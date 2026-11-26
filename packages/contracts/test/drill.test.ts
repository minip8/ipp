import { describe, expect, it } from 'vitest';
import {
  DRILL_CATEGORIES,
  DrillConfig,
  drillScore,
  isFullMix,
  RecordDrillRunRequest,
} from '../src';

const config = { durationSec: 120, level: 'standard', categories: ['multiply', 'add-subtract'] };

describe('drill contracts', () => {
  it('orders the categories of a config and refuses repeats, unknowns and odd durations', () => {
    expect(DrillConfig.parse(config).categories).toEqual(['add-subtract', 'multiply']);
    expect(DrillConfig.safeParse({ ...config, categories: [] }).success).toBe(false);
    expect(DrillConfig.safeParse({ ...config, categories: ['multiply', 'multiply'] }).success).toBe(
      false,
    );
    expect(DrillConfig.safeParse({ ...config, categories: ['algebra'] }).success).toBe(false);
    expect(DrillConfig.safeParse({ ...config, durationSec: 90 }).success).toBe(false);
    expect(isFullMix(DrillConfig.parse(config))).toBe(false);
    expect(isFullMix(DrillConfig.parse({ ...config, categories: [...DRILL_CATEGORIES] }))).toBe(
      true,
    );
  });

  it('accepts a consistent run', () => {
    const run = {
      config,
      byCategory: [
        { category: 'multiply', correct: 20, wrong: 2, skipped: 1 },
        { category: 'add-subtract', correct: 18, wrong: 0, skipped: 0 },
      ],
      elapsedMs: 120_400,
    };
    expect(RecordDrillRunRequest.safeParse(run).success).toBe(true);
    expect(RecordDrillRunRequest.safeParse({ ...run, byCategory: [] }).success).toBe(true);
    expect(drillScore({ correct: 38, wrong: 2 })).toBe(36);
  });

  it('refuses a run that contradicts itself or the clock', () => {
    const one = (over: object) => ({
      config,
      byCategory: [{ category: 'multiply', correct: 5, wrong: 0, skipped: 0 }],
      elapsedMs: 60_000,
      ...over,
    });
    const bad = (over: object) => RecordDrillRunRequest.safeParse(one(over)).success;
    expect(bad({})).toBe(true);
    expect(bad({ elapsedMs: 126_000 })).toBe(false);
    expect(bad({ byCategory: [{ category: 'divide', correct: 1, wrong: 0, skipped: 0 }] })).toBe(
      false,
    );
    expect(
      bad({
        byCategory: [
          { category: 'multiply', correct: 1, wrong: 0, skipped: 0 },
          { category: 'multiply', correct: 1, wrong: 0, skipped: 0 },
        ],
      }),
    ).toBe(false);
    expect(
      bad({ byCategory: [{ category: 'multiply', correct: 361, wrong: 0, skipped: 0 }] }),
    ).toBe(false);
    // Stopped after a second: the allowance is for the time played (plus the grace), not the clock.
    expect(
      bad({
        elapsedMs: 1_000,
        byCategory: [{ category: 'multiply', correct: 100, wrong: 0, skipped: 0 }],
      }),
    ).toBe(false);
    expect(
      bad({
        elapsedMs: 1_000,
        byCategory: [{ category: 'multiply', correct: 18, wrong: 0, skipped: 0 }],
      }),
    ).toBe(true);
    // Skips do not count towards the answer rate.
    expect(
      bad({
        elapsedMs: 1_000,
        byCategory: [{ category: 'multiply', correct: 2, wrong: 1, skipped: 400 }],
      }),
    ).toBe(true);
    expect(bad({ byCategory: [{ category: 'multiply', correct: -1, wrong: 0, skipped: 0 }] })).toBe(
      false,
    );
  });
});
