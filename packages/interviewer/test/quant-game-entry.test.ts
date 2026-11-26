/**
 * A market-making game's slot in `QuantContext.questions` (`QuantGameSlotEntry`, ARCHITECTURE
 * §8.3): read like any entry through the accessors; its material in the question's (cached)
 * system block, its books in the per-turn state.
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
    state,
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

  it('its system block has the prompt, mechanics, playbook, explanation and ladder, and no state', () => {
    const ctx = ctxOf(entry);
    const block = questionBlock(entry, 3);
    expect(block).toContain('question 2 of 3 (betting market making, medium)');
    expect(block).toContain('a market-making game, "Two hidden numbers"');
    expect(block).toContain('[PROMPT]');
    expect(block).toContain('[COUNTERPARTY]');
    expect(block).toContain('[EXPLAIN]');
    expect(block).toContain('1. [HINT-1]');
    expect(block).toContain('2. [HINT-2]');
    expect(block).toContain('1. First: 12345.678 or 23456.789, equally likely.');
    expect(block).toContain('in this order only: First. Second stays hidden until the settlement.');
    // The block is cached for the whole question: nothing that changes with play is in it, and
    // the drawn values are in it only as faces (both are faces here).
    expect(JSON.stringify(quantSystem(ctx))).toBe(
      JSON.stringify(quantSystem(ctxOf(gameEntry(createGameState(GAME, [12345.678, 45678.912]))))),
    );
    const books = booksText(ctx, T0 + 60_000).join('\n');
    expect(books).toContain('1 of 2 authored rungs given');
    expect(books).toContain('the next is rung 2');
    expect(books).toContain('Follow-up: a game has none');
    expect(books).toContain('GAME BOOKS');
    expect(books).toContain('True value (the contract settles at it): 58024.68');
  });

  it('a bank question’s prompt is unchanged by games', () => {
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
    const ctx = ctxOf({ index: 1, question: q, hintRungs: [], followUpAsked: false } as never);
    const books = booksText(ctx, T0 + 60_000).join('\n');
    expect(books).not.toMatch(/GAME|game/);
    expect(questionBlock(ctx.questions[0] as never, 3)).not.toMatch(/game|Mechanics/i);
  });
});
