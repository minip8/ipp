'use client';
/**
 * The Roadmap tab's study path: a track's topics as numbered steps to work through in order,
 * with the progress Practice shows and one-click ways into practice, the topic's bank and its
 * map; beside them a way into an interview on the path's open questions (the Interviews tab's
 * builder) and, in Quant, the mental math drill. Quant has two curated paths (trader,
 * researcher, in `?path=`); Software walks all its topics in study order.
 */
import type { QuizTopicStats, Track } from '@ipp/contracts';
import {
  CheckIcon,
  LibraryIcon,
  MapIcon,
  MessagesSquareIcon,
  PlayIcon,
  RouteIcon,
} from 'lucide-react';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { usePageView } from '@/components/page-tabs';
import { EmptyState, InlineError, useRetryCountdown } from '@/components/states';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Spinner } from '@/components/ui/spinner';
import { DrillCard } from '@/features/drill/drill-card';
import { PATH_PARAM, PATHS } from '@/features/quant/logic';
import { QuantPathPicker } from '@/features/quant/path-picker';
import { interviewLabel, PRACTICE_ROUND, quizQuestionCount } from '@/features/quiz/logic';
import { COMPLETE_ACCURACY } from '@/features/quiz/roadmap-logic';
import { useStartAttempt } from '@/features/quiz/start';
import { TopicProgress } from '@/features/quiz/topic-progress';
import { formatPercent } from '@/lib/format';
import { interviewsHref } from '@/lib/track';
import { cn } from '@/lib/utils';
import {
  interviewPool,
  listTitles,
  type PathStep,
  pathSteps,
  pathTopicSlugs,
  pickPath,
  type StudyPath,
  topicBankHref,
  topicRoadmapHref,
} from './logic';

type Start = ReturnType<typeof useStartAttempt>;

/** A step's action buttons: finger-sized and sharing the row on phones. */
const ACTION = 'max-sm:h-9 max-sm:w-full max-sm:px-2';

function StepMarker({ step }: { step: PathStep }) {
  const complete = step.state === 'complete';
  return (
    <span
      aria-hidden
      className={cn(
        'relative z-10 flex size-7 shrink-0 items-center justify-center rounded-full border text-xs font-semibold tabular',
        complete
          ? 'border-ok bg-ok text-white dark:text-[oklch(0.17_0.03_152)]'
          : step.next
            ? 'border-accent bg-accent text-accent-fg'
            : 'border-border-strong bg-surface text-fg-muted',
      )}
    >
      {complete ? <CheckIcon className="size-3.5" strokeWidth={3} /> : step.position}
    </span>
  );
}

function TopicStep({
  track,
  step,
  last,
  start,
  blocked,
}: {
  track: Track;
  step: PathStep;
  last: boolean;
  start: Start;
  /** a request is in flight, or a rate limit is counting down */
  blocked: boolean;
}) {
  const t = step.topic;
  const auto = quizQuestionCount(t);
  const busy = start.isPending && start.variables.topics[0] === t.slug;
  const titleId = `path-step-${t.slug}`;
  return (
    <li className="relative flex gap-3 sm:gap-4" aria-labelledby={titleId}>
      {/* The rail: a line from this step's marker down to the next. */}
      {!last && (
        <span
          aria-hidden
          className="absolute top-8 bottom-0 left-3.5 w-px -translate-x-1/2 bg-border"
        />
      )}
      <div className="pt-4">
        <StepMarker step={step} />
      </div>
      <article
        data-testid="path-step"
        aria-labelledby={titleId}
        className={cn(
          'mb-3 min-w-0 flex-1 rounded-lg border bg-surface p-4',
          step.next ? 'border-accent/60 ring-1 ring-accent/30' : 'border-border',
        )}
      >
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <h3 id={titleId} className="font-medium">
            <span className="sr-only">Step {step.position}: </span>
            {t.title}
          </h3>
          {step.next && <Badge tone="accent">Next up</Badge>}
          {step.state === 'complete' && <Badge tone="ok">Complete</Badge>}
        </div>
        <p className="mt-1 text-sm text-fg-muted">{t.description}</p>
        <TopicProgress t={t} accuracy className="mt-4 max-w-md" />
        {step.state !== 'complete' && t.questionCount > 0 && t.answered >= t.questionCount && (
          <p className="mt-2 text-xs text-fg-muted">
            Every question answered: get to {formatPercent(COMPLETE_ACCURACY)} accuracy to complete
            it.
          </p>
        )}
        {/* Phones: the three actions share one row. */}
        <div className="mt-4 grid grid-cols-3 gap-1.5 sm:flex sm:flex-wrap sm:items-center sm:gap-2">
          <Button
            variant={step.next ? 'primary' : 'secondary'}
            size="sm"
            className={ACTION}
            disabled={auto === 0 || blocked}
            aria-label={`Practise ${t.title}`}
            onClick={() =>
              start.mutate({
                topics: [t.slug],
                mode: 'practice',
                count: PRACTICE_ROUND,
                focusWeak: true,
              })
            }
          >
            {busy ? <Spinner /> : <PlayIcon />}
            Practise
          </Button>
          <Button asChild variant="ghost" size="sm" className={ACTION}>
            <Link href={topicBankHref(t.slug)} aria-label={`Browse ${t.title} questions`}>
              <LibraryIcon />
              Browse<span className="max-sm:hidden"> questions</span>
            </Link>
          </Button>
          <Button asChild variant="ghost" size="sm" className={ACTION}>
            <Link href={topicRoadmapHref(track, t.slug)} aria-label={`${t.title} topic map`}>
              <MapIcon />
              Topic map
            </Link>
          </Button>
        </div>
      </article>
    </li>
  );
}

/** The path's open questions, asked live: a link to the builder on an interview of them. */
function InterviewCard({ track, steps }: { track: Track; steps: PathStep[] }) {
  const pool = interviewPool(steps);
  return (
    <Card aria-labelledby="path-interview-heading" className="space-y-3 p-4">
      <div className="space-y-1">
        <h2 id="path-interview-heading" className="text-sm font-semibold">
          Talk it through with the interviewer
        </h2>
        <p className="text-sm text-fg-muted">
          {pool.topics.length === 0
            ? 'None of these topics has open questions yet.'
            : `An interview of open questions from ${listTitles(pool.titles)}: the interviewer follows up on your reasoning, then grades it. It runs on your AI key.`}
        </p>
      </div>
      {pool.topics.length > 0 && (
        <Button asChild variant="secondary" className="w-full max-sm:h-10">
          <Link href={interviewsHref(track, { topics: pool.topics })}>
            <MessagesSquareIcon />
            {interviewLabel(pool.topics.length)}
          </Link>
        </Button>
      )}
    </Card>
  );
}

function PathView({
  track,
  path,
  topics,
  picker,
}: {
  track: Track;
  path: StudyPath;
  topics: QuizTopicStats[];
  /** The path choice, when the track has more than one. */
  picker: ReactNode;
}) {
  const steps = pathSteps(pathTopicSlugs(path, topics, track), topics);
  const start = useStartAttempt();
  const wait = useRetryCountdown(start.error);
  const blocked = start.isPending || wait > 0;
  const intro = (
    <div className="mb-4 space-y-3">
      {picker}
      <p className="text-sm text-fg-muted" data-testid="path-description">
        {path.description}
      </p>
    </div>
  );
  if (steps.length === 0)
    return (
      <>
        {intro}
        <Card>
          <EmptyState icon={RouteIcon} title="No topics on this path yet">
            The {path.label.toLowerCase()} path&apos;s question banks have not been loaded on this
            server.
          </EmptyState>
        </Card>
      </>
    );
  return (
    <div className="grid items-start gap-x-6 gap-y-4 lg:grid-cols-[minmax(0,1fr)_340px]">
      <section aria-labelledby="path-heading" className="min-w-0">
        <h2 id="path-heading" className="sr-only">
          {path.label} path
        </h2>
        {intro}
        <InlineError error={start.error} className="mb-3" />
        <ol className="list-none" data-testid="path-steps">
          {steps.map((s, i) => (
            <TopicStep
              key={s.topic.slug}
              track={track}
              step={s}
              last={i === steps.length - 1}
              start={start}
              blocked={blocked}
            />
          ))}
        </ol>
      </section>
      <div className="min-w-0 space-y-4 lg:sticky lg:top-20">
        <InterviewCard track={track} steps={steps} />
        {track === 'quant' && <DrillCard />}
      </div>
    </div>
  );
}

export function PathSkeleton() {
  return (
    <div role="status" aria-busy="true" aria-label="Loading topics" className="space-y-3">
      <Skeleton className="h-4 w-2/3" />
      {Array.from({ length: 4 }, (_, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: placeholders
        <div key={i} className="flex gap-4">
          <Skeleton className="mt-4 size-7 rounded-full" />
          <div className="flex-1 rounded-lg border border-border bg-surface p-4">
            <Skeleton className="h-4 w-1/3" />
            <Skeleton className="mt-2 h-3 w-full max-w-lg" />
            <Skeleton className="mt-5 h-1.5 w-full max-w-md" />
          </div>
        </div>
      ))}
    </div>
  );
}

function QuantStudyPath({ topics }: { topics: QuizTopicStats[] }) {
  const [path, setPath] = usePageView(PATHS, PATH_PARAM);
  return (
    <PathView
      track="quant"
      path={pickPath('quant', path)}
      topics={topics}
      picker={<QuantPathPicker value={path} onValueChange={setPath} />}
    />
  );
}

export function StudyPathView({ track, topics }: { track: Track; topics: QuizTopicStats[] }) {
  if (track === 'quant') return <QuantStudyPath topics={topics} />;
  return <PathView track={track} path={pickPath(track, null)} topics={topics} picker={null} />;
}
