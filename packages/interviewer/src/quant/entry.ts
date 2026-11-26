/**
 * What every entry of `QuantContext.questions` has, a bank question's or a market-making game's
 * (`QuantContextEntry`, ARCHITECTURE §8.3), read without narrowing. Anything else (an answer, key
 * points, a game's books) needs `kind` checked first.
 */
import type { QuizDifficulty } from '@ipp/contracts';
import type { QuantContextEntry, QuantGameSlotEntry } from '../types';

export const isGameEntry = (e: QuantContextEntry): e is QuantGameSlotEntry => e.kind === 'game';

/** The prompt as it was posted. */
export const entryPrompt = (e: QuantContextEntry): string =>
  isGameEntry(e) ? e.game.prompt : e.question.prompt;

/** The authored hint ladder, gentlest first. */
export const entryHints = (e: QuantContextEntry): readonly string[] =>
  isGameEntry(e) ? e.game.hints : (e.question.hints ?? []);

/** The authored follow-ups (a game has none: the trading is the dialogue). */
export const entryFollowUps = (e: QuantContextEntry): readonly string[] =>
  isGameEntry(e) ? [] : (e.question.followUps ?? []);

export const entryTopic = (e: QuantContextEntry): string =>
  isGameEntry(e) ? e.game.topic : e.question.topic;

export const entryDifficulty = (e: QuantContextEntry): QuizDifficulty =>
  isGameEntry(e) ? e.game.difficulty : e.question.difficulty;

/** `short`, `numeric` or `game`, as the report's `QuantQuestionReview.type`. */
export const entryType = (e: QuantContextEntry): 'short' | 'numeric' | 'game' =>
  isGameEntry(e) ? 'game' : e.question.type;
