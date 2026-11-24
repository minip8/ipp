/**
 * Bring-your-own Anthropic API key: custody (encryption, expiry, never echoed or logged), the
 * key endpoints, whose key a pad or a grading call runs on, and what happens without a key or
 * with one Anthropic rejects.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { AiKeyStatus, PadDetail, QuizAttempt, Report } from '@ipp/contracts';
import { sql } from '@ipp/db/orm';
import { Redis } from 'ioredis';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { AI_KEY_HKDF_INFO, decryptKey, deriveKeyEncryptionKey, encryptKey } from '../src/ai/keys';
import { loadConfig } from '../src/config';
import { defaultInterviewerFactory } from '../src/interviewer/wiring';
import { TEST_REDIS_URL } from './helpers/env';
import {
  Client,
  EventSocket,
  FakeInterviewer,
  flushRedis,
  type Harness,
  sleep,
  startApi,
  TEST_AI_KEY,
  TEST_AI_KEY_2,
  testConfig,
  until,
} from './helpers/harness';

let h: Harness;
let fake: FakeInterviewer;
let redis: Redis;
/** Every HTTP response body and WebSocket frame seen by these tests, searched for the keys. */
const seen: string[] = [];

beforeAll(async () => {
  await flushRedis();
  fake = new FakeInterviewer();
  h = await startApi({ fake, captureLogs: true });
  redis = new Redis(TEST_REDIS_URL);
});
afterAll(async () => {
  redis?.disconnect();
  await h?.stop();
});

let ipSeq = 1;
async function user(name: string) {
  // A fresh address per user so the per-IP save limit only bites where a test means it to.
  const c = new Client(h.base, `192.0.2.${ipSeq++}`);
  const req = c.req.bind(c);
  c.req = async (...args: Parameters<Client['req']>) => {
    const res = await req(...args);
    seen.push(res.text);
    return res;
  };
  const { id } = await c.signUp(name);
  return { c, id };
}

async function openEvents(c: Client, padId: string) {
  const ws = await EventSocket.open(`${h.wsBase}/ws/pads/${padId}?ticket=${await c.ticket(padId)}`);
  return ws;
}

const rawRecord = (userId: string) => redis.get(`ipptest:aikey:${userId}`);

async function newPad(c: Client, interviewer: object = {}) {
  return (
    await c.post('/api/pads', {
      problemSlug: 'two-sum',
      language: 'python',
      interviewer: { enabled: true, ...interviewer },
    })
  ).json as { id: string; shareToken: string };
}

async function waitReport(c: Client, padId: string): Promise<Report> {
  let r = await c.get(`/api/pads/${padId}/report`);
  for (let i = 0; i < 100 && r.json.status === 'pending'; i++) {
    await sleep(50);
    r = await c.get(`/api/pads/${padId}/report`);
  }
  return Report.parse(r.json);
}

describe('encryption', () => {
  const kek = deriveKeyEncryptionKey('x'.repeat(40));

  it('round-trips, with a fresh IV (different ciphertext) every time', () => {
    const a = encryptKey(kek, 'user-1', TEST_AI_KEY);
    const b = encryptKey(kek, 'user-1', TEST_AI_KEY);
    expect(a.ct).not.toBe(b.ct);
    expect(a.iv).not.toBe(b.iv);
    expect(decryptKey(kek, 'user-1', a)).toBe(TEST_AI_KEY);
    expect(decryptKey(kek, 'user-1', b)).toBe(TEST_AI_KEY);
    expect(JSON.stringify(a)).not.toContain('TESTKEY');
  });

  it('is bound to the user, the secret and the purpose label', () => {
    const rec = encryptKey(kek, 'user-1', TEST_AI_KEY);
    expect(() => decryptKey(kek, 'user-2', rec)).toThrow();
    expect(() => decryptKey(deriveKeyEncryptionKey('y'.repeat(40)), 'user-1', rec)).toThrow();
    const tampered = { ...rec, ct: Buffer.from('x'.repeat(rec.ct.length)).toString('base64') };
    expect(() => decryptKey(kek, 'user-1', tampered)).toThrow();
    expect(AI_KEY_HKDF_INFO).toMatch(/api-key/);
    // The derived key is not the secret itself.
    expect(kek.equals(Buffer.from('x'.repeat(40)).subarray(0, 32))).toBe(false);
  });

  it('uses AI_KEY_ENCRYPTION_SECRET when set, otherwise BETTER_AUTH_SECRET', () => {
    const before = process.env.AI_KEY_ENCRYPTION_SECRET;
    try {
      delete process.env.AI_KEY_ENCRYPTION_SECRET;
      const a = loadConfig({ env: 'test' });
      expect(a.aiKeySecret).toBe(a.authSecret);
      process.env.AI_KEY_ENCRYPTION_SECRET = 'k'.repeat(48);
      expect(loadConfig({ env: 'test' }).aiKeySecret).toBe('k'.repeat(48));
      process.env.AI_KEY_ENCRYPTION_SECRET = 'short';
      expect(() => loadConfig({ env: 'test' })).toThrow(/AI_KEY_ENCRYPTION_SECRET/);
    } finally {
      if (before === undefined) delete process.env.AI_KEY_ENCRYPTION_SECRET;
      else process.env.AI_KEY_ENCRYPTION_SECRET = before;
    }
  });
});

describe('key endpoints', () => {
  it('status, save, replace, delete; only the last four characters ever come back', async () => {
    const { c, id } = await user('Keeper');
    const empty = AiKeyStatus.parse((await c.get('/api/ai-key')).json);
    expect(empty).toMatchObject({ state: 'missing', last4: null, expiresAt: null, problem: null });
    expect(empty).toMatchObject({ model: 'claude-opus-5-5', ttlHours: 24 });

    const saved = await c.put('/api/ai-key', { apiKey: `  ${TEST_AI_KEY}\n` });
    expect(saved.status).toBe(200);
    const st = AiKeyStatus.parse(saved.json);
    expect(st).toMatchObject({ state: 'active', last4: 'QWER', problem: null });
    const ttl = Date.parse(st.expiresAt ?? '') - Date.now();
    expect(ttl).toBeGreaterThan(23.9 * 3600_000);
    expect(ttl).toBeLessThanOrEqual(24 * 3600_000);
    expect(h.verifier.calls.at(-1)).toBe(TEST_AI_KEY); // trimmed before verifying

    // Stored encrypted: the Redis record has no plaintext, and every save re-encrypts.
    const first = await rawRecord(id);
    expect(first).toBeTruthy();
    expect(first).not.toContain('TESTKEY');
    await c.put('/api/ai-key', { apiKey: TEST_AI_KEY });
    const second = await rawRecord(id);
    expect(JSON.parse(second ?? '{}').ct).not.toBe(JSON.parse(first ?? '{}').ct);
    expect(JSON.parse(second ?? '{}').id).not.toBe(JSON.parse(first ?? '{}').id);

    // Replacing with another key.
    expect((await c.put('/api/ai-key', { apiKey: TEST_AI_KEY_2 })).json.last4).toBe('ZXCV');

    const del = await c.del('/api/ai-key');
    expect(del.status).toBe(200);
    expect(del.json.state).toBe('missing');
    expect(await rawRecord(id)).toBeNull();
    expect((await c.del('/api/ai-key')).json.state).toBe('missing');
  });

  it('validates the format locally and the key with Anthropic; nothing stored on refusal', async () => {
    const { c, id } = await user('Refused');
    const calls = h.verifier.calls.length;
    for (const apiKey of ['', 'not-a-key', 'sk-ant-short', `sk-ant-${'a'.repeat(30)} x`]) {
      const res = await c.put('/api/ai-key', { apiKey });
      expect(res.status).toBe(400);
      expect(res.json.error.code).toBe('validation_error');
    }
    expect((await c.put('/api/ai-key', {})).status).toBe(400);
    expect(h.verifier.calls.length).toBe(calls); // never sent to Anthropic

    const revoked = 'sk-ant-api03-revoked-0000000000000000000000000000-AAAA';
    const bad = await c.put('/api/ai-key', { apiKey: revoked });
    expect(bad.status).toBe(422);
    expect(bad.json.error.code).toBe('ai_key_rejected');
    expect(bad.json.error.message).toMatch(/did not accept this key/);
    expect(bad.text).not.toContain(revoked);
    const broke = await c.put('/api/ai-key', {
      apiKey: 'sk-ant-api03-broke-000000000000000000000000000000-BBBB',
    });
    expect(broke.status).toBe(422);
    expect(broke.json.error.message).toMatch(/no credit/);
    const down = await c.put('/api/ai-key', {
      apiKey: 'sk-ant-api03-down-0000000000000000000000000000000-CCCC',
    });
    expect(down.status).toBe(503);
    expect(down.json.error.code).toBe('ai_key_unverifiable');
    expect(await rawRecord(id)).toBeNull();
    expect((await c.get('/api/ai-key')).json.state).toBe('missing');
  });

  it('requires a session and the web origin, and caps the body size', async () => {
    const anon = new Client(h.base, '192.0.2.200');
    expect((await anon.get('/api/ai-key')).status).toBe(401);
    expect((await anon.put('/api/ai-key', { apiKey: TEST_AI_KEY })).status).toBe(401);
    expect((await anon.del('/api/ai-key')).status).toBe(401);

    const { c, id } = await user('Origin');
    const cross = await c.req(
      'PUT',
      '/api/ai-key',
      { apiKey: TEST_AI_KEY },
      {
        origin: 'https://evil.example',
      },
    );
    expect(cross.status).toBe(403);
    const crossDel = await c.req('DELETE', '/api/ai-key', undefined, {
      origin: 'https://evil.example',
    });
    expect(crossDel.status).toBe(403);
    const big = await c.put('/api/ai-key', { apiKey: TEST_AI_KEY, pad: 'x'.repeat(4000) });
    expect(big.status).toBe(413);
    expect(await rawRecord(id)).toBeNull();
  });

  it('rate limits saving per user and per address (it is not a key-checking oracle)', async () => {
    const l = h.api.ctx.config.limits.aiKeySave;
    const { c } = await user('Oracle');
    const before = h.verifier.calls.length;
    const statuses: number[] = [];
    for (let i = 0; i < l.userBurst.limit + 3; i++) {
      const res = await c.put('/api/ai-key', {
        apiKey: `sk-ant-api03-guess${i}-000000000000000000000000000000`,
      });
      statuses.push(res.status);
      if (res.status === 429) {
        expect(res.json.error.code).toBe('rate_limited');
        expect(res.json.error.retryAfter).toBeGreaterThan(0);
      }
    }
    expect(statuses.filter((s) => s === 422)).toHaveLength(l.userBurst.limit);
    expect(statuses.slice(l.userBurst.limit).every((s) => s === 429)).toBe(true);
    expect(h.verifier.calls.length - before).toBe(l.userBurst.limit);
    // A valid key is refused too while limited; deleting is not limited.
    expect((await c.put('/api/ai-key', { apiKey: TEST_AI_KEY })).status).toBe(429);
    expect((await c.del('/api/ai-key')).status).toBe(200);

    // Many accounts from one address share the per-address budget.
    const ip = '198.18.0.1';
    let accepted = 0;
    let limited = false;
    for (let n = 0; n < Math.ceil(l.ipBurst.limit / 2) + 2 && !limited; n++) {
      const u = new Client(h.base, ip);
      await u.signUp(`Sock${n}`);
      for (let i = 0; i < 2; i++) {
        const res = await u.put('/api/ai-key', { apiKey: TEST_AI_KEY });
        if (res.status === 429) limited = true;
        else accepted++;
      }
    }
    expect(limited).toBe(true);
    expect(accepted).toBe(l.ipBurst.limit);
  });

  it('expires after the TTL without use; each use refreshes it', async () => {
    const { c, id } = await user('Expiry');
    await c.saveKey();
    const k = `ipptest:aikey:${id}`;
    await redis.pexpire(k, 2000);
    expect(await redis.pttl(k)).toBeLessThanOrEqual(2000);
    // Use: resolving the key for a model call (here a grading call) restarts the clock.
    const r = await fake.deps.resolveKey({ userId: id });
    expect(r).toMatchObject({ ok: true, apiKey: TEST_AI_KEY });
    expect(await redis.pttl(k)).toBeGreaterThan(23.9 * 3600_000);
    // Reading the status is not use.
    await redis.pexpire(k, 2000);
    await c.get('/api/ai-key');
    expect(await redis.pttl(k)).toBeLessThanOrEqual(2000);
    // Unused: gone.
    await redis.pexpire(k, 50);
    await sleep(120);
    expect((await c.get('/api/ai-key')).json.state).toBe('missing');
    expect(await fake.deps.resolveKey({ userId: id })).toEqual({ ok: false, state: 'missing' });
  });

  it('a record that cannot be decrypted (secret rotated) counts as no key and is removed', async () => {
    const { c, id } = await user('Rotated');
    await c.saveKey();
    const rec = JSON.parse((await rawRecord(id)) ?? '{}');
    const other = encryptKey(deriveKeyEncryptionKey('z'.repeat(40)), id, TEST_AI_KEY);
    await redis.set(`ipptest:aikey:${id}`, JSON.stringify({ ...rec, ...other }), 'PX', 60_000);
    expect(await fake.deps.resolveKey({ userId: id })).toEqual({ ok: false, state: 'missing' });
    expect(await rawRecord(id)).toBeNull();
  });

  it('signing out removes the stored key', async () => {
    const { c, id } = await user('SignOut');
    await c.saveKey();
    expect(await rawRecord(id)).toBeTruthy();
    expect((await c.post('/api/auth/sign-out', {})).status).toBe(200);
    expect(await rawRecord(id)).toBeNull();
  });
});

describe('whose key', () => {
  it('a pad runs on its owner key; collaborators use it and learn nothing about it', async () => {
    const owner = await user('Owner');
    const collab = await user('Collab');
    await owner.c.saveKey(TEST_AI_KEY);
    await collab.c.saveKey(TEST_AI_KEY_2);
    const pad = await newPad(owner.c);
    await collab.c.post('/api/pads/join', { shareToken: pad.shareToken });

    const detail = await collab.c.get(`/api/pads/${pad.id}`);
    expect(PadDetail.parse(detail.json)).toMatchObject({
      interviewerAvailable: true,
      interviewerKey: 'active',
    });
    expect(detail.text).not.toContain('QWER'); // not even the last four
    // The collaborator's own key status is their own.
    expect((await collab.c.get('/api/ai-key')).json.last4).toBe('ZXCV');

    const ws = await openEvents(collab.c, pad.id);
    fake.keysUsed = [];
    ws.send({ type: 'chat.send', text: 'Is the array sorted?' });
    await ws.waitFor('message.created', (e) => e.message.role === 'interviewer');
    expect(fake.keysUsed).toEqual([TEST_AI_KEY]);
    seen.push(...ws.raw);
    ws.close();

    // Quiz grading uses the quiz taker's key.
    const attempt = QuizAttempt.parse(
      (await collab.c.post('/api/quiz/attempts', { topics: ['test-topic'], count: 4 })).json,
    );
    fake.keysUsed = [];
    const graded = await collab.c.post(`/api/quiz/attempts/${attempt.id}/answers`, {
      questionId: 'tq-short',
      response: { type: 'short', text: 'Destructors release resources.' },
    });
    expect(graded.json.gradedBy).toBe('ai');
    expect(fake.keysUsed).toEqual([TEST_AI_KEY_2]);
  });

  it('without the owner key the interviewer is silent even if a collaborator has one', async () => {
    const owner = await user('NoKeyOwner');
    const collab = await user('KeyedCollab');
    await collab.c.saveKey(TEST_AI_KEY_2);
    const pad = await newPad(owner.c);
    await collab.c.post('/api/pads/join', { shareToken: pad.shareToken });
    expect((await collab.c.get(`/api/pads/${pad.id}`)).json).toMatchObject({
      interviewerAvailable: false,
      interviewerKey: 'missing',
    });
    const ws = await openEvents(collab.c, pad.id);
    fake.keysUsed = [];
    ws.send({ type: 'chat.send', text: 'hello?' });
    await ws.waitFor('message.created', (e) => e.message.role === 'candidate');
    await until(() => fake.of('candidate_message', pad.id).length === 1);
    await sleep(200);
    expect(fake.keysUsed).toEqual([]);
    expect(
      ws.events.some((e) => e.type === 'message.created' && e.message.role === 'interviewer'),
    ).toBe(false);
    seen.push(...ws.raw);
    ws.close();
  });
});

describe('without a key, and when Anthropic rejects it', () => {
  it('adding a key turns the interviewer on live, for everyone in the pad', async () => {
    const owner = await user('LateKey');
    const collab = await user('Watcher');
    const pad = await newPad(owner.c);
    await collab.c.post('/api/pads/join', { shareToken: pad.shareToken });
    const wsOwner = await openEvents(owner.c, pad.id);
    const wsCollab = await openEvents(collab.c, pad.id);
    await until(() => fake.of('session_started', pad.id).length === 1);

    await owner.c.saveKey();
    expect((await wsOwner.waitFor('interviewer.status')).key).toBe('active');
    expect((await wsCollab.waitFor('interviewer.status')).key).toBe('active');
    // The interviewer gets another chance to greet now that it can speak.
    await until(() => fake.of('session_started', pad.id).length === 2);
    expect((await owner.c.get(`/api/pads/${pad.id}`)).json.interviewerAvailable).toBe(true);

    await owner.c.del('/api/ai-key');
    await wsCollab.waitFor('interviewer.status', (e) => e.key === 'missing');
    expect((await collab.c.get(`/api/pads/${pad.id}`)).json.interviewerAvailable).toBe(false);
    seen.push(...wsOwner.raw, ...wsCollab.raw);
    wsOwner.close();
    wsCollab.close();
  });

  it('a key rejected at runtime: one notice, status "rejected", then silence', async () => {
    const owner = await user('Revoked');
    await owner.c.saveKey();
    const pad = await newPad(owner.c);
    const ws = await openEvents(owner.c, pad.id);
    fake.rejectNext = 'invalid';
    ws.send({ type: 'chat.send', text: 'first' });
    const notice = await ws.waitFor('message.created', (e) => e.message.role === 'interviewer');
    expect(notice.message.text).toMatch(/rejected/);
    expect((await ws.waitFor('interviewer.status')).key).toBe('rejected');

    const st = AiKeyStatus.parse((await owner.c.get('/api/ai-key')).json);
    expect(st).toMatchObject({
      state: 'rejected',
      last4: 'QWER',
      problem: 'invalid',
      expiresAt: null,
    });
    const rec = (await rawRecord(owner.id)) ?? '';
    expect(rec).not.toContain('"ct"'); // the ciphertext is gone
    expect((await owner.c.get(`/api/pads/${pad.id}`)).json).toMatchObject({
      interviewerAvailable: false,
      interviewerKey: 'rejected',
    });

    fake.keysUsed = [];
    ws.send({ type: 'chat.send', text: 'second' });
    await until(() => fake.of('candidate_message', pad.id).length === 2);
    await sleep(200);
    expect(fake.keysUsed).toEqual([]);
    const interviewerMsgs = (await owner.c.get(`/api/pads/${pad.id}`)).json.messages.filter(
      (m: { role: string }) => m.role === 'interviewer',
    );
    expect(interviewerMsgs).toHaveLength(1);

    // A report for this pad says the key was rejected.
    await owner.c.post(`/api/pads/${pad.id}/end`);
    expect((await waitReport(owner.c, pad.id)).assessmentUnavailable).toBe('key_rejected');

    // Saving a new key clears the state.
    await owner.c.saveKey(TEST_AI_KEY_2);
    expect((await owner.c.get('/api/ai-key')).json).toMatchObject({
      state: 'active',
      last4: 'ZXCV',
    });
    seen.push(...ws.raw);
    ws.close();
  });

  it('a stale rejection does not clobber a key saved meanwhile', async () => {
    const { c, id } = await user('Race');
    await c.saveKey();
    const old = JSON.parse((await rawRecord(id)) ?? '{}').id as string;
    await c.saveKey(TEST_AI_KEY_2);
    await fake.deps.keyRejected({ userId: id }, old, 'invalid');
    expect((await c.get('/api/ai-key')).json).toMatchObject({ state: 'active', last4: 'ZXCV' });
  });

  it('report: no key -> stats only and a prompt; with a key the owner can ask for it', async () => {
    const owner = await user('ReportOwner');
    const collab = await user('ReportCollab');
    const pad = await newPad(owner.c);
    await collab.c.post('/api/pads/join', { shareToken: pad.shareToken });
    await owner.c.post(`/api/pads/${pad.id}/end`);
    const r1 = await waitReport(owner.c, pad.id);
    expect(r1).toMatchObject({
      status: 'ready',
      assessment: null,
      assessmentUnavailable: 'no_key',
    });
    expect(r1.stats).toBeTruthy();

    expect((await owner.c.post(`/api/pads/${pad.id}/report/assessment`)).json.error.code).toBe(
      'ai_key_missing',
    );
    await owner.c.saveKey();
    expect((await collab.c.post(`/api/pads/${pad.id}/report/assessment`)).status).toBe(403);
    const asked = await owner.c.post(`/api/pads/${pad.id}/report/assessment`);
    expect(asked.status).toBe(200);
    expect(['pending', 'ready']).toContain(asked.json.status);
    const r2 = await waitReport(owner.c, pad.id);
    expect(r2.assessment?.recommendation).toBe('hire');
    expect(r2.assessmentUnavailable).toBeNull();
    // Already there: asking again changes nothing and calls nothing.
    fake.keysUsed = [];
    expect((await owner.c.post(`/api/pads/${pad.id}/report/assessment`)).json.status).toBe('ready');
    expect(fake.keysUsed).toEqual([]);
  });

  it('quiz grading without a key falls back to self-grading without calling the model', async () => {
    const { c } = await user('NoKeyQuiz');
    const attempt = QuizAttempt.parse(
      (await c.post('/api/quiz/attempts', { topics: ['test-topic'], count: 4 })).json,
    );
    fake.keysUsed = [];
    const res = await c.post(`/api/quiz/attempts/${attempt.id}/answers`, {
      questionId: 'tq-short',
      response: { type: 'short', text: 'something' },
    });
    expect(res.json).toMatchObject({ gradedBy: 'self', needsSelfGrade: true });
    expect(fake.keysUsed).toEqual([]);
  });
});

describe('the key never leaks', () => {
  it('not in any response, WebSocket frame, log line or Postgres row', async () => {
    const needles = [TEST_AI_KEY, TEST_AI_KEY_2, 'TESTKEY', 'SECONDKEY'];
    expect(seen.length).toBeGreaterThan(50);
    expect(h.logs.length).toBeGreaterThan(50);
    const haystacks: [string, string][] = [
      ['responses and frames', seen.join('\n')],
      ['logs', h.logs.join('\n')],
    ];
    const tables = await h.api.ctx.db.execute<{ table_name: string }>(
      sql`select table_name from information_schema.tables where table_schema = 'public'`,
    );
    for (const { table_name } of tables) {
      const rows = await h.api.ctx.db.execute<{ t: string | null }>(
        sql`select string_agg(x::text, E'\n') as t from ${sql.identifier(table_name)} x`,
      );
      haystacks.push([`table ${table_name}`, rows[0]?.t ?? '']);
    }
    expect(tables.length).toBeGreaterThan(10);
    for (const [where, text] of haystacks)
      for (const n of needles) expect(text.includes(n), `${n} found in ${where}`).toBe(false);
  });
});

describe('no operator key', () => {
  it('the API source never reads an Anthropic key from the environment', () => {
    const root = join(import.meta.dirname, '../src');
    const files: string[] = [];
    const walk = (d: string) => {
      for (const f of readdirSync(d)) {
        const p = join(d, f);
        if (statSync(p).isDirectory()) walk(p);
        else if (p.endsWith('.ts')) files.push(p);
      }
    };
    walk(root);
    for (const f of files) {
      const src = readFileSync(f, 'utf8');
      expect(src, f).not.toMatch(/env(\.|\[['"])ANTHROPIC/);
      expect(src, f).not.toMatch(/anthropicApiKey|apiKey:\s*config/);
    }
  });

  it('with ANTHROPIC_API_KEY / ANTHROPIC_KEY set, no model call is made without a user key, and user calls carry the user key', async () => {
    const OPERATOR = 'sk-ant-api03-OPERATOR-KEY-must-never-be-used-000000';
    const saved = { a: process.env.ANTHROPIC_API_KEY, b: process.env.ANTHROPIC_KEY };
    process.env.ANTHROPIC_API_KEY = OPERATOR;
    process.env.ANTHROPIC_KEY = OPERATOR;
    try {
      const config = loadConfig({ ...testConfig(), env: 'test' });
      expect(JSON.stringify(config)).not.toContain(OPERATOR);
      const calls: string[] = [];
      vi.stubGlobal('fetch', async (_url: unknown, init?: RequestInit) => {
        calls.push(JSON.stringify(Object.fromEntries(new Headers(init?.headers))));
        return new Response(
          JSON.stringify({ type: 'error', error: { type: 'overloaded_error', message: 'x' } }),
          { status: 529, headers: { 'content-type': 'application/json' } },
        );
      });
      let key: { ok: true; keyId: string; apiKey: string } | { ok: false; state: 'missing' } = {
        ok: false,
        state: 'missing',
      };
      const factory = defaultInterviewerFactory(config);
      const iv = factory({
        now: () => new Date(),
        resolveKey: async () => key,
        keyRejected: async () => {},
        loadContext: async () => {
          throw new Error('no pad');
        },
        saveMessage: async () => {
          throw new Error('no');
        },
        appendPrivateNote: async () => {},
        emit: () => {},
        checkBudget: async () => ({ ok: true }),
        log: { info() {}, warn() {}, error() {} },
      });
      const q = {
        id: 'q',
        topic: 't',
        subtopic: 's',
        difficulty: 'easy' as const,
        prompt: 'p',
        explanation: '',
        tags: [],
        type: 'short' as const,
        reference: 'r',
        keyPoints: ['a'],
      };
      expect(await iv.gradeShortAnswer('u', q, 'a')).toBeNull();
      iv.handle('11111111-1111-4111-8111-111111111111', { type: 'session_started' });
      await sleep(50);
      expect(calls).toEqual([]);

      key = { ok: true, keyId: 'k', apiKey: TEST_AI_KEY };
      expect(await iv.gradeShortAnswer('u', q, 'a')).toBeNull(); // 529 from the stub
      expect(calls.length).toBeGreaterThan(0);
      for (const c of calls) {
        expect(c).toContain(TEST_AI_KEY);
        expect(c).not.toContain(OPERATOR);
      }
    } finally {
      // The test files share one process: never leave the fake fetch behind.
      vi.unstubAllGlobals();
      for (const [k, v] of [
        ['ANTHROPIC_API_KEY', saved.a],
        ['ANTHROPIC_KEY', saved.b],
      ] as const) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
    }
  });
});
