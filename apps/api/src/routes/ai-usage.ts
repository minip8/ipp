/**
 * The signed-in user's daily AI usage and their own daily limits (ARCHITECTURE §7, "Spend
 * guard"). Accounts only: a guest has no key, so nothing to limit. Cost is an estimate from list
 * prices; the provider's bill is the truth.
 */
import { SetAiLimitsRequest } from '@ipp/contracts';
import { Hono } from 'hono';
import { deleteLimits, saveLimits, usageStatus } from '../ai/limits';
import type { Ctx } from '../context';
import { type Env, parseBody, requireAccount } from '../http/app';
import { rateLimited } from '../http/errors';

export function aiUsageRoutes(ctx: Ctx) {
  const r = new Hono<Env>();

  const limited = async (userId: string) => {
    const l = ctx.config.limits.aiLimitsSave;
    const wait = await ctx.limiter.hit([
      { key: `ailimits:u:${userId}:burst`, ...l.userBurst },
      { key: `ailimits:u:${userId}:day`, ...l.userDaily },
    ]);
    if (wait > 0)
      throw rateLimited(wait, 'rate_limited', 'Too many changes to your limits. Try again later.');
  };

  r.get('/ai-usage', async (c) => {
    const user = requireAccount(c);
    return c.json(await usageStatus(ctx, user.id));
  });

  r.put('/ai-limits', async (c) => {
    const user = requireAccount(c);
    const limits = await parseBody(c, SetAiLimitsRequest);
    await limited(user.id);
    await saveLimits(ctx, user.id, limits);
    ctx.log.info({ userId: user.id }, 'AI limits saved');
    return c.json(await usageStatus(ctx, user.id));
  });

  r.delete('/ai-limits', async (c) => {
    const user = requireAccount(c);
    await limited(user.id);
    await deleteLimits(ctx, user.id);
    return c.json(await usageStatus(ctx, user.id));
  });

  return r;
}
