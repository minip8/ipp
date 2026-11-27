/**
 * The daily spend guard per user (ARCHITECTURE §7, "Spend guard"): today's usage in `ai_usage`,
 * the user's own caps in `ai_limits`, and the rule that decides whether the AI may be called.
 *
 * With no caps saved the server defaults apply exactly as before (messages, and input and output
 * tokens capped separately). Saved caps replace them: cost (estimated from list prices), total
 * tokens and messages, whichever is reached first. Cost cannot see a call whose model had no
 * known price, so when cost is the only cap and today's usage has unpriced tokens, the default
 * message limit applies as well.
 */
import {
  type AiCostTracking,
  type AiDailyLimits,
  type AiDefaultLimits,
  type AiLimitKind,
  type AiUsageStatus,
  type AiUsageToday,
  aiLimitReason,
} from '@ipp/contracts';
import { aiLimits, aiUsage } from '@ipp/db';
import { and, eq, sql } from '@ipp/db/orm';
import type { PriceBook } from '@ipp/interviewer';
import type { Config } from '../config';
import type { Ctx } from '../context';
import { defaultModel } from '../interviewer/wiring';

export const utcDay = (d = new Date()) => d.toISOString().slice(0, 10);

/** The next UTC midnight, when today's usage starts again from zero. */
export const nextUtcMidnight = (d = new Date()) =>
  new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1));

export type UsageRow = Pick<
  AiUsageToday,
  'messages' | 'inputTokens' | 'outputTokens' | 'costMicros' | 'unpricedTokens'
>;

const NO_USAGE: UsageRow = {
  messages: 0,
  inputTokens: 0,
  outputTokens: 0,
  costMicros: 0,
  unpricedTokens: 0,
};

export const defaultLimits = (config: Config): AiDefaultLimits => ({
  messages: config.aiDailyMessageLimit,
  inputTokens: config.aiDailyInputTokenLimit,
  outputTokens: config.aiDailyOutputTokenLimit,
});

/**
 * Which cap today's usage has reached, or null when there is allowance left. Pure: the whole
 * rule, so it can be read (and tested) in one place.
 */
export function limitReached(
  u: UsageRow,
  limits: AiDailyLimits | null,
  defaults: AiDefaultLimits,
): AiLimitKind | null {
  if (!limits) {
    if (u.messages >= defaults.messages) return 'messages';
    const inCap = defaults.inputTokens;
    const outCap = defaults.outputTokens;
    if ((inCap > 0 && u.inputTokens >= inCap) || (outCap > 0 && u.outputTokens >= outCap))
      return 'tokens';
    return null;
  }
  if (limits.costMicros !== null && u.costMicros >= limits.costMicros) return 'cost';
  if (limits.tokens !== null && u.inputTokens + u.outputTokens >= limits.tokens) return 'tokens';
  if (limits.messages !== null && u.messages >= limits.messages) return 'messages';
  const costOnly = limits.costMicros !== null && limits.tokens === null && limits.messages === null;
  if (costOnly && u.unpricedTokens > 0 && u.messages >= defaults.messages) return 'messages';
  return null;
}

type DbOf = Pick<Ctx, 'db'>;

export async function usageToday({ db }: DbOf, userId: string): Promise<UsageRow> {
  const [row] = await db
    .select({
      messages: aiUsage.messages,
      inputTokens: aiUsage.inputTokens,
      outputTokens: aiUsage.outputTokens,
      costMicros: aiUsage.costMicros,
      unpricedTokens: aiUsage.unpricedTokens,
    })
    .from(aiUsage)
    .where(and(eq(aiUsage.userId, userId), eq(aiUsage.day, utcDay())));
  return row ?? NO_USAGE;
}

export async function loadLimits({ db }: DbOf, userId: string): Promise<AiDailyLimits | null> {
  const [row] = await db.select().from(aiLimits).where(eq(aiLimits.userId, userId));
  if (!row) return null;
  return {
    costMicros: row.dailyCostMicros,
    tokens: row.dailyTokens,
    messages: row.dailyMessages,
  };
}

/** The reason to show when the user has no allowance left today, else null. */
export async function overDailyLimit(
  ctx: Pick<Ctx, 'db' | 'config'>,
  userId: string,
): Promise<string | null> {
  const [usage, limits] = await Promise.all([usageToday(ctx, userId), loadLimits(ctx, userId)]);
  const kind = limitReached(usage, limits, defaultLimits(ctx.config));
  return kind ? aiLimitReason(kind) : null;
}

export async function saveLimits({ db }: DbOf, userId: string, l: AiDailyLimits): Promise<void> {
  const values = {
    dailyCostMicros: l.costMicros,
    dailyTokens: l.tokens,
    dailyMessages: l.messages,
    updatedAt: new Date(),
  };
  await db
    .insert(aiLimits)
    .values({ userId, ...values })
    .onConflictDoUpdate({ target: aiLimits.userId, set: values });
}

export async function deleteLimits({ db }: DbOf, userId: string): Promise<void> {
  await db.delete(aiLimits).where(eq(aiLimits.userId, userId));
}

/**
 * Adds one model call to today's usage: its tokens, and its estimated cost, or its tokens as
 * unpriced when the model has no known price. Input counts cache reads and writes.
 */
export async function addCall(
  { db }: DbOf,
  userId: string,
  call: { inputTokens: number; outputTokens: number; costMicros: number | null },
): Promise<void> {
  const cost = call.costMicros ?? 0;
  const unpriced = call.costMicros === null ? call.inputTokens + call.outputTokens : 0;
  await db
    .insert(aiUsage)
    .values({
      userId,
      day: utcDay(),
      inputTokens: call.inputTokens,
      outputTokens: call.outputTokens,
      costMicros: cost,
      unpricedTokens: unpriced,
    })
    .onConflictDoUpdate({
      target: [aiUsage.userId, aiUsage.day],
      set: {
        inputTokens: sql`${aiUsage.inputTokens} + ${call.inputTokens}`,
        outputTokens: sql`${aiUsage.outputTokens} + ${call.outputTokens}`,
        costMicros: sql`${aiUsage.costMicros} + ${cost}`,
        unpricedTokens: sql`${aiUsage.unpricedTokens} + ${unpriced}`,
      },
    });
}

/** Whether the user's calls on their key's default model can be costed, and at what price. */
export async function costTracking(
  ctx: Pick<Ctx, 'config' | 'aiKeys'> & { prices: PriceBook },
  userId: string,
): Promise<AiCostTracking | null> {
  const s = await ctx.aiKeys.status(userId);
  if (s.state !== 'active' || !s.provider) return null;
  const provider = s.provider;
  const model = defaultModel(ctx.config, provider);
  const found = await ctx.prices.price(provider, model);
  // OpenRouter reports every call's cost, whether or not its catalogue lists the model.
  const reported = provider === 'openrouter';
  return {
    provider,
    model,
    tracked: reported || found !== null,
    source: reported ? 'reported' : found ? 'list' : null,
    price: found
      ? {
          input: found.price.input,
          output: found.price.output,
          cacheRead: found.price.cacheRead,
          cacheWrite: found.price.cacheWrite,
        }
      : null,
  };
}

/** `GET /api/ai-usage` (and the answer of the limit routes). */
export async function usageStatus(
  ctx: Pick<Ctx, 'db' | 'config' | 'aiKeys'> & { prices: PriceBook },
  userId: string,
): Promise<AiUsageStatus> {
  const now = new Date();
  const [u, limits, tracking] = await Promise.all([
    usageToday(ctx, userId),
    loadLimits(ctx, userId),
    costTracking(ctx, userId),
  ]);
  return {
    usage: {
      day: utcDay(now),
      ...u,
      totalTokens: u.inputTokens + u.outputTokens,
    },
    limits,
    defaults: defaultLimits(ctx.config),
    costTracking: tracking,
    resetsAt: nextUtcMidnight(now).toISOString(),
  };
}
