/**
 * A market-making game's slot in `QuantContext.questions` (`QuantGameSlotEntry`, ARCHITECTURE
 * §8.3) until the interviewer can trade: the prompts treat it as a conversation about its prompt
 * with the hint ladder, and carry none of its books, counterparty notes or explanation.
 */
import {
  createGameState,
  gameBooks,
  QuantGame,
  type QuantGameState,
  QuizQuestion,
} from '@ipp/contracts';
import { describe, expect, it } from 'vitest';
import {
  entryDifficulty,
  entryFollowUps,
  entryHints,
  entryPrompt,
  entryTopic,
  entryType,
  isGameEntry,
} from '../src/quant/entry';
import { booksText, quantSystem, questionBlock } from '../src/quant/prompts';
import type { QuantContext, QuantContextEntry, QuantGameSlotEntry } from '../src/types';

const GAME = QuantGame.parse({
  id: 'mm-entry',
  topic: 'betting-market-making',
  title: 'Two hidden numbers',
  difficulty: 'medium',
  prompt: 'Make me a market on the sum of two hidden numbers. [PROMPT]',
  components: [
    { label: 'First', faces: [12345.678, 23456.789] },
    { label: 'Second', faces: [34567.891, 45678.912] },
  ],
  payoff: 'sum',
  reveal: [0],
  tick: 0.5,
  maxSize: 5,
  counterparty: '[COUNTERPARTY] fair 58024.635',
  hints: ['[HINT-1] the average of each', '[HINT-2] add them'],
  explanation: '[EXPLAIN] fair 58024.635',
  expect: { fair: '58024.635', sd: 7856.71, min: '46913.569', max: '69135.701' },
});

function gameEntry(state: QuantGameState): QuantGameSlotEntry {
  return {
    kind: 'game',
    index: 1,
    game: {
      id: GAME.id,
      topic: GAME.topic,
      title: GAME.title,
      difficulty: GAME.difficulty,
      prompt: GAME.prompt,
      counterparty: GAME.counterparty,
      hints: GAME.hints,
      explanation: GAME.explanation,
      mechanics: state.spec,
    },
    books: gameBooks(state),
    hintRungs: [1],
    followUpAsked: false,
  };
}

const T0 = Date.parse('2026-11-26T10:00:00.000Z');
const ctxOf = (entry: QuantContextEntry) =>
  ({
    pad: {
      startedAt: new Date(T0).toISOString(),
      durationMin: 20,
      interviewer: { style: 'neutral', proactivity: 'normal', voice: false },
    },
    round: {
      version: 3,
      total: 3,
      phase: 'asking',
      clock: {
        index: entry.index,
        posedAt: T0,
        budgetMs: 300_000,
        graceMs: 60_000,
        nudged: false,
        roundEndsAt: T0 + 1_200_000,
      },
      path: 'trader',
      closed: [],
    },
    questions: [entry],
    transcript: [],
    scratch: '',
    privateNotes: [],
    now: new Date(T0 + 60_000),
  }) as unknown as QuantContext;

describe('a game entry', () => {
  const entry = gameEntry(createGameState(GAME, [23456.789, 34567.891]));

  it('reads like any entry through the accessors', () => {
    expect(isGameEntry(entry)).toBe(true);
    expect(entryPrompt(entry)).toBe(GAME.prompt);
    expect(entryHints(entry)).toEqual(GAME.hints);
    expect(entryFollowUps(entry)).toEqual([]);
    expect(entryTopic(entry)).toBe('betting-market-making');
    expect(entryDifficulty(entry)).toBe('medium');
    expect(entryType(entry)).toBe('game');
    // A bank entry, with or without `kind`, is a question.
    const q = QuizQuestion.parse({
      id: 'q',
      topic: 'probability',
      subtopic: 's',
      difficulty: 'easy',
      type: 'short',
      prompt: 'P',
      reference: 'R',
      keyPoints: ['K'],
      explanation: 'E',
      hints: ['H'],
      followUps: ['F'],
    });
    if (q.type !== 'short') throw new Error('fixture');
    for (const bank of [
      { index: 0, question: q, hintRungs: [], followUpAsked: false },
      { kind: 'question' as const, index: 0, question: q, hintRungs: [], followUpAsked: false },
    ]) {
      expect(isGameEntry(bank)).toBe(false);
      expect([entryPrompt(bank), entryType(bank), entryFollowUps(bank)]).toEqual([
        'P',
        'short',
        ['F'],
      ]);
    }
  });

  it('is a conversation about the prompt with the hint ladder: no books, notes or explanation', () => {
    const ctx = ctxOf(entry);
    const block = questionBlock(entry, 3);
    expect(block).toContain('question 2 of 3 (betting market making, medium)');
    expect(block).toContain('a market-making game, "Two hidden numbers"');
    expect(block).toContain('[PROMPT]');
    expect(block).toContain('1. [HINT-1]');
    expect(block).toContain('2. [HINT-2]');
    expect(block).toContain('you cannot trade or show a hidden value');
    const books = booksText(ctx, T0 + 60_000).join('\n');
    expect(books).toContain('1 of 2 authored rungs given');
    expect(books).toContain('the next is rung 2');
    const all = [JSON.stringify(quantSystem(ctx)), books].join('\n');
    for (const secret of ['[COUNTERPARTY]', '[EXPLAIN]', '58024.6', '23456.789', '34567.891'])
      expect(all.includes(secret), secret).toBe(false);
  });
});
