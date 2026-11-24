import { randomUUID } from 'node:crypto';
import type { ReportAssessment, ServerEvent } from '@ipp/contracts';
import { Redis } from 'ioredis';
import { WebSocket } from 'ws';
import { type Api, createApi } from '../../src/app';
import { type Config, DEFAULT_LIMITS, loadConfig } from '../../src/config';
import type { InterviewerFactory } from '../../src/interviewer/host';
import type {
  Interviewer,
  InterviewerDeps,
  ShortAnswerGrade,
  Trigger,
} from '../../src/interviewer/types';
import type { KeyVerifier } from '../../src/interviewer/wiring';
import { createLogger } from '../../src/log';
import { TEST_DATABASE_URL, TEST_REDIS_URL, TEST_WEB_ORIGIN } from './env';

export function testConfig(overrides: Partial<Config> = {}): Config {
  return loadConfig({
    env: 'test',
    databaseUrl: TEST_DATABASE_URL,
    redisUrl: TEST_REDIS_URL,
    port: 0,
    host: '127.0.0.1',
    webOrigin: TEST_WEB_ORIGIN,
    apiOrigin: 'http://api.test:4000',
    logLevel: process.env.TEST_LOG_LEVEL ?? 'silent',
    redisPrefix: 'ipptest:',
    consumerName: 'api-test',
    trustProxy: true,
    limits: structuredClone(DEFAULT_LIMITS),
    timing: {
      tickMs: 200,
      watchdogMs: 200,
      runGraceMs: 30_000,
      collabDebounceMs: 100,
      collabMaxDebounceMs: 500,
      historyCoalesceMs: 200,
      codeChangedMinGapMs: 1000,
    },
    ...overrides,
  });
}

export async function flushRedis(): Promise<void> {
  const r = new Redis(TEST_REDIS_URL);
  await r.flushdb();
  r.disconnect();
}

/** Test keys. The fake verifier accepts anything with "good" in it. */
export const TEST_AI_KEY = 'sk-ant-api03-good-TESTKEY-4f9c2d1e8b7a6c5d4e3f2a1b0c9d8e7f-QWER';
export const TEST_AI_KEY_2 = 'sk-ant-api03-good-SECONDKEY-0a1b2c3d4e5f6a7b8c9d0e1f2a3b-ZXCV';

/** Stand-in for the one real Anthropic call made when a key is saved. */
export class FakeVerifier {
  calls: string[] = [];
  verify: KeyVerifier = async (apiKey) => {
    this.calls.push(apiKey);
    if (apiKey.includes('good')) return { ok: true };
    if (apiKey.includes('broke')) return { ok: false, problem: 'billing' };
    if (apiKey.includes('down')) return { ok: false, problem: 'unverifiable' };
    return { ok: false, problem: 'invalid' };
  };
}

/**
 * A scripted stand-in for @ipp/interviewer that uses the deps boundary like the real one: every
 * reply, assessment and grade first resolves the key of whoever pays (pad owner / quiz taker)
 * and stays silent without one. `rejectNext` makes the next model call fail as if Anthropic
 * refused the key.
 */
export class FakeInterviewer implements Interviewer {
  deps!: InterviewerDeps;
  /** Plaintext keys the fake was handed, in order (what a real client would be built with). */
  keysUsed: string[] = [];
  rejectNext: 'invalid' | 'billing' | null = null;
  triggers: { padId: string; trigger: Trigger }[] = [];
  released: string[] = [];
  shortGrade: ShortAnswerGrade | null = { score: 0.9, feedback: 'Covered the key point.' };
  assessment: ReportAssessment | null = {
    recommendation: 'hire',
    summary: 'Solid.',
    scores: [{ dimension: 'coding', score: 3, evidence: 'Clean code.' }],
    strengths: ['clear'],
    improvements: ['tests'],
  };

  factory: InterviewerFactory = (deps) => {
    this.deps = deps;
    return this;
  };

  handle(padId: string, trigger: Trigger): void {
    this.triggers.push({ padId, trigger });
    if (trigger.type === 'candidate_message') void this.reply(padId, trigger.text);
  }

  /** Resolve the key and "call the model"; null = stay silent. */
  private async model(scope: Parameters<InterviewerDeps['resolveKey']>[0]): Promise<boolean> {
    const key = await this.deps.resolveKey(scope);
    if (!key.ok) return false;
    this.keysUsed.push(key.apiKey);
    if (this.rejectNext) {
      const problem = this.rejectNext;
      this.rejectNext = null;
      await this.deps.keyRejected(scope, key.keyId, problem);
      if ('padId' in scope)
        await this.deps.saveMessage(scope.padId, {
          kind: 'chat',
          intent: 'answer',
          text: 'Anthropic rejected the API key this pad runs on.',
        });
      return false;
    }
    this.deps.recordUsage?.(scope, {
      purpose: 'padId' in scope ? 'reply' : 'grade',
      model: 'fake',
      inputTokens: 100,
      outputTokens: 10,
      cacheReadInputTokens: 0,
      cacheCreationInputTokens: 0,
    });
    return true;
  }

  private async reply(padId: string, text: string) {
    if (!(await this.model({ padId }))) return;
    const ctx = await this.deps.loadContext(padId);
    const id = randomUUID();
    this.deps.emit(padId, { type: 'interviewer.thinking', active: true });
    this.deps.emit(padId, { type: 'message.delta', messageId: id, delta: 'Echo: ' });
    await this.deps.saveMessage(padId, {
      id,
      kind: 'chat',
      intent: 'answer',
      text: `Echo: ${text} | ${ctx.language} code ${ctx.code.length} chars | notes "${ctx.notes}"`,
    });
    this.deps.emit(padId, { type: 'interviewer.thinking', active: false });
  }

  of(type: Trigger['type'], padId?: string) {
    return this.triggers.filter((t) => t.trigger.type === type && (!padId || t.padId === padId));
  }

  release(padId: string): void {
    this.released.push(padId);
  }
  generateAssessment = async (padId: string) =>
    (await this.model({ padId })) ? this.assessment : null;
  gradeShortAnswer = async (userId: string) => {
    if (!(await this.model({ userId }))) return null;
    await new Promise((r) => setTimeout(r, 5));
    return this.shortGrade;
  };
}

export interface Harness {
  api: Api;
  base: string;
  wsBase: string;
  fake: FakeInterviewer;
  verifier: FakeVerifier;
  /** Every log line, when started with `captureLogs`. */
  logs: string[];
  stop(): Promise<void>;
}

export async function startApi(
  opts: { config?: Partial<Config>; fake?: FakeInterviewer; captureLogs?: boolean } = {},
): Promise<Harness> {
  const config = testConfig(opts.captureLogs ? { logLevel: 'trace', ...opts.config } : opts.config);
  const fake = opts.fake ?? new FakeInterviewer();
  const verifier = new FakeVerifier();
  const logs: string[] = [];
  const log = opts.captureLogs
    ? createLogger(config.logLevel, false, { write: (line: string) => void logs.push(line) })
    : createLogger(config.logLevel);
  const api = await createApi({
    config,
    log,
    interviewerFactory: fake.factory,
    verifyAiKey: verifier.verify,
  });
  const port = await api.listen(0);
  return {
    api,
    base: `http://127.0.0.1:${port}`,
    wsBase: `ws://127.0.0.1:${port}`,
    fake,
    verifier,
    logs,
    stop: () => api.stop(),
  };
}

/** HTTP client with a cookie jar that behaves like a browser on the web origin. */
export class Client {
  cookies = new Map<string, string>();
  constructor(
    readonly base: string,
    readonly ip = '203.0.113.7',
  ) {}

  async req(method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
    const h: Record<string, string> = { 'x-forwarded-for': this.ip, ...headers };
    if (method !== 'GET' && !('origin' in h)) h.origin = TEST_WEB_ORIGIN;
    if (body !== undefined) h['content-type'] = 'application/json';
    if (this.cookies.size) h.cookie = [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ');
    const res = await fetch(this.base + path, {
      method,
      headers: h,
      body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
    });
    for (const sc of res.headers.getSetCookie()) {
      const [pair] = sc.split(';');
      const i = pair?.indexOf('=') ?? -1;
      if (pair && i > 0) {
        const name = pair.slice(0, i);
        const value = pair.slice(i + 1);
        if (value === '' || /max-age=0/i.test(sc)) this.cookies.delete(name);
        else this.cookies.set(name, value);
      }
    }
    const text = await res.text();
    // biome-ignore lint/suspicious/noExplicitAny: test responses are asserted structurally
    let json: any = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = text;
    }
    return { status: res.status, json, text, headers: res.headers };
  }
  get = (p: string) => this.req('GET', p);
  post = (p: string, b?: unknown) => this.req('POST', p, b ?? {});
  patch = (p: string, b: unknown) => this.req('PATCH', p, b);
  put = (p: string, b: unknown) => this.req('PUT', p, b);
  del = (p: string) => this.req('DELETE', p);

  /** Saves an Anthropic API key for the signed-in user (through the fake verifier). */
  async saveKey(apiKey = TEST_AI_KEY) {
    const res = await this.put('/api/ai-key', { apiKey });
    if (res.status !== 200) throw new Error(`saving key failed: ${res.status} ${res.text}`);
    return res.json;
  }

  async signUp(name = 'Tester') {
    const email = `${name.toLowerCase()}-${randomUUID().slice(0, 8)}@example.com`;
    const res = await this.post('/api/auth/sign-up/email', {
      name,
      email,
      password: 'correct horse battery',
    });
    if (res.status !== 200) throw new Error(`sign-up failed: ${res.status} ${res.text}`);
    const me = await this.get('/api/me');
    return { email, id: me.json.user.id as string };
  }

  async ticket(padId: string): Promise<string> {
    const res = await this.post('/api/ws-ticket', { padId });
    if (res.status !== 200) throw new Error(`ticket failed: ${res.status} ${res.text}`);
    return res.json.ticket;
  }
}

/** Event-channel socket that records every server event. */
export class EventSocket {
  events: ServerEvent[] = [];
  raw: string[] = [];
  private waiters: { pred: (e: ServerEvent) => boolean; resolve: (e: ServerEvent) => void }[] = [];
  constructor(readonly ws: WebSocket) {
    ws.on('message', (data) => {
      const s = data.toString();
      this.raw.push(s);
      const e = JSON.parse(s) as ServerEvent;
      this.events.push(e);
      this.waiters = this.waiters.filter((w) => {
        if (w.pred(e)) {
          w.resolve(e);
          return false;
        }
        return true;
      });
    });
  }
  static open(url: string): Promise<EventSocket> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(url);
      const s = new EventSocket(ws);
      ws.once('open', () => resolve(s));
      ws.once('error', reject);
      ws.once('unexpected-response', (_req, res) =>
        reject(new Error(`ws rejected: ${res.statusCode}`)),
      );
    });
  }
  send(e: unknown) {
    this.ws.send(JSON.stringify(e));
  }
  waitFor<T extends ServerEvent['type']>(
    type: T,
    pred: (e: Extract<ServerEvent, { type: T }>) => boolean = () => true,
    ms = 10_000,
  ) {
    const existing = this.events.find(
      (e) => e.type === type && pred(e as Extract<ServerEvent, { type: T }>),
    );
    if (existing) return Promise.resolve(existing as Extract<ServerEvent, { type: T }>);
    return new Promise<Extract<ServerEvent, { type: T }>>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`timed out waiting for ${type}`)), ms);
      this.waiters.push({
        pred: (e) => e.type === type && pred(e as Extract<ServerEvent, { type: T }>),
        resolve: (e) => {
          clearTimeout(timer);
          resolve(e as Extract<ServerEvent, { type: T }>);
        },
      });
    });
  }
  close() {
    this.ws.close();
  }
}

export async function until(
  pred: () => boolean | Promise<boolean>,
  ms = 10_000,
  step = 50,
): Promise<void> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await pred()) return;
    await new Promise((r) => setTimeout(r, step));
  }
  throw new Error('condition not met in time');
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
