'use client';
/**
 * A finished run: the score and what went into it, the breakdown by category, and the questions
 * to look at again. The run is recorded by the page as it ends; this shows how that went, with a
 * retry when it failed (the results stand either way).
 */
import { DRILL_CATEGORY_INFO, type DrillConfig, isFullMix } from '@ipp/contracts';
import { CheckIcon, RotateCwIcon, SlidersHorizontalIcon, TrophyIcon, XIcon } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle } from '@/components/ui/card';
import { Spinner } from '@/components/ui/spinner';
import { errorMessage } from '@/lib/api';
import { formatClock, formatPercent, plural } from '@/lib/format';
import { cn } from '@/lib/utils';
import {
  type Answered,
  answerDisplay,
  type CategorySummary,
  estimateRange,
  formatPace,
  formatSeconds,
  summarize,
} from './logic';

export type SaveState =
  | { status: 'skipped' }
  | { status: 'pending' }
  | { status: 'saved'; newBest: boolean }
  | { status: 'failed'; error: unknown };

export interface FinishedRun {
  config: DrillConfig;
  answers: Answered[];
  elapsedMs: number;
  endedBy: 'time' | 'stop';
}

function Stat({
  label,
  value,
  tone,
  testId,
}: {
  label: string;
  value: string | number;
  tone?: 'ok' | 'bad';
  testId?: string;
}) {
  return (
    <div className="min-w-0">
      <dt className="flex items-center gap-1.5 text-xs text-fg-muted">
        {tone && (
          <span
            aria-hidden
            className={cn('size-1.5 rounded-full', tone === 'ok' ? 'bg-ok' : 'bg-bad')}
          />
        )}
        {label}
      </dt>
      <dd className="mt-0.5 text-lg font-semibold tabular" data-testid={testId}>
        {value}
      </dd>
    </div>
  );
}

function SaveNote({
  save,
  config,
  bestScore,
  onRetry,
}: {
  save: SaveState;
  config: DrillConfig;
  bestScore: number | null;
  onRetry: () => void;
}) {
  const full = isFullMix(config);
  if (save.status === 'skipped')
    return (
      <p className="text-sm text-fg-muted">Nothing was answered, so this run was not saved.</p>
    );
  if (save.status === 'pending')
    return (
      <p className="flex items-center gap-2 text-sm text-fg-muted" role="status">
        <Spinner className="size-3.5" />
        Saving to your history…
      </p>
    );
  if (save.status === 'failed')
    return (
      <div
        role="alert"
        className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-md border border-bad/30 bg-bad-soft px-3 py-2 text-sm text-bad-text"
      >
        <span className="min-w-0 flex-1">This run was not saved: {errorMessage(save.error)}</span>
        <Button size="sm" variant="secondary" onClick={onRetry}>
          <RotateCwIcon />
          Retry
        </Button>
      </div>
    );
  return (
    <p className="flex items-start gap-1.5 text-sm text-fg-muted" role="status">
      <CheckIcon className="mt-0.5 size-3.5 shrink-0 text-ok" aria-hidden />
      <span>
        Saved to your history.
        {!full
          ? ' Not every category was on, so it does not count towards a best.'
          : !save.newBest && bestScore !== null
            ? ` Your best here is ${bestScore}.`
            : ''}
      </span>
    </p>
  );
}

function CategoryTable({ rows, slowest }: { rows: CategorySummary[]; slowest: string | null }) {
  return (
    <table className="w-full text-sm" data-testid="drill-categories">
      <thead>
        <tr className="text-xs text-fg-muted">
          <th scope="col" className="py-2 pl-4 text-left font-medium">
            Category
          </th>
          <th scope="col" className="px-1.5 py-2 text-right font-medium sm:px-2">
            Right
          </th>
          <th scope="col" className="px-1.5 py-2 text-right font-medium sm:px-2">
            Wrong
          </th>
          <th scope="col" className="px-1.5 py-2 text-right font-medium sm:px-2">
            Skipped
          </th>
          <th scope="col" className="py-2 pr-4 pl-2 text-right font-medium">
            <span className="max-sm:hidden">Time each</span>
            <span className="sm:hidden">Each</span>
          </th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.category} className="border-t border-border">
            <th scope="row" className="py-2 pl-4 text-left font-medium">
              <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                {DRILL_CATEGORY_INFO[r.category].label}
                {r.category === slowest && <Badge tone="warn">Slowest</Badge>}
              </span>
            </th>
            <td className="px-1.5 py-2 text-right tabular sm:px-2">{r.correct}</td>
            <td className="px-1.5 py-2 text-right tabular sm:px-2">{r.wrong}</td>
            <td className="px-1.5 py-2 text-right tabular sm:px-2">{r.skipped}</td>
            <td className="py-2 pr-4 pl-1.5 text-right whitespace-nowrap text-fg-muted tabular sm:pl-2">
              {formatSeconds(r.meanMs)}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function ReviewItem({ a }: { a: Answered }) {
  const q = a.question;
  const range = estimateRange(q);
  return (
    <li className="flex flex-col gap-1 px-4 py-2.5">
      <span className="min-w-0 flex-1">
        <span className="font-medium tabular">{q.text}</span>
        {q.ask && <span className="ml-2 text-xs text-fg-muted">{q.ask}</span>}
      </span>
      <span className="flex flex-wrap items-baseline gap-x-3 text-sm">
        {a.typed === null ? (
          <span className="text-fg-muted">Skipped</span>
        ) : (
          <span className="inline-flex items-center gap-1 text-bad-text tabular">
            <XIcon className="size-3.5 shrink-0 self-center" strokeWidth={2.5} aria-hidden />
            <span className="sr-only">You answered </span>
            <span className="line-through decoration-bad/60">{a.typed}</span>
          </span>
        )}
        <span className="inline-flex items-center gap-1 font-medium text-ok-text tabular">
          <CheckIcon className="size-3.5 shrink-0 self-center" strokeWidth={2.5} aria-hidden />
          <span className="sr-only">Answer: </span>
          {answerDisplay(q)}
        </span>
        {range && (
          <span className="text-xs text-fg-muted tabular">
            accepted {range[0]} to {range[1]}
          </span>
        )}
      </span>
    </li>
  );
}

export function DrillResults({
  run,
  save,
  bestScore,
  onRetry,
  onPlayAgain,
  onChangeSetup,
}: {
  run: FinishedRun;
  save: SaveState;
  /** The best for this length and level, if any (shown when this run did not beat it). */
  bestScore: number | null;
  onRetry: () => void;
  onPlayAgain: () => void;
  onChangeSetup: () => void;
}) {
  const s = summarize(run.answers, run.elapsedMs);
  const playAgain = useRef<HTMLButtonElement>(null);
  // Enter plays again straight away.
  useEffect(() => {
    playAgain.current?.focus({ preventScroll: true });
  }, []);
  const newBest = save.status === 'saved' && save.newBest;
  return (
    <div
      className="grid items-start gap-x-6 gap-y-4 lg:grid-cols-[minmax(0,1fr)_360px]"
      data-testid="drill-results"
    >
      <div className="min-w-0 space-y-4">
        <Card className="p-4 sm:p-5">
          <div className="flex flex-col gap-x-10 gap-y-4 sm:flex-row sm:items-end">
            <div>
              <p className="text-sm text-fg-muted">Score</p>
              <p className="flex items-center gap-3">
                <span
                  className="text-4xl font-semibold tracking-tight tabular"
                  data-testid="drill-result-score"
                >
                  {s.score}
                </span>
                {newBest && (
                  <Badge tone="ok" className="h-6 px-2 text-xs" data-testid="drill-new-best">
                    <TrophyIcon />
                    New best
                  </Badge>
                )}
              </p>
            </div>
            <dl className="grid flex-1 grid-cols-5 gap-x-3 sm:gap-x-6">
              <Stat label="Right" value={s.correct} tone="ok" testId="drill-correct" />
              <Stat label="Wrong" value={s.wrong} tone="bad" testId="drill-wrong" />
              <Stat label="Skipped" value={s.skipped} testId="drill-skipped" />
              <Stat label="Accuracy" value={formatPercent(s.accuracy)} testId="drill-accuracy" />
              <Stat
                label="Per min"
                value={s.perMinute === null ? '—' : formatPace(s.perMinute)}
                testId="drill-pace"
              />
            </dl>
          </div>
          <p className="mt-4 text-xs text-fg-muted">
            A right answer scores a point and a wrong one loses one.{' '}
            {run.endedBy === 'stop'
              ? `Stopped after ${formatClock(run.elapsedMs / 1000)}.`
              : `Ran the full ${formatClock(run.config.durationSec)}.`}
          </p>
          <div className="mt-4">
            <SaveNote save={save} config={run.config} bestScore={bestScore} onRetry={onRetry} />
          </div>
          <div className="mt-5 flex flex-col gap-2 sm:flex-row">
            <Button ref={playAgain} variant="primary" size="lg" onClick={onPlayAgain}>
              <RotateCwIcon />
              Play again
            </Button>
            <Button variant="secondary" size="lg" onClick={onChangeSetup}>
              <SlidersHorizontalIcon />
              Change setup
            </Button>
          </div>
        </Card>

        {s.byCategory.length > 0 && (
          <Card aria-labelledby="drill-breakdown-heading">
            <CardHeader>
              <CardTitle id="drill-breakdown-heading">By category</CardTitle>
            </CardHeader>
            <CategoryTable rows={s.byCategory} slowest={s.slowest} />
          </Card>
        )}
      </div>
      <Card aria-labelledby="drill-review-heading" className="min-w-0 lg:sticky lg:top-20">
        <CardHeader>
          <CardTitle id="drill-review-heading">To review</CardTitle>
          {s.review.length > 0 && (
            <span className="text-xs text-fg-subtle tabular">
              {plural(s.review.length, 'question')}
            </span>
          )}
        </CardHeader>
        {s.review.length === 0 ? (
          <p className="px-4 py-4 text-sm text-fg-muted">
            {run.answers.length === 0
              ? 'No questions were answered.'
              : 'Nothing to review: every answer was right.'}
          </p>
        ) : (
          <ul className="divide-y divide-border" data-testid="drill-review">
            {s.review.map((a) => (
              <ReviewItem key={a.question.index} a={a} />
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
