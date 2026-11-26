/**
 * A market-making game (ARCHITECTURE §8.3) played by the real interviewer: the API, database,
 * socket and interviewer are real, only the model is scripted. Quotes go through the quote route;
 * the interviewer trades, reveals and closes through its steps, the platform's facts open its
 * messages, and the books in the database are what those messages say. What a browser socket
 * receives never holds a hidden value, a fair value, a mark or the playbook before the game
 * settles.
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

describe('a game played by the real interviewer', () => {
  it('trades, reveals and closes through the real API; the socket never carries a hidden figure', {
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

    const said = () =>
      s.events.flatMap((e) =>
        e.type === 'message.created' && e.message.role === 'interviewer' ? [e.message.text] : [],
      );
    const quote = async (bid: number, ask: number, size: number) => {
      const posted = await a.post(`/api/pads/${id}/round/quote`, { index: 1, bid, ask, size });
      expect(posted.status).toBe(200);
      return posted.json.version as number;
    };

    // The context carries the game's state and books (the interviewer's private view).
    const ctx = await rig.deps.loadQuantContext?.(id);
    const entry = ctx?.questions[0];
    expect(entry?.kind).toBe('game');
    if (entry?.kind === 'game') {
      const { state } = await roundRow(id);
      const g = state.questions[1]?.game;
      if (!g) throw new Error('no game');
      expect(entry.books).toEqual(gameBooks(g));
      expect(entry.state).toEqual(g);
      expect(entry.game.counterparty).toBe(GAME.counterparty);
    }

    // Quote 1: the interviewer lifts the offer for one and shows the first number.
    let from = m.calls.length;
    m.script(
      'reply',
      turn({ action: 'stay', trade: 'buy', quantity: 1, reveal: true, message: 'Where now?' }),
    );
    const v1 = await quote(50000, 60000, 2);
    expect(v1).toBe(3);
    const call1 = await m.next('reply', from, 15_000);
    await s.waitFor('round.updated', (e) => e.round.version === 4, 15_000);
    await rig.idle(id);
    expect(said().at(-1)).toBe('I buy 1 at your offer of 60000. First shows 23456.789. Where now?');
    let g = (await roundRow(id)).state.questions[1]?.game;
    expect(g).toMatchObject({ position: -1, cash: 60000, revealed: 1, quote: null });

    // The request: the game's material and books, the quote marked as posted; never earlier
    // questions' private material.
    const text = requestText(call1.req);
    for (const x of [
      '[GAME-PROMPT]',
      '[GAME-HINT-1]',
      '[COUNTERPARTY]',
      '[GAME-EXPLAIN]',
      'GAME BOOKS',
      'True value (the contract settles at it): 58024.68.',
      '50000 bid, 60000 offered, 2 lots',
      'source=\\"quote\\"',
    ])
      expect(text, x).toContain(x);
    expect(text).not.toContain('[GQ-');

    // Quote 2: the interviewer, informed, hits a bid above the true value. This one streams.
    from = m.calls.length;
    m.script(
      'reply',
      turn({ action: 'stay', trade: 'sell', quantity: 1, message: 'What do you make of that?' }),
    );
    await quote(63000, 64000, 1);
    await m.next('reply', from, 15_000);
    await s.waitFor('round.updated', (e) => e.round.version === 6, 15_000);
    await rig.idle(id);
    expect(said().at(-1)).toBe('I sell 1 at your bid of 63000. What do you make of that?');
    const streamed = s.events
      .flatMap((e) => (e.type === 'message.delta' ? [e.delta] : []))
      .join('');
    expect(streamed).toContain('I sell 1 at your bid of 63000. What do you make of that?');
    g = (await roundRow(id)).state.questions[1]?.game;
    expect(g).toMatchObject({ position: 0, cash: -3000 });

    // Until the game closes, nothing the browser got holds a hidden value, a fair value, a mark,
    // the playbook or the explanation (the first number only once it was shown).
    const shownAt = s.events.findIndex(
      (e) => e.type === 'message.created' && e.message.text.includes('First shows'),
    );
    expect(shownAt).toBeGreaterThan(0);
    const before = s.events.map((e) => JSON.stringify(e));
    const never = [
      '34567.891',
      '58024.68',
      '58024.635',
      // The public fair value after the first reveal, and the marks.
      '63580.19',
      '[COUNTERPARTY]',
      '[GAME-EXPLAIN]',
      '[GAME-HINT',
      'GAME BOOKS',
      'mm-qgame-real',
    ];
    before.forEach((json, i) => {
      for (const x of never) expect(json.includes(x), `${x} in event ${i}`).toBe(false);
      if (i < shownAt)
        expect(json.includes('23456.789'), `the first number in event ${i}`).toBe(false);
    });

    // The close settles the game; the platform states the settlement.
    from = m.calls.length;
    m.script('reply', turn({ action: 'close', message: 'Thanks.', score: 0.5, summary: 'Fair.' }));
    s.send({ type: 'chat.send', text: "I think I'm done." });
    await m.next('reply', from, 15_000);
    await s.waitFor('round.updated', (e) => e.round.version === 7, 15_000);
    await rig.idle(id);
    expect(said()).toContain(
      'That settles the game at 58024.68 (First: 23456.789, Second: 34567.891). You finish flat, a loss of 3000. Thanks.',
    );
    const closed = (await roundRow(id)).state;
    expect(closed.current).toBe(2);
    expect(closed.questions[1]?.game?.settlement).toMatchObject({ value: 58024.68, pnl: -3000 });
    expect(closed.questions[1]?.verdict).toEqual({ score: 0.5, summary: 'Fair.' });

    // Ending the pad: the report, and the game's verdict is no quiz answer.
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
