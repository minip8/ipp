'use client';
import type { Difficulty, PadSummary } from '@ipp/contracts';
import { useQuery } from '@tanstack/react-query';
import {
  ArrowRightIcon,
  CircleCheckIcon,
  CircleDashedIcon,
  FileTextIcon,
  HistoryIcon,
  ListChecksIcon,
  PlayIcon,
  PlusIcon,
  ShuffleIcon,
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
import { api } from '@/lib/api';
import { DIFFICULTY_LABEL, formatDuration, formatPercent, formatRelative } from '@/lib/format';
import { qk, useMe } from '@/lib/queries';
import { cn } from '@/lib/utils';

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
}

/** Picks a random problem on the setup page; nothing starts until the user confirms there. */
function QuickStart() {
  const items: { d: Difficulty; blurb: string }[] = [
    { d: 'easy', blurb: 'Warm up. About 20 minutes.' },
    { d: 'medium', blurb: 'The typical phone screen.' },
    { d: 'hard', blurb: 'Onsite-level. Bring a plan.' },
  ];
  return (
    <div className="grid gap-3 sm:grid-cols-3">
      {items.map(({ d, blurb }) => (
        <Link
          key={d}
          href={`/new?difficulty=${d}&random=1`}
          className="group flex flex-col items-start rounded-lg border border-border bg-surface p-4 text-left transition-[border-color,box-shadow] hover:border-border-strong hover:shadow-pop"
        >
          <span className="flex w-full items-center justify-between">
            <DifficultyBadge difficulty={d} />
            <ShuffleIcon
              className="size-4 text-fg-subtle transition-colors group-hover:text-accent-text"
              aria-hidden
            />
          </span>
          <span className="mt-3 text-base font-medium">
            Random {DIFFICULTY_LABEL[d].toLowerCase()} problem
          </span>
          <span className="mt-0.5 text-sm text-fg-muted">{blurb}</span>
        </Link>
      ))}
    </div>
  );
}

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
          When you end an interview, it shows up here with its outcome and a full report.
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

function QuizCard() {
  const topics = useQuery({ queryKey: qk.quizTopics, queryFn: api.quizTopics });
  const answered = topics.data?.reduce((s, t) => s + t.answered, 0) ?? 0;
  const weighted = topics.data?.reduce((s, t) => s + (t.accuracy ?? 0) * t.answered, 0) ?? 0;
  const accuracy = answered ? weighted / answered : null;
  const weakest = topics.data
    ?.filter((t) => t.accuracy !== null)
    .sort((a, b) => (a.accuracy ?? 0) - (b.accuracy ?? 0))[0];
  return (
    <Card>
      <CardHeader>
        <CardTitle>Knowledge quizzes</CardTitle>
        <ListChecksIcon className="size-4 text-fg-subtle" aria-hidden />
      </CardHeader>
      <div className="p-4">
        {topics.isPending ? (
          <div className="space-y-2">
            <Skeleton className="h-8 w-24" />
            <Skeleton className="h-4 w-full" />
          </div>
        ) : topics.isError ? (
          <p className="text-sm text-fg-muted">Quiz stats are unavailable right now.</p>
        ) : (
          <>
            <div className="flex items-baseline gap-4">
              <div>
                <p className="text-xl font-semibold tabular">{formatPercent(accuracy)}</p>
                <p className="text-xs text-fg-muted">accuracy</p>
              </div>
              <div>
                <p className="text-xl font-semibold tabular">{answered}</p>
                <p className="text-xs text-fg-muted">answered</p>
              </div>
            </div>
            {weakest && (
              <p className="mt-3 text-sm text-fg-muted">
                Weakest topic: <span className="font-medium text-fg">{weakest.title}</span> (
                {formatPercent(weakest.accuracy)})
              </p>
            )}
          </>
        )}
        <Button asChild className="mt-4 w-full">
          <Link href="/quiz">
            Practice fundamentals <ArrowRightIcon />
          </Link>
        </Button>
      </div>
    </Card>
  );
}

function StatsCard({ pads }: { pads: PadSummary[] | undefined }) {
  const ended = pads?.filter((p) => p.status === 'ended') ?? [];
  const solved = ended.filter((p) => p.accepted).length;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Your practice</CardTitle>
      </CardHeader>
      <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-b-lg bg-border">
        {[
          ['Interviews', pads ? String(ended.length) : '—'],
          ['Solved', pads ? `${solved}` : '—'],
        ].map(([k, v]) => (
          <div key={k} className="bg-surface px-4 py-3">
            <dt className="text-xs text-fg-muted">{k}</dt>
            <dd className="mt-0.5 text-lg font-semibold tabular">{v}</dd>
          </div>
        ))}
      </dl>
    </Card>
  );
}

export function Dashboard() {
  const me = useMe();
  const pads = useQuery({ queryKey: qk.pads, queryFn: api.pads });
  const active = pads.data?.filter((p) => p.status === 'active') ?? [];
  const ended = pads.data?.filter((p) => p.status === 'ended') ?? [];
  const firstName = me.data?.name.split(' ')[0];
  const [toDelete, setToDelete] = useState<DeleteTarget | null>(null);

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">
            {greeting()}
            {firstName ? `, ${firstName}` : ''}
          </h1>
          <p className="mt-1 text-sm text-fg-muted">
            Pick up a problem at random, or choose one from the library.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button asChild>
            <Link href="/new?mode=host">
              <UsersIcon /> Host an interview
            </Link>
          </Button>
          <Button asChild variant="primary">
            <Link href="/new">
              <PlusIcon /> Choose a problem
            </Link>
          </Button>
        </div>
      </div>

      <div className="mt-6 grid gap-8 lg:grid-cols-[minmax(0,1fr)_300px]">
        <div className="min-w-0">
          <QuickStart />
          {pads.isPending ? (
            <div
              className="mt-8 space-y-2"
              role="status"
              aria-busy="true"
              aria-label="Loading interviews"
            >
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-16 w-full" />
              <Skeleton className="mt-6 h-64 w-full" />
            </div>
          ) : pads.isError ? (
            <Card className="mt-8">
              <ErrorState error={pads.error} onRetry={() => pads.refetch()} compact />
            </Card>
          ) : (
            <>
              <ActivePads pads={active} onDelete={setToDelete} />
              <History pads={ended} onDelete={setToDelete} />
              <DeletePadDialog target={toDelete} onClose={() => setToDelete(null)} />
            </>
          )}
        </div>
        <aside className={cn('space-y-4')}>
          <StatsCard pads={pads.data} />
          <QuizCard />
        </aside>
      </div>
    </div>
  );
}
