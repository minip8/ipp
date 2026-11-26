/** Deleting from one's own history: quiz attempts, the whole quiz history, and drill runs. */
import {
  ClearQuizHistoryResponse,
  DeleteAttemptResponse,
  DRILL_CATEGORIES,
  DrillHistory,
  QuizAttempt,
  QuizAttemptSummary,
  QuizBank,
  RecordDrillRunResponse,
} from '@ipp/contracts';
import { quizAnswers } from '@ipp/db';
import { eq } from '@ipp/db/orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_LIMITS } from '../src/config';
import { Client, FakeInterviewer, flushRedis, type Harness, startApi } from './helpers/harness';

let h: Harness;
let ipCounter = 0;
beforeAll(async () => {
  await flushRedis();
  h = await startApi({ fake: new FakeInterviewer() });
});
afterAll(async () => h?.stop());
beforeEach(() => {
  h.api.ctx.config.limits = structuredClone(DEFAULT_LIMITS);
  h.api.ctx.config.limits.drillRuns.userBurst = { limit: 1000, windowSec: 60 };
});

async function user(name: string) {
  const c = new Client(h.base, `198.51.101.${++ipCounter}`);
  await c.signUp(name);
  return c;
}

const RIGHT_SINGLE = { type: 'single', choice: 'b' } as const;
const WRONG_SINGLE = { type: 'single', choice: 'a' } as const;
const RIGHT_MULTIPLE = { type: 'multiple', choices: ['c', 'a'] } as const;

async function attempt(c: Client, mode: 'practice' | 'exam' = 'practice') {
  const res = await c.post('/api/quiz/attempts', { topics: ['test-topic'], count: 4, mode });
  expect(res.status, res.text).toBe(200);
  return QuizAttempt.parse(res.json);
}

async function answer(c: Client, attemptId: string, questionId: string, response: unknown) {
  const res = await c.post(`/api/quiz/attempts/${attemptId}/answers`, { questionId, response });
  expect(res.status, res.text).toBe(200);
}

async function history(c: Client) {
  return QuizAttemptSummary.array().parse((await c.get('/api/quiz/attempts')).json);
}

async function status(c: Client) {
  const bank = QuizBank.parse((await c.get('/api/quiz/topics/test-topic/questions')).json);
  return Object.fromEntries(bank.items.map((i) => [i.question.id, i.status]));
}

async function stats(c: Client) {
  return (await c.get('/api/quiz/topics')).json[0] as { answered: number; accuracy: number | null };
}

describe('deleting a quiz attempt', () => {
  it('lists how many questions each attempt has answered', async () => {
    const c = await user('Counter');
    const a = await attempt(c);
    await answer(c, a.id, 'tq-single', RIGHT_SINGLE);
    await answer(c, a.id, 'tq-multiple', RIGHT_MULTIPLE);
    await attempt(c, 'exam');
    expect((await history(c)).map((s) => [s.mode, s.answeredCount])).toEqual([
      ['exam', 0],
      ['practice', 2],
    ]);
  });

  it('removes the attempt and its answers, and the numbers fall back to what is left', async () => {
    const c = await user('Deleter');
    // An older attempt got tq-single wrong; a newer one got it right.
    const older = await attempt(c);
    await answer(c, older.id, 'tq-single', WRONG_SINGLE);
    const newer = await attempt(c);
    await answer(c, newer.id, 'tq-single', RIGHT_SINGLE);
    await answer(c, newer.id, 'tq-multiple', RIGHT_MULTIPLE);
    expect(await status(c)).toMatchObject({ 'tq-single': 'correct', 'tq-multiple': 'correct' });
    expect(await stats(c)).toMatchObject({ answered: 2, accuracy: 1 });

    const res = await c.del(`/api/quiz/attempts/${newer.id}`);
    expect(res.status, res.text).toBe(200);
    expect(DeleteAttemptResponse.parse(res.json)).toEqual({ attemptId: newer.id });
    // Gone from the list and from its own page; its answers with it.
    expect((await history(c)).map((a) => a.id)).toEqual([older.id]);
    expect((await c.get(`/api/quiz/attempts/${newer.id}`)).status).toBe(404);
    const left = await h.api.ctx.db
      .select()
      .from(quizAnswers)
      .where(eq(quizAnswers.attemptId, newer.id));
    expect(left).toEqual([]);
    // Status and stats read the latest answer that is left: the older wrong one, or none.
    expect(await status(c)).toMatchObject({
      'tq-single': 'incorrect',
      'tq-multiple': 'unanswered',
    });
    expect(await stats(c)).toMatchObject({ answered: 1, accuracy: 0 });
    // A second delete is a 404.
    expect((await c.del(`/api/quiz/attempts/${newer.id}`)).status).toBe(404);
  });

  it('deletes a running attempt of any mode', async () => {
    const c = await user('Runner');
    const practice = await attempt(c);
    await answer(c, practice.id, 'tq-single', RIGHT_SINGLE);
    const exam = await attempt(c, 'exam');
    await c.saveKey();
    const discussion = await c.post('/api/quiz/attempts', {
      topics: ['test-topic'],
      count: 1,
      mode: 'discussion',
    });
    expect(discussion.status, discussion.text).toBe(200);
    for (const id of [practice.id, exam.id, discussion.json.id as string])
      expect((await c.del(`/api/quiz/attempts/${id}`)).status).toBe(200);
    expect(await history(c)).toEqual([]);
  });

  it('only the owner can delete, and someone else’s id looks like no attempt at all', async () => {
    const owner = await user('Owner');
    const other = await user('Other');
    const a = await attempt(owner);
    const theirs = await other.del(`/api/quiz/attempts/${a.id}`);
    const missing = await other.del('/api/quiz/attempts/00000000-0000-4000-8000-000000000000');
    expect(theirs.status).toBe(404);
    expect(theirs.json).toEqual(missing.json);
    expect((await other.del('/api/quiz/attempts/not-an-id')).status).toBe(404);
    expect((await history(owner)).map((x) => x.id)).toEqual([a.id]);
  });
});

describe('clearing the quiz history', () => {
  it('deletes every attempt and every question-bank answer of the caller only', async () => {
    const c = await user('Clearer');
    const bystander = await user('Bystander');
    const a = await attempt(c);
    await answer(c, a.id, 'tq-single', RIGHT_SINGLE);
    await attempt(c, 'exam');
    expect(
      (await c.post('/api/quiz/questions/tq-multiple/answers', { response: RIGHT_MULTIPLE }))
        .status,
    ).toBe(200);
    const b = await attempt(bystander);
    await answer(bystander, b.id, 'tq-single', RIGHT_SINGLE);

    const res = await c.del('/api/quiz/history');
    expect(res.status, res.text).toBe(200);
    expect(ClearQuizHistoryResponse.parse(res.json)).toEqual({ attempts: 2, bankAnswers: 1 });
    expect(await history(c)).toEqual([]);
    expect(Object.values(await status(c)).every((s) => s === 'unanswered')).toBe(true);
    expect(await stats(c)).toMatchObject({ answered: 0, accuracy: null });
    // Someone else's history is untouched.
    expect((await history(bystander)).map((x) => x.id)).toEqual([b.id]);
    expect((await status(bystander))['tq-single']).toBe('correct');
    // Nothing left is not an error.
    expect((await c.del('/api/quiz/history')).json).toEqual({ attempts: 0, bankAnswers: 0 });
  });
});

const ALL = [...DRILL_CATEGORIES];
function drillRun(score: number, durationSec = 60) {
  return {
    config: { durationSec, level: 'standard', categories: ALL },
    byCategory: [{ category: 'multiply', correct: score, wrong: 0, skipped: 0 }],
    elapsedMs: durationSec * 1000,
  };
}
async function record(c: Client, score: number) {
  const res = await c.post('/api/drill/runs', drillRun(score));
  expect(res.status, res.text).toBe(200);
  return RecordDrillRunResponse.parse(res.json).run;
}

describe('deleting drill runs', () => {
  it('deletes one run and answers with the history, the best falling to the next run', async () => {
    const c = await user('Driller');
    const low = await record(c, 5);
    const best = await record(c, 9);
    const res = await c.del(`/api/drill/runs/${best.id}`);
    expect(res.status, res.text).toBe(200);
    const after = DrillHistory.parse(res.json);
    expect(after.runs.map((r) => r.id)).toEqual([low.id]);
    expect(after.totalRuns).toBe(1);
    expect(after.bests.map((b) => b.score)).toEqual([5]);
    expect(DrillHistory.parse((await c.get('/api/drill/runs')).json)).toEqual(after);
    expect((await c.del(`/api/drill/runs/${best.id}`)).status).toBe(404);
  });

  it('clears every run and best of the caller only', async () => {
    const c = await user('Wiper');
    const other = await user('Keeper');
    await record(c, 4);
    await record(c, 6);
    const kept = await record(other, 3);
    const res = await c.del('/api/drill/runs');
    expect(res.status, res.text).toBe(200);
    expect(DrillHistory.parse(res.json)).toEqual({ runs: [], bests: [], totalRuns: 0 });
    expect(DrillHistory.parse((await other.get('/api/drill/runs')).json).runs[0]?.id).toBe(kept.id);
  });

  it('someone else’s run is a 404 and stays', async () => {
    const owner = await user('RunOwner');
    const other = await user('Prowler');
    const run = await record(owner, 7);
    expect((await other.del(`/api/drill/runs/${run.id}`)).status).toBe(404);
    expect(DrillHistory.parse((await owner.get('/api/drill/runs')).json).totalRuns).toBe(1);
  });
});

describe('history deletes', () => {
  it('are rate limited', async () => {
    h.api.ctx.config.limits.historyDeletes.userBurst = { limit: 2, windowSec: 60 };
    const c = await user('Hasty');
    expect((await c.del('/api/drill/runs')).status).toBe(200);
    expect((await c.del('/api/quiz/history')).status).toBe(200);
    const limited = await c.del('/api/drill/runs');
    expect(limited.status).toBe(429);
    expect(limited.json.error.retryAfter).toBeGreaterThan(0);
  });

  it('need an account: anonymous callers and guests are refused', async () => {
    const anon = new Client(h.base, `198.51.101.${++ipCounter}`);
    const id = '00000000-0000-4000-8000-000000000000';
    for (const path of [
      `/api/quiz/attempts/${id}`,
      '/api/quiz/history',
      `/api/drill/runs/${id}`,
      '/api/drill/runs',
    ])
      expect((await anon.del(path)).status).toBe(401);

    const host = await user('RoomHost');
    const room = await host.post('/api/pads', {
      kind: 'room',
      language: 'python',
      problemSlug: 'two-sum',
    });
    const guest = new Client(h.base, `198.51.101.${++ipCounter}`);
    const joined = await guest.post('/api/pads/join-guest', {
      shareToken: room.json.shareToken,
      name: 'Casey',
    });
    expect(joined.status).toBe(200);
    for (const path of [
      `/api/quiz/attempts/${id}`,
      '/api/quiz/history',
      `/api/drill/runs/${id}`,
      '/api/drill/runs',
    ]) {
      const res = await guest.del(path);
      expect([res.status, res.json?.error?.code]).toEqual([403, 'account_required']);
    }
  });
});
