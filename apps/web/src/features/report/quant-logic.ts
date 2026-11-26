/**
 * Pure helpers for a quant pad's report (`Report.quant`): the round's figures for the stats
 * strip, and how each question's status, score, hints and time read.
 */
import type { QuantQuestionReview, QuantQuestionStatus, QuantReport } from '@ipp/contracts';
import { formatClock, plural } from '@/lib/format';
import type { Tone } from '@/lib/verdict';

export const STATUS_LABEL: Record<QuantQuestionStatus, string> = {
  answered: 'Answered',
  timed_out: 'Timed out',
  unfinished: 'Unfinished',
  not_reached: 'Not reached',
};

/** Badge tones: an answer's quality is its score, so "answered" itself is not green. */
export const STATUS_TONE: Record<QuantQuestionStatus, 'accent' | 'warn' | 'neutral' | 'outline'> = {
  answered: 'accent',
  timed_out: 'warn',
  unfinished: 'neutral',
  not_reached: 'outline',
};

/**
 * The round's figures for the report's stats strip, in place of the runs and submissions a
 * coding pad has (`Report.stats` has none for a quant pad). Derived from `Report.quant`.
 */
export type RoundFigures = {
  total: number;
  /** Asked: every question posed. */
  posed: number;
  answered: number;
  timedOut: number;
  /** Mean verdict score (0..1) over the questions that have one; null when none does. */
  meanScore: number | null;
  judged: number;
  hintsGiven: number;
  hintsAvailable: number;
};

export function roundFigures(report: QuantReport): RoundFigures {
  const qs = report.questions;
  const scores = qs.flatMap((q) => (q.verdict ? [q.verdict.score] : []));
  const posed = qs.filter((q) => q.status !== 'not_reached');
  return {
    total: qs.length,
    posed: posed.length,
    answered: qs.filter((q) => q.status === 'answered').length,
    timedOut: qs.filter((q) => q.status === 'timed_out').length,
    meanScore: scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : null,
    judged: scores.length,
    hintsGiven: qs.reduce((n, q) => n + q.hintsGiven, 0),
    hintsAvailable: posed.reduce((n, q) => n + q.hintsAvailable, 0),
  };
}

/** Under "Answered": "3 asked · 1 timed out · 1 not reached", leaving out what is zero. */
export function answeredDetail(f: RoundFigures): string {
  const parts = [`${f.posed} asked`];
  if (f.timedOut) parts.push(`${f.timedOut} timed out`);
  if (f.posed < f.total) parts.push(`${f.total - f.posed} not reached`);
  return parts.join(' · ');
}

/** A 0..1 score as a percentage, toned the way the scorecard tones its meters. */
export function scoreView(score: number): { label: string; tone: Tone } {
  const pct = Math.round(score * 100);
  return { label: `${pct}%`, tone: score >= 0.7 ? 'ok' : score >= 0.4 ? 'warn' : 'bad' };
}

/**
 * "2 of 4 hints" (the authored ladder). The interviewer may also hint in its own words, so more
 * can be given than were written; then it is the count alone.
 */
export function hintsLabel(q: Pick<QuantQuestionReview, 'hintsGiven' | 'hintsAvailable'>): string {
  if (q.hintsAvailable === 0 || q.hintsGiven > q.hintsAvailable)
    return plural(q.hintsGiven, 'hint');
  return `${q.hintsGiven} of ${plural(q.hintsAvailable, 'hint')}`;
}

/** "5:12 of 7:00", with how far over when it ran past its time; null for one never posed. */
export function timeLabel(
  q: Pick<QuantQuestionReview, 'timeSec' | 'budgetSec'>,
): { label: string; over: boolean } | null {
  if (q.budgetSec === null) return null;
  if (q.timeSec === null) return { label: `${formatClock(q.budgetSec)} given`, over: false };
  return {
    label: `${formatClock(q.timeSec)} of ${formatClock(q.budgetSec)}`,
    over: q.timeSec > q.budgetSec,
  };
}
