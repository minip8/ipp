/**
 * Mental math drill fixtures: a little history (newest first) and the bests the API would derive
 * from it, by the contract's rule (the highest full-mix score per length and level, the earliest
 * run on a tie).
 */
import {
  DRILL_CATEGORIES,
  type DrillBest,
  type DrillCategory,
  type DrillCategoryResult,
  type DrillConfig,
  type DrillRun,
  drillScore,
  isFullMix,
} from '@ipp/contracts';
import { iso, uuid } from './fixtures';

/** A stored run whose totals add up from its categories. */
export function makeDrillRun(
  config: DrillConfig,
  byCategory: DrillCategoryResult[],
  finishedAt: string,
  id = uuid(),
  elapsedMs = config.durationSec * 1000,
): DrillRun {
  const correct = byCategory.reduce((n, c) => n + c.correct, 0);
  const wrong = byCategory.reduce((n, c) => n + c.wrong, 0);
  const skipped = byCategory.reduce((n, c) => n + c.skipped, 0);
  return {
    id,
    config,
    byCategory,
    correct,
    wrong,
    skipped,
    score: drillScore({ correct, wrong }),
    elapsedMs,
    finishedAt,
  };
}

/** Spread right/wrong/skipped over categories, the remainder to the first. */
function spread(cats: readonly DrillCategory[], correct: number, wrong: number, skipped: number) {
  const n = cats.length;
  const share = (total: number, i: number) => Math.floor(total / n) + (i === 0 ? total % n : 0);
  return cats.map((category, i) => ({
    category,
    correct: share(correct, i),
    wrong: share(wrong, i),
    skipped: share(skipped, i),
  }));
}

const ALL = [...DRILL_CATEGORIES];

/** Newest first: two full-mix 2 min · Standard runs (best 31), a partial run, a warm-up. */
export const DRILL_RUNS: DrillRun[] = [
  makeDrillRun(
    { durationSec: 120, level: 'standard', categories: ALL },
    spread(ALL, 30, 3, 1),
    iso(-3600 * 5),
    uuid(9001),
  ),
  makeDrillRun(
    { durationSec: 60, level: 'hard', categories: ['multiply', 'divide'] },
    spread(['multiply', 'divide'], 11, 2, 0),
    iso(-86400),
    uuid(9002),
  ),
  makeDrillRun(
    { durationSec: 120, level: 'standard', categories: ALL },
    spread(ALL, 33, 2, 0),
    iso(-86400 * 3),
    uuid(9003),
  ),
  makeDrillRun(
    { durationSec: 60, level: 'warmup', categories: ALL },
    spread(ALL, 19, 1, 0),
    iso(-86400 * 6),
    uuid(9004),
  ),
];

export function drillBests(runs: readonly DrillRun[]): DrillBest[] {
  const best = new Map<string, DrillRun>();
  // Oldest first, so a later run must beat (not tie) the score to replace it.
  for (const r of [...runs].reverse()) {
    if (!isFullMix(r.config)) continue;
    const key = `${r.config.durationSec}/${r.config.level}`;
    const prev = best.get(key);
    if (!prev || r.score > prev.score) best.set(key, r);
  }
  return [...best.values()].map((r) => ({
    durationSec: r.config.durationSec,
    level: r.config.level,
    score: r.score,
    finishedAt: r.finishedAt,
  }));
}
