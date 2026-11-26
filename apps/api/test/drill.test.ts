import {
  DRILL_CATEGORIES,
  DRILL_HISTORY_LIMIT,
  type DrillCategoryResult,
  DrillHistory,
  RecordDrillRunResponse,
} from '@ipp/contracts';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_LIMITS } from '../src/config';
import { Client, flushRedis, type Harness, startApi } from './helpers/harness';

let h: Harness;
let ipCounter = 0;
beforeAll(async () => {
  await flushRedis();
  h = await startApi();
});
afterAll(async () => h?.stop());
beforeEach(() => {
  h.api.ctx.config.limits = structuredClone(DEFAULT_LIMITS);
  // Most tests record many runs; the rate limit has its own test.
  h.api.ctx.config.limits.drillRuns.userBurst = { limit: 1000, windowSec: 60 };
});

async function user(name: string) {
  const c = new Client(h.base, `198.51.100.${++ipCounter}`);
  await c.signUp(name);
  return c;
}

const ALL = [...DRILL_CATEGORIES];
type Level = 'warmup' | 'standard' | 'hard';

/** A full-mix run scoring `score` (all on multiplication), unless categories are given. */
function run(
  score: number,
  opts: {
    durationSec?: number;
    level?: Level;
    categories?: string[];
    byCategory?: DrillCategoryResult[];
  } = {},
) {
  const durationSec = opts.durationSec ?? 60;
  return {
    config: {
      durationSec,
      level: opts.level ?? 'standard',
      categories: opts.categories ?? ALL,
    },
    byCategory: opts.byCategory ?? [
      {
        category: 'multiply',
        correct: Math.max(score, 0),
        wrong: Math.max(-score, 0),
        skipped: 0,
      },
    ],
    elapsedMs: durationSec * 1000,
  };
}

async function record(c: Client, body: unknown) {
  const res = await c.post('/api/drill/runs', body);
  expect(res.status, res.text).toBe(200);
  return RecordDrillRunResponse.parse(res.json);
}

async function history(c: Client) {
  const res = await c.get('/api/drill/runs');
  expect(res.status).toBe(200);
  return DrillHistory.parse(res.json);
}

describe('drill runs', () => {
  it('records a run, computing totals and score itself, and reads it back', async () => {
    const c = await user('Drill');
    expect(await history(c)).toEqual({ runs: [], bests: [], totalRuns: 0 });
    const before = Date.now();
    const { run: stored, newBest } = await record(c, {
      config: { durationSec: 120, level: 'hard', categories: ['percentages', 'add-subtract'] },
      byCategory: [
        { category: 'percentages', correct: 7, wrong: 2, skipped: 1 },
        { category: 'add-subtract', correct: 12, wrong: 1, skipped: 0 },
      ],
      elapsedMs: 118_500,
      // Whatever the client claims is ignored.
      score: 999,
      correct: 999,
      finishedAt: '2000-01-01T00:00:00.000Z',
    });
    expect(newBest).toBe(false);
    expect(stored).toMatchObject({
      config: { durationSec: 120, level: 'hard', categories: ['add-subtract', 'percentages'] },
      byCategory: [
        { category: 'add-subtract', correct: 12, wrong: 1, skipped: 0 },
        { category: 'percentages', correct: 7, wrong: 2, skipped: 1 },
      ],
      correct: 19,
      wrong: 3,
      skipped: 1,
      score: 16,
      elapsedMs: 118_500,
    });
    const at = new Date(stored.finishedAt).getTime();
    expect(at).toBeGreaterThanOrEqual(before - 1000);
    expect(at).toBeLessThanOrEqual(Date.now() + 1000);

    const hist = await history(c);
    expect(hist.runs).toEqual([stored]);
    expect(hist.totalRuns).toBe(1);
    // Chosen categories set no best.
    expect(hist.bests).toEqual([]);
  });

  it('refuses a body that is inconsistent or impossible', async () => {
    const c = await user('Cheat');
    const bad = async (body: unknown) => {
      const res = await c.post('/api/drill/runs', body);
      expect([res.status, res.json?.error?.code]).toEqual([400, 'validation_error']);
    };
    // A category that was not part of the run.
    await bad(
      run(0, {
        categories: ['multiply'],
        byCategory: [{ category: 'divide', correct: 1, wrong: 0, skipped: 0 }],
      }),
    );
    // More answers than anyone gives in 60 s.
    await bad(
      run(0, { byCategory: [{ category: 'multiply', correct: 150, wrong: 20, skipped: 20 }] }),
    );
    // Longer than its clock (past the grace).
    await bad({ ...run(5), elapsedMs: 66_000 });
    // A duration that is not offered.
    await bad(run(5, { durationSec: 90 }));
    await bad({ ...run(5), elapsedMs: -1 });
    expect((await c.post('/api/drill/runs', 'not json')).status).toBe(400);
    expect((await history(c)).totalRuns).toBe(0);
  });

  it('keeps bests per duration and level from full-mix runs only, earliest on a tie', async () => {
    const c = await user('Best');
    const first = await record(c, run(10));
    expect(first.newBest).toBe(true);
    const tie = await record(c, run(10));
    expect(tie.newBest).toBe(false);
    expect((await record(c, run(8))).newBest).toBe(false);
    expect((await record(c, run(11))).newBest).toBe(true);
    // Other durations and levels are separate.
    expect((await record(c, run(3, { durationSec: 300 }))).newBest).toBe(true);
    expect((await record(c, run(4, { level: 'hard' }))).newBest).toBe(true);
    // A custom-category run never sets a best, however high.
    const custom = await record(c, run(40, { categories: ['multiply'] }));
    expect(custom.newBest).toBe(false);
    // A first run that scores nothing is no best (but still listed among the bests).
    expect((await record(c, run(0, { level: 'warmup', durationSec: 120 }))).newBest).toBe(false);

    const hist = await history(c);
    expect(hist.totalRuns).toBe(8);
    expect(hist.bests.map((b) => [b.durationSec, b.level, b.score])).toEqual([
      [60, 'standard', 11],
      [60, 'hard', 4],
      [120, 'warmup', 0],
      [300, 'standard', 3],
    ]);

    // A tie keeps the earliest run.
    const d = await user('Tie');
    const a = await record(d, run(7, { level: 'hard' }));
    await record(d, run(7, { level: 'hard' }));
    expect((await history(d)).bests).toEqual([
      { durationSec: 60, level: 'hard', score: 7, finishedAt: a.run.finishedAt },
    ]);
  });

  it('shows each user only their own runs', async () => {
    const a = await user('Alice');
    const b = await user('Bob');
    const mine = await record(a, run(5));
    expect((await record(b, run(3))).newBest).toBe(true);
    const ha = await history(a);
    const hb = await history(b);
    expect(ha.runs.map((r) => r.id)).toEqual([mine.run.id]);
    expect(hb.runs.map((r) => r.id)).not.toContain(mine.run.id);
    expect(hb.bests.map((x) => x.score)).toEqual([3]);
    expect(hb.totalRuns).toBe(1);
  });

  it('refuses anonymous callers and guests', async () => {
    const anon = new Client(h.base, `198.51.100.${++ipCounter}`);
    expect((await anon.get('/api/drill/runs')).status).toBe(401);
    expect((await anon.post('/api/drill/runs', run(5))).status).toBe(401);

    const host = await user('Host');
    const room = await host.post('/api/pads', {
      kind: 'room',
      language: 'python',
      problemSlug: 'two-sum',
    });
    const guest = new Client(h.base, `198.51.100.${++ipCounter}`);
    const joined = await guest.post('/api/pads/join-guest', {
      shareToken: room.json.shareToken,
      name: 'Casey',
    });
    expect(joined.status).toBe(200);
    for (const res of [
      await guest.get('/api/drill/runs'),
      await guest.post('/api/drill/runs', run(5)),
    ])
      expect([res.status, res.json?.error?.code]).toEqual([403, 'account_required']);
  });

  it('rate limits recording', async () => {
    h.api.ctx.config.limits.drillRuns.userBurst = { limit: 2, windowSec: 60 };
    const c = await user('Hasty');
    await record(c, run(1));
    await record(c, run(2));
    const limited = await c.post('/api/drill/runs', run(3));
    expect(limited.status).toBe(429);
    expect(limited.json.error.retryAfter).toBeGreaterThan(0);
    expect(limited.headers.get('retry-after')).toBeTruthy();
    // A refused run is not stored, and reading is not limited.
    expect((await history(c)).totalRuns).toBe(2);
  });

  it('lists the latest runs newest first and counts them all', async () => {
    const c = await user('Keen');
    const ids: string[] = [];
    for (let i = 0; i < DRILL_HISTORY_LIMIT + 3; i++)
      ids.push((await record(c, run(i % 5, { categories: ['multiply'] }))).run.id);
    const hist = await history(c);
    expect(hist.totalRuns).toBe(DRILL_HISTORY_LIMIT + 3);
    expect(hist.runs.map((r) => r.id)).toEqual(ids.reverse().slice(0, DRILL_HISTORY_LIMIT));
  });
});
