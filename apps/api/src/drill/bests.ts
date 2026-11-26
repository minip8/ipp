/**
 * The mental math drill's arithmetic on the server: totals and score from a recorded run, and
 * personal bests. Pure, so it is unit-tested without a database.
 */
import {
  DRILL_CATEGORIES,
  DRILL_DURATIONS,
  DRILL_LEVELS,
  type DrillBest,
  type DrillCategoryResult,
  type DrillDuration,
  type DrillLevel,
  drillScore,
} from '@ipp/contracts';

export interface DrillTotals {
  correct: number;
  wrong: number;
  skipped: number;
  score: number;
}

/** Totals over every category and the score from them (the client's score is never taken). */
export function drillTotals(byCategory: DrillCategoryResult[]): DrillTotals {
  let correct = 0;
  let wrong = 0;
  let skipped = 0;
  for (const c of byCategory) {
    correct += c.correct;
    wrong += c.wrong;
    skipped += c.skipped;
  }
  return { correct, wrong, skipped, score: drillScore({ correct, wrong }) };
}

/** `byCategory` in `DRILL_CATEGORIES` order, as it is stored and returned. */
export const orderByCategory = (byCategory: DrillCategoryResult[]) =>
  [...byCategory].sort(
    (a, b) => DRILL_CATEGORIES.indexOf(a.category) - DRILL_CATEGORIES.indexOf(b.category),
  );

/** A full-mix run, reduced to what a best needs. */
export interface BestCandidate {
  durationSec: number;
  level: DrillLevel;
  score: number;
  finishedAt: Date;
}

/**
 * The best per duration and level: the highest score, the earliest run on a tie. Ordered by
 * duration, then level, as the contract lists them. Rows with a duration outside the contract
 * are ignored.
 */
export function drillBests(rows: BestCandidate[]): DrillBest[] {
  const best = new Map<string, BestCandidate>();
  for (const r of rows) {
    const key = `${r.durationSec}:${r.level}`;
    const cur = best.get(key);
    if (
      !cur ||
      r.score > cur.score ||
      (r.score === cur.score && r.finishedAt.getTime() < cur.finishedAt.getTime())
    )
      best.set(key, r);
  }
  const out: DrillBest[] = [];
  for (const durationSec of DRILL_DURATIONS)
    for (const level of DRILL_LEVELS) {
      const b = best.get(`${durationSec}:${level}`);
      if (b)
        out.push({
          durationSec: durationSec as DrillDuration,
          level,
          score: b.score,
          finishedAt: b.finishedAt.toISOString(),
        });
    }
  return out;
}

/**
 * Whether a full-mix run sets a new best, given the highest score among the user's earlier
 * full-mix runs of the same duration and level (null: there are none). The first run counts when
 * it scores above 0; after that it must be strictly higher.
 */
export const isNewBest = (score: number, previousBest: number | null) =>
  score > (previousBest ?? 0);
