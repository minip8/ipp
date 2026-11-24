import { AnswerFeedback, QuizAttempt, QuizTopicStats } from '@ipp/contracts';
import { aiUsage } from '@ipp/db';
import { eq } from '@ipp/db/orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  Client,
  FakeInterviewer,
  flushRedis,
  type Harness,
  startApi,
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

const LEAKS = [
  'EXPLAIN-',
  'REFERENCE-SHORT',
  '"answer"',
  'correctAnswer',
  'keyPoints',
  'destructor releases',
];
const noLeak = (s: string) => {
  for (const l of LEAKS) expect(s).not.toContain(l);
};

const RIGHT = {
  'tq-single': { type: 'single', choice: 'b' },
  'tq-multiple': { type: 'multiple', choices: ['c', 'a'] },
  'tq-output': { type: 'output', answer: { kind: 'output', output: '  1   2\n3\n' } },
  'tq-short': { type: 'short', text: 'Resources are released in destructors.' },
} as const;

/** A signed-up user; with their own API key unless `withKey` is false (AI grading uses it). */
async function user(name: string, withKey = true) {
  const c = new Client(h.base, `100.100.0.${Math.floor(Math.random() * 250)}`);
  await c.signUp(name);
  if (withKey) await c.saveKey();
  return c;
}

describe('quiz', () => {
  it('practice: feedback per answer, nothing revealed for unanswered questions', async () => {
    const c = await user('Practice');
    expect((await c.post('/api/quiz/attempts', { topics: ['nope'] })).status).toBe(400);
    const res = await c.post('/api/quiz/attempts', {
      topics: ['test-topic'],
      count: 4,
      mode: 'practice',
    });
    expect(res.status).toBe(200);
    const attempt = QuizAttempt.parse(res.json);
    expect(attempt.questions).toHaveLength(4);
    expect(attempt.feedback).toEqual([]);
    noLeak(res.text);

    const single = await c.post(`/api/quiz/attempts/${attempt.id}/answers`, {
      questionId: 'tq-single',
      response: { type: 'single', choice: 'a' },
    });
    const fb = AnswerFeedback.parse(single.json);
    expect(fb).toMatchObject({
      correct: false,
      score: 0,
      correctAnswer: 'b',
      explanation: 'EXPLAIN-SINGLE',
      gradedBy: 'auto',
    });
    // Answering again in practice is refused.
    expect(
      (
        await c.post(`/api/quiz/attempts/${attempt.id}/answers`, {
          questionId: 'tq-single',
          response: RIGHT['tq-single'],
        })
      ).status,
    ).toBe(409);
    // Wrong response type and foreign question are rejected.
    expect(
      (
        await c.post(`/api/quiz/attempts/${attempt.id}/answers`, {
          questionId: 'tq-multiple',
          response: { type: 'single', choice: 'a' },
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await c.post(`/api/quiz/attempts/${attempt.id}/answers`, {
          questionId: 'not-in-it',
          response: { type: 'single', choice: 'a' },
        })
      ).status,
    ).toBe(400);

    const out = await c.post(`/api/quiz/attempts/${attempt.id}/answers`, {
      questionId: 'tq-output',
      response: RIGHT['tq-output'],
    });
    expect(out.json).toMatchObject({
      correct: true,
      score: 1,
      correctAnswer: { kind: 'output', output: '1 2\n3' },
    });

    const short = await c.post(`/api/quiz/attempts/${attempt.id}/answers`, {
      questionId: 'tq-short',
      response: RIGHT['tq-short'],
    });
    expect(short.json).toMatchObject({
      gradedBy: 'ai',
      score: 0.9,
      correct: true,
      feedback: 'Covered the key point.',
      correctAnswer: 'REFERENCE-SHORT',
      needsSelfGrade: false,
    });

    // Reload: answered questions have feedback, the unanswered one does not leak.
    const reload = await c.get(`/api/quiz/attempts/${attempt.id}`);
    const view = QuizAttempt.parse(reload.json);
    expect(view.feedback.map((f) => f.questionId).sort()).toEqual([
      'tq-output',
      'tq-short',
      'tq-single',
    ]);
    expect(Object.keys(view.responses).sort()).toEqual(['tq-output', 'tq-short', 'tq-single']);
    expect(reload.text).not.toContain('EXPLAIN-MULTIPLE');

    const fin = QuizAttempt.parse((await c.post(`/api/quiz/attempts/${attempt.id}/finish`)).json);
    expect(fin.status).toBe('finished');
    expect(fin.feedback).toHaveLength(4);
    expect(fin.score).toBeCloseTo((0 + 1 + 0.9 + 0) / 4);
    expect(
      (
        await c.post(`/api/quiz/attempts/${attempt.id}/answers`, {
          questionId: 'tq-multiple',
          response: RIGHT['tq-multiple'],
        })
      ).status,
    ).toBe(409);

    // Other users cannot see it.
    const other = await user('Peeker');
    expect((await other.get(`/api/quiz/attempts/${attempt.id}`)).status).toBe(404);

    const list = await c.get('/api/quiz/attempts');
    expect(list.json).toEqual([
      expect.objectContaining({ id: attempt.id, status: 'finished', questionCount: 4 }),
    ]);

    const stats = (await c.get('/api/quiz/topics')).json.map((t: unknown) =>
      QuizTopicStats.parse(t),
    );
    expect(stats).toEqual([
      {
        slug: 'test-topic',
        title: 'Test topic',
        description: 'Questions for the API tests',
        questionCount: 4,
        answered: 3,
        accuracy: expect.closeTo(1.9 / 3, 5),
      },
    ]);
  });

  it('exam: nothing revealed until finished, then all feedback; answers may change before finishing', async () => {
    const c = await user('Exam');
    const created = await c.post('/api/quiz/attempts', {
      topics: ['test-topic'],
      count: 4,
      mode: 'exam',
    });
    const attempt = QuizAttempt.parse(created.json);
    noLeak(created.text);
    const first = await c.post(`/api/quiz/attempts/${attempt.id}/answers`, {
      questionId: 'tq-single',
      response: { type: 'single', choice: 'a' },
    });
    expect(first.json).toEqual({ recorded: true });
    const changed = await c.post(`/api/quiz/attempts/${attempt.id}/answers`, {
      questionId: 'tq-single',
      response: RIGHT['tq-single'],
    });
    expect(changed.json).toEqual({ recorded: true });
    const multi = await c.post(`/api/quiz/attempts/${attempt.id}/answers`, {
      questionId: 'tq-multiple',
      response: { type: 'multiple', choices: ['a'] },
    });
    expect(multi.json).toEqual({ recorded: true });
    const mid = await c.get(`/api/quiz/attempts/${attempt.id}`);
    const midView = QuizAttempt.parse(mid.json);
    expect(midView.feedback).toEqual([]);
    expect(midView.score).toBeNull();
    noLeak(mid.text);
    // Stats do not move while the exam is running (they would leak correctness).
    const statsMid = (await c.get('/api/quiz/topics')).json;
    expect(statsMid[0]).toMatchObject({ answered: 0, accuracy: null });

    const fin = await c.post(`/api/quiz/attempts/${attempt.id}/finish`);
    const done = QuizAttempt.parse(fin.json);
    expect(done.feedback).toHaveLength(4);
    const byId = Object.fromEntries(done.feedback.map((f) => [f.questionId, f]));
    expect(byId['tq-single']).toMatchObject({ correct: true, score: 1 });
    expect(byId['tq-multiple']).toMatchObject({ correct: false, score: 0.5 });
    expect(byId['tq-output']).toMatchObject({
      correct: false,
      score: 0,
      feedback: 'Not answered.',
    });
    expect(done.score).toBeCloseTo(1.5 / 4);
    const statsAfter = (await c.get('/api/quiz/topics')).json;
    expect(statsAfter[0]).toMatchObject({ answered: 2 });
  });

  it('short answers fall back to self-grading without a key', async () => {
    const c = await user('SelfGrade', false);
    const attempt = QuizAttempt.parse(
      (await c.post('/api/quiz/attempts', { topics: ['test-topic'], count: 4 })).json,
    );
    const first = await c.post(`/api/quiz/attempts/${attempt.id}/answers`, {
      questionId: 'tq-short',
      response: { type: 'short', text: 'RAII ties lifetime' },
    });
    expect(first.json).toMatchObject({
      needsSelfGrade: true,
      gradedBy: 'self',
      score: 0,
      correctAnswer: 'REFERENCE-SHORT',
    });
    const graded = await c.post(`/api/quiz/attempts/${attempt.id}/answers`, {
      questionId: 'tq-short',
      response: { type: 'short', text: 'ignored', selfGrade: 1 },
    });
    expect(graded.json).toMatchObject({
      needsSelfGrade: false,
      gradedBy: 'self',
      score: 1,
      correct: true,
    });
    const view = QuizAttempt.parse((await c.get(`/api/quiz/attempts/${attempt.id}`)).json);
    expect(view.responses['tq-short']).toEqual({
      type: 'short',
      text: 'RAII ties lifetime',
      selfGrade: 1,
    });

    // Exam: self-grade after finishing.
    const exam = QuizAttempt.parse(
      (await c.post('/api/quiz/attempts', { topics: ['test-topic'], count: 4, mode: 'exam' })).json,
    );
    await c.post(`/api/quiz/attempts/${exam.id}/answers`, {
      questionId: 'tq-short',
      response: { type: 'short', text: 'x' },
    });
    const fin = QuizAttempt.parse((await c.post(`/api/quiz/attempts/${exam.id}/finish`)).json);
    expect(fin.feedback.find((f) => f.questionId === 'tq-short')?.needsSelfGrade).toBe(true);
    expect(fin.score).toBe(0);
    const late = await c.post(`/api/quiz/attempts/${exam.id}/answers`, {
      questionId: 'tq-short',
      response: { type: 'short', text: 'x', selfGrade: 0.5 },
    });
    expect(late.json).toMatchObject({ score: 0.5, correct: false, needsSelfGrade: false });
    expect((await c.get(`/api/quiz/attempts/${exam.id}`)).json.score).toBeCloseTo(0.5 / 4);
  });

  it('a failed grading call also falls back to self-grading', async () => {
    fake.shortGrade = null;
    try {
      const c = await user('ModelDown');
      const attempt = QuizAttempt.parse(
        (await c.post('/api/quiz/attempts', { topics: ['test-topic'], count: 4 })).json,
      );
      const res = await c.post(`/api/quiz/attempts/${attempt.id}/answers`, {
        questionId: 'tq-short',
        response: RIGHT['tq-short'],
      });
      expect(res.json).toMatchObject({ needsSelfGrade: true, gradedBy: 'self' });
    } finally {
      fake.shortGrade = { score: 0.9, feedback: 'Covered the key point.' };
    }
  });

  it('short-answer grading is charged to the user and refused over the daily budget', async () => {
    const c = await user('Budgeted');
    const me = (await c.get('/api/me')).json.user.id as string;
    const a = QuizAttempt.parse(
      (await c.post('/api/quiz/attempts', { topics: ['test-topic'], count: 4 })).json,
    );
    const graded = await c.post(`/api/quiz/attempts/${a.id}/answers`, {
      questionId: 'tq-short',
      response: RIGHT['tq-short'],
    });
    expect(graded.json.gradedBy).toBe('ai');
    await until(async () => {
      const [row] = await h.api.ctx.db.select().from(aiUsage).where(eq(aiUsage.userId, me));
      return row?.messages === 1 && row.inputTokens === 100 && row.outputTokens === 10;
    });
    h.api.ctx.config.aiDailyMessageLimit = 1;
    try {
      const b = QuizAttempt.parse(
        (await c.post('/api/quiz/attempts', { topics: ['test-topic'], count: 4 })).json,
      );
      const over = await c.post(`/api/quiz/attempts/${b.id}/answers`, {
        questionId: 'tq-short',
        response: RIGHT['tq-short'],
      });
      expect(over.json).toMatchObject({ gradedBy: 'self', needsSelfGrade: true });
    } finally {
      h.api.ctx.config.aiDailyMessageLimit = 300;
    }
  });

  it('selection favours missed and unseen questions', async () => {
    const c = await user('Weak');
    // Answer everything: single wrong, the rest right.
    const a = QuizAttempt.parse(
      (await c.post('/api/quiz/attempts', { topics: ['test-topic'], count: 4 })).json,
    );
    await c.post(`/api/quiz/attempts/${a.id}/answers`, {
      questionId: 'tq-single',
      response: { type: 'single', choice: 'a' },
    });
    for (const id of ['tq-multiple', 'tq-output', 'tq-short'] as const) {
      await c.post(`/api/quiz/attempts/${a.id}/answers`, { questionId: id, response: RIGHT[id] });
    }
    for (let i = 0; i < 5; i++) {
      const next = QuizAttempt.parse(
        (await c.post('/api/quiz/attempts', { topics: ['test-topic'], count: 1 })).json,
      );
      expect(next.questions.map((q) => q.id)).toEqual(['tq-single']);
    }
    const random = QuizAttempt.parse(
      (await c.post('/api/quiz/attempts', { topics: ['test-topic'], count: 4, focusWeak: false }))
        .json,
    );
    expect(random.questions).toHaveLength(4);
  });
});
