'use client';
/** The user's bests (full-mix runs, by length and level) and their recent runs. */
import {
  DRILL_DURATIONS,
  DRILL_LEVEL_LABEL,
  DRILL_LEVELS,
  type DrillConfig,
  type DrillHistory,
} from '@ipp/contracts';
import type { UseQueryResult } from '@tanstack/react-query';
import { TimerIcon } from 'lucide-react';
import { useState } from 'react';
import { EmptyState, ErrorState } from '@/components/states';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { formatPercent, formatRelative, plural } from '@/lib/format';
import { cn } from '@/lib/utils';
import { bestFor, DURATION_LABEL, runAccuracy, setupLabel } from './logic';

/** Recent runs shown before "Show all". */
const RECENT = 6;

function BestsTable({ history, config }: { history: DrillHistory; config: DrillConfig }) {
  return (
    <table className="w-full text-sm" data-testid="drill-bests">
      <thead>
        <tr className="text-xs text-fg-muted">
          <th scope="col" className="w-16 py-2 pl-4 text-left font-normal">
            <span className="sr-only">Length</span>
          </th>
          {DRILL_LEVELS.map((l) => (
            <th key={l} scope="col" className="py-2 pr-4 text-right font-medium">
              {DRILL_LEVEL_LABEL[l]}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {DRILL_DURATIONS.map((d) => (
          <tr key={d} className="border-t border-border">
            <th scope="row" className="py-2 pl-4 text-left text-xs font-medium text-fg-muted">
              {DURATION_LABEL[d]}
            </th>
            {DRILL_LEVELS.map((l) => {
              const best = bestFor(history.bests, d, l);
              const chosen = config.durationSec === d && config.level === l;
              return (
                <td
                  key={l}
                  className={cn(
                    'py-2 pr-4 text-right tabular',
                    best ? 'font-semibold' : 'text-fg-subtle',
                    chosen && 'bg-accent-soft/40',
                  )}
                  aria-current={chosen ? 'true' : undefined}
                >
                  {best ? best.score : '—'}
                </td>
              );
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function DrillHistoryPanel({
  history,
  config,
}: {
  history: UseQueryResult<DrillHistory>;
  config: DrillConfig;
}) {
  const [showAll, setShowAll] = useState(false);
  const data = history.data;
  const runs = data ? (showAll ? data.runs : data.runs.slice(0, RECENT)) : [];
  return (
    <Card aria-labelledby="drill-history-heading" className="min-w-0">
      <CardHeader>
        <CardTitle id="drill-history-heading">Your runs</CardTitle>
        {data && data.totalRuns > 0 && (
          <span className="text-xs text-fg-subtle tabular">{plural(data.totalRuns, 'run')}</span>
        )}
      </CardHeader>
      {history.isPending ? (
        <div role="status" className="space-y-3 p-4" aria-busy="true" aria-label="Loading runs">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      ) : history.isError ? (
        <ErrorState error={history.error} onRetry={() => history.refetch()} compact />
      ) : !data || data.runs.length === 0 ? (
        <EmptyState icon={TimerIcon} title="No runs yet">
          Your scores and bests show up here after your first run.
        </EmptyState>
      ) : (
        <>
          <section aria-label="Bests">
            {data.bests.length > 0 ? (
              <>
                <p className="px-4 pt-3 text-xs font-medium text-fg-muted">
                  Bests, with every category on
                </p>
                <BestsTable history={data} config={config} />
              </>
            ) : (
              <p className="px-4 py-3 text-sm text-fg-muted">
                No bests yet: a run with every category on sets one.
              </p>
            )}
          </section>
          <section aria-label="Recent runs" className="border-t border-border">
            <ul className="divide-y divide-border" data-testid="drill-runs">
              {runs.map((r) => {
                const acc = runAccuracy(r);
                return (
                  <li key={r.id} className="flex items-center gap-4 px-4 py-2.5">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">
                        {setupLabel(r.config)}
                      </span>
                      <span className="mt-0.5 block text-xs text-fg-muted">
                        {formatRelative(r.finishedAt)}
                        {acc !== null && <> · {formatPercent(acc)} accuracy</>}
                      </span>
                    </span>
                    <span className="text-right">
                      <span className="block text-base font-semibold tabular">{r.score}</span>
                      <span className="block text-2xs text-fg-subtle">score</span>
                    </span>
                  </li>
                );
              })}
            </ul>
            {data.runs.length > RECENT && (
              <div className="border-t border-border px-2 py-1.5">
                <Button variant="ghost" size="sm" onClick={() => setShowAll((v) => !v)}>
                  {showAll ? 'Show fewer' : `Show all ${data.runs.length}`}
                </Button>
              </div>
            )}
          </section>
        </>
      )}
    </Card>
  );
}
