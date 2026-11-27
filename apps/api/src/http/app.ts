import { randomUUID } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import { sql } from '@ipp/db/orm';
import { type Context, Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { secureHeaders } from 'hono/secure-headers';
import type { z } from 'zod';
import type { SessionUser } from '../auth';
import { normalizeIp } from '../config';
import type { Ctx } from '../context';
import { aiKeyRoutes } from '../routes/ai-key';
import { drillRoutes } from '../routes/drill';
import { interviewRoutes } from '../routes/interviews';
import { miscRoutes } from '../routes/misc';
import { padRoutes } from '../routes/pads';
import { quizRoutes } from '../routes/quiz';
import { runRoutes } from '../routes/runs';
import { forbidden, HttpError, rateLimited, unauthorized, validationError } from './errors';

export type Env = {
  Bindings: { incoming?: IncomingMessage };
  Variables: { reqId: string; ip: string; user: SessionUser | null };
};
export type C = Context<Env>;

const STATE_CHANGING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export function requireUser(c: C): SessionUser {
  const user = c.get('user');
  if (!user) throw unauthorized();
  return user;
}

/** A real account: guests (who joined a room by its link) may only use that room. */
export function requireAccount(c: C): SessionUser {
  const user = requireUser(c);
  if (user.guest)
    throw new HttpError(403, 'account_required', 'Sign in with an account to do this');
  return user;
}

export const MAX_JSON_DEPTH = 64;

/** Iterative, so it cannot overflow the stack itself. */
export function jsonDeeperThan(value: unknown, max: number): boolean {
  const stack: [unknown, number][] = [[value, 1]];
  while (stack.length) {
    const [v, d] = stack.pop() as [unknown, number];
    if (v === null || typeof v !== 'object') continue;
    if (d > max) return true;
    for (const child of Array.isArray(v) ? v : Object.values(v)) stack.push([child, d + 1]);
  }
  return false;
}

export async function parseBody<T extends z.ZodType>(c: C, schema: T): Promise<z.output<T>> {
  let json: unknown;
  try {
    json = await c.req.json();
  } catch {
    throw new HttpError(400, 'invalid_json', 'Request body must be JSON');
  }
  // Zod validates recursively (a 200k-deep array was a 500 from a stack overflow) and the judge
  // parses jobs with serde's 128-level limit (a 300-deep custom argument made the job vanish).
  if (jsonDeeperThan(json, MAX_JSON_DEPTH))
    throw new HttpError(
      400,
      'validation_error',
      `JSON nested deeper than ${MAX_JSON_DEPTH} levels`,
    );
  const parsed = schema.safeParse(json);
  if (!parsed.success) throw validationError(parsed.error);
  return parsed.data;
}

export function clientIp(
  ctx: Ctx,
  headers: Headers | IncomingMessage['headers'],
  remote: string | undefined,
): string {
  const peer = remote ? normalizeIp(remote) : 'unknown';
  // X-Forwarded-For is client-controlled unless it was written by a proxy we trust: the API is
  // reachable directly (the browser's WebSockets go to it), so a header from any other peer is
  // ignored, otherwise per-IP limits could be dodged by sending a fresh value with each request.
  const trusted = new Set(ctx.config.trustedProxies);
  if (!ctx.config.trustProxy || !trusted.has(peer)) return peer;
  const xff =
    headers instanceof Headers ? headers.get('x-forwarded-for') : headers['x-forwarded-for'];
  const value = Array.isArray(xff) ? xff.join(',') : xff;
  const chain = (value ?? '')
    .split(',')
    .map((s) => normalizeIp(s))
    .filter(Boolean);
  // Rightmost entry that is not one of our own proxies = the address the first trusted hop saw.
  for (let i = chain.length - 1; i >= 0; i--) {
    const ip = chain[i] as string;
    if (!trusted.has(ip)) return ip.slice(0, 64);
  }
  return peer;
}

/** Allowed origins for browser requests: the web app (normal path) and the API itself. */
export function originAllowed(
  ctx: Ctx,
  origin: string | null | undefined,
  secFetchSite: string | null | undefined,
): boolean {
  if (origin) return origin === ctx.config.webOrigin || origin === ctx.config.apiOrigin;
  return secFetchSite !== 'cross-site';
}

export function createHttpApp(ctx: Ctx): Hono<Env> {
  const app = new Hono<Env>();
  const log = ctx.log;

  app.use('*', async (c, next) => {
    const reqId = c.req.header('x-request-id')?.slice(0, 64) || randomUUID();
    c.set('reqId', reqId);
    c.set('ip', clientIp(ctx, c.req.raw.headers, c.env?.incoming?.socket.remoteAddress));
    c.set('user', null);
    const started = performance.now();
    c.header('x-request-id', reqId);
    try {
      await next();
    } finally {
      // Path only: query strings and bodies are never logged.
      log.info(
        {
          reqId,
          method: c.req.method,
          path: c.req.path,
          status: c.res.status,
          ms: Math.round(performance.now() - started),
          userId: c.get('user')?.id,
        },
        'request',
      );
    }
  });

  app.use(
    '*',
    secureHeaders({
      contentSecurityPolicy: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] },
      crossOriginResourcePolicy: 'same-site',
      referrerPolicy: 'no-referrer',
      strictTransportSecurity:
        ctx.config.env === 'production' ? 'max-age=31536000; includeSubDomains' : false,
    }),
  );

  app.get('/healthz', (c) => c.json({ ok: true }));
  app.get('/readyz', async (c) => {
    const checks = { postgres: false, redis: false };
    await Promise.all([
      ctx.db
        .execute(sql`select 1`)
        .then(() => (checks.postgres = true))
        .catch(() => {}),
      ctx.redis
        .ping()
        .then(() => (checks.redis = true))
        .catch(() => {}),
    ]);
    const ok = checks.postgres && checks.redis;
    return c.json({ ok, checks }, ok ? 200 : 503);
  });

  // CSRF defence in depth (cookies are SameSite=Lax): state-changing requests from a browser
  // must come from the web origin.
  app.use('/api/*', async (c, next) => {
    if (
      STATE_CHANGING.has(c.req.method) &&
      !originAllowed(ctx, c.req.header('origin'), c.req.header('sec-fetch-site'))
    ) {
      throw forbidden('Origin not allowed');
    }
    await next();
  });

  const tooLarge = (c: C) =>
    c.json(new HttpError(413, 'too_large', 'Request body too large').toBody(), 413);
  app.use('/api/pads/:id/runs', bodyLimit({ maxSize: 512 * 1024, onError: tooLarge }));
  // An API key is ~110 characters; nothing bigger needs to reach the parser.
  app.use('/api/ai-key', bodyLimit({ maxSize: 2 * 1024, onError: tooLarge }));
  app.use('/api/*', async (c, next) => {
    if (/^\/api\/pads\/[^/]+\/runs$/.test(c.req.path)) return next();
    return bodyLimit({ maxSize: 64 * 1024, onError: tooLarge })(c, next);
  });

  // Better Auth. Credential endpoints are rate limited per IP.
  app.on(['GET', 'POST'], '/api/auth/*', async (c) => {
    // Guest users are created only by joining a room (POST /api/pads/join-guest), never here.
    if (/^\/api\/auth\/(sign-in\/anonymous|delete-anonymous-user)\/?$/.test(c.req.path))
      return c.json(new HttpError(404, 'not_found', 'Not found').toBody(), 404);
    if (c.req.method === 'POST') {
      const l = ctx.config.limits.auth;
      const ip = c.get('ip');
      const wait = await ctx.limiter.hit([
        { key: `auth:ip:${ip}:burst`, ...l.ipBurst },
        { key: `auth:ip:${ip}:day`, ...l.ipDaily },
      ]);
      if (wait > 0) throw rateLimited(wait);
    }
    if (c.req.method === 'POST' && c.req.path === '/api/auth/sign-out') {
      // Signing out also removes the user's stored AI provider API key.
      const session = await ctx.auth.api
        .getSession({ headers: c.req.raw.headers })
        .catch(() => null);
      const res = await ctx.auth.handler(c.req.raw);
      if (res.ok && session?.user) {
        const userId = session.user.id;
        try {
          if (await ctx.aiKeys.delete(userId)) await ctx.ai.keyChanged(userId);
        } catch (err) {
          log.warn({ err: String(err), userId }, 'removing AI key on sign-out failed');
        }
      }
      return res;
    }
    return ctx.auth.handler(c.req.raw);
  });

  app.use('/api/*', async (c, next) => {
    const session = await ctx.auth.api.getSession({ headers: c.req.raw.headers });
    if (session?.user) {
      const u = session.user;
      c.set('user', {
        id: u.id,
        name: u.name,
        email: u.email,
        image: u.image ?? null,
        guest: (u as { isAnonymous?: boolean | null }).isAnonymous === true,
      });
    }
    await next();
  });

  app.route('/api', miscRoutes(ctx));
  app.route('/api', aiKeyRoutes(ctx));
  app.route('/api', padRoutes(ctx));
  app.route('/api', runRoutes(ctx));
  app.route('/api', quizRoutes(ctx));
  app.route('/api', drillRoutes(ctx));
  app.route('/api', interviewRoutes(ctx));

  app.notFound((c) => c.json(new HttpError(404, 'not_found', 'Not found').toBody(), 404));
  app.onError((err, c) => {
    if (err instanceof HttpError) {
      if (err.retryAfter !== undefined) c.header('Retry-After', String(err.retryAfter));
      return c.json(err.toBody(), err.status);
    }
    log.error({ err, reqId: c.get('reqId') }, 'unhandled error');
    return c.json(new HttpError(500, 'internal', 'Internal server error').toBody(), 500);
  });

  return app;
}
