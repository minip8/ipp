import type { Db } from '@ipp/db';
import type { Redis } from 'ioredis';
import type { Logger } from 'pino';
import type postgres from 'postgres';
import type { AiKeyStore } from './ai/keys';
import type { Auth } from './auth';
import type { Config } from './config';
import type { InterviewerHost } from './interviewer/host';
import type { KeyVerifier } from './interviewer/wiring';
import type { RateLimiter } from './ratelimit';
import type { Collab } from './realtime/collab';
import type { Rooms } from './realtime/rooms';
import type { Tickets } from './realtime/tickets';
import type { RunService } from './runs/service';

/** Process-wide services, built once in app.ts. */
export interface Ctx {
  config: Config;
  log: Logger;
  db: Db;
  sql: postgres.Sql;
  /** Commands. */
  redis: Redis;
  auth: Auth;
  limiter: RateLimiter;
  rooms: Rooms;
  tickets: Tickets;
  collab: Collab;
  ai: InterviewerHost;
  /** Users' encrypted Anthropic API keys (Redis only). */
  aiKeys: AiKeyStore;
  verifyAiKey: KeyVerifier;
  runs: RunService;
}
