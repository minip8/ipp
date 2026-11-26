'use client';
/**
 * The Roadmap tab's study path: a track's topics as numbered steps to work through in order,
 * with the progress Practice shows and one-click ways into practice, the topic's bank and its
 * map; beside them a discussion of the path's open questions and, in Quant, the mental math
 * drill. Quant has two curated paths (trader, researcher, in `?path=`); Software walks all its
 * topics in study order.
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
import { DISCUSSION_ROUND, PRACTICE_ROUND } from '@/features/quiz/logic';
import { COMPLETE_ACCURACY } from '@/features/quiz/roadmap-logic';
import { DiscussionKeyPrompt, useDiscussionKey, useStartAttempt } from '@/features/quiz/start';
import { TopicProgress } from '@/features/quiz/topic-progress';
import { formatPercent, plural } from '@/lib/format';
import { cn } from '@/lib/utils';
import {
  discussionPool,
  listTitles,
  type PathStep,
  pathSteps,
  pathTopicSlugs,
  pickPath,
  practiceCount,
  type StudyPath,
  topicBankHref,
  topicRoadmapHref,
} from './logic';

type Start = ReturnType<typeof useStartAttempt>;

/** A step's action buttons: finger-sized and sharing the row on phones. */
const ACTION = 'max-sm:h-9 max-sm:w-full max-sm:px-2';

/** The error of the last request of this mode, if it failed. */
const failed = (start: Start, mode: 'practice' | 'discussion') =>
  start.isError && start.variables.mode === mode ? start.error : null;

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
  const auto = practiceCount(t);
  const busy =
    start.isPending && start.variables.mode === 'practice' && start.variables.topics[0] === t.slug;
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
            <Link href={topicRoadmapHref(track, t.slug)} aria-label={`${t.title} roadmap`}>
              <MapIcon />
              Roadmap
            </Link>
          </Button>
        </div>
      </article>
    </li>
  );
}

function DiscussionCard({
  steps,
  start,
  blocked,
}: {
  steps: PathStep[];
  start: Start;
  blocked: boolean;
}) {
  const { missing } = useDiscussionKey();
  const pool = discussionPool(steps);
  const titles = steps.filter((s) => pool.topics.includes(s.topic.slug)).map((s) => s.topic.title);
  const busy = start.isPending && start.variables.mode === 'discussion';
  return (
    <Card aria-labelledby="path-discuss-heading" className="space-y-3 p-4">
      <div className="space-y-1">
        <h2 id="path-discuss-heading" className="text-sm font-semibold">
          Talk it through with the interviewer
        </h2>
        <p className="text-sm text-fg-muted">
          {pool.questions === 0
            ? 'None of these topics has open questions yet.'
            : `${plural(Math.min(DISCUSSION_ROUND, pool.questions), 'open question')} from ${listTitles(titles)}. Explain your reasoning; the interviewer asks follow-ups, then grades what you said.`}
        </p>
      </div>
      {missing && pool.questions > 0 && (
        <DiscussionKeyPrompt state={missing} testId="path-key-prompt" />
      )}
      <Button
        variant="secondary"
        className="w-full max-sm:h-10"
        disabled={pool.questions === 0 || missing !== null || blocked}
        onClick={() =>
          start.mutate({
            topics: pool.topics,
            mode: 'discussion',
            count: DISCUSSION_ROUND,
            focusWeak: true,
          })
        }
      >
        {busy ? <Spinner /> : <MessagesSquareIcon />}
        Start discussion
      </Button>
      <InlineError error={failed(start, 'discussion')} />
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
        <InlineError error={failed(start, 'practice')} className="mb-3" />
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
        <DiscussionCard steps={steps} start={start} blocked={blocked} />
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
