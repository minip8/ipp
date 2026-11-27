'use client';
/**
 * A staged interview's page (`/interviews/<id>`, a track-free URL like a pad's): the hub between
 * stages and the combined report in one. While the interview is going it offers the stage under
 * way ("Continue") or, between stages, the next one ("Start stage 2: …"), and ending it; the
 * stages follow in order, each with its status and, once done, its report in brief. Once it has
 * ended, the overall recommendation: the stages' recommendations averaged by their planned
 * length (arithmetic, not an AI's judgement) with each stage's beside it.
 */
import {
  type Interview,
  interviewMinutes,
  overallRecommendation,
  STAGE_KIND_INFO,
  TRACK_INFO,
} from '@ipp/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  FileQuestionIcon,
  FlagIcon,
  PlayIcon,
  Trash2Icon,
} from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { EmptyState, ErrorState } from '@/components/states';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { Spinner } from '@/components/ui/spinner';
import { DeletePadDialog } from '@/features/delete-pad/delete-pad-dialog';
import { interviewTarget } from '@/features/delete-pad/logic';
import { startError } from '@/features/interview-builder/logic';
import { RecommendationBadge, RecommendationScale } from '@/features/report/scorecard';
import { ApiRequestError, api } from '@/lib/api';
import { formatDuration, plural } from '@/lib/format';
import { qk } from '@/lib/queries';
import { interviewsHref } from '@/lib/track';
import { useTrack } from '@/lib/track-hooks';
import {
  hubAction,
  recommendationLabel,
  reportsPending,
  stageSummary,
  timeSpentSec,
} from './logic';
import { StageResult } from './stage-result';
import { useStageNames } from './use-names';

function formatDate(iso: string) {
  return new Date(iso).toLocaleString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function PageSkeleton() {
  return (
    <div role="status" aria-busy="true" aria-label="Loading the interview">
      <Skeleton className="h-4 w-20" />
      <Skeleton className="mt-3 h-7 w-64" />
      <Skeleton className="mt-2 h-4 w-80" />
      <Skeleton className="mt-6 h-24 w-full" />
      <div className="mt-6 space-y-3">
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    </div>
  );
}

/** Refresh what shows the interview once it has moved. */
function useMoved() {
  const qc = useQueryClient();
  return (next: Interview) => {
    qc.setQueryData(qk.interview(next.id), next);
    void qc.invalidateQueries({ queryKey: qk.interviews });
    void qc.invalidateQueries({ queryKey: qk.pads });
  };
}

/** What to do now: continue the stage under way, or start the next one; and end it here. */
function Hub({ interview }: { interview: Interview }) {
  const router = useRouter();
  const names = useStageNames();
  const moved = useMoved();
  const [confirmEnd, setConfirmEnd] = useState(false);
  const action = hubAction(interview);
  const advance = useMutation({
    mutationFn: (from: number) => api.advanceInterview(interview.id, { from }),
    onSuccess: ({ interview: next, padId }) => {
      moved(next);
      if (padId) router.push(`/pads/${padId}`);
    },
  });
  if (interview.status !== 'active') return null;
  const done = interview.stages.filter((s) => s.status === 'done').length;
  return (
    <Card className="mt-6 border-accent/40 bg-accent-soft/20" data-testid="interview-hub">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-3 px-4 py-4 sm:px-5">
        <div className="min-w-0 flex-1">
          {action.kind === 'continue' ? (
            <>
              <p className="font-medium">
                Stage {action.stage.index + 1} of {interview.stages.length} is under way
              </p>
              <p className="mt-0.5 truncate text-sm text-fg-muted">
                {stageSummary(action.stage.stage, names, action.stage.pad?.problemTitle)}
              </p>
            </>
          ) : action.kind === 'start' ? (
            <>
              <p className="font-medium">
                {done === 0
                  ? 'Ready for the first stage'
                  : `${plural(done, 'stage')} done, ${interview.stages.length - done} to go`}
              </p>
              <p className="mt-0.5 text-sm text-fg-muted">
                Take a breath. The next stage’s clock starts when you open it.
              </p>
            </>
          ) : (
            <p className="font-medium">Every stage is done.</p>
          )}
        </div>
        <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
          {action.kind === 'continue' ? (
            <Button asChild variant="primary" className="max-sm:h-10 max-sm:flex-1">
              <Link href={`/pads/${action.padId}`}>
                <PlayIcon /> Continue
              </Link>
            </Button>
          ) : action.kind === 'start' ? (
            <Button
              variant="primary"
              className="max-w-full max-sm:h-10 max-sm:flex-1"
              disabled={advance.isPending}
              onClick={() => advance.mutate(action.from)}
              data-testid="start-next-stage"
            >
              {advance.isPending ? <Spinner /> : <ArrowRightIcon />}
              <span className="truncate">
                Start stage {action.stage.index + 1}: {stageSummary(action.stage.stage, names)}
              </span>
            </Button>
          ) : null}
          <Button variant="ghost" className="max-sm:h-10" onClick={() => setConfirmEnd(true)}>
            <FlagIcon /> End interview
          </Button>
        </div>
        {advance.isError && (
          <p role="alert" className="w-full text-sm text-bad-text" data-testid="advance-error">
            {startError(advance.error)}
          </p>
        )}
      </div>
      <EndDialog interview={interview} open={confirmEnd} onOpenChange={setConfirmEnd} />
    </Card>
  );
}

function EndDialog({
  interview,
  open,
  onOpenChange,
}: {
  interview: Interview;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const moved = useMoved();
  const left = interview.stages.filter((s) => s.status === 'upcoming').length;
  const underWay = interview.stages.some((s) => s.status === 'active');
  const end = useMutation({
    mutationFn: () => api.endInterview(interview.id),
    onSuccess: (next) => {
      moved(next);
      onOpenChange(false);
    },
  });
  return (
    <Dialog open={open} onOpenChange={(o) => !end.isPending && onOpenChange(o)}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>End the interview?</DialogTitle>
          <DialogDescription>
            {[
              underWay ? 'The stage under way ends and its report is written.' : null,
              left > 0
                ? `The ${plural(left, 'stage')} not started ${left === 1 ? 'is' : 'are'} skipped.`
                : null,
              'The overall result is worked out from the stages you took.',
            ]
              .filter(Boolean)
              .join(' ')}
          </DialogDescription>
        </DialogHeader>
        {end.isError && (
          <DialogBody>
            <p role="alert" className="text-sm text-bad-text">
              {startError(end.error)}
            </p>
          </DialogBody>
        )}
        <DialogFooter>
          <Button variant="ghost" disabled={end.isPending} onClick={() => onOpenChange(false)}>
            Keep going
          </Button>
          <Button variant="primary" disabled={end.isPending} onClick={() => end.mutate()}>
            {end.isPending && <Spinner />}
            End interview
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Once ended: the overall recommendation, said for what it is, and each stage's beside it. */
function Overall({ interview }: { interview: Interview }) {
  if (interview.status !== 'ended') return null;
  const overall = overallRecommendation(interview.stages);
  const pending = reportsPending(interview);
  return (
    <Card className="mt-6" aria-labelledby="overall-heading" data-testid="interview-overall">
      <CardHeader>
        <CardTitle id="overall-heading">Overall</CardTitle>
      </CardHeader>
      <div className="grid gap-x-8 gap-y-5 px-4 pt-4 pb-5 sm:px-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div>
          {overall ? (
            <RecommendationScale value={overall} />
          ) : (
            <p className="text-sm text-fg-muted">
              {pending
                ? 'The stages’ reports are still being written; the overall result follows them.'
                : 'No stage has an assessment, so there is no overall result.'}
            </p>
          )}
          <p className="mt-3 text-xs text-fg-muted" data-testid="overall-note">
            The stages’ recommendations averaged, each weighted by its planned length. This is
            arithmetic, not an AI’s judgement: each stage’s report has the reasoning.
          </p>
        </div>
        <ol className="space-y-1.5" aria-label="Each stage’s recommendation">
          {interview.stages.map((s) => (
            <li key={s.index} className="flex items-center gap-2 text-sm">
              <span className="w-14 shrink-0 text-xs text-fg-subtle tabular">
                Stage {s.index + 1}
              </span>
              <span className="min-w-0 flex-1 truncate">{STAGE_KIND_INFO[s.stage.kind].label}</span>
              {s.result?.recommendation ? (
                <RecommendationBadge value={s.result.recommendation} />
              ) : (
                <span className="text-xs text-fg-subtle">
                  {s.status === 'skipped'
                    ? 'Skipped'
                    : s.result?.report === 'pending'
                      ? 'Being written'
                      : 'No assessment'}
                </span>
              )}
              <span className="sr-only">
                {s.result?.recommendation ? recommendationLabel(s.result.recommendation) : ''}
              </span>
            </li>
          ))}
        </ol>
      </div>
    </Card>
  );
}

export function InterviewPage({ id }: { id: string }) {
  const router = useRouter();
  const remembered = useTrack();
  const names = useStageNames();
  const [deleted, setDeleted] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const q = useQuery({
    queryKey: qk.interview(id),
    queryFn: () => api.interview(id),
    enabled: !deleted,
    // A stage's report is written after its pad ends: poll until none is pending.
    refetchInterval: (query) =>
      query.state.data && reportsPending(query.state.data) ? 3000 : false,
  });
  const track = q.data?.track ?? remembered;
  const back = (
    <Link
      href={interviewsHref(track)}
      className="inline-flex items-center gap-1 text-sm text-fg-muted hover:text-fg"
    >
      <ArrowLeftIcon className="size-3.5" aria-hidden /> Interviews
    </Link>
  );

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 pb-[calc(2rem_+_env(safe-area-inset-bottom))] sm:px-6">
      {deleted ? (
        <p role="status" className="text-sm text-fg-muted">
          Returning to your interviews…
        </p>
      ) : q.isPending ? (
        <PageSkeleton />
      ) : q.isError ? (
        <>
          {back}
          <Card className="mt-4">
            {q.error instanceof ApiRequestError &&
            (q.error.isNotFound || q.error.status === 403) ? (
              <EmptyState
                icon={FileQuestionIcon}
                title="This interview does not exist or you don't have access"
                action={
                  <Button asChild size="sm">
                    <Link href={interviewsHref(track)}>Back to your interviews</Link>
                  </Button>
                }
              >
                It may have been deleted. Interviews are visible only to the person who took them.
              </EmptyState>
            ) : (
              <ErrorState error={q.error} onRetry={() => q.refetch()} />
            )}
          </Card>
        </>
      ) : (
        <>
          {back}
          <header className="mt-2 flex flex-wrap items-end justify-between gap-4">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2.5">
                <h1 className="text-xl font-semibold tracking-tight">{q.data.title}</h1>
                <Badge tone={q.data.status === 'active' ? 'accent' : 'neutral'}>
                  {q.data.status === 'active' ? 'Under way' : 'Ended'}
                </Badge>
              </div>
              <p
                className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-fg-muted"
                data-testid="interview-meta"
              >
                <span>{TRACK_INFO[q.data.track].label}</span>
                <span aria-hidden className="text-fg-subtle">
                  ·
                </span>
                <time dateTime={q.data.startedAt}>{formatDate(q.data.startedAt)}</time>
                <span aria-hidden className="text-fg-subtle">
                  ·
                </span>
                <span>
                  {plural(q.data.stages.length, 'stage')},{' '}
                  {interviewMinutes(q.data.stages.map((s) => s.stage))} min planned
                </span>
                {q.data.stages.some((s) => s.pad) && (
                  <>
                    <span aria-hidden className="text-fg-subtle">
                      ·
                    </span>
                    <span className="tabular">{formatDuration(timeSpentSec(q.data))} spent</span>
                  </>
                )}
              </p>
            </div>
            <Button variant="danger-ghost" size="sm" onClick={() => setConfirming(true)}>
              <Trash2Icon /> Delete interview
            </Button>
          </header>

          <Hub interview={q.data} />
          <Overall interview={q.data} />

          <section aria-labelledby="stages-heading" className="mt-8">
            <h2 id="stages-heading" className="mb-3 text-sm font-semibold">
              Stages
            </h2>
            <ol className="space-y-3">
              {q.data.stages.map((s) => (
                <StageResult key={s.index} view={s} names={names} previous={Math.max(1, s.index)} />
              ))}
            </ol>
          </section>
        </>
      )}
      <DeletePadDialog
        target={confirming && q.data ? interviewTarget(q.data) : null}
        onClose={() => setConfirming(false)}
        onDeleted={() => {
          setDeleted(true);
          router.replace(interviewsHref(track));
        }}
      />
    </div>
  );
}
