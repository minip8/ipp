import type { QuantGameView, QuantQuestionView, QuantRoundView } from '@ipp/contracts';
import { describe, expect, it } from 'vitest';
import {
  clearQuantUnread,
  closedLabel,
  currentQuestion,
  earlierQuestions,
  gameMoves,
  lastSettledGame,
  minutesPerQuestion,
  NO_QUANT_UNREAD,
  noteQuantActivity,
  questionClock,
  roundHeading,
  roundProgress,
} from './logic';

const T = Date.parse('2026-01-01T10:00:00.000Z');
const at = (sec: number) => new Date(T + sec * 1000).toISOString();
const question = (index: number, over: Partial<QuantQuestionView> = {}): QuantQuestionView => ({
  index,
  topic: 'probability',
  topicTitle: 'Probability',
  difficulty: 'easy',
  prompt: `Q${index + 1}`,
  unit: null,
  posedAt: at(index * 600),
  budgetSec: 420,
  closedAt: null,
  closedBy: null,
  hintsGiven: 0,
  posedMessageId: null,
  game: null,
  ...over,
});
const round = (over: Partial<QuantRoundView> = {}): QuantRoundView => ({
  path: 'trader',
  total: 4,
  phase: 'asking',
  questions: [question(0, { closedAt: at(300), hintsGiven: 2 }), question(1, { hintsGiven: 1 })],
  version: 3,
  ...over,
});

describe('the round as the panel shows it', () => {
  it('the current question is the last posed while asking, and the rest are earlier', () => {
    const r = round();
    expect(currentQuestion(r)?.index).toBe(1);
    expect(earlierQuestions(r).map((q) => q.index)).toEqual([0]);
    expect(roundHeading(r)).toBe('Question 2 of 4');
  });

  it('has no current question before the start or after the end', () => {
    const pending = round({ phase: 'pending', questions: [] });
    expect(currentQuestion(pending)).toBeNull();
    expect(roundHeading(pending)).toBe('4 questions');
    const done = round({
      phase: 'finished',
      questions: [question(0, { closedAt: at(300) }), question(1, { closedAt: at(900) })],
    });
    expect(currentQuestion(done)).toBeNull();
    expect(earlierQuestions(done)).toHaveLength(2);
    expect(roundHeading(done)).toBe('Round finished');
  });

  it('counts what the round has done for the end dialog', () => {
    expect(roundProgress(round())).toEqual({ posed: 2, closed: 1, hints: 3, total: 4 });
  });

  it('says when an earlier question was closed by the clock, and nothing otherwise', () => {
    expect(closedLabel(question(0, { closedBy: 'timeout' }))).toBe('Timed out');
    expect(closedLabel(question(0, { closedBy: 'round_time' }))).toBe('Out of time');
    expect(closedLabel(question(0, { closedBy: 'interviewer' }))).toBeNull();
    expect(closedLabel(question(0))).toBeNull();
  });

  it('shares the round evenly in whole minutes', () => {
    expect(minutesPerQuestion(30, 4)).toBe(8);
    expect(minutesPerQuestion(20, 3)).toBe(7);
    expect(minutesPerQuestion(45, 6)).toBe(8);
  });
});

describe('a question clock', () => {
  const q = question(0);
  it('counts down the budget', () => {
    const c = questionClock(q, T + 100_000);
    expect(c).toMatchObject({ elapsedSec: 100, leftSec: 320, over: false, label: '5:20 left' });
    expect(c.fraction).toBeCloseTo(100 / 420);
  });

  it('then says how far over, quietly, and stops at a full bar', () => {
    const c = questionClock(q, T + 462_000);
    expect(c).toMatchObject({ leftSec: -42, over: true, label: '0:42 over', fraction: 1 });
  });

  it('stops when the question was closed', () => {
    const closed = { ...q, closedAt: at(200) };
    expect(questionClock(closed, T + 999_000).elapsedSec).toBe(200);
  });
});

describe('the phone layout', () => {
  it('marks the chat and a new question while another pane shows, and clears on opening', () => {
    let u = noteQuantActivity(NO_QUANT_UNREAD, 'scratch', { messages: 2, newQuestion: true });
    expect(u).toEqual({ chat: 2, question: true });
    u = noteQuantActivity(u, 'chat', { messages: 1, newQuestion: false });
    expect(u).toEqual({ chat: 0, question: true });
    u = clearQuantUnread(u, 'question');
    expect(u).toEqual(NO_QUANT_UNREAD);
    expect(noteQuantActivity(u, 'chat', { messages: 0, newQuestion: false })).toBe(u);
  });
});

describe('a round with a game', () => {
  const game = (over: Partial<QuantGameView> = {}): QuantGameView => ({
    title: 'Sum of three dice',
    components: [
      { label: 'Die 1', value: null },
      { label: 'Die 2', value: null },
    ],
    payoff: 'sum',
    tick: 0.5,
    maxSize: 5,
    quote: null,
    log: [],
    position: 0,
    cash: 0,
    settlement: null,
    quotesLeft: 100,
    ...over,
  });
  const quote = { kind: 'quote', at: at(10), bid: 6, ask: 8, size: 1 } as const;
  const trade = {
    kind: 'trade',
    at: at(20),
    candidateSide: 'sell',
    price: 8,
    quantity: 1,
  } as const;
  const shown = { kind: 'reveal', at: at(30), component: 0, label: 'Die 1', value: 6 } as const;

  it('counts the interviewer’s moves in the current game, not the candidate’s quotes', () => {
    expect(gameMoves(null)).toBe(0);
    expect(gameMoves(round())).toBe(0);
    const playing = (log: QuantGameView['log']) =>
      round({
        questions: [question(0, { closedAt: at(300) }), question(1, { game: game({ log }) })],
      });
    expect(gameMoves(playing([quote]))).toBe(0);
    expect(gameMoves(playing([quote, trade, shown]))).toBe(2);
  });

  it('keeps the last closed question’s settled game in view', () => {
    const settled = game({
      components: [
        { label: 'Die 1', value: 6 },
        { label: 'Die 2', value: 2 },
      ],
      settlement: { at: at(400), value: 8, pnl: 0 },
    });
    const r = round({
      questions: [question(0, { closedAt: at(400), game: settled }), question(1)],
    });
    expect(lastSettledGame(r)?.index).toBe(0);
    expect(lastSettledGame(round())).toBeNull();
    // A later bank question closing moves it out of view.
    const later = round({
      questions: [
        question(0, { closedAt: at(400), game: settled }),
        question(1, { closedAt: at(900) }),
        question(2),
      ],
    });
    expect(lastSettledGame(later)).toBeNull();
  });
});
