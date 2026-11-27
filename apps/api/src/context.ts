import type { Db } from '@ipp/db';
import type { PriceBook } from '@ipp/interviewer';
import type { Redis } from 'ioredis';
import type { Logger } from 'pino';
import type postgres from 'postgres';
import type { AiKeyStore } from './ai/keys';
import type { Auth } from './auth';
import type { Config } from './config';
import type { InterviewerHost } from './interviewer/host';
import type { KeyVerifier, ModelLister } from './interviewer/wiring';
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
  /** Users' encrypted AI provider API keys (Redis only). */
  aiKeys: AiKeyStore;
  verifyAiKey: KeyVerifier;
  listAiModels: ModelLister;
  /** List prices for the cost estimate of the spend guard (`ai/limits.ts`). */
  prices: PriceBook;
  runs: RunService;
  /**
   * The database's clock (`readDbClock` in pg.ts), read with the given connection or
   * transaction. What a quant round stamps and decides on; tests may shift it.
   */
  dbNow(q: Pick<Db, 'execute'>): Promise<Date>;
}
