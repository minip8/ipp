/**
 * A market-making game (ARCHITECTURE §8.3) with the real interviewer, before it can trade: the
 * API, database, socket and interviewer are real, only the model is scripted. The interviewer
 * treats the game as a conversation about its prompt with the hint ladder, answers a quote as a
 * typed message, makes no game move, and never has a hidden value, the fair value or the
 * counterparty notes in any request; the books are in its context only.
 */
import { randomUUID } from 'node:crypto';
import { gameBooks, type Pad, QuantGame, QuizQuestion } from '@ipp/contracts';
import { quantGames, quantRoundAnswers, quantRounds, quizQuestions, quizTopics } from '@ipp/db';
import { eq, inArray } from '@ipp/db/orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  Client,
  EventSocket,
  flushRedis,
  type Harness,
  startApi,
  testConfig,
} from './helpers/harness';
import { eventually, RealInterviewerRig, requestText, turn } from './helpers/real-interviewer';

const TOPICS = [
  { slug: 'probability', title: 'Probability', description: 'game tests', track: 'quant' },
  {
    slug: 'betting-market-making',
    title: 'Market making',
    description: 'game tests',
    track: 'quant',
  },
] as const;

const QUESTIONS = (['easy', 'medium', 'hard'] as const).map((difficulty, i) =>
  QuizQuestion.parse({
    id: `qgame-${i}`,
    topic: 'probability',
    subtopic: `gamesub-${i}`,
    difficulty,
    tags: [],
    type: 'short',
    prompt: `Puzzle ${i}? [GQ-PROMPT-${i}]`,
    reference: `[GQ-REF-${i}]`,
    keyPoints: [`[GQ-KEY-${i}]`],
    explanation: `[GQ-EXPLAIN-${i}]`,
    hints: [`[GQ-HINT-${i}]`],
    followUps: [`[GQ-FOLLOW-${i}]`],
  }),
);

const VALUES = [23456.789, 34567.891];
const GAME = QuantGame.parse({
  id: 'mm-qgame-real',
  topic: 'betting-market-making',
  title: 'Two hidden numbers',
  difficulty: 'medium',
  prompt: 'Make me a market on the sum of two hidden numbers. [GAME-PROMPT]',
  components: [
    { label: 'First', faces: [12345.678, 23456.789] },
    { label: 'Second', faces: [34567.891, 45678.912] },
  ],
  payoff: 'sum',
  reveal: [0],
  tick: 0.5,
  maxSize: 5,
  counterparty: '[COUNTERPARTY] the fair value is 58024.635; trade on the books.',
  hints: ['[GAME-HINT-1] what is each number on average?', '[GAME-HINT-2] add them up'],
  explanation: '[GAME-EXPLAIN] fair 58024.635',
  expect: { fair: '58024.635', sd: 7856.71, min: '46913.569', max: '69135.701' },
});

let h: Harness;
let rig: RealInterviewerRig;

beforeAll(async () => {
  await flushRedis();
  rig = new RealInterviewerRig(testConfig());
  h = await startApi({ interviewerFactory: rig.factory });
  const db = h.api.ctx.db;
  await db
    .insert(quizTopics)
    .values([...TOPICS])
    .onConflictDoNothing();
  for (const q of QUESTIONS)
    await db
      .insert(quizQuestions)
      .values({
        id: q.id,
        topic: q.topic,
        subtopic: q.subtopic,
        difficulty: q.difficulty,
        type: q.type,
        data: q,
      })
      .onConflictDoNothing();
  await db
    .insert(quantGames)
    .values({ id: GAME.id, topic: GAME.topic, difficulty: GAME.difficulty, data: GAME })
    .onConflictDoNothing();
});

afterAll(async () => {
  const db = h?.api.ctx.db;
  if (db) {
    const ids = QUESTIONS.map((q) => q.id);
    await db.delete(quantRoundAnswers).where(inArray(quantRoundAnswers.questionId, ids));
    await db.delete(quizQuestions).where(inArray(quizQuestions.id, ids));
    await db.delete(quantGames).where(eq(quantGames.id, GAME.id));
    await db.delete(quizTopics).where(
      inArray(
        quizTopics.slug,
        TOPICS.map((t) => t.slug),
      ),
    );
  }
  await h?.stop();
});

async function roundRow(padId: string) {
  const [row] = await h.api.ctx.db.select().from(quantRounds).where(eq(quantRounds.padId, padId));
  if (!row) throw new Error('no round');
  return row;
}

describe('a game slot with the real interviewer, before it trades', () => {
  it('is a conversation about the prompt: a quote is answered, nothing hidden is in a request', {
    timeout: 60_000,
  }, async () => {
    const a = new Client(h.base, '100.71.0.1');
    const { id: userId } = await a.signUp('GameReal');
    const apiKey = `sk-ant-api03-good-${randomUUID()}`;
    await a.saveKey(apiKey);
    const m = rig.model(apiKey);
    const res = await a.post('/api/pads/quant', { path: 'trader', durationMin: 20 });
    expect(res.status).toBe(200);
    const pad = res.json as Pad;
    const id = pad.id;
    // Known hidden values.
    const row0 = await roundRow(id);
    const state0 = structuredClone(row0.state);
    const slot = state0.questions[1]?.game;
    if (!slot) throw new Error('no game in the second slot');
    slot.values = [...VALUES];
    await h.api.ctx.db.update(quantRounds).set({ state: state0 }).where(eq(quantRounds.padId, id));

    const s = await EventSocket.open(`${h.wsBase}/ws/pads/${id}?ticket=${await a.ticket(id)}`);
    await s.waitFor('round.updated', (e) => e.round.version === 1, 15_000);
    // The bank question closes; the game is posed.
    m.script('reply', turn({ action: 'close', message: 'Right.', score: 1, summary: 'Fine.' }));
    s.send({ type: 'chat.send', text: 'My answer is two.' });
    await s.waitFor('round.updated', (e) => e.round.version === 2, 15_000);
    expect((await roundRow(id)).state.current).toBe(1);

    // A quote: posted as the candidate's message, answered like one.
    const from = m.calls.length;
    m.script('reply', turn({ action: 'stay', message: 'How did you choose that width?' }));
    const posted = await a.post(`/api/pads/${id}/round/quote`, {
      index: 1,
      bid: 50000,
      ask: 60000,
      size: 1,
    });
    expect(posted.status).toBe(200);
    expect(posted.json.version).toBe(3);
    const call = await m.next('reply', from, 15_000);
    await s.waitFor('round.updated', (e) => e.round.version === 4, 15_000);
    await rig.idle(id);
    const said = s.events.flatMap((e) =>
      e.type === 'message.created' && e.message.role === 'interviewer' ? [e.message.text] : [],
    );
    expect(said.at(-1)).toBe('How did you choose that width?');

    // The request: the game's prompt, its hints and the quote; nothing hidden.
    const text = requestText(call.req);
    expect(text).toContain('[GAME-PROMPT]');
    expect(text).toContain('[GAME-HINT-1]');
    expect(text).toContain('50000 bid, 60000 offered, 1 lot');
    expect(text).toContain('a market-making game');
    for (const secret of [
      '[COUNTERPARTY]',
      '[GAME-EXPLAIN]',
      'mm-qgame-real',
      '23456.789',
      '34567.891',
      '58024.6',
      // Earlier questions in numbers only.
      '[GQ-',
    ])
      expect(text.includes(secret), `${secret} in the request`).toBe(false);

    // The interviewer made no game move: the game holds only the quote.
    const { state } = await roundRow(id);
    expect(state.questions[1]?.game?.events.map((e) => e.kind)).toEqual(['quote']);
    expect(state.questions[1]?.game?.position).toBe(0);
    // …though its context carries the books.
    const ctx = await rig.deps.loadQuantContext?.(id);
    const entry = ctx?.questions[0];
    expect(entry?.kind).toBe('game');
    if (entry?.kind === 'game') {
      const g = state.questions[1]?.game;
      if (!g) throw new Error('no game');
      expect(entry.books).toEqual(gameBooks(g));
      expect(entry.game.counterparty).toBe(GAME.counterparty);
    }

    // Ending mid-game: the assessment judges the game (no verdict yet) without a hitch, and the
    // verdict is no quiz answer.
    expect((await a.post(`/api/pads/${id}/end`)).status).toBe(200);
    await eventually(
      async () => (await a.get(`/api/pads/${id}/report`)).json?.status === 'ready',
      15_000,
      'the report',
    );
    const after = (await roundRow(id)).state;
    expect(after.questions[1]?.verdict).not.toBeNull();
    expect(after.questions[1]?.game?.settlement).not.toBeNull();
    const recorded = await h.api.ctx.db
      .select({ questionId: quantRoundAnswers.questionId })
      .from(quantRoundAnswers)
      .where(eq(quantRoundAnswers.userId, userId));
    expect(recorded.map((r) => r.questionId)).not.toContain(GAME.id);
    expect(recorded.map((r) => r.questionId)).toContain(after.questions[0]?.questionId);
    s.close();
  });
});
