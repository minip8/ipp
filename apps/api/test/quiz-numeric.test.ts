import {
  AnswerFeedback,
  QuizAttempt,
  QuizBank,
  QuizBankQuestion,
  QuizQuestion,
  QuizRoadmapTopic,
} from '@ipp/contracts';
import { quizAttempts, quizQuestions, quizStandaloneAnswers, quizTopics } from '@ipp/db';
import { arrayOverlaps, eq, inArray } from '@ipp/db/orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client, FakeInterviewer, flushRedis, type Harness, startApi } from './helpers/harness';

let h: Harness;
let fake: FakeInterviewer;

const TOPIC = 'nq-topic';
const base = { topic: TOPIC, subtopic: 'odds', difficulty: 'easy', tags: [] } as const;
/** Interviewer material: must never reach the browser, before or after answering. */
const SECRET = ['HINT-SECRET', 'FOLLOWUP-SECRET'];
const extras = (id: string) => ({
  hints: [`HINT-SECRET ${id} gentle`, `HINT-SECRET ${id} stronger`],
  followUps: [`FOLLOWUP-SECRET ${id}`],
});

const QUESTIONS = [
  /** An exact fraction: decimals to three figures count, two figures do not. */
  QuizQuestion.parse({
    ...base,
    id: 'nq-frac',
    type: 'numeric',
    prompt: 'Two dice: the chance of a sum of 6?',
    explanation: 'EXPLAIN-FRAC',
    answer: '5/36',
    ...extras('nq-frac'),
  }),
  /** A count: only the exact value. */
  QuizQuestion.parse({
    ...base,
    id: 'nq-count',
    type: 'numeric',
    prompt: 'How many handshakes?',
    explanation: 'EXPLAIN-COUNT',
    answer: 45,
    unit: 'handshakes',
  }),
  /** An estimate: anything within the tolerance. */
  QuizQuestion.parse({
    ...base,
    id: 'nq-tol',
    type: 'numeric',
    prompt: 'The chance nobody gets their own hat back?',
    explanation: 'EXPLAIN-TOL',
    answer: '0.367879',
    answerText: '$1/e \\approx 0.368$',
    tolerance: { abs: 0.01 },
  }),
  QuizQuestion.parse({
    ...base,
    id: 'nq-short',
    type: 'short',
    prompt: 'Why is the expected number of fixed points 1?',
    explanation: 'EXPLAIN-NQ-SHORT',
    reference: 'REFERENCE-NQ',
    keyPoints: ['KEYPOINT-NQ linearity'],
    ...extras('nq-short'),
  }),
];
/** Stored before `hints`, `followUps` and `unit` existed: read as having none. */
const OLD_SHORT = {
  ...base,
  id: 'nq-old-short',
  type: 'short',
  prompt: 'Old short',
  explanation: 'EXPLAIN-OLD',
  reference: 'REFERENCE-OLD',
  keyPoints: ['k'],
} as unknown as QuizQuestion;
const IDS = [...QUESTIONS.map((q) => q.id), OLD_SHORT.id];

beforeAll(async () => {
  await flushRedis();
  fake = new FakeInterviewer();
  h = await startApi({ fake });
  const { db } = h.api.ctx;
  await db.insert(quizTopics).values({
    slug: TOPIC,
    title: 'Numeric topic',
    description: 'For the numeric tests',
    track: 'quant',
    position: 5,
  });
  await db.insert(quizQuestions).values(
    [...QUESTIONS, OLD_SHORT].map((x) => ({
      id: x.id,
      topic: x.topic,
      subtopic: x.subtopic,
      difficulty: x.difficulty,
      type: x.type,
      data: x,
    })),
  );
});
afterAll(async () => {
  const db = h?.api.ctx.db;
  if (db) {
    await db.delete(quizAttempts).where(arrayOverlaps(quizAttempts.topics, [TOPIC]));
    await db.delete(quizStandaloneAnswers).where(inArray(quizStandaloneAnswers.questionId, IDS));
    await db.delete(quizQuestions).where(inArray(quizQuestions.id, IDS));
    await db.delete(quizTopics).where(eq(quizTopics.slug, TOPIC));
  }
  await h?.stop();
});

async function user(name: string, withKey = false) {
  const c = new Client(h.base, `100.100.2.${Math.floor(Math.random() * 250)}`);
  await c.signUp(name);
  if (withKey) await c.saveKey();
  return c;
}

const noSecret = (text: string) => {
  for (const s of SECRET) expect(text).not.toContain(s);
};
const numeric = (value: string) => ({ type: 'numeric', value });

/** [question, typed value, counts as right] */
const CASES: [string, string, boolean][] = [
  ['nq-frac', '5/36', true],
  ['nq-frac', '10 / 72', true], // the same fraction, unreduced
  ['nq-frac', '0.139', true], // three significant figures
  ['nq-frac', '13.9%', true],
  ['nq-frac', '0.14', false], // two figures are not enough
  ['nq-frac', '14/100', false], // a fraction claims to be exact
  ['nq-count', '45', true],
  ['nq-count', '45.0', true],
  ['nq-count', '45.1', false], // a whole-number answer needs the exact value
  ['nq-count', '44.99', false],
  ['nq-tol', '0.37', true], // within 0.01
  ['nq-tol', '0.36', true],
  ['nq-tol', '3/8', true], // 0.375, any form within the tolerance
  ['nq-tol', '0.35', false],
];

describe('numeric questions in the question bank', () => {
  it('grades each typed value, right or wrong, and reveals the answer only after', async () => {
    const c = await user('Bank');
    const before = await c.get('/api/quiz/questions/nq-count');
    const q = QuizBankQuestion.parse(before.json);
    expect(q.question).toMatchObject({ type: 'numeric', unit: 'handshakes', choices: null });
    expect(q.feedback).toBeNull();
    expect(before.text).not.toContain('EXPLAIN-COUNT');
    expect(before.text).not.toContain('"answer"');

    for (const [id, value, right] of CASES) {
      const res = await c.post(`/api/quiz/questions/${id}/answers`, { response: numeric(value) });
      expect(res.status, `${id} ${value}`).toBe(200);
      const fb = AnswerFeedback.parse(res.json);
      expect([id, value, fb.correct, fb.score], `${id} ${value}`).toEqual([
        id,
        value,
        right,
        right ? 1 : 0,
      ]);
      expect(fb).toMatchObject({ gradedBy: 'auto', needsSelfGrade: false, feedback: null });
    }

    // The answer as Markdown: answerText when there is one, otherwise the number as written.
    const tol = QuizBankQuestion.parse((await c.get('/api/quiz/questions/nq-tol')).json);
    expect(tol.feedback?.correctAnswer).toBe('$1/e \\approx 0.368$');
    expect(tol.response).toEqual(numeric('0.35'));
    expect(tol.status).toBe('incorrect');
    const frac = QuizBankQuestion.parse((await c.get('/api/quiz/questions/nq-frac')).json);
    expect(frac.feedback).toMatchObject({ correctAnswer: '5/36', explanation: 'EXPLAIN-FRAC' });
    const count = QuizBankQuestion.parse((await c.get('/api/quiz/questions/nq-count')).json);
    expect(count.feedback?.correctAnswer).toBe('45');
  });

  it('refuses a value that is not a number, and a numeric answer to another type', async () => {
    const c = await user('Garbage');
    for (const value of ['about 0.14', '', '1/0', '0x10', `${'1'.repeat(41)}`, '1/3/4']) {
      const res = await c.post('/api/quiz/questions/nq-frac/answers', {
        response: numeric(value),
      });
      expect(res.status, value).toBe(400);
    }
    expect(
      (
        await c.post('/api/quiz/questions/nq-frac/answers', {
          response: { type: 'short', text: 'x' },
        })
      ).status,
    ).toBe(400);
    expect(
      (await c.post('/api/quiz/questions/nq-short/answers', { response: numeric('1') })).status,
    ).toBe(400);
    // Nothing was recorded.
    const q = QuizBankQuestion.parse((await c.get('/api/quiz/questions/nq-frac')).json);
    expect(q.status).toBe('unanswered');
  });
});

describe('numeric questions in attempts', () => {
  it('practice draws numeric questions, never short ones, and grades them at once', async () => {
    const c = await user('Practice');
    const res = await c.post('/api/quiz/attempts', { topics: [TOPIC], count: 10 });
    const attempt = QuizAttempt.parse(res.json);
    expect(attempt.questions.map((q) => q.id).sort()).toEqual(['nq-count', 'nq-frac', 'nq-tol']);
    expect(attempt.questions.find((q) => q.id === 'nq-count')?.unit).toBe('handshakes');
    expect(attempt.questions.find((q) => q.id === 'nq-frac')?.unit).toBeNull();
    noSecret(res.text);
    expect(res.text).not.toContain('5/36');

    const answer = (questionId: string, value: string) =>
      c.post(`/api/quiz/attempts/${attempt.id}/answers`, { questionId, response: numeric(value) });
    expect((await answer('nq-frac', 'one in seven')).status).toBe(400);
    const frac = await answer('nq-frac', '0.1389');
    expect(AnswerFeedback.parse(frac.json)).toMatchObject({
      correct: true,
      score: 1,
      correctAnswer: '5/36',
    });
    const count = await answer('nq-count', '45.5');
    expect(AnswerFeedback.parse(count.json)).toMatchObject({ correct: false, score: 0 });
    const tol = await answer('nq-tol', '0.368');
    expect(AnswerFeedback.parse(tol.json)).toMatchObject({
      correct: true,
      correctAnswer: '$1/e \\approx 0.368$',
    });
    noSecret(frac.text + count.text + tol.text);

    const fin = await c.post(`/api/quiz/attempts/${attempt.id}/finish`);
    const done = QuizAttempt.parse(fin.json);
    expect(done.score).toBeCloseTo(2 / 3);
    expect(done.responses['nq-count']).toEqual(numeric('45.5'));
    noSecret(fin.text);

    // Stats and the roadmap count numeric answers like any automatically graded answer.
    const stats = (await c.get('/api/quiz/topics')).json.find(
      (t: { slug: string }) => t.slug === TOPIC,
    );
    expect(stats).toMatchObject({ questionCount: 5, shortCount: 2, answered: 3, track: 'quant' });
    expect(stats.accuracy).toBeCloseTo(2 / 3);
  });

  it('exam: numeric answers are hidden until finished, then graded', async () => {
    const c = await user('Exam');
    const attempt = QuizAttempt.parse(
      (await c.post('/api/quiz/attempts', { topics: [TOPIC], count: 10, mode: 'exam' })).json,
    );
    expect(attempt.questions.every((q) => q.type === 'numeric')).toBe(true);
    const answer = (questionId: string, value: string) =>
      c.post(`/api/quiz/attempts/${attempt.id}/answers`, { questionId, response: numeric(value) });
    expect((await answer('nq-frac', '0.14')).json).toEqual({ recorded: true });
    expect((await answer('nq-frac', '5/36')).json).toEqual({ recorded: true }); // changed
    expect((await answer('nq-count', '45')).json).toEqual({ recorded: true });
    expect((await answer('nq-tol', '0.5')).json).toEqual({ recorded: true });
    expect((await answer('nq-tol', 'NaN')).status).toBe(400);
    const mid = await c.get(`/api/quiz/attempts/${attempt.id}`);
    expect(QuizAttempt.parse(mid.json).feedback).toEqual([]);
    expect(mid.text).not.toContain('correctAnswer');

    const fin = await c.post(`/api/quiz/attempts/${attempt.id}/finish`);
    const done = QuizAttempt.parse(fin.json);
    const byId = Object.fromEntries(done.feedback.map((f) => [f.questionId, f]));
    expect(byId['nq-frac']).toMatchObject({ correct: true, correctAnswer: '5/36' });
    expect(byId['nq-count']).toMatchObject({ correct: true, correctAnswer: '45' });
    expect(byId['nq-tol']).toMatchObject({ correct: false, score: 0 });
    expect(done.score).toBeCloseTo(2 / 3);
    noSecret(fin.text);
  });

  it('discussion draws only short questions, and the interviewer gets the hints', async () => {
    const c = await user('Talk', true);
    fake.discussionCalls = [];
    const res = await c.post('/api/quiz/attempts', {
      topics: [TOPIC],
      count: 10,
      mode: 'discussion',
    });
    const attempt = QuizAttempt.parse(res.json);
    expect(attempt.questions.map((q) => q.id).sort()).toEqual(['nq-old-short', 'nq-short']);
    noSecret(res.text);
    const say = (questionId: string, text: string) =>
      c.post(`/api/quiz/attempts/${attempt.id}/discussion`, { questionId, text });
    const first = await say('nq-short', 'no idea');
    const second = await say('nq-short', 'linearity of expectation');
    expect(second.json.feedback).toMatchObject({ correctAnswer: 'REFERENCE-NQ' });
    noSecret(first.text + second.text);
    expect(fake.discussionCalls[0]?.question).toMatchObject(extras('nq-short'));

    // A row stored before hints existed still works.
    const old = await say('nq-old-short', 'something');
    expect(old.status).toBe(200);
    const view = await c.get(`/api/quiz/attempts/${attempt.id}`);
    noSecret(view.text);
  });
});

describe('interviewer material never reaches the browser', () => {
  it('for a short and a numeric question, before and after answering', async () => {
    const c = await user('Snoop', true);
    fake.gradeCalls = [];
    const seen: string[] = [];
    const fetch = async (path: string) => {
      const res = await c.get(path);
      expect(res.status, path).toBe(200);
      seen.push(res.text);
      return res;
    };
    const reads = async () => {
      await fetch(`/api/quiz/topics/${TOPIC}/questions`);
      await fetch('/api/quiz/questions/nq-short');
      await fetch('/api/quiz/questions/nq-frac');
      await fetch('/api/quiz/topics');
      await fetch('/api/quiz/roadmap');
    };
    await reads();
    for (const [id, response] of [
      ['nq-short', { type: 'short', text: 'Linearity of expectation.' }],
      ['nq-frac', numeric('5/36')],
    ] as const) {
      const res = await c.post(`/api/quiz/questions/${id}/answers`, { response });
      expect(res.status).toBe(200);
      seen.push(res.text);
    }
    await reads();
    const answered = QuizBankQuestion.parse(JSON.parse(seen.at(-4) ?? 'null'));
    expect(answered.feedback).toMatchObject({ correctAnswer: 'REFERENCE-NQ', gradedBy: 'ai' });
    for (const text of seen) noSecret(text);
    // The grader still had them.
    expect(fake.gradeCalls[0]).toMatchObject(extras('nq-short'));
  });
});

describe('topic tracks', () => {
  it('every topic shape carries its track', async () => {
    const c = await user('Tracks');
    const topics = (await c.get('/api/quiz/topics')).json as { slug: string; track: string }[];
    expect(Object.fromEntries(topics.map((t) => [t.slug, t.track]))).toMatchObject({
      [TOPIC]: 'quant',
      'test-topic': 'fundamentals',
    });

    const bank = await c.get(`/api/quiz/topics/${TOPIC}/questions`);
    expect(bank.json.topic.track).toBe('quant');
    expect(QuizBank.parse(bank.json).items.map((i) => i.question.id)).toEqual([
      'nq-count',
      'nq-frac',
      'nq-old-short',
      'nq-short',
      'nq-tol',
    ]);
    expect((await c.get('/api/quiz/topics/test-topic/questions')).json.topic.track).toBe(
      'fundamentals',
    );

    const roadmap = (await c.get('/api/quiz/roadmap')).json as { slug: string; track: string }[];
    expect(roadmap.map((t) => [t.slug, t.track])).toEqual([
      ['test-topic', 'fundamentals'],
      [TOPIC, 'quant'],
    ]);
    QuizRoadmapTopic.array().parse(roadmap);
  });
});
