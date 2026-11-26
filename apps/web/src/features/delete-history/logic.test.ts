import { DRILL_CATEGORIES, type DrillBest, type DrillRun } from '@ipp/contracts';
import { describe, expect, it } from 'vitest';
import { ApiRequestError } from '@/lib/api';
import {
  type AttemptTarget,
  alreadyGone,
  attemptDeleteCopy,
  attemptTarget,
  clearDrillHistoryCopy,
  clearQuizHistoryCopy,
  drillRunDeleteCopy,
  holdsBest,
  withoutAttempt,
  withoutRun,
} from './logic';

const t = (over: Partial<AttemptTarget> = {}): AttemptTarget => ({
  id: 'a1',
  mode: 'practice',
  status: 'finished',
  topics: 'C++',
  answered: 8,
  ...over,
});

describe('attemptDeleteCopy', () => {
  it('names the mode and topics and says the numbers fall back to what is left', () => {
    const c = attemptDeleteCopy(t());
    expect(c.action).toBe('Delete practice quiz');
    expect(c.title).toBe('Delete this practice quiz on C++?');
    expect(c.description).toMatch(/cannot be undone/);
    expect(c.lost).toEqual([
      '8 answers and their feedback.',
      expect.stringMatching(
        /stats, roadmap progress and question statuses go back.*Prefer questions I missed/,
      ),
    ]);
    expect(c.done).toBe('Practice quiz deleted');
  });

  it('a running attempt cannot be resumed afterwards', () => {
    const c = attemptDeleteCopy(t({ status: 'active', answered: 1 }));
    expect(c.lost[0]).toMatch(/in progress: you will not be able to resume it/);
    expect(c.lost[1]).toBe('1 answer and its feedback.');
  });

  it('a running exam changes no numbers; nor does an attempt with no answers', () => {
    expect(
      attemptDeleteCopy(t({ mode: 'exam', status: 'active', answered: 4 })).lost.at(-1),
    ).toMatch(/do not change: answers in an exam count once it is finished/);
    expect(attemptDeleteCopy(t({ mode: 'exam', status: 'finished' })).lost.at(-1)).toMatch(
      /go back/,
    );
    const empty = attemptDeleteCopy(t({ answered: 0 }));
    expect(empty.lost).toContain('No answers yet.');
    expect(empty.lost.at(-1)).toMatch(/do not change/);
  });

  it('a discussion loses its conversation too', () => {
    const c = attemptDeleteCopy(t({ mode: 'discussion', answered: 2 }));
    expect(c.title).toBe('Delete this discussion on C++?');
    expect(c.lost[0]).toBe('2 graded answers, and the conversation on every question.');
  });

  it('builds the target from a history entry', () => {
    expect(
      attemptTarget(
        { id: 'x', mode: 'exam', status: 'active', answeredCount: 3 },
        'Networking, Python',
      ),
    ).toEqual({
      id: 'x',
      mode: 'exam',
      status: 'active',
      topics: 'Networking, Python',
      answered: 3,
    });
  });
});

describe('clearing everything', () => {
  it('quiz history: attempts, the question bank, and what still counts', () => {
    const c = clearQuizHistoryCopy(3);
    expect(c.lost[0]).toBe('3 quizzes in your history, with their answers.');
    expect(c.lost.join(' ')).toMatch(/question bank/);
    expect(c.lost.join(' ')).toMatch(/quant rounds still count/);
    expect(clearQuizHistoryCopy(1).lost[0]).toMatch(/^1 quiz in/);
  });

  it('drill history: every run and every best', () => {
    const c = clearDrillHistoryCopy(12);
    expect(c.lost).toEqual(['All 12 runs.', expect.stringMatching(/Every best/)]);
  });
});

const ALL = [...DRILL_CATEGORIES];
const run = (over: Partial<DrillRun> = {}): DrillRun => ({
  id: 'r1',
  config: { durationSec: 120, level: 'standard', categories: ALL },
  byCategory: [{ category: 'multiply', correct: 31, wrong: 0, skipped: 0 }],
  correct: 31,
  wrong: 0,
  skipped: 0,
  score: 31,
  elapsedMs: 120_000,
  finishedAt: '2026-11-20T10:00:00.000Z',
  ...over,
});
const best: DrillBest = {
  durationSec: 120,
  level: 'standard',
  score: 31,
  finishedAt: '2026-11-20T10:00:00.000Z',
};

describe('drill runs', () => {
  it('knows which run a best belongs to', () => {
    expect(holdsBest(run(), [best])).toBe(true);
    // The same score later: the best is the earlier run.
    expect(holdsBest(run({ finishedAt: '2026-11-21T10:00:00.000Z' }), [best])).toBe(false);
    expect(holdsBest(run({ config: { ...run().config, level: 'hard' } }), [best])).toBe(false);
    expect(holdsBest(run({ config: { ...run().config, categories: ['multiply'] } }), [best])).toBe(
      false,
    );
  });

  it('says when deleting a run changes a best', () => {
    const c = drillRunDeleteCopy(run(), [best]);
    expect(c.title).toBe('Delete this 2 min · Standard · All categories run?');
    expect(c.description).toMatch(/scored 31/);
    expect(c.lost[1]).toMatch(/your best at 2 min · Standard: the best goes to your next highest/);
    expect(drillRunDeleteCopy(run({ score: 20 }), [best]).lost[1]).toBe(
      'Your bests stay as they are.',
    );
    expect(
      drillRunDeleteCopy(run({ config: { ...run().config, categories: ['multiply'] } }), [best])
        .lost[1],
    ).toMatch(/never sets one/);
  });

  it('drops a run that was already gone from the cached history', () => {
    const h = { runs: [run(), run({ id: 'r2' })], bests: [best], totalRuns: 9 };
    expect(withoutRun(h, 'r1')).toEqual({ runs: [run({ id: 'r2' })], bests: [best], totalRuns: 8 });
    expect(withoutRun(h, 'zz')?.totalRuns).toBe(9);
    expect(withoutRun(undefined, 'r1')).toBeUndefined();
  });
});

describe('cache helpers', () => {
  it('a 404 is already gone, anything else is a failure', () => {
    expect(alreadyGone(new ApiRequestError(404, 'not_found', 'Attempt not found'))).toBe(true);
    expect(alreadyGone(new ApiRequestError(503, 'unavailable', 'busy'))).toBe(false);
    expect(alreadyGone(new Error('x'))).toBe(false);
  });

  it('drops the attempt from the list and leaves an absent cache absent', () => {
    const list = [{ id: 'a' }, { id: 'b' }] as Parameters<typeof withoutAttempt>[0];
    expect(withoutAttempt(list, 'a')).toEqual([{ id: 'b' }]);
    expect(withoutAttempt(undefined, 'a')).toBeUndefined();
  });
});
