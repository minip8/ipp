/**
 * Environment: the root .env is loaded (without overriding variables already set), then
 * validated with Zod. Every variable has a development default except real secrets; in
 * production missing values are fatal.
 */
import { hostname } from 'node:os';
import type { AiProvider } from '@ipp/contracts';
import { loadRootEnv } from '@ipp/db';
import { interviewerConfigFromEnv } from '@ipp/interviewer';
import { z } from 'zod';

const emptyToUndefined = (v: unknown) => (typeof v === 'string' && v.trim() === '' ? undefined : v);
const opt = <T extends z.ZodType>(s: T) => z.preprocess(emptyToUndefined, s.optional());
const withDefault = <T extends z.ZodType>(s: T, d: z.input<T>) =>
  z.preprocess(emptyToUndefined, s.default(d as never));

const DEV_SECRET = 'dev-only-secret-not-for-production-use-0123456789';

const Env = z.object({
  NODE_ENV: withDefault(z.enum(['development', 'test', 'production']), 'development'),
  DATABASE_URL: opt(z.string()),
  REDIS_URL: opt(z.string()),
  API_PORT: withDefault(z.coerce.number().int().min(0).max(65535), 4000),
  API_HOST: withDefault(z.string(), '0.0.0.0'),
  API_ORIGIN: opt(z.url()),
  WEB_ORIGIN: opt(z.url()),
  BETTER_AUTH_SECRET: opt(z.string().min(32)),
  GITHUB_CLIENT_ID: opt(z.string()),
  GITHUB_CLIENT_SECRET: opt(z.string()),
  GOOGLE_CLIENT_ID: opt(z.string()),
  GOOGLE_CLIENT_SECRET: opt(z.string()),
  /**
   * Secret the users' AI provider API keys are encrypted under (HKDF-derived AES-256-GCM key).
   * Optional: without it the key is derived from BETTER_AUTH_SECRET. Rotating whichever secret
   * is used makes every stored key unreadable; users then add their key again.
   */
  AI_KEY_ENCRYPTION_SECRET: opt(z.string().min(32)),
  /** A saved key is deleted after this many hours without use; each use restarts the clock. */
  AI_KEY_TTL_HOURS: withDefault(z.coerce.number().int().min(1).max(720), 24),
  AI_DAILY_MESSAGE_LIMIT: withDefault(z.coerce.number().int().min(0), 300),
  /**
   * Model tokens per user per day (input incl. cache reads/writes, and output). Silent
   * speak/stay-silent decisions and report assessments cost tokens but are not messages, so the
   * message limit alone does not bound spend.
   */
  AI_DAILY_INPUT_TOKEN_LIMIT: withDefault(z.coerce.number().int().min(0), 5_000_000),
  AI_DAILY_OUTPUT_TOKEN_LIMIT: withDefault(z.coerce.number().int().min(0), 500_000),
  LOG_LEVEL: withDefault(
    z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']),
    'info',
  ),
  /** Prefix for the API's own Redis keys (tickets, rate limits, in-flight guards). Judge keys are fixed by contract. */
  REDIS_KEY_PREFIX: withDefault(z.string(), 'ipp:'),
  /** Stable consumer name in the judge:results group (pending entries survive a restart). */
  API_CONSUMER_NAME: opt(z.string()),
  /** Refuse new runs with 503 when this many jobs are waiting or in progress. */
  QUEUE_MAX_DEPTH: withDefault(z.coerce.number().int().min(1), 100),
  /**
   * Use X-Forwarded-For for the client IP (per-IP rate limits), but only on connections from a
   * TRUSTED_PROXIES address, and then the rightmost entry that is not itself a trusted proxy.
   * Note: the Next.js rewrite does not append to X-Forwarded-For (it passes a client-supplied
   * value through), so in production an edge proxy in front of Next must append the real client
   * address, and the Next host(s) and that proxy must be listed here.
   */
  TRUST_PROXY: withDefault(
    z.enum(['true', 'false']).transform((v) => v === 'true'),
    'true',
  ),
  /** Comma-separated proxy IPs whose X-Forwarded-For is believed. */
  TRUSTED_PROXIES: withDefault(z.string(), '127.0.0.1,::1'),
});

export interface RateLimit {
  limit: number;
  windowSec: number;
}

export interface Limits {
  runs: { userBurst: RateLimit; userDaily: RateLimit; ipBurst: RateLimit; ipDaily: RateLimit };
  chat: { userBurst: RateLimit; userDaily: RateLimit };
  auth: { ipBurst: RateLimit; ipDaily: RateLimit };
  quizAnswers: { userBurst: RateLimit };
  wsTickets: { userBurst: RateLimit };
  padCreate: { userBurst: RateLimit; userDaily: RateLimit };
  /** Telemetry and language events on the pad event channel (each writes a timeline row). */
  padEvents: { userBurst: RateLimit };
  /**
   * Saving an API key makes one real call to the provider, so it must not become a free
   * key-checking service: tight limits per user and per client address.
   */
  aiKeySave: { userBurst: RateLimit; userDaily: RateLimit; ipBurst: RateLimit; ipDaily: RateLimit };
  /** Listing the models a key can use (one provider call per cache miss). */
  aiModels: { userBurst: RateLimit };
  /** Asking for a report assessment again (after adding a key). */
  assessmentRetry: { userBurst: RateLimit };
  /** A room host asking the AI for a second opinion on the code (one model call each). */
  review: { userBurst: RateLimit; userDaily: RateLimit };
  /** Reading an invite or joining by one, per client address (the token is the only secret). */
  invites: { ipBurst: RateLimit; ipDaily: RateLimit };
  /** A room host changing the problem (each rewrites the editor document). */
  problemChange: { userBurst: RateLimit };
  /** Hard cap on interviewer messages per pad (spend guard). */
  interviewerMessagesPerPad: number;
  collab: {
    /** Bytes of Yjs updates a pad may accumulate (history included); further edits are refused. */
    docBytes: number;
    /** Bytes a /collab socket may send before it has authenticated. */
    preAuthBytes: number;
    /** A /collab socket that has not authenticated within this time is closed. */
    authTimeoutMs: number;
  };
}

export const DEFAULT_LIMITS: Limits = {
  runs: {
    userBurst: { limit: 12, windowSec: 60 },
    userDaily: { limit: 400, windowSec: 86_400 },
    ipBurst: { limit: 30, windowSec: 60 },
    ipDaily: { limit: 1500, windowSec: 86_400 },
  },
  chat: { userBurst: { limit: 20, windowSec: 60 }, userDaily: { limit: 600, windowSec: 86_400 } },
  auth: { ipBurst: { limit: 20, windowSec: 60 }, ipDaily: { limit: 300, windowSec: 86_400 } },
  quizAnswers: { userBurst: { limit: 40, windowSec: 60 } },
  wsTickets: { userBurst: { limit: 60, windowSec: 60 } },
  padCreate: {
    userBurst: { limit: 10, windowSec: 60 },
    userDaily: { limit: 100, windowSec: 86_400 },
  },
  padEvents: { userBurst: { limit: 60, windowSec: 60 } },
  aiKeySave: {
    userBurst: { limit: 5, windowSec: 600 },
    userDaily: { limit: 15, windowSec: 86_400 },
    ipBurst: { limit: 10, windowSec: 3600 },
    ipDaily: { limit: 30, windowSec: 86_400 },
  },
  aiModels: { userBurst: { limit: 30, windowSec: 600 } },
  assessmentRetry: { userBurst: { limit: 5, windowSec: 3600 } },
  review: { userBurst: { limit: 6, windowSec: 60 }, userDaily: { limit: 150, windowSec: 86_400 } },
  invites: { ipBurst: { limit: 30, windowSec: 60 }, ipDaily: { limit: 600, windowSec: 86_400 } },
  problemChange: { userBurst: { limit: 10, windowSec: 60 } },
  interviewerMessagesPerPad: 200,
  collab: { docBytes: 16 * 1024 * 1024, preAuthBytes: 64 * 1024, authTimeoutMs: 15_000 },
};

export interface Config {
  env: 'development' | 'test' | 'production';
  databaseUrl: string;
  redisUrl: string;
  port: number;
  host: string;
  apiOrigin: string;
  webOrigin: string;
  authSecret: string;
  github: { clientId: string; clientSecret: string } | null;
  google: { clientId: string; clientSecret: string } | null;
  /**
   * Input keying material for encrypting users' API keys: AI_KEY_ENCRYPTION_SECRET, else
   * BETTER_AUTH_SECRET. Never log this. (There is deliberately no operator provider key.)
   */
  aiKeySecret: string;
  aiKeyTtlHours: number;
  /** The Anthropic default model (INTERVIEWER_MODEL). */
  interviewerModel: string;
  /** Other providers' default models from INTERVIEWER_MODEL_OPENAI / _GEMINI / _OPENROUTER. */
  interviewerModels: Partial<Record<AiProvider, string>>;
  aiDailyMessageLimit: number;
  /** 0 = no limit. */
  aiDailyInputTokenLimit: number;
  aiDailyOutputTokenLimit: number;
  logLevel: string;
  redisPrefix: string;
  consumerName: string;
  queueMaxDepth: number;
  trustProxy: boolean;
  /** Normalised (no ::ffff: prefix) peer addresses allowed to set X-Forwarded-For. */
  trustedProxies: string[];
  limits: Limits;
  /** Timers; overridable in tests. */
  timing: {
    tickMs: number;
    watchdogMs: number;
    /** Extra time on top of the job's totalMs before the watchdog fails a run. */
    runGraceMs: number;
    collabDebounceMs: number;
    collabMaxDebounceMs: number;
    historyCoalesceMs: number;
    codeChangedMinGapMs: number;
  };
}

/** `::ffff:1.2.3.4` -> `1.2.3.4`; trims and lowercases. */
export function normalizeIp(ip: string): string {
  const v = ip.trim().toLowerCase();
  return v.startsWith('::ffff:') && v.includes('.') ? v.slice(7) : v;
}

export function loadConfig(overrides: Partial<Config> = {}): Config {
  loadRootEnv();
  const parsed = Env.safeParse(process.env);
  if (!parsed.success) {
    // Only variable names and messages, never values.
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`invalid environment: ${issues}`);
  }
  const e = parsed.data;
  // INTERVIEWER_MODEL[_OPENAI|_GEMINI|_OPENROUTER] (owned by the interviewer package). No
  // provider key (ANTHROPIC_API_KEY, OPENAI_API_KEY, GEMINI_API_KEY, …) is ever read: model calls
  // run only on the keys users save themselves.
  const ai = interviewerConfigFromEnv(process.env);
  const prod = e.NODE_ENV === 'production';
  const required = <T>(name: string, value: T | undefined, devDefault: T): T => {
    if (value !== undefined) return value;
    if (prod) throw new Error(`${name} is required in production`);
    return devDefault;
  };
  const config: Config = {
    env: e.NODE_ENV,
    databaseUrl: required('DATABASE_URL', e.DATABASE_URL, 'postgres://ipp:ipp@127.0.0.1:5432/ipp'),
    redisUrl: required('REDIS_URL', e.REDIS_URL, 'redis://127.0.0.1:6379'),
    port: e.API_PORT,
    host: e.API_HOST,
    apiOrigin: required('API_ORIGIN', e.API_ORIGIN, 'http://localhost:4000').replace(/\/$/, ''),
    webOrigin: required('WEB_ORIGIN', e.WEB_ORIGIN, 'http://localhost:3000').replace(/\/$/, ''),
    authSecret: required('BETTER_AUTH_SECRET', e.BETTER_AUTH_SECRET, DEV_SECRET),
    github:
      e.GITHUB_CLIENT_ID && e.GITHUB_CLIENT_SECRET
        ? { clientId: e.GITHUB_CLIENT_ID, clientSecret: e.GITHUB_CLIENT_SECRET }
        : null,
    google:
      e.GOOGLE_CLIENT_ID && e.GOOGLE_CLIENT_SECRET
        ? { clientId: e.GOOGLE_CLIENT_ID, clientSecret: e.GOOGLE_CLIENT_SECRET }
        : null,
    aiKeySecret: '',
    aiKeyTtlHours: e.AI_KEY_TTL_HOURS,
    interviewerModel: ai.model,
    interviewerModels: ai.models ?? {},
    aiDailyMessageLimit: e.AI_DAILY_MESSAGE_LIMIT,
    aiDailyInputTokenLimit: e.AI_DAILY_INPUT_TOKEN_LIMIT,
    aiDailyOutputTokenLimit: e.AI_DAILY_OUTPUT_TOKEN_LIMIT,
    logLevel: e.LOG_LEVEL,
    redisPrefix: e.REDIS_KEY_PREFIX,
    consumerName: e.API_CONSUMER_NAME ?? `api-${hostname()}`,
    queueMaxDepth: e.QUEUE_MAX_DEPTH,
    trustProxy: e.TRUST_PROXY,
    trustedProxies: e.TRUSTED_PROXIES.split(',')
      .map((s) => normalizeIp(s.trim()))
      .filter(Boolean),
    limits: DEFAULT_LIMITS,
    timing: {
      tickMs: 5000,
      watchdogMs: 5000,
      runGraceMs: 30_000,
      collabDebounceMs: 2000,
      collabMaxDebounceMs: 10_000,
      historyCoalesceMs: 2000,
      codeChangedMinGapMs: 1000,
    },
    ...overrides,
  };
  if (prod && config.authSecret === DEV_SECRET)
    throw new Error('BETTER_AUTH_SECRET must be set in production');
  if (!config.aiKeySecret) config.aiKeySecret = e.AI_KEY_ENCRYPTION_SECRET ?? config.authSecret;
  return config;
}
