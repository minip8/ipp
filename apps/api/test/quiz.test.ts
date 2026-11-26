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
    // Open (short) questions are never part of a practice quiz or an exam.
    expect(attempt.questions.map((q) => q.id).sort()).toEqual([
      'tq-multiple',
      'tq-output',
      'tq-single',
    ]);
    expect(attempt.feedback).toEqual([]);
    expect(attempt.discussion).toEqual({});
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

    // Reload: answered questions have feedback, the unanswered one does not leak.
    const reload = await c.get(`/api/quiz/attempts/${attempt.id}`);
    const view = QuizAttempt.parse(reload.json);
    expect(view.feedback.map((f) => f.questionId).sort()).toEqual(['tq-output', 'tq-single']);
    expect(Object.keys(view.responses).sort()).toEqual(['tq-output', 'tq-single']);
    expect(reload.text).not.toContain('EXPLAIN-MULTIPLE');

    const fin = QuizAttempt.parse((await c.post(`/api/quiz/attempts/${attempt.id}/finish`)).json);
    expect(fin.status).toBe('finished');
    expect(fin.feedback).toHaveLength(3);
    expect(fin.score).toBeCloseTo((0 + 1 + 0) / 3);
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
      expect.objectContaining({ id: attempt.id, status: 'finished', questionCount: 3 }),
    ]);

    const stats = (await c.get('/api/quiz/topics')).json.map((t: unknown) =>
      QuizTopicStats.parse(t),
    );
    expect(stats).toEqual([
      {
        slug: 'test-topic',
        title: 'Test topic',
        description: 'Questions for the API tests',
        track: 'fundamentals',
        questionCount: 4,
        shortCount: 1,
        answered: 2,
        accuracy: expect.closeTo(1 / 2, 5),
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
    expect(done.feedback).toHaveLength(3);
    const byId = Object.fromEntries(done.feedback.map((f) => [f.questionId, f]));
    expect(byId['tq-single']).toMatchObject({ correct: true, score: 1 });
    expect(byId['tq-multiple']).toMatchObject({ correct: false, score: 0.5 });
    expect(byId['tq-output']).toMatchObject({
      correct: false,
      score: 0,
      feedback: 'Not answered.',
    });
    expect(done.score).toBeCloseTo(1.5 / 3);
    const statsAfter = (await c.get('/api/quiz/topics')).json;
    expect(statsAfter[0]).toMatchObject({ answered: 2 });
  });

  it('a failed grading call falls back to self-grading', async () => {
    fake.shortGrade = null;
    try {
      const c = await user('ModelDown');
      const res = await c.post('/api/quiz/questions/tq-short/answers', {
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
    const graded = await c.post('/api/quiz/questions/tq-short/answers', {
      response: RIGHT['tq-short'],
    });
    expect(graded.json.gradedBy).toBe('ai');
    await until(async () => {
      const [row] = await h.api.ctx.db.select().from(aiUsage).where(eq(aiUsage.userId, me));
      return row?.messages === 1 && row.inputTokens === 100 && row.outputTokens === 10;
    });
    h.api.ctx.config.aiDailyMessageLimit = 1;
    try {
      const over = await c.post('/api/quiz/questions/tq-short/answers', {
        response: RIGHT['tq-short'],
      });
      expect(over.json).toMatchObject({ gradedBy: 'self', needsSelfGrade: true });
    } finally {
      h.api.ctx.config.aiDailyMessageLimit = 300;
    }
  });

  it('discussion: open questions only, follow-ups, then a graded answer', async () => {
    const c = await user('Talker');
    fake.discussionCalls = [];
    const created = await c.post('/api/quiz/attempts', {
      topics: ['test-topic'],
      count: 5,
      mode: 'discussion',
    });
    const attempt = QuizAttempt.parse(created.json);
    expect(attempt.mode).toBe('discussion');
    expect(attempt.questions.map((q) => q.id)).toEqual(['tq-short']);
    noLeak(created.text);
    const say = (text: string, questionId = 'tq-short') =>
      c.post(`/api/quiz/attempts/${attempt.id}/discussion`, { questionId, text });

    // A discussion is not answered through the ordinary endpoint.
    expect(
      (
        await c.post(`/api/quiz/attempts/${attempt.id}/answers`, {
          questionId: 'tq-short',
          response: RIGHT['tq-short'],
        })
      ).status,
    ).toBe(400);
    expect((await say('x', 'tq-single')).status).toBe(400);
    expect((await say('   ')).status).toBe(400);

    const first = await say('It is about lifetimes.');
    expect(first.status).toBe(200);
    expect(first.json).toEqual({
      turns: [
        { role: 'candidate', text: 'It is about lifetimes.' },
        { role: 'interviewer', text: 'What happens under contention?' },
      ],
      feedback: null,
    });
    // A follow-up reveals nothing, and nothing counts yet.
    noLeak(first.text);
    const mid = await c.get(`/api/quiz/attempts/${attempt.id}`);
    noLeak(mid.text);
    expect(QuizAttempt.parse(mid.json)).toMatchObject({
      feedback: [],
      responses: {},
      discussion: { 'tq-short': first.json.turns },
    });
    expect((await c.get('/api/quiz/topics')).json[0]).toMatchObject({ answered: 0 });

    const second = await say('Resources are released in destructors.');
    expect(second.json.turns).toHaveLength(3);
    expect(AnswerFeedback.parse(second.json.feedback)).toMatchObject({
      gradedBy: 'ai',
      score: 0.9,
      correct: true,
      feedback: 'Covered the key points.',
      correctAnswer: 'REFERENCE-SHORT',
      needsSelfGrade: false,
    });
    // The model saw the whole conversation, follow-up included.
    expect(fake.discussionCalls.map((x) => [x.turns.length, x.final])).toEqual([
      [1, false],
      [3, false],
    ]);
    expect((await say('more')).status).toBe(409);

    // The recorded answer is everything the candidate said; it counts at once, like practice.
    const view = QuizAttempt.parse((await c.get(`/api/quiz/attempts/${attempt.id}`)).json);
    expect(view.responses['tq-short']).toEqual({
      type: 'short',
      text: 'It is about lifetimes.\n\nResources are released in destructors.',
    });
    expect(view.feedback).toHaveLength(1);
    expect((await c.get('/api/quiz/topics')).json[0]).toMatchObject({ answered: 1 });
    const fin = QuizAttempt.parse((await c.post(`/api/quiz/attempts/${attempt.id}/finish`)).json);
    expect(fin.score).toBeCloseTo(0.9);
    expect(fin.discussion['tq-short']).toHaveLength(3);
  });

  it('discussion: the last turn closes the question whatever the model wants to ask', async () => {
    const c = await user('Stubborn');
    fake.discussionCalls = [];
    const saved = fake.discussionSteps;
    fake.discussionSteps = [{ score: 0.2, feedback: 'Thin.', followUp: 'And then?' }];
    try {
      const attempt = QuizAttempt.parse(
        (await c.post('/api/quiz/attempts', { topics: ['test-topic'], mode: 'discussion' })).json,
      );
      const say = (text: string) =>
        c.post(`/api/quiz/attempts/${attempt.id}/discussion`, { questionId: 'tq-short', text });
      expect((await say('one')).json.feedback).toBeNull();
      expect((await say('two')).json.feedback).toBeNull();
      const last = await say('three');
      expect(last.json.turns).toHaveLength(5);
      expect(last.json.feedback).toMatchObject({ score: 0.2, correct: false, feedback: 'Thin.' });
      expect(fake.discussionCalls.map((x) => x.final)).toEqual([false, false, true]);
    } finally {
      fake.discussionSteps = saved;
    }
  });

  it('discussion: needs a key, and a failed reply stores nothing', async () => {
    const keyless = await user('NoKey', false);
    const a = QuizAttempt.parse(
      (await keyless.post('/api/quiz/attempts', { topics: ['test-topic'], mode: 'discussion' }))
        .json,
    );
    const refused = await keyless.post(`/api/quiz/attempts/${a.id}/discussion`, {
      questionId: 'tq-short',
      text: 'hello',
    });
    expect(refused.status).toBe(409);
    expect(refused.json.error.code).toBe('ai_key_missing');

    const c = await user('ModelDownTalk');
    const saved = fake.discussionSteps;
    fake.discussionSteps = [null];
    try {
      const b = QuizAttempt.parse(
        (await c.post('/api/quiz/attempts', { topics: ['test-topic'], mode: 'discussion' })).json,
      );
      const down = await c.post(`/api/quiz/attempts/${b.id}/discussion`, {
        questionId: 'tq-short',
        text: 'hello',
      });
      expect(down.status).toBe(503);
      const view = QuizAttempt.parse((await c.get(`/api/quiz/attempts/${b.id}`)).json);
      expect(view.discussion).toEqual({});
    } finally {
      fake.discussionSteps = saved;
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
    for (const id of ['tq-multiple', 'tq-output'] as const) {
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
    expect(random.questions).toHaveLength(3);
  });
});
