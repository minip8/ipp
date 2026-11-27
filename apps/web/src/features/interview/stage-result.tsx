'use client';
/**
 * One stage on the interview's page: its kind, summary and status and, once its pad has ended,
 * its report in brief (the recommendation, the summary and a score per dimension, from the
 * stage's own report) with a link to the full report. A report still being written is polled,
 * as the report page does.
 */
import {
  type InterviewStageView,
  QUANT_REPORT_DIMENSIONS,
  REPORT_DIMENSIONS,
  type Report,
  STAGE_KIND_INFO,
  type StageStatus,
} from '@ipp/contracts';
import { useQuery } from '@tanstack/react-query';
import {
  ArrowRightIcon,
  BotOffIcon,
  CircleAlertIcon,
  FileBarChartIcon,
  PlayIcon,
  RotateCwIcon,
} from 'lucide-react';
import Link from 'next/link';
import { LazyMathMarkdown } from '@/components/lazy-math-markdown';
import { Markdown } from '@/components/markdown';
import { ErrorState } from '@/components/states';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Spinner } from '@/components/ui/spinner';
import { RecommendationBadge, ScoreBars } from '@/features/report/scorecard';
import { api } from '@/lib/api';
import { formatTimeOfDay } from '@/lib/format';
import { qk } from '@/lib/queries';
import { cn } from '@/lib/utils';
import { type Names, STAGE_STATUS_LABEL, stageSummary } from './logic';
import { STAGE_ICON } from './stage-icon';

const STATUS_TONE: Record<StageStatus, 'accent' | 'ok' | 'neutral' | 'outline'> = {
  upcoming: 'outline',
  active: 'accent',
  done: 'ok',
  skipped: 'neutral',
};

function Note({
  icon,
  title,
  children,
  action,
}: {
  icon: React.ReactNode;
  title: string;
  children?: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex items-start gap-3" data-testid="stage-report-note">
      <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md border border-border bg-surface-2 text-fg-subtle">
        {icon}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">{title}</p>
        {children && <p className="mt-0.5 text-sm text-fg-muted">{children}</p>}
        {action && <div className="mt-2">{action}</div>}
      </div>
    </div>
  );
}

/** The report in brief, in the report page's words for the states without an assessment. */
function Brief({ report, onRetry }: { report: Report; onRetry: () => void }) {
  if (report.status === 'pending')
    return (
      <Note icon={<Spinner className="text-accent-text" />} title="Writing the assessment…">
        The interviewer is reviewing this stage. This usually takes under a minute; the page updates
        by itself.
      </Note>
    );
  if (report.status === 'failed')
    return (
      <Note
        icon={<CircleAlertIcon className="size-4 text-bad" />}
        title="The assessment could not be generated"
        action={
          <Button size="sm" onClick={onRetry}>
            <RotateCwIcon /> Check again
          </Button>
        }
      >
        The stage’s stats, transcript and playback are in its full report.
      </Note>
    );
  const a = report.assessment;
  if (!a)
    return (
      <Note icon={<BotOffIcon className="size-4" />} title="No AI assessment for this stage">
        {report.assessmentUnavailable === 'no_key' ||
        report.assessmentUnavailable === 'key_rejected'
          ? 'The assessment runs on your own AI API key. Open the full report to add one and have it written.'
          : 'No assessment was produced for this stage. Its stats, transcript and playback are in the full report.'}
      </Note>
    );
  const quant = report.quant !== null;
  const Summary = quant ? LazyMathMarkdown : Markdown;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <RecommendationBadge value={a.recommendation} className="h-6 px-2 text-xs" />
      </div>
      <Summary className="text-sm leading-relaxed text-fg-muted">{a.summary}</Summary>
      <ScoreBars
        scores={a.scores}
        dimensions={quant ? QUANT_REPORT_DIMENSIONS : REPORT_DIMENSIONS}
      />
    </div>
  );
}

function StageReport({ padId }: { padId: string }) {
  const report = useQuery({
    queryKey: qk.report(padId),
    queryFn: () => api.report(padId),
    refetchInterval: (q) => (q.state.data?.status === 'pending' ? 3000 : false),
  });
  if (report.isPending)
    return (
      <div className="space-y-2" role="status" aria-label="Loading the stage’s report">
        <Skeleton className="h-6 w-24" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-5/6" />
      </div>
    );
  if (report.isError)
    return (
      <ErrorState
        error={report.error}
        onRetry={() => report.refetch()}
        title="The report could not be loaded"
        compact
      />
    );
  return <Brief report={report.data} onRetry={() => report.refetch()} />;
}

export function StageResult({
  view,
  names,
  previous,
}: {
  view: InterviewStageView;
  names: Names;
  /** The stage before it, for an upcoming stage's note. */
  previous: number;
}) {
  const Icon = STAGE_ICON[view.stage.kind];
  const number = view.index + 1;
  const summary = stageSummary(view.stage, names, view.pad?.problemTitle);
  return (
    <li
      className={cn(
        'rounded-lg border bg-surface',
        view.status === 'active' ? 'border-accent/50' : 'border-border',
      )}
      data-testid="interview-stage"
      data-status={view.status}
      aria-labelledby={`stage-${number}-title`}
    >
      <div className="flex items-center gap-3 border-b border-border px-4 py-3 max-sm:flex-wrap">
        <span
          className="flex size-6 shrink-0 items-center justify-center rounded-full bg-surface-3 text-2xs font-semibold text-fg-muted tabular"
          aria-hidden
        >
          {number}
        </span>
        <span
          className="flex size-8 shrink-0 items-center justify-center rounded-md border border-border bg-surface-2 text-accent-text"
          aria-hidden
        >
          <Icon className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <h3 id={`stage-${number}-title`} className="text-sm font-medium">
            <span className="sr-only">Stage {number}: </span>
            {STAGE_KIND_INFO[view.stage.kind].label}
          </h3>
          <p className="truncate text-xs text-fg-muted" data-testid="interview-stage-summary">
            {summary}
          </p>
        </div>
        <Badge tone={STATUS_TONE[view.status]} data-testid="stage-status">
          {STAGE_STATUS_LABEL[view.status]}
        </Badge>
      </div>
      <div className="px-4 py-3.5">
        {view.status === 'done' && view.pad ? (
          <div className="space-y-3">
            <StageReport padId={view.pad.id} />
            <Button asChild size="sm" variant="ghost" className="-ml-2">
              <Link href={`/pads/${view.pad.id}/report`}>
                <FileBarChartIcon /> Full report
                <span className="sr-only"> of stage {number}</span>
              </Link>
            </Button>
          </div>
        ) : view.status === 'active' && view.pad ? (
          <div className="flex flex-wrap items-center gap-3">
            <p className="min-w-0 flex-1 text-sm text-fg-muted">
              Under way since {formatTimeOfDay(view.pad.startedAt)}.
            </p>
            <Button asChild size="sm" variant="primary">
              <Link href={`/pads/${view.pad.id}`}>
                <PlayIcon /> Continue
              </Link>
            </Button>
          </div>
        ) : view.status === 'skipped' ? (
          <p className="text-sm text-fg-muted">Not taken: the interview ended before it.</p>
        ) : (
          <p className="flex items-center gap-1.5 text-sm text-fg-muted">
            <ArrowRightIcon className="size-3.5" aria-hidden /> Starts when you move on from stage{' '}
            {previous}. What it draws is chosen then.
          </p>
        )}
      </div>
    </li>
  );
}
