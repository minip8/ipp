'use client';
import type { PadSummary } from '@ipp/contracts';
import { useQuery } from '@tanstack/react-query';
import {
  CircleCheckIcon,
  CircleDashedIcon,
  FileTextIcon,
  HistoryIcon,
  PlayIcon,
  UsersIcon,
} from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { DifficultyBadge, LanguageTag } from '@/components/domain';
import { EmptyState, ErrorState } from '@/components/states';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { DeletePadButton, DeletePadDialog } from '@/features/delete-pad/delete-pad-dialog';
import type { DeleteTarget } from '@/features/delete-pad/logic';
import { NewInterview } from '@/features/new/new-interview';
import { api } from '@/lib/api';
import { formatDuration, formatRelative } from '@/lib/format';
import { qk } from '@/lib/queries';

type OnDelete = (t: DeleteTarget) => void;

/** What a pad is called in lists: its problem, or its own title when it has none (a blank room). */
const padName = (p: PadSummary) => p.problemTitle ?? p.title;
const deleteTarget = (p: PadSummary): DeleteTarget => ({
  id: p.id,
  problemTitle: padName(p),
  status: p.status,
  role: p.role,
});
/** A room's report is its host's; a candidate with an account only gets the pad back. */
const canOpenReport = (p: PadSummary) => p.kind !== 'room' || p.role === 'owner';

function RoomBadge({ p }: { p: PadSummary }) {
  if (p.kind !== 'room') return null;
  return (
    <Badge tone="outline">
      <UsersIcon /> {p.role === 'owner' ? 'Hosting' : 'Candidate'}
    </Badge>
  );
}

function ActivePads({ pads, onDelete }: { pads: PadSummary[]; onDelete: OnDelete }) {
  if (pads.length === 0) return null;
  return (
    <section aria-labelledby="active-heading" className="mt-8">
      <h2 id="active-heading" className="mb-3 text-sm font-semibold">
        In progress
      </h2>
      <ul className="space-y-2">
        {pads.map((p) => (
          <li
            key={p.id}
            className="flex items-center gap-4 rounded-lg border border-accent/40 bg-accent-soft/30 px-4 py-3"
          >
            <span className="relative flex size-2.5 shrink-0" aria-hidden>
              <span className="absolute inline-flex size-full animate-ping rounded-full bg-accent opacity-40" />
              <span className="relative inline-flex size-2.5 rounded-full bg-accent" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate font-medium">{padName(p)}</p>
              <p className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-fg-muted">
                <RoomBadge p={p} />
                {p.difficulty && <DifficultyBadge difficulty={p.difficulty} />}
                <LanguageTag language={p.language} />
                <span>Started {formatRelative(p.startedAt)}</span>
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <Button asChild variant="primary" size="sm">
                <Link href={`/pads/${p.id}`}>
                  <PlayIcon /> Resume
                </Link>
              </Button>
              <DeletePadButton target={deleteTarget(p)} onClick={() => onDelete(deleteTarget(p))} />
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

function History({ pads, onDelete }: { pads: PadSummary[]; onDelete: OnDelete }) {
  return (
    <Card className="mt-8" aria-labelledby="history-heading">
      <CardHeader>
        <CardTitle id="history-heading">History</CardTitle>
        {pads.length > 0 && (
          <span className="text-xs text-fg-subtle tabular">{pads.length} completed</span>
        )}
      </CardHeader>
      {pads.length === 0 ? (
        <EmptyState icon={HistoryIcon} title="No finished interviews yet">
          Interviews you finish show up here, each with a report.
        </EmptyState>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs text-fg-subtle">
                <th className="px-4 py-2 font-medium">Problem</th>
                <th className="hidden px-4 py-2 font-medium md:table-cell">Language</th>
                <th className="hidden px-4 py-2 font-medium sm:table-cell">When</th>
                <th className="hidden px-4 py-2 font-medium lg:table-cell">Length</th>
                <th className="px-4 py-2 font-medium">Outcome</th>
                <th className="px-4 py-2">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {pads.map((p) => {
                const len = p.endedAt
                  ? (Date.parse(p.endedAt) - Date.parse(p.startedAt)) / 1000
                  : null;
                return (
                  <tr
                    key={p.id}
                    className="group border-b border-border last:border-0 hover:bg-surface-2"
                  >
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-2">
                        <Link
                          href={canOpenReport(p) ? `/pads/${p.id}/report` : `/pads/${p.id}`}
                          className="truncate font-medium hover:underline"
                        >
                          {padName(p)}
                        </Link>
                        {p.difficulty && <DifficultyBadge difficulty={p.difficulty} />}
                        <RoomBadge p={p} />
                      </div>
                    </td>
                    <td className="hidden px-4 py-2.5 md:table-cell">
                      <LanguageTag language={p.language} />
                    </td>
                    <td className="hidden px-4 py-2.5 text-fg-muted sm:table-cell">
                      {formatRelative(p.startedAt)}
                    </td>
                    <td className="hidden px-4 py-2.5 text-fg-muted tabular lg:table-cell">
                      {len ? formatDuration(len) : '—'}
                    </td>
                    <td className="px-4 py-2.5">
                      {p.accepted ? (
                        <span className="inline-flex items-center gap-1.5 text-ok-text">
                          <CircleCheckIcon className="size-4 text-ok" aria-hidden /> Solved
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-fg-muted">
                          <CircleDashedIcon className="size-4 text-fg-subtle" aria-hidden /> Not
                          solved
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <div className="inline-flex items-center gap-1">
                        {canOpenReport(p) && (
                          <Button asChild variant="ghost" size="xs">
                            <Link
                              href={`/pads/${p.id}/report`}
                              aria-label={`Report for ${padName(p)}`}
                            >
                              <FileTextIcon /> <span className="hidden sm:inline">Report</span>
                            </Link>
                          </Button>
                        )}
                        <DeletePadButton
                          target={deleteTarget(p)}
                          onClick={() => onDelete(deleteTarget(p))}
                        />
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

export function Dashboard() {
  const pads = useQuery({ queryKey: qk.pads, queryFn: api.pads });
  const active = pads.data?.filter((p) => p.status === 'active') ?? [];
  const ended = pads.data?.filter((p) => p.status === 'ended') ?? [];
  const solved = ended.filter((p) => p.accepted).length;
  const [toDelete, setToDelete] = useState<DeleteTarget | null>(null);

  // The same shape as the quiz page: what you can start, how to set it up, then what you did.
  return (
    <div className="mx-auto max-w-6xl px-4 pt-8 pb-24 sm:px-6 lg:pb-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Interviews</h1>
          <p className="mt-1 text-sm text-fg-muted">
            Solve a problem with the AI interviewer, or interview someone yourself.
          </p>
        </div>
        {pads.data && (
          <dl className="flex gap-6 text-right">
            <div>
              <dt className="text-xs text-fg-muted">Interviews</dt>
              <dd className="text-lg font-semibold tabular">{ended.length}</dd>
            </div>
            <div>
              <dt className="text-xs text-fg-muted">Solved</dt>
              <dd className="text-lg font-semibold tabular">{solved}</dd>
            </div>
          </dl>
        )}
      </div>

      {pads.data && <ActivePads pads={active} onDelete={setToDelete} />}
      <div className="mt-8">
        <NewInterview />
      </div>
      {pads.isPending ? (
        <div className="mt-8" role="status" aria-busy="true" aria-label="Loading interviews">
          <Skeleton className="h-64 w-full" />
        </div>
      ) : pads.isError ? (
        <Card className="mt-8">
          <ErrorState error={pads.error} onRetry={() => pads.refetch()} compact />
        </Card>
      ) : (
        <>
          <History pads={ended} onDelete={setToDelete} />
          <DeletePadDialog target={toDelete} onClose={() => setToDelete(null)} />
        </>
      )}
    </div>
  );
}
