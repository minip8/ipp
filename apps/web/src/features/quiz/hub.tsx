'use client';
import type { QuizAttemptSummary, QuizTopicStats } from '@ipp/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowRightIcon,
  CheckIcon,
  HistoryIcon,
  LibraryIcon,
  ListChecksIcon,
  PlayIcon,
} from 'lucide-react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useMemo, useState } from 'react';
import { EmptyState, ErrorState, InlineError, useRetryCountdown } from '@/components/states';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/input';
import { Segmented } from '@/components/ui/segmented';
import { Skeleton } from '@/components/ui/skeleton';
import { Spinner } from '@/components/ui/spinner';
import { Switch } from '@/components/ui/switch';
import { api } from '@/lib/api';
import { formatPercent, formatRelative, plural } from '@/lib/format';
import { qk } from '@/lib/queries';
import { cn } from '@/lib/utils';
import { bankHref } from './bank-logic';

type Mode = 'practice' | 'exam';
type Diff = 'any' | 'easy' | 'medium' | 'hard';

const MODE_HINT: Record<Mode, string> = {
  practice: 'See whether you were right, and why, after every question.',
  exam: 'Answer everything first. Feedback comes when you finish.',
};

function AccuracyBar({ value }: { value: number }) {
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-3" aria-hidden>
      <div
        className="h-full rounded-full bg-accent"
        style={{ width: `${Math.round(value * 100)}%` }}
      />
    </div>
  );
}

function TopicCard({
  t,
  selected,
  onToggle,
}: {
  t: QuizTopicStats;
  selected: boolean;
  onToggle: () => void;
}) {
  const coverage = t.questionCount ? t.answered / t.questionCount : 0;
  return (
    <div
      className={cn(
        'group relative flex flex-col rounded-lg border bg-surface transition-[border-color,box-shadow,background-color]',
        selected
          ? 'border-accent bg-accent-soft/30 ring-1 ring-accent'
          : 'border-border hover:border-border-strong hover:shadow-pop',
      )}
    >
      <button
        type="button"
        onClick={onToggle}
        aria-pressed={selected}
        className="flex flex-1 flex-col rounded-t-lg p-4 text-left focus-visible:outline-offset-[-2px]"
      >
        <span className="flex items-start gap-3">
          <span className="min-w-0 flex-1">
            <span className="block font-medium">{t.title}</span>
            <span className="mt-1 line-clamp-2 block text-sm text-fg-muted">{t.description}</span>
          </span>
          <span
            aria-hidden
            className={cn(
              'mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-[4px] border transition-colors',
              selected
                ? 'border-accent bg-accent text-accent-fg'
                : 'border-border-strong bg-surface',
            )}
          >
            {selected && <CheckIcon className="size-3" strokeWidth={3} />}
          </span>
        </span>
        <span className="mt-4 flex items-end justify-between gap-3 text-xs text-fg-muted">
          <span className="tabular">
            {t.answered} of {plural(t.questionCount, 'question')} answered
          </span>
          {t.accuracy === null ? (
            <span className="text-fg-subtle">Not started</span>
          ) : (
            <span className="font-medium text-fg tabular">{formatPercent(t.accuracy)} correct</span>
          )}
        </span>
        <span className="mt-2 block">
          {t.accuracy === null ? (
            <span
              className="block h-1.5 rounded-full border border-dashed border-border-strong"
              aria-hidden
            />
          ) : (
            <AccuracyBar value={t.accuracy} />
          )}
        </span>
        <span className="sr-only">
          {t.accuracy === null
            ? 'Not started.'
            : `${formatPercent(t.accuracy)} accuracy, ${formatPercent(coverage)} of the bank seen.`}
        </span>
      </button>
      <Link
        href={bankHref(t.slug)}
        aria-label={`Browse ${t.title} questions`}
        className="flex items-center gap-1.5 rounded-b-lg border-t border-border px-4 py-2 text-sm font-medium text-accent-text transition-colors hover:bg-surface-2 focus-visible:outline-offset-[-2px]"
      >
        <LibraryIcon className="size-3.5" />
        Browse {plural(t.questionCount, 'question')}
        <ArrowRightIcon className="ml-auto size-3.5" />
      </Link>
    </div>
  );
}

/** The question bank as a first-class way in: any question, answered right away. */
function BrowsePanel({ topics }: { topics: QuizTopicStats[] }) {
  return (
    <section
      aria-labelledby="browse-heading"
      className="rounded-lg border border-border bg-surface p-4"
    >
      <div className="flex items-start gap-3">
        <span
          aria-hidden
          className="flex size-8 shrink-0 items-center justify-center rounded-md bg-accent-soft text-accent-text"
        >
          <LibraryIcon className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 id="browse-heading" className="font-medium">
            Browse the question bank
          </h2>
          <p className="mt-0.5 text-sm text-fg-muted">
            Open any question in a topic and answer it straight away, with the explanation right
            after. Nothing to set up or finish; your answers count toward your stats.
          </p>
          <ul className="mt-3 flex flex-wrap gap-1.5" aria-label="Browse a topic">
            {topics.map((t) => (
              <li key={t.slug}>
                <Link
                  href={bankHref(t.slug)}
                  className="inline-flex h-7 items-center gap-1 rounded-md border border-border-strong bg-surface px-2.5 text-sm font-medium transition-colors hover:bg-surface-3"
                >
                  {t.title}
                  <span className="text-xs font-normal text-fg-subtle tabular">
                    {t.questionCount}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}

function TopicGridSkeleton() {
  return (
    <div
      role="status"
      className="grid gap-3 sm:grid-cols-2"
      aria-busy="true"
      aria-label="Loading topics"
    >
      {Array.from({ length: 6 }, (_, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: placeholders
        <div key={i} className="rounded-lg border border-border bg-surface p-4">
          <Skeleton className="h-4 w-1/3" />
          <Skeleton className="mt-2 h-3 w-full" />
          <Skeleton className="mt-1.5 h-3 w-2/3" />
          <Skeleton className="mt-5 h-1.5 w-full" />
        </div>
      ))}
    </div>
  );
}

function SetupPanel({
  topics,
  selected,
  onClear,
}: {
  topics: QuizTopicStats[];
  selected: string[];
  onClear: () => void;
}) {
  const router = useRouter();
  const qc = useQueryClient();
  const [mode, setMode] = useState<Mode>('practice');
  const [difficulty, setDifficulty] = useState<Diff>('any');
  const [count, setCount] = useState('10');
  const [focusWeak, setFocusWeak] = useState(true);
  const start = useMutation({
    mutationFn: () =>
      api.createAttempt({
        topics: selected,
        mode,
        difficulty: difficulty === 'any' ? undefined : difficulty,
        count: Number(count),
        focusWeak,
      }),
    onSuccess: (a) => {
      qc.setQueryData(qk.attempt(a.id), a);
      qc.invalidateQueries({ queryKey: qk.attempts });
      router.push(`/quiz/${a.id}`);
    },
  });
  const wait = useRetryCountdown(start.error);
  const names = selected.map((s) => topics.find((t) => t.slug === s)?.title ?? s);

  return (
    <section aria-labelledby="setup-heading" className="rounded-lg border border-border bg-surface">
      <div className="border-b border-border p-4">
        <h2
          id="setup-heading"
          className="scroll-mt-20 text-2xs font-medium tracking-wider text-fg-subtle uppercase"
        >
          New quiz
        </h2>
        {selected.length === 0 ? (
          <p className="mt-2 text-sm text-fg-muted">
            Select one or more topics to build a quiz from.
          </p>
        ) : (
          <div className="mt-2">
            <div className="flex flex-wrap gap-1.5">
              {names.map((n) => (
                <Badge key={n} tone="accent">
                  {n}
                </Badge>
              ))}
            </div>
            <button
              type="button"
              onClick={onClear}
              className="mt-2 text-xs text-fg-muted hover:text-fg hover:underline"
            >
              Clear selection
            </button>
          </div>
        )}
      </div>
      <div className="space-y-5 p-4">
        <div className="space-y-1.5">
          <Label>Mode</Label>
          <Segmented
            aria-label="Mode"
            className="flex w-full"
            value={mode}
            onValueChange={setMode}
            options={[
              { value: 'practice', label: 'Practice' },
              { value: 'exam', label: 'Exam' },
            ]}
          />
          <p className="text-xs text-fg-muted">{MODE_HINT[mode]}</p>
        </div>
        <div className="space-y-1.5">
          <Label>Difficulty</Label>
          <Segmented
            aria-label="Difficulty"
            className="flex w-full"
            value={difficulty}
            onValueChange={setDifficulty}
            options={[
              { value: 'any', label: 'Any' },
              { value: 'easy', label: 'Easy' },
              { value: 'medium', label: 'Medium' },
              { value: 'hard', label: 'Hard' },
            ]}
          />
        </div>
        <div className="space-y-1.5">
          <Label>Questions</Label>
          <Segmented
            aria-label="Number of questions"
            className="flex w-full"
            value={count}
            onValueChange={setCount}
            options={['5', '10', '20', '30'].map((c) => ({ value: c, label: c }))}
          />
        </div>
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <label htmlFor="focus-weak" className="block text-sm font-medium">
              Prefer questions I missed or haven't seen
            </label>
            <p className="text-xs text-fg-muted">Turn off for a uniform sample of the topic.</p>
          </div>
          <Switch id="focus-weak" checked={focusWeak} onCheckedChange={setFocusWeak} />
        </div>
        <InlineError error={start.error} />
        <Button
          variant="primary"
          size="lg"
          className="w-full"
          disabled={selected.length === 0 || start.isPending || wait > 0}
          onClick={() => start.mutate()}
        >
          {start.isPending ? <Spinner /> : <PlayIcon />}
          {wait > 0 ? `Try again in ${wait}s` : 'Start quiz'}
        </Button>
      </div>
    </section>
  );
}

function scoreTone(score: number) {
  return score >= 0.8 ? 'text-ok-text' : score >= 0.5 ? 'text-warn-text' : 'text-bad-text';
}

function HistoryList({ topics }: { topics: QuizTopicStats[] }) {
  const attempts = useQuery({ queryKey: qk.attempts, queryFn: api.attempts });
  const title = (slug: string) => topics.find((t) => t.slug === slug)?.title ?? slug;
  const items = attempts.data ?? [];
  return (
    <Card aria-labelledby="quiz-history-heading">
      <CardHeader>
        <CardTitle id="quiz-history-heading">History</CardTitle>
        {items.length > 0 && (
          <span className="text-xs text-fg-subtle tabular">{plural(items.length, 'attempt')}</span>
        )}
      </CardHeader>
      {attempts.isPending ? (
        <div role="status" className="space-y-3 p-4" aria-busy="true" aria-label="Loading history">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      ) : attempts.isError ? (
        <ErrorState error={attempts.error} onRetry={() => attempts.refetch()} compact />
      ) : items.length === 0 ? (
        <EmptyState icon={HistoryIcon} title="No quizzes yet">
          Pick a topic above and start a quiz. Your scores and answers show up here.
        </EmptyState>
      ) : (
        <ul className="divide-y divide-border">
          {items.map((a: QuizAttemptSummary) => (
            <li key={a.id}>
              <Link
                href={`/quiz/${a.id}`}
                className="flex items-center gap-4 px-4 py-3 transition-colors hover:bg-surface-2 focus-visible:outline-offset-[-2px]"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">
                    {a.topics.map(title).join(', ')}
                  </span>
                  <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-fg-muted">
                    <Badge tone="outline">{a.mode === 'exam' ? 'Exam' : 'Practice'}</Badge>
                    <span>{plural(a.questionCount, 'question')}</span>
                    <span aria-hidden>·</span>
                    <span>{formatRelative(a.startedAt)}</span>
                  </span>
                </span>
                {a.status === 'active' ? (
                  <span className="inline-flex items-center gap-1 text-sm font-medium text-accent-text">
                    Resume <ArrowRightIcon className="size-3.5" />
                  </span>
                ) : (
                  <span className="text-right">
                    <span
                      className={cn(
                        'block text-base font-semibold tabular',
                        a.score !== null && scoreTone(a.score),
                      )}
                    >
                      {formatPercent(a.score)}
                    </span>
                    <span className="block text-2xs text-fg-subtle">score</span>
                  </span>
                )}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

export function QuizHub() {
  const topics = useQuery({ queryKey: qk.quizTopics, queryFn: api.quizTopics });
  const params = useSearchParams();
  // "Take a quiz instead" in the question bank links here with its topic preselected.
  const [selected, setSelected] = useState<string[]>(() => {
    const t = params.get('topic');
    return t ? [t] : [];
  });
  // Ignore a preselected slug that is not a topic.
  const known = topics.data;
  if (known && selected.some((s) => !known.some((t) => t.slug === s)))
    setSelected(selected.filter((s) => known.some((t) => t.slug === s)));
  const toggle = (slug: string) =>
    setSelected((s) => (s.includes(slug) ? s.filter((x) => x !== slug) : [...s, slug]));
  const totals = useMemo(() => {
    const list = topics.data ?? [];
    const answered = list.reduce((s, t) => s + t.answered, 0);
    const weighted = list.reduce((s, t) => s + (t.accuracy ?? 0) * t.answered, 0);
    return {
      answered,
      accuracy: answered ? weighted / answered : null,
      questions: list.reduce((s, t) => s + t.questionCount, 0),
    };
  }, [topics.data]);

  return (
    <div className="mx-auto max-w-6xl px-4 pt-8 pb-24 sm:px-6 lg:pb-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Quizzes</h1>
          <p className="mt-1 text-sm text-fg-muted">
            Short drills on the fundamentals interviewers like to probe.
          </p>
        </div>
        {topics.data && topics.data.length > 0 && (
          <dl className="flex gap-6 text-right">
            <div>
              <dt className="text-xs text-fg-muted">Answered</dt>
              <dd className="text-lg font-semibold tabular">{totals.answered}</dd>
            </div>
            <div>
              <dt className="text-xs text-fg-muted">Accuracy</dt>
              <dd className="text-lg font-semibold tabular">{formatPercent(totals.accuracy)}</dd>
            </div>
          </dl>
        )}
      </div>

      <div className="mt-6 grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_340px] lg:gap-x-6 lg:gap-y-8">
        <div className="min-w-0 space-y-3 lg:col-start-1 lg:row-start-1">
          {topics.data && topics.data.length > 0 && <BrowsePanel topics={topics.data} />}
          <h2 className="sr-only">Topics</h2>
          {topics.isPending ? (
            <TopicGridSkeleton />
          ) : topics.isError ? (
            <Card>
              <ErrorState error={topics.error} onRetry={() => topics.refetch()} />
            </Card>
          ) : topics.data.length === 0 ? (
            <Card>
              <EmptyState icon={ListChecksIcon} title="No quiz topics yet">
                The question bank has not been loaded on this server.
              </EmptyState>
            </Card>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              {topics.data.map((t) => (
                <TopicCard
                  key={t.slug}
                  t={t}
                  selected={selected.includes(t.slug)}
                  onToggle={() => toggle(t.slug)}
                />
              ))}
            </div>
          )}
        </div>
        <div className="lg:sticky lg:top-20 lg:col-start-2 lg:row-span-2 lg:row-start-1">
          {topics.data && topics.data.length > 0 ? (
            <SetupPanel topics={topics.data} selected={selected} onClear={() => setSelected([])} />
          ) : (
            topics.isPending && <Skeleton className="h-96 w-full rounded-lg" />
          )}
        </div>
        <div className="min-w-0 lg:col-start-1 lg:row-start-2">
          <HistoryList topics={topics.data ?? []} />
        </div>
      </div>
      {selected.length > 0 && (
        <div className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-surface/95 px-4 py-3 backdrop-blur-sm lg:hidden">
          <div className="mx-auto flex max-w-6xl items-center gap-3">
            <span className="flex-1 text-sm">
              <span className="font-medium">{plural(selected.length, 'topic')}</span> selected
            </span>
            <Button
              variant="primary"
              size="sm"
              onClick={() =>
                document
                  .getElementById('setup-heading')
                  ?.scrollIntoView({ behavior: 'smooth', block: 'start' })
              }
            >
              Set up quiz
            </Button>
          </div>
        </div>
      )}
      <p className="sr-only" aria-live="polite">
        {selected.length ? `${plural(selected.length, 'topic')} selected` : ''}
      </p>
    </div>
  );
}
