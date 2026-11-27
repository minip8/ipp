import { describe, expect, it } from 'vitest';
import {
  AI_LIMIT_BOUNDS,
  AiDailyLimits,
  AiUsageStatus,
  aiLimitReason,
  SetAiLimitsRequest,
} from '../src';

const none = { costMicros: null, tokens: null, messages: null };

describe('AiDailyLimits', () => {
  it('takes any one cap, or several', () => {
    expect(SetAiLimitsRequest.parse({ ...none, costMicros: 2_500_000 })).toEqual({
      ...none,
      costMicros: 2_500_000,
    });
    expect(SetAiLimitsRequest.parse({ ...none, tokens: 2_000_000 }).tokens).toBe(2_000_000);
    expect(SetAiLimitsRequest.parse({ ...none, messages: 300 }).messages).toBe(300);
    const all = { costMicros: 1_000_000, tokens: 5_000_000, messages: 50 };
    expect(AiDailyLimits.parse(all)).toEqual(all);
  });

  it('refuses no cap at all', () => {
    const r = SetAiLimitsRequest.safeParse(none);
    expect(r.success).toBe(false);
    expect(r.error?.issues[0]?.message).toMatch(/at least one/);
  });

  it('keeps every cap inside its bounds', () => {
    for (const [field, b] of Object.entries(AI_LIMIT_BOUNDS)) {
      expect(SetAiLimitsRequest.safeParse({ ...none, [field]: b.min }).success).toBe(true);
      expect(SetAiLimitsRequest.safeParse({ ...none, [field]: b.max }).success).toBe(true);
      expect(SetAiLimitsRequest.safeParse({ ...none, [field]: b.min - 1 }).success).toBe(false);
      expect(SetAiLimitsRequest.safeParse({ ...none, [field]: b.max + 1 }).success).toBe(false);
      expect(SetAiLimitsRequest.safeParse({ ...none, [field]: 0 }).success).toBe(false);
      expect(SetAiLimitsRequest.safeParse({ ...none, [field]: -5 }).success).toBe(false);
      expect(SetAiLimitsRequest.safeParse({ ...none, [field]: b.min + 0.5 }).success).toBe(false);
    }
    // Every bound fits a Postgres integer column.
    for (const b of Object.values(AI_LIMIT_BOUNDS)) expect(b.max).toBeLessThan(2 ** 31);
  });

  it('wants every field, and nothing else', () => {
    expect(SetAiLimitsRequest.safeParse({ messages: 5 }).success).toBe(false);
    expect(SetAiLimitsRequest.safeParse({ ...none, messages: 5, extra: 1 }).success).toBe(false);
    expect(SetAiLimitsRequest.safeParse({ ...none, messages: '5' }).success).toBe(false);
  });
});

describe('AiUsageStatus', () => {
  const status = {
    usage: {
      day: '2026-11-27',
      messages: 12,
      inputTokens: 120_000,
      outputTokens: 4_000,
      totalTokens: 124_000,
      costMicros: 560_000,
      unpricedTokens: 0,
    },
    limits: null,
    defaults: { messages: 1500, inputTokens: 5_000_000, outputTokens: 500_000 },
    costTracking: {
      provider: 'anthropic',
      model: 'claude-opus-5-5',
      tracked: true,
      source: 'list',
      price: { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 },
    },
    resetsAt: '2026-11-28T00:00:00.000Z',
  };

  it('parses the defaults case and a saved setting', () => {
    expect(AiUsageStatus.parse(status)).toEqual(status);
    const saved = { ...status, limits: { ...none, tokens: 1_000_000 }, costTracking: null };
    expect(AiUsageStatus.parse(saved).limits?.tokens).toBe(1_000_000);
  });

  it('allows an untracked model with no price', () => {
    const untracked = {
      ...status,
      costTracking: {
        provider: 'gemini',
        model: 'gemini-x',
        tracked: false,
        source: null,
        price: null,
      },
    };
    expect(AiUsageStatus.parse(untracked).costTracking?.tracked).toBe(false);
  });

  it('refuses negative usage and a malformed day', () => {
    expect(
      AiUsageStatus.safeParse({ ...status, usage: { ...status.usage, costMicros: -1 } }).success,
    ).toBe(false);
    expect(
      AiUsageStatus.safeParse({ ...status, usage: { ...status.usage, day: 'today' } }).success,
    ).toBe(false);
  });
});

describe('aiLimitReason', () => {
  it('names the cap and Settings, and carries no figure', () => {
    for (const kind of ['cost', 'tokens', 'messages'] as const) {
      const text = aiLimitReason(kind);
      expect(text).toMatch(/Settings/);
      expect(text).not.toMatch(/\d/);
      expect(text).not.toMatch(/\$/);
      expect(text).not.toMatch(/—/);
    }
    expect(aiLimitReason('cost')).toMatch(/spending/);
    expect(aiLimitReason('tokens')).toMatch(/token/);
    expect(aiLimitReason('messages')).toMatch(/message/);
  });
});
