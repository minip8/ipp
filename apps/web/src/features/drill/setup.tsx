'use client';
/** The drill's setup: length, level and categories, the best to beat, and Start. */
import {
  DRILL_CATEGORIES,
  DRILL_CATEGORY_INFO,
  DRILL_DURATIONS,
  DRILL_LEVEL_LABEL,
  DRILL_LEVELS,
  type DrillConfig,
  type DrillDuration,
  type DrillHistory,
  isFullMix,
} from '@ipp/contracts';
import type { UseQueryResult } from '@tanstack/react-query';
import { PlayIcon, TrophyIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/input';
import { Segmented } from '@/components/ui/segmented';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { bestFor, CATEGORY_HINT, DURATION_LABEL, LEVEL_HINT, toggleCategory } from './logic';

/** Phones: segmented controls at a size a finger can hit (desktop keeps the compact size). */
const TOUCH_SEGMENTS = 'max-sm:[&>*]:h-9';

export function BestLine({
  config,
  history,
}: {
  config: DrillConfig;
  history: UseQueryResult<DrillHistory>;
}) {
  const where = `${DURATION_LABEL[config.durationSec]} · ${DRILL_LEVEL_LABEL[config.level]}`;
  const best = history.data ? bestFor(history.data.bests, config.durationSec, config.level) : null;
  return (
    <div className="min-w-0 space-y-0.5 text-sm" data-testid="drill-best">
      {history.isPending ? (
        <Skeleton className="h-5 w-48" />
      ) : best ? (
        <p className="flex items-center gap-1.5">
          <TrophyIcon className="size-4 shrink-0 text-warn" aria-hidden />
          <span>
            Your best at {where}:{' '}
            <span className="font-semibold tabular" data-testid="drill-best-score">
              {best.score}
            </span>
          </span>
        </p>
      ) : (
        <p className="text-fg-muted">No best yet at {where}.</p>
      )}
      <p className="text-xs text-fg-muted" data-testid="drill-mix-note">
        {isFullMix(config)
          ? 'Every category is on, so this run can set a best.'
          : 'Runs on some categories go in your history; only a run on all of them sets a best.'}
      </p>
    </div>
  );
}

export function DrillSetup({
  config,
  onChange,
  onStart,
  history,
}: {
  config: DrillConfig;
  onChange: (c: DrillConfig) => void;
  onStart: () => void;
  history: UseQueryResult<DrillHistory>;
}) {
  const all = isFullMix(config);
  return (
    <section
      aria-labelledby="drill-setup-heading"
      className="min-w-0 rounded-lg border border-border bg-surface"
    >
      <h2 id="drill-setup-heading" className="sr-only">
        Setup
      </h2>
      <div className="space-y-5 p-4 sm:p-5">
        <div className="grid gap-5 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label>Length</Label>
            <Segmented
              aria-label="Length"
              className={cn('flex w-full', TOUCH_SEGMENTS)}
              value={String(config.durationSec)}
              onValueChange={(v) =>
                onChange({ ...config, durationSec: Number(v) as DrillDuration })
              }
              options={DRILL_DURATIONS.map((d) => ({ value: String(d), label: DURATION_LABEL[d] }))}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Level</Label>
            <Segmented
              aria-label="Level"
              className={cn('flex w-full', TOUCH_SEGMENTS)}
              value={config.level}
              onValueChange={(level) => onChange({ ...config, level })}
              options={DRILL_LEVELS.map((l) => ({ value: l, label: DRILL_LEVEL_LABEL[l] }))}
            />
            <p className="text-xs text-fg-muted" data-testid="drill-level-hint">
              {LEVEL_HINT[config.level]}
            </p>
          </div>
        </div>
        <fieldset aria-labelledby="drill-categories-label" className="min-w-0 space-y-2">
          <div className="flex h-6 items-center justify-between gap-2">
            <span id="drill-categories-label" className="text-sm font-medium">
              Categories
            </span>
            {!all && (
              <Button
                variant="link"
                size="xs"
                onClick={() => onChange({ ...config, categories: [...DRILL_CATEGORIES] })}
              >
                Select all
              </Button>
            )}
          </div>
          <div className="grid grid-cols-2 gap-2">
            {DRILL_CATEGORIES.map((c) => {
              const on = config.categories.includes(c);
              // The last category on stays on: a run needs at least one.
              const locked = on && config.categories.length === 1;
              const id = `drill-cat-${c}`;
              return (
                <label
                  key={c}
                  htmlFor={id}
                  className={cn(
                    'flex items-start gap-3 rounded-md border px-3 py-2.5 transition-colors max-sm:items-center',
                    on
                      ? 'border-accent/50 bg-accent-soft/30'
                      : 'cursor-pointer border-border hover:border-border-strong',
                    on && !locked && 'cursor-pointer',
                  )}
                >
                  <Checkbox
                    id={id}
                    className="mt-0.5 max-sm:mt-0"
                    checked={on}
                    disabled={locked}
                    title={locked ? 'A run needs at least one category' : undefined}
                    aria-labelledby={`${id}-label`}
                    aria-describedby={`${id}-hint`}
                    onCheckedChange={(v) => onChange(toggleCategory(config, c, v === true))}
                  />
                  <span className="min-w-0">
                    <span id={`${id}-label`} className="block text-sm font-medium">
                      {DRILL_CATEGORY_INFO[c].label}
                    </span>
                    <span
                      id={`${id}-hint`}
                      className="mt-0.5 block text-xs text-fg-muted max-sm:hidden"
                    >
                      {CATEGORY_HINT[c]}
                    </span>
                  </span>
                </label>
              );
            })}
          </div>
        </fieldset>
      </div>
      <div className="flex flex-col gap-3 border-t border-border p-4 sm:flex-row sm:items-center sm:gap-6 sm:p-5">
        <BestLine config={config} history={history} />
        <Button
          variant="primary"
          size="lg"
          className="shrink-0 sm:ml-auto sm:px-6"
          onClick={onStart}
        >
          <PlayIcon />
          Start
        </Button>
      </div>
    </section>
  );
}
