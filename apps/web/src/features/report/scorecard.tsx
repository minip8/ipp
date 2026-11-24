'use client';
import {
  type PadDetail,
  REPORT_DIMENSIONS,
  type Report,
  type ReportAssessment,
} from '@ipp/contracts';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  BotOffIcon,
  CheckIcon,
  CircleAlertIcon,
  CircleCheckIcon,
  CircleDashedIcon,
  MinusIcon,
  PlusIcon,
  RotateCwIcon,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { toast } from 'sonner';
import { Markdown } from '@/components/markdown';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle } from '@/components/ui/card';
import { Spinner } from '@/components/ui/spinner';
import { AiKeyPrompt } from '@/features/ai-key/ai-key-prompt';
import { api, errorMessage } from '@/lib/api';
import { formatDuration } from '@/lib/format';
import { qk } from '@/lib/queries';
import { cn } from '@/lib/utils';

type Recommendation = ReportAssessment['recommendation'];
type Dimension = (typeof REPORT_DIMENSIONS)[number];

const RECOMMENDATIONS: { value: Recommendation; label: string; tone: 'bad' | 'warn' | 'ok' }[] = [
  { value: 'no_hire', label: 'No hire', tone: 'bad' },
  { value: 'lean_no_hire', label: 'Lean no hire', tone: 'bad' },
  { value: 'lean_hire', label: 'Lean hire', tone: 'warn' },
  { value: 'hire', label: 'Hire', tone: 'ok' },
  { value: 'strong_hire', label: 'Strong hire', tone: 'ok' },
];

export const DIMENSION_LABEL: Record<Dimension, string> = {
  problem_solving: 'Problem solving',
  coding: 'Coding',
  communication: 'Communication',
  testing: 'Testing',
  complexity_analysis: 'Complexity analysis',
};

const SCORE_WORD = ['', 'Weak', 'Mixed', 'Good', 'Strong'] as const;

const toneFill = { bad: 'bg-bad', warn: 'bg-warn', ok: 'bg-ok' } as const;
const toneText = { bad: 'text-bad-text', warn: 'text-warn-text', ok: 'text-ok-text' } as const;
const toneSelected = {
  bad: 'border-bad/60 bg-bad-soft text-bad-text',
  warn: 'border-warn/60 bg-warn-soft text-warn-text',
  ok: 'border-ok/60 bg-ok-soft text-ok-text',
} as const;

export function RecommendationScale({ value }: { value: Recommendation }) {
  const current = RECOMMENDATIONS.find((r) => r.value === value) ?? RECOMMENDATIONS[2];
  return (
    <div>
      <p className="text-2xs font-medium tracking-wider text-fg-subtle uppercase">Recommendation</p>
      <p
        className={cn(
          'mt-1 text-xl font-semibold tracking-tight',
          current && toneText[current.tone],
        )}
      >
        {current?.label}
      </p>
      <ol
        className="mt-3 grid grid-cols-5 gap-1"
        aria-label="Recommendation scale, from no hire to strong hire"
      >
        {RECOMMENDATIONS.map((r) => {
          const selected = r.value === value;
          return (
            <li
              key={r.value}
              aria-current={selected ? 'true' : undefined}
              className={cn(
                'flex min-h-9 items-center justify-center gap-1 rounded-md border px-1 text-center text-2xs leading-tight font-medium sm:text-xs',
                selected ? toneSelected[r.tone] : 'border-border bg-surface-2 text-fg-subtle',
              )}
            >
              {selected && (
                <CheckIcon className="size-3.5 shrink-0" strokeWidth={2.5} aria-hidden />
              )}
              <span>{r.label}</span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

export function DimensionMeter({
  dimension,
  score,
  evidence,
}: {
  dimension: Dimension;
  score: number;
  evidence: string;
}) {
  const tone = score >= 3 ? 'ok' : score === 2 ? 'warn' : 'bad';
  return (
    <li className="grid gap-x-6 gap-y-1.5 py-3.5 sm:grid-cols-[200px_minmax(0,1fr)]">
      <div>
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-sm font-medium">{DIMENSION_LABEL[dimension]}</span>
          <span className="text-xs text-fg-muted tabular">
            <span className="font-semibold text-fg">{score}</span>/4 · {SCORE_WORD[score] ?? ''}
          </span>
        </div>
        <meter
          className="sr-only"
          min={1}
          max={4}
          value={score}
          aria-label={`${DIMENSION_LABEL[dimension]}: ${score} of 4, ${SCORE_WORD[score] ?? ''}`}
        />
        <div className="mt-2 grid grid-cols-4 gap-1" aria-hidden>
          {[1, 2, 3, 4].map((i) => (
            <span
              key={i}
              className={cn('h-1.5 rounded-full', i <= score ? toneFill[tone] : 'bg-surface-3')}
            />
          ))}
        </div>
      </div>
      <p className="text-sm leading-relaxed text-fg-muted">{evidence}</p>
    </li>
  );
}

function ListBlock({
  title,
  items,
  kind,
}: {
  title: string;
  items: string[];
  kind: 'plus' | 'minus';
}) {
  const Icon = kind === 'plus' ? PlusIcon : MinusIcon;
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      {items.length === 0 ? (
        <p className="px-4 py-3 text-sm text-fg-muted">Nothing noted.</p>
      ) : (
        <ul className="space-y-2.5 px-4 py-3.5">
          {items.map((s) => (
            <li key={s} className="flex gap-2.5 text-sm leading-relaxed">
              <span
                className={cn(
                  'mt-0.5 flex size-4.5 shrink-0 items-center justify-center rounded-full',
                  kind === 'plus' ? 'bg-ok-soft text-ok-text' : 'bg-warn-soft text-warn-text',
                )}
                aria-hidden
              >
                <Icon className="size-3" strokeWidth={2.5} />
              </span>
              <span>{s}</span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

/** Stats strip; works for any report status because stats are always present. */
export function StatsStrip({ stats }: { stats: Report['stats'] }) {
  const tiles: { label: string; value: ReactNode; sub?: string }[] = [
    { label: 'Duration', value: formatDuration(stats.durationSec) },
    {
      label: 'Result',
      value: stats.accepted ? (
        <span className="inline-flex items-center gap-1.5 text-ok-text">
          <CircleCheckIcon className="size-4.5 text-ok" aria-hidden /> Solved
        </span>
      ) : (
        <span className="inline-flex items-center gap-1.5 text-fg-muted">
          <CircleDashedIcon className="size-4.5 text-fg-subtle" aria-hidden /> Not solved
        </span>
      ),
    },
    { label: 'Runs', value: stats.runs },
    { label: 'Submissions', value: stats.submissions },
    {
      label: 'Messages',
      value: stats.candidateMessages + stats.interviewerMessages,
      sub: `${stats.candidateMessages} you · ${stats.interviewerMessages} interviewer`,
    },
  ];
  return (
    <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-border bg-border sm:grid-cols-3 lg:grid-cols-5">
      {tiles.map((t, i) => (
        <div
          key={t.label}
          className={cn(
            'bg-surface px-4 py-3',
            i === tiles.length - 1 && 'col-span-2 sm:col-span-1',
          )}
        >
          <dt className="text-xs text-fg-muted">{t.label}</dt>
          <dd className="mt-1 text-lg font-semibold tabular">{t.value}</dd>
          {t.sub && (
            <dd className="mt-0.5 truncate text-2xs text-fg-subtle tabular" title={t.sub}>
              {t.sub}
            </dd>
          )}
        </div>
      ))}
    </dl>
  );
}

function Notice({
  icon,
  title,
  children,
  action,
}: {
  icon: ReactNode;
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <Card className="flex items-start gap-3 px-5 py-5">
      <div className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-md border border-border bg-surface-2 text-fg-subtle">
        {icon}
      </div>
      <div className="min-w-0 flex-1">
        <p className="font-medium">{title}</p>
        {children && <div className="mt-0.5 text-sm text-fg-muted">{children}</div>}
        {action && <div className="mt-3">{action}</div>}
      </div>
    </Card>
  );
}

/** Ask for the assessment now (the owner just added a key, or an earlier attempt failed). */
function useRequestAssessment(padId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.requestAssessment(padId),
    // A pending report makes the page poll until the assessment is written.
    onSuccess: (r) => qc.setQueryData(qk.report(padId), r),
    onError: (e) => toast.error('Could not start the assessment', { description: errorMessage(e) }),
  });
}

function NoAssessment({ report, pad }: { report: Report; pad: PadDetail }) {
  const owner = pad.role === 'owner';
  const ask = useRequestAssessment(pad.pad.id);
  const why =
    report.assessmentUnavailable ?? (pad.pad.interviewer.enabled ? 'failed' : 'interviewer_off');
  const below = 'Stats, transcript and playback are below.';
  if (why === 'interviewer_off')
    return (
      <Notice icon={<BotOffIcon className="size-4" />} title="No AI assessment for this interview">
        The AI interviewer was turned off for this interview, so there is no written assessment.{' '}
        {below}
      </Notice>
    );
  if (why === 'failed')
    return (
      <Notice
        icon={<BotOffIcon className="size-4" />}
        title="No AI assessment for this interview"
        action={
          owner && (
            <Button
              size="sm"
              variant="primary"
              onClick={() => ask.mutate()}
              disabled={ask.isPending}
            >
              {ask.isPending ? <Spinner /> : <RotateCwIcon />} Write the assessment
            </Button>
          )
        }
      >
        No assessment was produced for this interview. {below}
      </Notice>
    );
  const rejected = why === 'key_rejected';
  if (!owner)
    return (
      <Notice icon={<BotOffIcon className="size-4" />} title="No AI assessment yet">
        {rejected
          ? 'The AI provider rejected the pad owner’s API key, so the assessment could not be written.'
          : 'The assessment runs on the pad owner’s own AI API key, and they have not added one.'}{' '}
        {below}
      </Notice>
    );
  return (
    <AiKeyPrompt
      testId="assessment-key-prompt"
      state={rejected ? 'rejected' : 'missing'}
      title={
        rejected
          ? 'Your API key was rejected, so there is no assessment yet'
          : 'Get a written assessment of this interview'
      }
      action={rejected ? 'Update key' : 'Add API key'}
      dialogTitle={rejected ? 'Update your API key' : undefined}
      onSaved={() => ask.mutate()}
      className="bg-surface px-5 py-5"
    >
      The assessment runs on your own AI API key (Anthropic, OpenAI, Google Gemini or OpenRouter).
      Add it and the interviewer reviews this session right away. {below}
    </AiKeyPrompt>
  );
}

export function Assessment({
  report,
  pad,
  onRetry,
}: {
  report: Report;
  pad: PadDetail;
  onRetry: () => void;
}) {
  if (report.status === 'pending') {
    return (
      <Notice icon={<Spinner className="text-accent-text" />} title="Writing your assessment…">
        The interviewer is reviewing the session. This usually takes under a minute; the page
        updates by itself.
      </Notice>
    );
  }
  if (report.status === 'failed') {
    return (
      <Notice
        icon={<CircleAlertIcon className="size-4 text-bad" />}
        title="The assessment could not be generated"
        action={
          <Button size="sm" onClick={onRetry}>
            <RotateCwIcon /> Check again
          </Button>
        }
      >
        Your stats, transcript and playback are below. The written assessment is missing for this
        interview.
      </Notice>
    );
  }
  const a = report.assessment;
  if (!a) return <NoAssessment report={report} pad={pad} />;
  const scores = REPORT_DIMENSIONS.map((d) => a.scores.find((s) => s.dimension === d)).filter(
    (s): s is NonNullable<typeof s> => Boolean(s),
  );
  return (
    <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
      <Card aria-labelledby="assessment-heading">
        <CardHeader>
          <CardTitle id="assessment-heading">Assessment</CardTitle>
        </CardHeader>
        <div className="px-5 pt-4 pb-5">
          <RecommendationScale value={a.recommendation} />
          <Markdown className="mt-5 text-base leading-relaxed">{a.summary}</Markdown>
        </div>
        <div className="border-t border-border px-5">
          <ul className="divide-y divide-border">
            {scores.map((s) => (
              <DimensionMeter
                key={s.dimension}
                dimension={s.dimension}
                score={s.score}
                evidence={s.evidence}
              />
            ))}
          </ul>
        </div>
      </Card>
      <div className="space-y-4">
        <ListBlock title="Strengths" items={a.strengths} kind="plus" />
        <ListBlock title="To work on" items={a.improvements} kind="minus" />
      </div>
    </div>
  );
}
