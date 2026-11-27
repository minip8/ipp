/**
 * The user's own daily AI limits (ARCHITECTURE §7, "Spend guard"): the routes, how each cap stops
 * the interviewer (and quiz grading) at its amount and not before, the cost-only fallback to the
 * default message limit while some usage is unpriced, and the cost estimate per call.
 */
import { AiUsageStatus, aiLimitReason } from '@ipp/contracts';
import { aiLimits, aiUsage } from '@ipp/db';
import { eq } from '@ipp/db/orm';
import { createPriceBook } from '@ipp/interviewer';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { limitReached, utcDay } from '../src/ai/limits';
import {
  Client,
  EventSocket,
  FakeInterviewer,
  flushRedis,
  type Harness,
  startApi,
  TEST_AI_KEY,
  until,
} from './helpers/harness';

let h: Harness;
let fake: FakeInterviewer;
beforeAll(async () => {
  await flushRedis();
  fake = new FakeInterviewer();
  h = await startApi({ fake });
});
afterAll(async () => h?.stop());
beforeEach(() => {
  fake.usage = {};
});

let ip = 1;
const none = { costMicros: null, tokens: null, messages: null };
const OPENROUTER_KEY = 'sk-or-v1-good-0123456789abcdef0123456789abcdef0123456789abcdef01';
const GEMINI_KEY = 'AIzaSy-good-TESTgeminiKEY_0123456789abc';

/** A signed-up user with a key (Anthropic unless given) and a coding pad. */
async function setup(name: string, opts: { key?: string | null; provider?: 'openrouter' } = {}) {
  const c = new Client(h.base, `100.72.${Math.floor(ip / 250)}.${ip++ % 250}`);
  const { id } = await c.signUp(name);
  if (opts.key !== null) await c.saveKey(opts.key ?? TEST_AI_KEY);
  const pad = (await c.post('/api/pads', { problemSlug: 'two-sum', language: 'python' })).json;
  return { c, id, pad: pad as { id: string } };
}

/** Sets the given counters of today's usage of `userId` (the others are kept). */
async function usage(
  userId: string,
  u: Partial<{
    messages: number;
    inputTokens: number;
    outputTokens: number;
    costMicros: number;
    unpricedTokens: number;
  }>,
) {
  await h.api.ctx.db
    .insert(aiUsage)
    .values({ userId, day: utcDay(), ...u })
    .onConflictDoUpdate({ target: [aiUsage.userId, aiUsage.day], set: u });
}

const budget = (padId: string) => fake.deps.checkBudget(padId);

const row = async (userId: string) =>
  (await h.api.ctx.db.select().from(aiUsage).where(eq(aiUsage.userId, userId)))[0];

describe('the routes', () => {
  it('GET shows the defaults when nothing is saved', async () => {
    const { c } = await setup('Fresh');
    const res = await c.get('/api/ai-usage');
    expect(res.status).toBe(200);
    const s = AiUsageStatus.parse(res.json);
    expect(s.limits).toBeNull();
    expect(s.defaults).toEqual({
      messages: h.api.ctx.config.aiDailyMessageLimit,
      inputTokens: h.api.ctx.config.aiDailyInputTokenLimit,
      outputTokens: h.api.ctx.config.aiDailyOutputTokenLimit,
    });
    expect(s.usage).toMatchObject({ day: utcDay(), messages: 0, totalTokens: 0, costMicros: 0 });
    expect(new Date(s.resetsAt).getTime()).toBeGreaterThan(Date.now());
    expect(s.costTracking).toEqual({
      provider: 'anthropic',
      model: 'claude-opus-5-5',
      tracked: true,
      source: 'list',
      price: { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 },
    });
  });

  it('PUT saves each kind of cap, DELETE goes back to the defaults', async () => {
    const { c, id } = await setup('Saver');
    for (const limits of [
      { ...none, costMicros: 2_500_000 },
      { ...none, tokens: 2_000_000 },
      { ...none, messages: 40 },
      { costMicros: 1_000_000, tokens: 3_000_000, messages: 100 },
    ]) {
      const res = await c.put('/api/ai-limits', limits);
      expect(res.status).toBe(200);
      expect(AiUsageStatus.parse(res.json).limits).toEqual(limits);
      expect(AiUsageStatus.parse((await c.get('/api/ai-usage')).json).limits).toEqual(limits);
    }
    const reset = await c.del('/api/ai-limits');
    expect(reset.status).toBe(200);
    expect(AiUsageStatus.parse(reset.json).limits).toBeNull();
    expect(await h.api.ctx.db.select().from(aiLimits).where(eq(aiLimits.userId, id))).toEqual([]);
    // Resetting again is harmless.
    expect((await c.del('/api/ai-limits')).status).toBe(200);
  });

  it('PUT validates: at least one cap, within bounds, whole numbers', async () => {
    const { c } = await setup('Validator');
    for (const bad of [
      none,
      { ...none, messages: 0 },
      { ...none, tokens: 2_000_000_000 },
      { ...none, costMicros: 1.5 },
      { messages: 10 },
      { ...none, messages: 10, extra: true },
      'not json',
    ]) {
      const res = await c.put('/api/ai-limits', bad);
      expect(res.status, JSON.stringify(bad)).toBe(400);
    }
    expect(AiUsageStatus.parse((await c.get('/api/ai-usage')).json).limits).toBeNull();
  });

  it('refuses guests and anonymous callers', async () => {
    const { c: host } = await setup('RoomHost');
    const room = await host.post('/api/pads', {
      kind: 'room',
      language: 'python',
      problemSlug: 'two-sum',
    });
    const guest = new Client(h.base, `100.73.0.${ip++ % 250}`);
    expect(
      (
        await guest.post('/api/pads/join-guest', {
          shareToken: room.json.shareToken,
          name: 'Gale',
        })
      ).status,
    ).toBe(200);
    for (const res of [
      await guest.get('/api/ai-usage'),
      await guest.put('/api/ai-limits', { ...none, messages: 5 }),
      await guest.del('/api/ai-limits'),
    ])
      expect([res.status, res.json?.error?.code]).toEqual([403, 'account_required']);
    const anon = new Client(h.base, `100.73.1.${ip++ % 250}`);
    expect((await anon.get('/api/ai-usage')).status).toBe(401);
    expect((await anon.put('/api/ai-limits', { ...none, messages: 5 })).status).toBe(401);
  });

  it('rate limits saving', async () => {
    const saved = h.api.ctx.config.limits.aiLimitsSave.userBurst;
    h.api.ctx.config.limits.aiLimitsSave.userBurst = { limit: 2, windowSec: 60 };
    try {
      const { c } = await setup('Fiddler');
      expect((await c.put('/api/ai-limits', { ...none, messages: 5 })).status).toBe(200);
      expect((await c.del('/api/ai-limits')).status).toBe(200);
      const third = await c.put('/api/ai-limits', { ...none, messages: 6 });
      expect(third.status).toBe(429);
      expect(third.json.error.retryAfter).toBeGreaterThan(0);
    } finally {
      h.api.ctx.config.limits.aiLimitsSave.userBurst = saved;
    }
  });

  it('says when cost cannot be tracked, and that OpenRouter reports it', async () => {
    const saved = h.api.ctx.config.interviewerModels;
    const gemini = await setup('Gem', { key: GEMINI_KEY });
    expect(AiUsageStatus.parse((await gemini.c.get('/api/ai-usage')).json).costTracking).toEqual({
      provider: 'gemini',
      model: 'gemini-4-hydrogen',
      tracked: true,
      source: 'list',
      price: { input: 1.5, output: 7.5, cacheRead: 0.075, cacheWrite: 1.5 },
    });
    h.api.ctx.config.interviewerModels = { ...saved, gemini: 'gemini-unpriced-test' };
    try {
      expect(
        AiUsageStatus.parse((await gemini.c.get('/api/ai-usage')).json).costTracking,
      ).toMatchObject({ model: 'gemini-unpriced-test', tracked: false, source: null, price: null });
      h.api.ctx.config.interviewerModels = { ...saved, openrouter: 'vendor/priced' };
      const or = await setup('Router', { key: OPENROUTER_KEY });
      expect(AiUsageStatus.parse((await or.c.get('/api/ai-usage')).json).costTracking).toEqual({
        provider: 'openrouter',
        model: 'vendor/priced',
        tracked: true,
        source: 'reported',
        price: { input: 1, output: 2, cacheRead: 1, cacheWrite: 1 },
      });
    } finally {
      h.api.ctx.config.interviewerModels = saved;
    }
    const keyless = await setup('Keyless', { key: null });
    expect(AiUsageStatus.parse((await keyless.c.get('/api/ai-usage')).json).costTracking).toBe(
      null,
    );
  });
});

describe('enforcement', () => {
  it('with no setting, the defaults apply as before', async () => {
    const { id, pad } = await setup('Default');
    const d = h.api.ctx.config;
    await usage(id, { messages: d.aiDailyMessageLimit - 1 });
    expect(await budget(pad.id)).toEqual({ ok: true });
    await usage(id, { messages: d.aiDailyMessageLimit });
    expect(await budget(pad.id)).toEqual({ ok: false, reason: aiLimitReason('messages') });
    await usage(id, { messages: 0, inputTokens: d.aiDailyInputTokenLimit });
    expect(await budget(pad.id)).toEqual({ ok: false, reason: aiLimitReason('tokens') });
    await usage(id, { inputTokens: 0, outputTokens: d.aiDailyOutputTokenLimit });
    expect(await budget(pad.id)).toEqual({ ok: false, reason: aiLimitReason('tokens') });
    // Separately capped: under both, however large the sum.
    await usage(id, {
      inputTokens: d.aiDailyInputTokenLimit - 1,
      outputTokens: d.aiDailyOutputTokenLimit - 1,
    });
    expect(await budget(pad.id)).toEqual({ ok: true });
    // Cost has no default cap.
    await usage(id, { costMicros: 1_000_000_000 });
    expect(await budget(pad.id)).toEqual({ ok: true });
  });

  it('a cost cap stops the interviewer at its amount and not before', async () => {
    const { c, id, pad } = await setup('CostCap');
    await c.put('/api/ai-limits', { ...none, costMicros: 500_000 });
    await usage(id, { costMicros: 499_999, messages: 10_000, inputTokens: 1e8 });
    expect(await budget(pad.id)).toEqual({ ok: true });
    await usage(id, { costMicros: 500_000 });
    expect(await budget(pad.id)).toEqual({ ok: false, reason: aiLimitReason('cost') });
  });

  it('a token cap counts input and output together', async () => {
    const { c, id, pad } = await setup('TokenCap');
    await c.put('/api/ai-limits', { ...none, tokens: 10_000 });
    await usage(id, { inputTokens: 9_000, outputTokens: 999, messages: 10_000 });
    expect(await budget(pad.id)).toEqual({ ok: true });
    await usage(id, { outputTokens: 1_000 });
    expect(await budget(pad.id)).toEqual({ ok: false, reason: aiLimitReason('tokens') });
  });

  it('a message cap replaces the default one', async () => {
    const { c, id, pad } = await setup('MsgCap');
    await c.put('/api/ai-limits', { ...none, messages: 3 });
    // Far over the default token caps, which no longer apply.
    await usage(id, { messages: 2, inputTokens: 1e9, outputTokens: 1e9 });
    expect(await budget(pad.id)).toEqual({ ok: true });
    await fake.deps.saveMessage(pad.id, { kind: 'chat', intent: 'answer', text: 'one more' });
    expect(await budget(pad.id)).toEqual({ ok: false, reason: aiLimitReason('messages') });
    // A higher cap than the default lets the user go on past it.
    await c.put('/api/ai-limits', { ...none, messages: 100_000 });
    await usage(id, { messages: h.api.ctx.config.aiDailyMessageLimit + 10 });
    expect(await budget(pad.id)).toEqual({ ok: true });
  });

  it('whichever cap comes first', async () => {
    const { c, id, pad } = await setup('Several');
    await c.put('/api/ai-limits', { costMicros: 1_000_000, tokens: 50_000, messages: 20 });
    await usage(id, { costMicros: 10, inputTokens: 10, messages: 20 });
    expect(await budget(pad.id)).toEqual({ ok: false, reason: aiLimitReason('messages') });
    await usage(id, { messages: 0, inputTokens: 50_000 });
    expect(await budget(pad.id)).toEqual({ ok: false, reason: aiLimitReason('tokens') });
  });

  it('cost alone with unpriced usage today: the default message limit applies as well', async () => {
    const { c, id, pad } = await setup('Unpriced');
    await c.put('/api/ai-limits', { ...none, costMicros: 5_000_000 });
    const cap = h.api.ctx.config.aiDailyMessageLimit;
    // All priced: messages are not capped.
    await usage(id, { messages: cap + 5 });
    expect(await budget(pad.id)).toEqual({ ok: true });
    // Some usage the cost cap cannot see: the default message limit binds.
    await usage(id, { unpricedTokens: 1 });
    expect(await budget(pad.id)).toEqual({ ok: false, reason: aiLimitReason('messages') });
    await usage(id, { messages: cap - 1 });
    expect(await budget(pad.id)).toEqual({ ok: true });
    // With a second cap the user chose, the fallback is not needed.
    await c.put('/api/ai-limits', { ...none, costMicros: 5_000_000, tokens: 1_000_000_000 });
    await usage(id, { messages: cap + 5 });
    expect(await budget(pad.id)).toEqual({ ok: true });
  });

  it('the reason names the cap and Settings, never an amount', async () => {
    const { c, id, pad } = await setup('Reason');
    await c.put('/api/ai-limits', { ...none, costMicros: 1_230_000 });
    await usage(id, { costMicros: 1_500_000 });
    const res = await budget(pad.id);
    if (res.ok) throw new Error('expected the cap to bind');
    expect(res.reason).toMatch(/spending limit/);
    expect(res.reason).toMatch(/Settings/);
    expect(res.reason).not.toMatch(/\d/);
  });

  it('quiz grading and discussion respect the user’s caps and count as messages', async () => {
    const { c, id } = await setup('Quizzer');
    await c.put('/api/ai-limits', { ...none, messages: 2 });
    const answer = () =>
      c.post('/api/quiz/questions/tq-short/answers', {
        response: { type: 'short', text: 'Resources are released in destructors.' },
      });
    expect((await answer()).json.gradedBy).toBe('ai');
    await until(async () => (await row(id))?.messages === 1);
    expect((await answer()).json.gradedBy).toBe('ai');
    await until(async () => (await row(id))?.messages === 2);
    expect((await answer()).json).toMatchObject({ gradedBy: 'self', needsSelfGrade: true });

    const attempt = (
      await c.post('/api/quiz/attempts', { topics: ['test-topic'], mode: 'discussion' })
    ).json;
    const before = fake.discussionCalls.length;
    await c.post(`/api/quiz/attempts/${attempt.id}/discussion`, {
      questionId: 'tq-short',
      text: 'An answer',
    });
    expect(fake.discussionCalls.length).toBe(before);
    // Raising the cap lets discussion go on.
    await c.put('/api/ai-limits', { ...none, messages: 10 });
    await c.post(`/api/quiz/attempts/${attempt.id}/discussion`, {
      questionId: 'tq-short',
      text: 'An answer',
    });
    expect(fake.discussionCalls.length).toBe(before + 1);
  });
});

describe('cost per call', () => {
  const reply = async (c: Client, padId: string) => {
    const ws = await EventSocket.open(
      `${h.wsBase}/ws/pads/${padId}?ticket=${await c.ticket(padId)}`,
    );
    ws.send({ type: 'chat.send', text: 'hello' });
    await ws.waitFor('message.created', (e) => e.message.role === 'interviewer');
    ws.close();
  };

  it('accumulates priced, reported and unpriced calls', async () => {
    const { c, id, pad } = await setup('Spender');
    // Anthropic list prices per million: $4 in, $0.20 cache reads, $5 cache writes, $20 out.
    fake.usage = {
      provider: 'anthropic',
      model: 'claude-opus-5-5',
      inputTokens: 600,
      cacheReadInputTokens: 300,
      cacheCreationInputTokens: 100,
      outputTokens: 100,
    };
    await reply(c, pad.id);
    const opus = 2_400 + 60 + 500 + 2_000;
    await until(async () => (await row(id))?.costMicros === opus);

    // OpenRouter's catalogue (the harness's fake: $1 in, $2 out).
    fake.usage = { provider: 'openrouter', model: 'vendor/priced', inputTokens: 1_000 };
    await reply(c, pad.id);
    await until(async () => (await row(id))?.costMicros === opus + 1_000 + 10 * 2);

    // A reported cost wins over any price.
    fake.usage = {
      provider: 'openrouter',
      model: 'vendor/priced',
      inputTokens: 1_000,
      reportedCostMicros: 777,
    };
    await reply(c, pad.id);
    await until(async () => (await row(id))?.costMicros === opus + 1_020 + 777);

    // No known price: its tokens count as unpriced, not as cost.
    fake.usage = { provider: 'gemini', model: 'gemini-nobody-priced' };
    await reply(c, pad.id);
    await until(async () => (await row(id))?.unpricedTokens === 110);
    fake.usage = {};
    await reply(c, pad.id);
    await until(async () => (await row(id))?.unpricedTokens === 220);

    const r = await row(id);
    expect(r?.costMicros).toBe(opus + 1_797);
    expect(r?.inputTokens).toBe(1_000 + 1_000 + 1_000 + 100 + 100);
    const s = AiUsageStatus.parse((await c.get('/api/ai-usage')).json);
    expect(s.usage).toMatchObject({
      costMicros: opus + 1_797,
      unpricedTokens: 220,
      messages: 5,
      totalTokens: r ? r.inputTokens + r.outputTokens : -1,
    });
  });

  it('a price lookup that fails leaves the call unpriced and the interviewer working', async () => {
    const broken = await startApi({
      prices: createPriceBook({
        fetch: (async () => {
          throw new Error('catalogue down');
        }) as unknown as typeof fetch,
      }),
    });
    try {
      const c = new Client(broken.base, '100.74.0.1');
      const { id } = await c.signUp('Outage');
      await c.saveKey();
      const pad = (await c.post('/api/pads', { problemSlug: 'two-sum', language: 'python' })).json;
      broken.fake.usage = { provider: 'openrouter', model: 'vendor/priced' };
      const ws = await EventSocket.open(
        `${broken.wsBase}/ws/pads/${pad.id}?ticket=${await c.ticket(pad.id)}`,
      );
      ws.send({ type: 'chat.send', text: 'hello' });
      await ws.waitFor('message.created', (e) => e.message.role === 'interviewer');
      ws.close();
      const read = async () =>
        (await broken.api.ctx.db.select().from(aiUsage).where(eq(aiUsage.userId, id)))[0];
      await until(async () => (await read())?.unpricedTokens === 110);
      expect((await read())?.costMicros).toBe(0);
    } finally {
      await broken.stop();
    }
  });
});

describe('limitReached', () => {
  const defaults = { messages: 10, inputTokens: 100, outputTokens: 50 };
  const u = { messages: 0, inputTokens: 0, outputTokens: 0, costMicros: 0, unpricedTokens: 0 };

  it('keeps a default token cap of 0 off, as before', () => {
    expect(limitReached({ ...u, inputTokens: 1e9 }, null, { ...defaults, inputTokens: 0 })).toBe(
      null,
    );
  });

  it('applies the fallback only while there are unpriced tokens', () => {
    const costOnly = { ...none, costMicros: 1_000_000 };
    expect(limitReached({ ...u, messages: 10 }, costOnly, defaults)).toBeNull();
    expect(limitReached({ ...u, messages: 10, unpricedTokens: 5 }, costOnly, defaults)).toBe(
      'messages',
    );
    expect(limitReached({ ...u, messages: 9, unpricedTokens: 5 }, costOnly, defaults)).toBeNull();
  });
});
