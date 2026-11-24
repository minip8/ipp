/**
 * Sliding-window rate limits in Redis (sorted set of hit timestamps per key). All windows of one
 * check are evaluated atomically: either every window admits the hit and it is recorded in all of
 * them, or nothing is recorded and the longest required wait is returned.
 */
import { randomUUID } from 'node:crypto';
import type { Redis } from 'ioredis';
import type { RateLimit } from './config';

const SCRIPT = `
local now = tonumber(ARGV[1])
local member = ARGV[2]
local n = #KEYS
local wait = 0
for i = 1, n do
  local limit = tonumber(ARGV[2 + (i - 1) * 2 + 1])
  local window = tonumber(ARGV[2 + (i - 1) * 2 + 2])
  redis.call('ZREMRANGEBYSCORE', KEYS[i], '-inf', now - window)
  local count = redis.call('ZCARD', KEYS[i])
  if count >= limit then
    local oldest = redis.call('ZRANGE', KEYS[i], 0, count - limit, 'WITHSCORES')
    local w = tonumber(oldest[#oldest]) + window - now
    if w > wait then wait = w end
  end
end
if wait > 0 then return wait end
for i = 1, n do
  local window = tonumber(ARGV[2 + (i - 1) * 2 + 2])
  redis.call('ZADD', KEYS[i], now, member)
  redis.call('PEXPIRE', KEYS[i], window)
end
return 0
`;

export interface LimitRule extends RateLimit {
  /** e.g. "runs:user:<id>:burst" */
  key: string;
}

export class RateLimiter {
  constructor(
    private readonly redis: Redis,
    private readonly prefix: string,
  ) {}

  /** Returns 0 when allowed, otherwise seconds until a retry can succeed. */
  async hit(rules: LimitRule[]): Promise<number> {
    const active = rules.filter((r) => r.limit > 0);
    if (active.length === 0) return 0;
    const args: (string | number)[] = [Date.now(), randomUUID()];
    for (const r of active) args.push(r.limit, r.windowSec * 1000);
    const waitMs = (await this.redis.eval(
      SCRIPT,
      active.length,
      ...active.map((r) => `${this.prefix}rl:${r.key}`),
      ...args,
    )) as number;
    return waitMs > 0 ? Math.max(1, Math.ceil(waitMs / 1000)) : 0;
  }
}
