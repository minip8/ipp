/**
 * The quant round's clock as the interviewer acts on it. The server owns the clock
 * (`quantClock` in @ipp/contracts); the interviewer keeps a mirror of it, refreshed from every
 * context load and every step result, and checks it on each pass of the pad's pump (ticks arrive
 * every ~5 s, so no timers are needed).
 */
import { QUANT_BUDGET_MIN_SEC, type QuantClock } from '@ipp/contracts';

/**
 *  nudge       the question's budget is up and nobody has said so yet: say it (once)
 *  timeout     the budget and its grace are up: close the question for time
 *  round_time  the round's clock has run out: close the open question and wrap up
 */
export type QuantDue = 'nudge' | 'timeout' | 'round_time';

/** What the clock requires now, if anything. The round's end wins over the question's clock. */
export function quantDue(clock: QuantClock | null, now: number): QuantDue | null {
  if (!clock) return null;
  if (now >= clock.roundEndsAt) return 'round_time';
  const up = clock.posedAt + clock.budgetMs;
  if (now >= up + clock.graceMs) return 'timeout';
  if (now >= up && !clock.nudged) return 'nudge';
  return null;
}

/** The current question's budget is used up (grace or not). */
export const budgetUp = (clock: QuantClock | null, now: number): boolean =>
  clock !== null && now >= clock.posedAt + clock.budgetMs;

/**
 * Whether closing the current question now ends the round: it is the last one, or too little of
 * the round is left to pose another (the same rule as `advanceRound`).
 */
export function closingEndsRound(clock: QuantClock | null, total: number, now: number): boolean {
  if (!clock) return true;
  return clock.index + 1 >= total || clock.roundEndsAt - now < QUANT_BUDGET_MIN_SEC * 1000;
}

/** A clock action that failed or was refused is retried no sooner than this. */
export const QUANT_RETRY_MS = 30_000;
