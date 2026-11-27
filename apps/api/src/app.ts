/**
 * Composition root: builds every service, the HTTP app and the Node server with WebSocket
 * upgrades for /ws/pads/:padId and /collab. `createApi` is what main.ts and the tests use.
 */

import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { serve } from '@hono/node-server';
import { createDb } from '@ipp/db';
import { createPriceBook, type PriceBook } from '@ipp/interviewer';
import { Redis } from 'ioredis';
import type { Logger } from 'pino';
import { AiKeyStore } from './ai/keys';
import { createAuth } from './auth';
import type { Config } from './config';
import type { Ctx } from './context';
import { createHttpApp, originAllowed } from './http/app';
import { type InterviewerFactory, InterviewerHost } from './interviewer/host';
import { defaultModelLister, type KeyVerifier, type ModelLister } from './interviewer/wiring';
import { readDbClock } from './pg';
import { startQuantSweeper } from './quant/sweeper';
import { RateLimiter } from './ratelimit';
import { Collab } from './realtime/collab';
import { EventsGateway } from './realtime/events';
import { createRooms } from './realtime/rooms';
import { Tickets } from './realtime/tickets';
import { RunService } from './runs/service';

export interface ApiOptions {
  config: Config;
  log: Logger;
  interviewerFactory: InterviewerFactory;
  /** Checks a key with its provider before it is stored (tests pass a fake). */
  verifyAiKey: KeyVerifier;
  /** Lists the models a key can use (tests pass a fake; default: the provider's list). */
  listAiModels?: ModelLister;
  /** Model prices for the spend guard (tests pass one on a fake fetch; default: the real one). */
  prices?: PriceBook;
}

export interface Api {
  ctx: Ctx;
  server: Server;
  /** Resolves with the bound port. */
  listen(port?: number): Promise<number>;
  stop(): Promise<void>;
}

const PAD_WS = /^\/ws\/pads\/([0-9a-f-]{36})$/;

export async function createApi(opts: ApiOptions): Promise<Api> {
  const { config, log } = opts;
  const dbh = createDb(config.databaseUrl, { max: 10 });
  const redis = new Redis(config.redisUrl, { maxRetriesPerRequest: 3 });
  redis.on('error', (err) => log.warn({ err }, 'redis error'));

  const ctx = {
    config,
    log,
    db: dbh.db,
    sql: dbh.sql,
    redis,
    auth: createAuth(config, dbh.db, log),
    limiter: new RateLimiter(redis, config.redisPrefix),
    rooms: createRooms(),
    tickets: new Tickets(redis, config.redisPrefix),
    aiKeys: new AiKeyStore(
      redis,
      config.redisPrefix,
      config.aiKeySecret,
      config.aiKeyTtlHours,
      (userId) => log.warn({ userId }, 'stored AI key could not be decrypted; discarded'),
    ),
    verifyAiKey: opts.verifyAiKey,
    listAiModels: opts.listAiModels ?? defaultModelLister(config),
    prices: opts.prices ?? createPriceBook(),
    dbNow: readDbClock,
  } as Ctx;
  ctx.collab = new Collab(ctx);
  ctx.runs = new RunService(ctx);
  ctx.ai = new InterviewerHost(ctx, opts.interviewerFactory);
  const events = new EventsGateway(ctx);
  const app = createHttpApp(ctx);

  await ctx.runs.start();

  // Periodic tick for active pads that have someone connected.
  const livePads = () => {
    const padIds = new Set(ctx.rooms.pads());
    for (const name of ctx.collab.hocuspocus.documents.keys()) {
      const id = name.startsWith('pad:') ? name.slice(4) : null;
      if (id && ctx.collab.connectionCount(id) > 0) padIds.add(id);
    }
    return padIds;
  };
  const tick = setInterval(() => {
    for (const id of livePads()) ctx.ai.trigger(id, { type: 'tick' });
  }, config.timing.tickMs);
  tick.unref();
  // A quant round's clock where nobody is connected (so no tick reaches its interviewer).
  const sweeper =
    config.timing.quantSweepMs > 0
      ? startQuantSweeper(
          ctx,
          (padId) => ctx.rooms.count(padId) > 0 || ctx.collab.connectionCount(padId) > 0,
          config.timing.quantSweepMs,
        )
      : null;

  let server: Server | null = null;
  const sockets = new Set<import('node:net').Socket>();

  const api: Api = {
    ctx,
    get server() {
      if (!server) throw new Error('not listening');
      return server;
    },
    listen(port = config.port) {
      return new Promise((resolve) => {
        const s = serve({ fetch: app.fetch, port, hostname: config.host }, (info: AddressInfo) =>
          resolve(info.port),
        ) as Server;
        server = s;
        s.on('connection', (sock) => {
          sockets.add(sock);
          sock.on('close', () => sockets.delete(sock));
        });
        s.on('upgrade', (req, socket, head) => {
          socket.on('error', () => {});
          const url = new URL(req.url ?? '/', 'http://localhost');
          if (
            !originAllowed(
              ctx,
              req.headers.origin,
              req.headers['sec-fetch-site'] as string | undefined,
            )
          ) {
            socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
            return;
          }
          if (url.pathname === '/collab') return ctx.collab.handleUpgrade(req, socket, head);
          const m = PAD_WS.exec(url.pathname);
          if (m?.[1]) {
            void events
              .handleUpgrade(req, socket, head, m[1], url.searchParams.get('ticket'))
              .catch((err) => {
                log.error({ err }, 'ws upgrade failed');
                socket.destroy();
              });
            return;
          }
          socket.end('HTTP/1.1 404 Not Found\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
        });
      });
    },
    async stop() {
      clearInterval(tick);
      await sweeper?.stop();
      const closed = server
        ? new Promise<void>((r) => server?.close(() => r()))
        : Promise.resolve();
      await ctx.runs.stop();
      events.stop();
      await ctx.collab.stop();
      ctx.rooms.closeAll();
      // Give in-flight requests a moment, then drop idle keep-alive sockets.
      server?.closeIdleConnections();
      const force = setTimeout(() => {
        for (const s of sockets) s.destroy();
      }, 3000);
      await closed;
      clearTimeout(force);
      await redis.quit().catch(() => redis.disconnect());
      await dbh.close();
    },
  };
  return api;
}
