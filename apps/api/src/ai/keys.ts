/**
 * Custody of users' Anthropic API keys (docs/ARCHITECTURE.md §7, "Bring your own key").
 *
 * - Stored only in Redis, one record per user, never in Postgres. The record holds the key
 *   encrypted with AES-256-GCM (random 96-bit IV per save, the user id as associated data so a
 *   record cannot be moved to another user) under a key derived with HKDF-SHA256 from
 *   AI_KEY_ENCRYPTION_SECRET, or BETTER_AUTH_SECRET when that is not set.
 * - Sliding expiry: the record expires `ttlHours` after it was last used; `resolve` (every model
 *   call) restarts the clock.
 * - Plaintext exists only while a model client is being built (`resolve` returns it to the
 *   interviewer, which keeps it inside a small, bounded client cache). It is never logged, never
 *   returned by an endpoint, never part of an error message. Only the last four characters are
 *   stored in the clear, for the UI.
 * - When Anthropic refuses the key in use, the ciphertext is replaced by a small "rejected"
 *   marker (last four + reason) so the UI can say what happened.
 */
import { createCipheriv, createDecipheriv, hkdfSync, randomBytes, randomUUID } from 'node:crypto';
import type { AiKeyProblem, AiKeyState } from '@ipp/contracts';
import type { ResolvedKey } from '@ipp/interviewer';
import type { Redis } from 'ioredis';

/** HKDF purpose label: a key derived for anything else from the same secret differs. */
export const AI_KEY_HKDF_INFO = 'interview++/user-anthropic-api-key/aes-256-gcm/v1';
const HKDF_SALT = 'interview++ ai key encryption';

interface ActiveRecord {
  v: 1;
  state: 'active';
  /** Changes on every save; lets the interviewer reuse a client for the same key. */
  id: string;
  iv: string;
  ct: string;
  tag: string;
  last4: string;
  savedAt: string;
}
interface RejectedRecord {
  v: 1;
  state: 'rejected';
  id: string;
  last4: string;
  problem: AiKeyProblem;
  at: string;
}
type KeyRecord = ActiveRecord | RejectedRecord;

export interface KeyStatus {
  state: AiKeyState;
  last4: string | null;
  expiresAt: string | null;
  problem: AiKeyProblem | null;
}

export function deriveKeyEncryptionKey(secret: string): Buffer {
  return Buffer.from(hkdfSync('sha256', secret, HKDF_SALT, AI_KEY_HKDF_INFO, 32));
}

const aad = (userId: string) => Buffer.from(`ipp-ai-key:v1:${userId}`, 'utf8');

export function encryptKey(
  kek: Buffer,
  userId: string,
  plaintext: string,
): { iv: string; ct: string; tag: string } {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', kek, iv);
  cipher.setAAD(aad(userId));
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return {
    iv: iv.toString('base64'),
    ct: ct.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
  };
}

/** Throws when the record was tampered with, belongs to another user or the secret changed. */
export function decryptKey(
  kek: Buffer,
  userId: string,
  rec: { iv: string; ct: string; tag: string },
): string {
  const decipher = createDecipheriv('aes-256-gcm', kek, Buffer.from(rec.iv, 'base64'));
  decipher.setAAD(aad(userId));
  decipher.setAuthTag(Buffer.from(rec.tag, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(rec.ct, 'base64')), decipher.final()]).toString(
    'utf8',
  );
}

// Replace the record only if it is still the key that was refused (a new key saved meanwhile wins).
const REJECT_SCRIPT = `
local v = redis.call('GET', KEYS[1])
if not v then return 0 end
local ok, rec = pcall(cjson.decode, v)
if not ok or rec.id ~= ARGV[1] or rec.state ~= 'active' then return 0 end
redis.call('SET', KEYS[1], ARGV[2], 'PX', ARGV[3])
return 1
`;

export class AiKeyStore {
  private readonly kek: Buffer;
  private readonly ttlMs: number;

  constructor(
    private readonly redis: Redis,
    private readonly prefix: string,
    secret: string,
    ttlHours: number,
    private readonly onUnreadable: (userId: string) => void = () => {},
  ) {
    this.kek = deriveKeyEncryptionKey(secret);
    this.ttlMs = ttlHours * 3600_000;
  }

  private redisKey(userId: string): string {
    return `${this.prefix}aikey:${userId}`;
  }

  private async read(userId: string): Promise<{ rec: KeyRecord | null; pttl: number }> {
    const k = this.redisKey(userId);
    const [[, raw], [, pttl]] = (await this.redis.multi().get(k).pttl(k).exec()) as [
      [unknown, string | null],
      [unknown, number],
    ];
    if (!raw) return { rec: null, pttl: -2 };
    try {
      const rec = JSON.parse(raw) as KeyRecord;
      if (rec?.v !== 1 || (rec.state !== 'active' && rec.state !== 'rejected'))
        return { rec: null, pttl };
      return { rec, pttl };
    } catch {
      return { rec: null, pttl };
    }
  }

  async status(userId: string): Promise<KeyStatus> {
    const { rec, pttl } = await this.read(userId);
    if (!rec) return { state: 'missing', last4: null, expiresAt: null, problem: null };
    const expiresAt = pttl > 0 ? new Date(Date.now() + pttl).toISOString() : null;
    if (rec.state === 'rejected')
      return { state: 'rejected', last4: rec.last4, expiresAt: null, problem: rec.problem };
    return { state: 'active', last4: rec.last4, expiresAt, problem: null };
  }

  async state(userId: string): Promise<AiKeyState> {
    return (await this.status(userId)).state;
  }

  /** Encrypts and stores the key (a fresh IV and id every time). The caller has verified it. */
  async save(userId: string, apiKey: string): Promise<KeyStatus> {
    const rec: ActiveRecord = {
      v: 1,
      state: 'active',
      id: randomUUID(),
      ...encryptKey(this.kek, userId, apiKey),
      last4: apiKey.slice(-4),
      savedAt: new Date().toISOString(),
    };
    await this.redis.set(this.redisKey(userId), JSON.stringify(rec), 'PX', this.ttlMs);
    return this.status(userId);
  }

  async delete(userId: string): Promise<boolean> {
    return (await this.redis.del(this.redisKey(userId))) > 0;
  }

  /**
   * The plaintext key for a model call, refreshing its expiry (this is "use"). A record that
   * cannot be decrypted (the secret was rotated, or it was tampered with) is deleted.
   */
  async resolve(userId: string): Promise<ResolvedKey> {
    const { rec } = await this.read(userId);
    if (!rec) return { ok: false, state: 'missing' };
    if (rec.state === 'rejected') return { ok: false, state: 'rejected' };
    let apiKey: string;
    try {
      apiKey = decryptKey(this.kek, userId, rec);
    } catch {
      await this.redis.del(this.redisKey(userId));
      this.onUnreadable(userId);
      return { ok: false, state: 'missing' };
    }
    await this.redis.pexpire(this.redisKey(userId), this.ttlMs);
    return { ok: true, keyId: rec.id, apiKey };
  }

  /** Anthropic refused key `keyId`: drop the ciphertext, keep last four and the reason. */
  async reject(userId: string, keyId: string, problem: AiKeyProblem): Promise<boolean> {
    const { rec } = await this.read(userId);
    if (rec?.state !== 'active' || rec.id !== keyId) return false;
    const marker: RejectedRecord = {
      v: 1,
      state: 'rejected',
      id: keyId,
      last4: rec.last4,
      problem,
      at: new Date().toISOString(),
    };
    const n = (await this.redis.eval(
      REJECT_SCRIPT,
      1,
      this.redisKey(userId),
      keyId,
      JSON.stringify(marker),
      this.ttlMs,
    )) as number;
    return n === 1;
  }
}
