'use client';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeftIcon, CodeIcon, FileQuestionIcon, PlayIcon, Trash2Icon } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { DifficultyBadge, LanguageTag } from '@/components/domain';
import { EmptyState, ErrorState } from '@/components/states';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { DeletePadDialog } from '@/features/delete-pad/delete-pad-dialog';
import { type DeleteTarget, deleteCopy } from '@/features/delete-pad/logic';
import { ApiRequestError, api } from '@/lib/api';
import { qk, useMe } from '@/lib/queries';
import { Player } from './player';
import { Assessment, StatsStrip } from './scorecard';

function formatDate(iso: string) {
  return new Date(iso).toLocaleString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function BackLink() {
  return (
    <Link
      href="/dashboard"
      className="inline-flex items-center gap-1 text-sm text-fg-muted hover:text-fg"
    >
      <ArrowLeftIcon className="size-3.5" aria-hidden /> Interviews
    </Link>
  );
}

function ReportSkeleton() {
  return (
    <div role="status" aria-busy="true" aria-label="Loading report">
      <Skeleton className="h-4 w-20" />
      <Skeleton className="mt-3 h-7 w-64" />
      <Skeleton className="mt-2 h-4 w-80" />
      <Skeleton className="mt-6 h-[74px] w-full" />
      <div className="mt-6 grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
        <Skeleton className="h-96" />
        <div className="space-y-4">
          <Skeleton className="h-40" />
          <Skeleton className="h-40" />
        </div>
      </div>
      <Skeleton className="mt-6 h-[600px] w-full" />
    </div>
  );
}

function SectionSkeleton({ className }: { className: string }) {
  return <Skeleton className={className} />;
}

export function ReportPage({ id }: { id: string }) {
  const me = useMe();
  const router = useRouter();
  // Once deleted, nothing here may refetch (it would 404) while the dashboard loads.
  const [deleted, setDeleted] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const pad = useQuery({ queryKey: qk.pad(id), queryFn: () => api.pad(id), enabled: !deleted });
  const ended = pad.data?.pad.status === 'ended' && !deleted;
  const target: DeleteTarget | null = pad.data
    ? {
        id,
        problemTitle: pad.data.problem.title,
        status: pad.data.pad.status,
        role: pad.data.role,
      }
    : null;
  const report = useQuery({
    queryKey: qk.report(id),
    queryFn: () => api.report(id),
    enabled: ended,
    refetchInterval: (q) => (q.state.data?.status === 'pending' ? 3000 : false),
  });
  const playback = useQuery({
    queryKey: qk.playback(id),
    queryFn: () => api.playback(id),
    enabled: ended,
    staleTime: Number.POSITIVE_INFINITY,
  });

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
      {deleted ? (
        <p role="status" className="text-sm text-fg-muted">
          Returning to your interviews…
        </p>
      ) : pad.isPending ? (
        <ReportSkeleton />
      ) : pad.isError ? (
        <>
          <BackLink />
          <Card className="mt-4">
            {pad.error instanceof ApiRequestError &&
            (pad.error.isNotFound || pad.error.status === 403) ? (
              <EmptyState
                icon={FileQuestionIcon}
                title="This report does not exist or you don't have access"
                action={
                  <Button asChild size="sm">
                    <Link href="/dashboard">Back to your interviews</Link>
                  </Button>
                }
              >
                Reports are visible to the people who took part in the interview.
              </EmptyState>
            ) : (
              <ErrorState error={pad.error} onRetry={() => pad.refetch()} />
            )}
          </Card>
        </>
      ) : (
        <>
          <BackLink />
          <header className="mt-2 flex flex-wrap items-end justify-between gap-4">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2.5">
                <h1 className="text-xl font-semibold tracking-tight">{pad.data.problem.title}</h1>
                <DifficultyBadge difficulty={pad.data.problem.difficulty} />
              </div>
              <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-fg-muted">
                <span>Interview report</span>
                <span aria-hidden className="text-fg-subtle">
                  ·
                </span>
                <LanguageTag language={pad.data.pad.language} />
                <span aria-hidden className="text-fg-subtle">
                  ·
                </span>
                <time dateTime={pad.data.pad.startedAt}>{formatDate(pad.data.pad.startedAt)}</time>
              </p>
            </div>
            <div className="flex items-center gap-2">
              {target && (
                <Button variant="danger-ghost" size="sm" onClick={() => setConfirming(true)}>
                  <Trash2Icon /> {deleteCopy(target).action}
                </Button>
              )}
              {ended ? (
                <Button asChild size="sm">
                  <Link href={`/pads/${id}`}>
                    <CodeIcon /> Open pad
                  </Link>
                </Button>
              ) : null}
            </div>
          </header>

          {!ended ? (
            <Card className="mt-6">
              <EmptyState
                icon={PlayIcon}
                title="This interview is still in progress"
                action={
                  <Button asChild variant="primary" size="sm">
                    <Link href={`/pads/${id}`}>
                      <PlayIcon /> Resume interview
                    </Link>
                  </Button>
                }
              >
                The report is written when the interview ends.
              </EmptyState>
            </Card>
          ) : (
            <div className="mt-6 space-y-6">
              {report.isPending ? (
                <>
                  <SectionSkeleton className="h-[74px] w-full" />
                  <SectionSkeleton className="h-80 w-full" />
                </>
              ) : report.isError ? (
                <Card>
                  <ErrorState
                    error={report.error}
                    onRetry={() => report.refetch()}
                    title="The report could not be loaded"
                    compact
                  />
                </Card>
              ) : (
                <>
                  <StatsStrip stats={report.data.stats} />
                  <Assessment
                    report={report.data}
                    pad={pad.data}
                    onRetry={() => report.refetch()}
                  />
                </>
              )}

              {playback.isPending ? (
                <SectionSkeleton className="h-[600px] w-full" />
              ) : playback.isError ? (
                <Card>
                  <ErrorState
                    error={playback.error}
                    onRetry={() => playback.refetch()}
                    title="The playback could not be loaded"
                    compact
                  />
                </Card>
              ) : (
                <Player detail={pad.data} playback={playback.data} selfId={me.data?.id} />
              )}
            </div>
          )}
        </>
      )}
      <DeletePadDialog
        target={confirming ? target : null}
        onClose={() => setConfirming(false)}
        onDeleted={() => {
          setDeleted(true);
          router.replace('/dashboard');
        }}
      />
    </div>
  );
}
