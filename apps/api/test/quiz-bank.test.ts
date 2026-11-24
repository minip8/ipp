import {
  AnswerFeedback,
  QuizAttempt,
  QuizBank,
  QuizBankQuestion,
  QuizQuestion,
} from '@ipp/contracts';
import { quizAttempts, quizQuestions } from '@ipp/db';
import { eq } from '@ipp/db/orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client, FakeInterviewer, flushRedis, type Harness, startApi } from './helpers/harness';

let h: Harness;
let fake: FakeInterviewer;

/** Removed from content: never listed, never answerable. */
const INACTIVE = QuizQuestion.parse({
  id: 'tq-retired',
  topic: 'test-topic',
  subtopic: 'basics',
  difficulty: 'easy',
  type: 'single',
  prompt: 'Retired',
  explanation: 'EXPLAIN-RETIRED',
  choices: [
    { id: 'a', text: 'A' },
    { id: 'b', text: 'B' },
  ],
  answer: 'a',
});

beforeAll(async () => {
  await flushRedis();
  fake = new FakeInterviewer();
  h = await startApi({ fake });
  await h.api.ctx.db
    .insert(quizQuestions)
    .values({
      id: INACTIVE.id,
      topic: INACTIVE.topic,
      subtopic: INACTIVE.subtopic,
      difficulty: INACTIVE.difficulty,
      type: INACTIVE.type,
      data: INACTIVE,
      active: false,
    })
    .onConflictDoNothing();
});
afterAll(async () => {
  await h?.api.ctx.db.delete(quizQuestions).where(eq(quizQuestions.id, INACTIVE.id));
  await h?.stop();
});

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
const WRONG_SINGLE = { type: 'single', choice: 'a' } as const;

async function user(name: string, withKey = true) {
  const c = new Client(h.base, `100.101.0.${Math.floor(Math.random() * 250)}`);
  await c.signUp(name);
  if (withKey) await c.saveKey();
  return c;
}

const answer = (c: Client, id: string, response: unknown) =>
  c.post(`/api/quiz/questions/${id}/answers`, { response });

async function bank(c: Client) {
  const res = await c.get('/api/quiz/topics/test-topic/questions');
  expect(res.status).toBe(200);
  const parsed = QuizBank.parse(res.json);
  return {
    text: res.text,
    status: Object.fromEntries(parsed.items.map((i) => [i.question.id, i.status])),
    items: parsed.items,
  };
}

async function topicStats(c: Client) {
  return (await c.get('/api/quiz/topics')).json[0] as { answered: number; accuracy: number | null };
}

describe('question bank', () => {
  it('lists a topic without answers, in a stable order', async () => {
    const c = await user('Browser');
    const b = await bank(c);
    noLeak(b.text);
    expect(b.text).not.toContain(INACTIVE.id);
    // One subtopic, one difficulty: ordered by id.
    expect(b.items.map((i) => i.question.id)).toEqual([
      'tq-multiple',
      'tq-output',
      'tq-short',
      'tq-single',
    ]);
    expect(b.items.every((i) => i.status === 'unanswered' && i.score === null)).toBe(true);
    expect(b.items.every((i) => i.answeredAt === null)).toBe(true);

    expect((await c.get('/api/quiz/topics/nope/questions')).status).toBe(404);
    expect((await c.get('/api/quiz/topics/NOT_A_SLUG/questions')).status).toBe(404);

    const detail = await c.get('/api/quiz/questions/tq-single');
    expect(detail.status).toBe(200);
    expect(QuizBankQuestion.parse(detail.json)).toMatchObject({
      status: 'unanswered',
      response: null,
      feedback: null,
    });
    noLeak(detail.text);

    const anon = new Client(h.base);
    expect((await anon.get('/api/quiz/topics/test-topic/questions')).status).toBe(401);
    expect((await anon.post('/api/quiz/questions/tq-single/answers', RIGHT)).status).toBe(401);
  });

  it('grades like attempts do and lets the user answer again', async () => {
    const c = await user('Answerer');
    const wrong = await answer(c, 'tq-single', WRONG_SINGLE);
    expect(wrong.status).toBe(200);
    expect(AnswerFeedback.parse(wrong.json)).toMatchObject({
      questionId: 'tq-single',
      correct: false,
      score: 0,
      correctAnswer: 'b',
      explanation: 'EXPLAIN-SINGLE',
      gradedBy: 'auto',
      needsSelfGrade: false,
    });
    const partial = await answer(c, 'tq-multiple', { type: 'multiple', choices: ['a'] });
    expect(partial.json).toMatchObject({ correct: false, score: 0.5 });
    const out = await answer(c, 'tq-output', RIGHT['tq-output']);
    expect(out.json).toMatchObject({
      correct: true,
      score: 1,
      correctAnswer: { kind: 'output', output: '1 2\n3' },
    });
    const short = await answer(c, 'tq-short', RIGHT['tq-short']);
    expect(short.json).toMatchObject({
      gradedBy: 'ai',
      score: 0.9,
      correct: true,
      feedback: 'Covered the key point.',
      correctAnswer: 'REFERENCE-SHORT',
    });

    let b = await bank(c);
    expect(b.status).toEqual({
      'tq-single': 'incorrect',
      'tq-multiple': 'partial',
      'tq-output': 'correct',
      'tq-short': 'correct',
    });
    expect(b.items.find((i) => i.question.id === 'tq-multiple')?.score).toBe(0.5);
    // Statuses, not answers: the listing still carries no explanations.
    noLeak(b.text);

    // The detail reveals the recorded response and its feedback.
    const detail = QuizBankQuestion.parse((await c.get('/api/quiz/questions/tq-single')).json);
    expect(detail.response).toEqual(WRONG_SINGLE);
    expect(detail.feedback).toMatchObject({ correctAnswer: 'b', explanation: 'EXPLAIN-SINGLE' });

    // Answering again replaces the previous answer.
    const again = await answer(c, 'tq-single', RIGHT['tq-single']);
    expect(again.json).toMatchObject({ correct: true, score: 1 });
    b = await bank(c);
    expect(b.status['tq-single']).toBe('correct');
    const redo = QuizBankQuestion.parse((await c.get('/api/quiz/questions/tq-single')).json);
    expect(redo.response).toEqual(RIGHT['tq-single']);

    // Another user sees none of it.
    const other = await user('Stranger', false);
    expect(Object.values((await bank(other)).status)).toEqual([
      'unanswered',
      'unanswered',
      'unanswered',
      'unanswered',
    ]);
  });

  it('rejects unknown and retired questions and mismatched responses', async () => {
    const c = await user('Picky', false);
    expect((await answer(c, 'nope', WRONG_SINGLE)).status).toBe(404);
    expect((await c.get('/api/quiz/questions/nope')).status).toBe(404);
    expect((await answer(c, INACTIVE.id, { type: 'single', choice: 'a' })).status).toBe(404);
    const retired = await c.get(`/api/quiz/questions/${INACTIVE.id}`);
    expect(retired.status).toBe(404);
    expect(retired.text).not.toContain('EXPLAIN-RETIRED');
    expect((await answer(c, 'tq-multiple', WRONG_SINGLE)).status).toBe(400);
    expect((await c.post('/api/quiz/questions/tq-single/answers', { nope: 1 })).status).toBe(400);
    expect((await bank(c)).status['tq-multiple']).toBe('unanswered');
  });

  it('short answers are self-graded without a key, keeping the submitted text', async () => {
    const c = await user('Selfie', false);
    const first = await answer(c, 'tq-short', { type: 'short', text: 'RAII ties lifetime' });
    expect(first.json).toMatchObject({
      needsSelfGrade: true,
      gradedBy: 'self',
      correctAnswer: 'REFERENCE-SHORT',
    });
    expect((await bank(c)).status['tq-short']).toBe('pending');
    expect(await topicStats(c)).toMatchObject({ answered: 0, accuracy: null });

    const graded = await answer(c, 'tq-short', { type: 'short', text: 'ignored', selfGrade: 0.5 });
    expect(graded.json).toMatchObject({ needsSelfGrade: false, score: 0.5, correct: false });
    const detail = QuizBankQuestion.parse((await c.get('/api/quiz/questions/tq-short')).json);
    expect(detail.response).toEqual({ type: 'short', text: 'RAII ties lifetime', selfGrade: 0.5 });
    expect(detail.status).toBe('partial');
    expect(await topicStats(c)).toMatchObject({ answered: 1, accuracy: 0.5 });
  });

  it('status and stats combine attempt and question-bank answers', async () => {
    const c = await user('Mixer');
    // A practice-attempt answer shows up in the bank.
    const practice = QuizAttempt.parse(
      (await c.post('/api/quiz/attempts', { topics: ['test-topic'], count: 4 })).json,
    );
    await c.post(`/api/quiz/attempts/${practice.id}/answers`, {
      questionId: 'tq-single',
      response: RIGHT['tq-single'],
    });
    expect((await bank(c)).status['tq-single']).toBe('correct');
    const fromAttempt = QuizBankQuestion.parse((await c.get('/api/quiz/questions/tq-single')).json);
    expect(fromAttempt.response).toEqual(RIGHT['tq-single']);
    expect(fromAttempt.feedback?.explanation).toBe('EXPLAIN-SINGLE');

    // A later bank answer wins over the attempt answer.
    await answer(c, 'tq-single', WRONG_SINGLE);
    expect((await bank(c)).status['tq-single']).toBe('incorrect');

    // An exam still running reveals nothing, not even whether the answer was right.
    const exam = QuizAttempt.parse(
      (await c.post('/api/quiz/attempts', { topics: ['test-topic'], count: 4, mode: 'exam' })).json,
    );
    await c.post(`/api/quiz/attempts/${exam.id}/answers`, {
      questionId: 'tq-multiple',
      response: RIGHT['tq-multiple'],
    });
    expect((await bank(c)).status['tq-multiple']).toBe('unanswered');
    const hidden = await c.get('/api/quiz/questions/tq-multiple');
    expect(hidden.json).toMatchObject({ status: 'unanswered', response: null, feedback: null });
    noLeak(hidden.text);
    await c.post(`/api/quiz/attempts/${exam.id}/finish`);
    expect((await bank(c)).status['tq-multiple']).toBe('correct');

    // Stats: latest graded answer per question across both sources.
    await answer(c, 'tq-output', RIGHT['tq-output']);
    const stats = await topicStats(c);
    expect(stats.answered).toBe(3); // single (bank, wrong), multiple (exam), output (bank)
    expect(stats.accuracy).toBeCloseTo(2 / 3, 5);

    // Neither the bank nor its answers create attempts.
    const me = (await c.get('/api/me')).json.user.id as string;
    const attempts = await h.api.ctx.db
      .select({ id: quizAttempts.id })
      .from(quizAttempts)
      .where(eq(quizAttempts.userId, me));
    expect(attempts).toHaveLength(2);
  });

  it('"focus weak" selection counts question-bank answers', async () => {
    const c = await user('Focus');
    await answer(c, 'tq-single', WRONG_SINGLE);
    for (const id of ['tq-multiple', 'tq-output', 'tq-short'] as const)
      await answer(c, id, RIGHT[id]);
    for (let i = 0; i < 4; i++) {
      const next = QuizAttempt.parse(
        (await c.post('/api/quiz/attempts', { topics: ['test-topic'], count: 1 })).json,
      );
      expect(next.questions.map((q) => q.id)).toEqual(['tq-single']);
    }
  });

  it('shares the attempt answers rate limit', async () => {
    const limits = h.api.ctx.config.limits.quizAnswers;
    const saved = limits.userBurst;
    limits.userBurst = { limit: 3, windowSec: 60 };
    try {
      const c = await user('Hasty');
      const a = QuizAttempt.parse(
        (await c.post('/api/quiz/attempts', { topics: ['test-topic'], count: 4 })).json,
      );
      await c.post(`/api/quiz/attempts/${a.id}/answers`, {
        questionId: 'tq-single',
        response: WRONG_SINGLE,
      });
      expect((await answer(c, 'tq-single', RIGHT['tq-single'])).status).toBe(200);
      expect((await answer(c, 'tq-output', RIGHT['tq-output'])).status).toBe(200);
      const limited = await answer(c, 'tq-multiple', RIGHT['tq-multiple']);
      expect(limited.status).toBe(429);
      expect(limited.json.error.retryAfter).toBeGreaterThan(0);
      expect(limited.headers.get('retry-after')).toBeTruthy();
      // Refused answers are not recorded.
      expect((await bank(c)).status['tq-multiple']).toBe('unanswered');
    } finally {
      limits.userBurst = saved;
    }
  });
});
