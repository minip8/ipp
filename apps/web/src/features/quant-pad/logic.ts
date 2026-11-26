/**
 * Pure rules for a quant pad: which question is current, its clock, what the panel heads it
 * with, and the phone layout's panes. The view (`QuantRoundView`) is all the browser knows about
 * the round: how each question closed, but never a verdict.
 */
import type { QuantQuestionView, QuantRoundView } from '@ipp/contracts';
import { formatClock, plural } from '@/lib/format';

/** The question being asked now: the last posed one, while the round is asking. */
export function currentQuestion(round: QuantRoundView): QuantQuestionView | null {
  if (round.phase !== 'asking') return null;
  const last = round.questions.at(-1);
  return last && last.closedAt === null ? last : null;
}

/** The questions already closed, oldest first (prompts only: the view has no verdicts). */
export function earlierQuestions(round: QuantRoundView): QuantQuestionView[] {
  const current = currentQuestion(round);
  return round.questions.filter((q) => q !== current);
}

/**
 * What an earlier question's row says about how it closed: only the clock's doing is worth a
 * word (one the interviewer closed was simply answered, or given up on together).
 */
export function closedLabel(q: Pick<QuantQuestionView, 'closedBy'>): string | null {
  switch (q.closedBy) {
    case 'timeout':
      return 'Timed out';
    case 'round_time':
      return 'Out of time';
    default:
      return null;
  }
}

/** "Question 2 of 4" for the current question; otherwise what the round is doing. */
export function roundHeading(round: QuantRoundView): string {
  const q = currentQuestion(round);
  // A quant room's round (total null) has no "of N".
  if (q)
    return round.total === null
      ? `Question ${q.index + 1}`
      : `Question ${q.index + 1} of ${round.total}`;
  if (round.phase === 'finished') return 'Round finished';
  return plural(round.total ?? round.questions.length, 'question');
}

export type QuestionClock = {
  /** Seconds since the question was posed (until it was closed, for a closed one). */
  elapsedSec: number;
  /** Seconds left of its budget; negative once over. */
  leftSec: number;
  over: boolean;
  /** Elapsed share of the budget, 0..1. */
  fraction: number;
  /** "3:12 left", or "0:42 over" */
  label: string;
};

export function questionClock(q: QuantQuestionView, now: number): QuestionClock {
  const end = q.closedAt ? Date.parse(q.closedAt) : now;
  const elapsedSec = Math.max(0, Math.floor((end - Date.parse(q.posedAt)) / 1000));
  // A quant room's questions have no budget (null).
  const budgetSec = q.budgetSec ?? 0;
  const leftSec = budgetSec - elapsedSec;
  const over = leftSec < 0;
  return {
    elapsedSec,
    leftSec,
    over,
    fraction: budgetSec > 0 ? Math.min(1, elapsedSec / budgetSec) : 1,
    label: over ? `${formatClock(-leftSec)} over` : `${formatClock(leftSec)} left`,
  };
}

/** What the round has done so far, for the end dialog. */
export function roundProgress(round: QuantRoundView): {
  posed: number;
  closed: number;
  hints: number;
  total: number;
} {
  return {
    posed: round.questions.length,
    closed: round.questions.filter((q) => q.closedAt !== null).length,
    hints: round.questions.reduce((n, q) => n + q.hintsGiven, 0),
    total: round.total ?? round.questions.length,
  };
}

/** The round's even share of time per question, in whole minutes ("about 8 minutes each"). */
export const minutesPerQuestion = (durationMin: number, total: number) =>
  Math.max(1, Math.round(durationMin / Math.max(1, total)));

/** The phone layout's panes, in tab order. The chat is where a quant pad opens. */
export type QuantPane = 'question' | 'scratch' | 'chat';
export const QUANT_PANES: readonly QuantPane[] = ['question', 'scratch', 'chat'];

export type QuantUnread = { chat: number; question: boolean };
export const NO_QUANT_UNREAD: QuantUnread = { chat: 0, question: false };

/** Marks what arrived on a pane other than the one showing. */
export function noteQuantActivity(
  unread: QuantUnread,
  showing: QuantPane,
  activity: { messages: number; newQuestion: boolean },
): QuantUnread {
  const chat = showing === 'chat' ? 0 : unread.chat + activity.messages;
  const question = showing === 'question' ? false : unread.question || activity.newQuestion;
  return chat === unread.chat && question === unread.question ? unread : { chat, question };
}

/** Opening a pane reads what was waiting there. */
export function clearQuantUnread(unread: QuantUnread, pane: QuantPane): QuantUnread {
  if (pane === 'chat' && unread.chat) return { ...unread, chat: 0 };
  if (pane === 'question' && unread.question) return { ...unread, question: false };
  return unread;
}

/**
 * The game of the question closed last, once settled: the next question is posed in the same
 * step, so the panel keeps the settlement in view rather than only in the collapsed list.
 */
export function lastSettledGame(round: QuantRoundView): QuantQuestionView | null {
  const last = earlierQuestions(round).at(-1);
  return last?.game?.settlement ? last : null;
}

/**
 * The interviewer's moves in the current question's game so far (trades, reveals and the
 * settlement; not the candidate's own quotes): when it grows on another pane, the question tab
 * is marked.
 */
export function gameMoves(round: QuantRoundView | null): number {
  const game = round?.questions.at(-1)?.game;
  return game ? game.log.filter((e) => e.kind !== 'quote').length : 0;
}
