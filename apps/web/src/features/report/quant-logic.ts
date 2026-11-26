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

// ---------------------------------------------------------------- a market-making game's review

type GameReview = NonNullable<QuantQuestionReview['game']>;
type ReviewQuote = GameReview['quotes'][number];

/** Where the fair value stood against a market: inside it, or above or below it. */
export type FairSide = 'inside' | 'above' | 'below';

export const FAIR_SIDE_LABEL: Record<FairSide, string> = {
  inside: 'Inside',
  above: 'Above your offer',
  below: 'Below your bid',
};

export function fairSide(q: Pick<ReviewQuote, 'bid' | 'ask' | 'fair'>): FairSide {
  if (q.fair > q.ask) return 'above';
  if (q.fair < q.bid) return 'below';
  return 'inside';
}

export type QuoteRow = ReviewQuote & {
  /** 1-based, in the order posted. */
  n: number;
  side: FairSide;
  /** The width in standard deviations of the contract at the time (null when it was known). */
  widthSd: number | null;
};

export const quoteRows = (g: Pick<GameReview, 'quotes'>): QuoteRow[] =>
  g.quotes.map((q, i) => ({
    ...q,
    n: i + 1,
    side: fairSide(q),
    widthSd: q.sd > 0 ? q.width / q.sd : null,
  }));

/** The markets at a glance: how many had fair value inside, were traded, and how wide they were. */
export function quoteSummary(g: Pick<GameReview, 'quotes'>): {
  count: number;
  inside: number;
  traded: number;
  meanWidth: number;
  /** Mean width in standard deviations, over the markets made while something was still random. */
  meanWidthSd: number | null;
} | null {
  const rows = quoteRows(g);
  if (rows.length === 0) return null;
  const sds = rows.flatMap((r) => (r.widthSd === null ? [] : [r.widthSd]));
  return {
    count: rows.length,
    inside: rows.filter((r) => r.side === 'inside').length,
    traded: rows.filter((r) => r.traded).length,
    meanWidth: rows.reduce((s, r) => s + r.width, 0) / rows.length,
    meanWidthSd: sds.length ? sds.reduce((s, x) => s + x, 0) / sds.length : null,
  };
}

/**
 * How the candidate's market moved when a component was shown, against how the fair value moved:
 *  followed   the mid moved most of the way (75% to 125%)
 *  partly     a quarter to three quarters of the way
 *  overshot   further than the fair value did
 *  barely     less than a quarter of the way
 *  wrong_way  the opposite way
 *  no_change  the fair value did not move (nothing to follow)
 *  no_quote   no market before it, or none after it
 */
export type RevealVerdict =
  | 'followed'
  | 'partly'
  | 'overshot'
  | 'barely'
  | 'wrong_way'
  | 'no_change'
  | 'no_quote';

export const REVEAL_TONE: Record<RevealVerdict, Tone> = {
  followed: 'ok',
  partly: 'warn',
  overshot: 'warn',
  barely: 'bad',
  wrong_way: 'bad',
  no_change: 'neutral',
  no_quote: 'neutral',
};

export type RevealRow = GameReview['reveals'][number] & {
  fairMove: number;
  midMove: number | null;
  /** midMove / fairMove (null without both mids, or when fair did not move). */
  share: number | null;
  verdict: RevealVerdict;
  /** The verdict in words ("Moved 60% of the way"). */
  verdictLabel: string;
};

const EPS = 1e-9;

export function revealRows(g: Pick<GameReview, 'reveals'>): RevealRow[] {
  return g.reveals.map((r) => {
    const fairMove = r.fairAfter - r.fairBefore;
    const midMove = r.midBefore !== null && r.midAfter !== null ? r.midAfter - r.midBefore : null;
    let verdict: RevealVerdict;
    let share: number | null = null;
    if (midMove === null) verdict = 'no_quote';
    else if (Math.abs(fairMove) < EPS) verdict = 'no_change';
    else {
      share = midMove / fairMove;
      verdict =
        share < 0
          ? 'wrong_way'
          : share < 0.25
            ? 'barely'
            : share < 0.75
              ? 'partly'
              : share <= 1.25
                ? 'followed'
                : 'overshot';
    }
    const pct = share === null ? '' : `${Math.round(share * 100)}%`;
    const verdictLabel = {
      followed: 'Moved with it',
      partly: `Moved ${pct} of the way`,
      overshot: `Moved too far (${pct})`,
      barely: 'Barely moved',
      wrong_way: 'Moved the wrong way',
      no_change: 'Fair value did not move',
      no_quote: r.midBefore === null ? 'No market before it' : 'No market after it',
    }[verdict];
    return { ...r, fairMove, midMove, share, verdict, verdictLabel };
  });
}

/**
 * The P&L, split the way the report teaches it: the expected edge (each trade against the fair
 * value when it was made: the decisions) and the realised P&L at the true value; the difference
 * is what the hidden values and an informed counterparty added or took.
 */
export function pnlParts(g: Pick<GameReview, 'expectedEdge' | 'pnl'>): {
  expectedEdge: number;
  pnl: number;
  luck: number;
} {
  return {
    expectedEdge: g.expectedEdge,
    pnl: g.pnl,
    luck: Number((g.pnl - g.expectedEdge).toPrecision(12)) + 0,
  };
}

/** A figure's tone: a gain good, a loss bad, nothing neutral. */
export const signTone = (x: number): Tone => (x > EPS ? 'ok' : x < -EPS ? 'bad' : 'neutral');
