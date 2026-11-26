/**
 * The mental math drill: a timed run of generated arithmetic questions, answered from the
 * keyboard. Questions are generated and marked in the browser (apps/web/src/features/drill); the
 * server only keeps the result of each finished run, for the user's own history and bests. There
 * is no leaderboard, so a run is the client's word: the API checks that it is self-consistent and
 * humanly possible, nothing more.
 */
import { z } from 'zod';
import { Id, IsoDate } from './common';

/** What a question asks for, in the order the setup lists them. */
export const DRILL_CATEGORIES = [
  'add-subtract',
  'multiply',
  'divide',
  'fractions',
  'percentages',
  'estimation',
] as const;
export const DrillCategory = z.enum(DRILL_CATEGORIES);
export type DrillCategory = z.infer<typeof DrillCategory>;

export const DRILL_CATEGORY_INFO: Record<DrillCategory, { label: string; description: string }> = {
  'add-subtract': {
    label: 'Addition & subtraction',
    description: 'Whole numbers and decimals, with carries and negatives.',
  },
  multiply: { label: 'Multiplication', description: 'Two-digit products and decimals.' },
  divide: { label: 'Division', description: 'Exact quotients and divisions by decimals.' },
  fractions: {
    label: 'Fractions',
    description: 'Adding, multiplying and comparing fractions; converting to decimals.',
  },
  percentages: {
    label: 'Percentages',
    description: 'A percentage of a number, percentage change, and reversing one.',
  },
  estimation: {
    label: 'Estimation',
    description: 'Awkward products and quotients, answered to within a few percent.',
  },
};

export const DRILL_LEVELS = ['warmup', 'standard', 'hard'] as const;
export const DrillLevel = z.enum(DRILL_LEVELS);
export type DrillLevel = z.infer<typeof DrillLevel>;

export const DRILL_LEVEL_LABEL: Record<DrillLevel, string> = {
  warmup: 'Warm-up',
  standard: 'Standard',
  hard: 'Hard',
};

/** Run lengths offered, in seconds. */
export const DRILL_DURATIONS = [60, 120, 300] as const;
export const DrillDuration = z.union([z.literal(60), z.literal(120), z.literal(300)]);
export type DrillDuration = z.infer<typeof DrillDuration>;

/** Nobody answers faster than this for a whole run; a result above it is refused. */
export const DRILL_MAX_ANSWERS_PER_SEC = 3;
/** How far past the clock a run may report (the last answer, a slow tab). */
export const DRILL_GRACE_MS = 5_000;

export const DrillConfig = z.object({
  durationSec: DrillDuration,
  level: DrillLevel,
  /** In `DRILL_CATEGORIES` order, no repeats. */
  categories: z
    .array(DrillCategory)
    .min(1)
    .refine((c) => new Set(c).size === c.length, { message: 'a category is listed twice' })
    .transform((c) => DRILL_CATEGORIES.filter((k) => c.includes(k))),
});
export type DrillConfig = z.infer<typeof DrillConfig>;

/** A run on every category: the only kind that counts towards a personal best. */
export const isFullMix = (c: Pick<DrillConfig, 'categories'>) =>
  c.categories.length === DRILL_CATEGORIES.length;

const Count = z.int().min(0).max(100_000);

export const DrillCategoryResult = z.object({
  category: DrillCategory,
  correct: Count,
  wrong: Count,
  /** Passed over without an answer. */
  skipped: Count,
});
export type DrillCategoryResult = z.infer<typeof DrillCategoryResult>;

/** A right answer earns a point and a wrong one costs a point, as in the tests firms set. */
export const drillScore = (r: { correct: number; wrong: number }) => r.correct - r.wrong;

/** `POST /api/drill/runs`: the result of a run that has just finished. */
export const RecordDrillRunRequest = z
  .object({
    config: DrillConfig,
    /** One entry per category that came up, each at most once. */
    byCategory: z.array(DrillCategoryResult).max(DRILL_CATEGORIES.length),
    /** Milliseconds actually played: the full duration, or less when the user stopped early. */
    elapsedMs: z.int().min(0),
  })
  .superRefine((r, ctx) => {
    const seen = new Set<string>();
    let answers = 0;
    for (const c of r.byCategory) {
      if (seen.has(c.category)) ctx.addIssue({ code: 'custom', message: 'a category is repeated' });
      seen.add(c.category);
      if (!r.config.categories.includes(c.category))
        ctx.addIssue({ code: 'custom', message: `${c.category} was not part of this run` });
      answers += c.correct + c.wrong + c.skipped;
    }
    if (r.elapsedMs > r.config.durationSec * 1000 + DRILL_GRACE_MS)
      ctx.addIssue({ code: 'custom', message: 'the run is longer than its clock' });
    // Against the time actually played, so a run stopped early cannot claim a full run's answers.
    const played = Math.min(r.elapsedMs + DRILL_GRACE_MS, r.config.durationSec * 1000);
    if (answers > Math.ceil((played / 1000) * DRILL_MAX_ANSWERS_PER_SEC))
      ctx.addIssue({ code: 'custom', message: 'too many answers for the time' });
  });
export type RecordDrillRunRequest = z.infer<typeof RecordDrillRunRequest>;

export const DrillRun = z.object({
  id: Id,
  config: DrillConfig,
  byCategory: z.array(DrillCategoryResult),
  correct: z.int(),
  wrong: z.int(),
  skipped: z.int(),
  /** `drillScore`: correct minus wrong. */
  score: z.int(),
  elapsedMs: z.int(),
  finishedAt: IsoDate,
});
export type DrillRun = z.infer<typeof DrillRun>;

/** The best full-mix run for one duration and level. */
export const DrillBest = z.object({
  durationSec: DrillDuration,
  level: DrillLevel,
  score: z.int(),
  finishedAt: IsoDate,
});
export type DrillBest = z.infer<typeof DrillBest>;

/** How many recent runs `GET /api/drill/runs` returns. */
export const DRILL_HISTORY_LIMIT = 50;

/**
 * `GET /api/drill/runs`: the caller's latest runs (newest first) and their bests. A best is the
 * highest score among full-mix runs of a duration and level (the earliest run on a tie); runs on
 * chosen categories are kept in the history but are not comparable, so they set no best.
 */
export const DrillHistory = z.object({
  runs: z.array(DrillRun),
  bests: z.array(DrillBest),
  /** Every run the user has finished, not only the ones listed. */
  totalRuns: z.int(),
});
export type DrillHistory = z.infer<typeof DrillHistory>;

/**
 * `POST /api/drill/runs` answers with the stored run and whether it set a new best (always false
 * for a run that is not a full mix).
 */
export const RecordDrillRunResponse = z.object({ run: DrillRun, newBest: z.boolean() });
export type RecordDrillRunResponse = z.infer<typeof RecordDrillRunResponse>;
