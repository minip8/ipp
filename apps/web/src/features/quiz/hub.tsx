'use client';
import type { QuizAttemptSummary, QuizTopicStats } from '@ipp/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowRightIcon,
  CheckIcon,
  HistoryIcon,
  LibraryIcon,
  ListChecksIcon,
  MessagesSquareIcon,
  PlayIcon,
} from 'lucide-react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { type RefObject, useEffect, useMemo, useRef, useState } from 'react';
import { PageTabPanel, PageTabs, usePageView } from '@/components/page-tabs';
import { EmptyState, ErrorState, InlineError, useRetryCountdown } from '@/components/states';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/input';
import { Segmented } from '@/components/ui/segmented';
import { Skeleton } from '@/components/ui/skeleton';
import { Spinner } from '@/components/ui/spinner';
import { Switch } from '@/components/ui/switch';
import { AiKeyPrompt } from '@/features/ai-key/ai-key-prompt';
import { api } from '@/lib/api';
import { formatPercent, formatRelative, plural } from '@/lib/format';
import { qk, useAiKey } from '@/lib/queries';
import { storage } from '@/lib/storage';
import { cn } from '@/lib/utils';
import { bankHref } from './bank-logic';
import {
  DISCUSSION_COUNTS,
  MODE_HINT,
  MODE_LABEL,
  parseSetup,
  QUIZ_COUNTS,
  type QuizSetup,
  questionsFor,
  SETUP_STORAGE_KEY,
} from './logic';

/** The page's two views; the first is the default and keeps `?view=` out of the URL. */
const VIEWS = ['start', 'history'] as const;

/** Phones: segmented controls at a size a finger can hit (desktop keeps the compact size). */
const TOUCH_SEGMENTS = 'max-sm:[&>*]:h-9';

/** Whether any of the element is on screen. */
function useOnScreen(ref: RefObject<HTMLElement | null>) {
  const [onScreen, setOnScreen] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver((entries) =>
      setOnScreen(Boolean(entries[entries.length - 1]?.isIntersecting)),
    );
    io.observe(el);
    return () => io.disconnect();
  }, [ref]);
  return onScreen;
}

function ProgressBar({ value }: { value: number }) {
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-3" aria-hidden>
      <div
        className="h-full rounded-full bg-accent"
        style={{ width: `${Math.round(Math.min(1, value) * 100)}%` }}
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
        <span className="mt-4 block text-xs text-fg-muted tabular">
          {t.answered} of {plural(t.questionCount, 'question')} answered
        </span>
        <span className="mt-2 block">
          <ProgressBar value={coverage} />
        </span>
      </button>
      <Link
        href={bankHref(t.slug)}
        aria-label={`Browse ${t.title} questions`}
        className="flex items-center gap-1.5 rounded-b-lg border-t border-border px-4 py-2 text-sm font-medium text-accent-text transition-colors hover:bg-surface-2 focus-visible:outline-offset-[-2px] max-sm:py-3"
      >
        <LibraryIcon className="size-3.5" />
        Browse {plural(t.questionCount, 'question')}
        <ArrowRightIcon className="ml-auto size-3.5" />
      </Link>
    </div>
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
  setup,
  update,
}: {
  topics: QuizTopicStats[];
  setup: QuizSetup;
  update: (patch: Partial<QuizSetup>) => void;
}) {
  const router = useRouter();
  const qc = useQueryClient();
  const aiKey = useAiKey();
  const { mode, difficulty, focusWeak } = setup;
  const selected = setup.topics;
  const discussion = mode === 'discussion';
  const count = discussion ? setup.discussionCount : setup.count;
  // A discussion is a conversation with the model, so it cannot start without a working key.
  const keyState = aiKey.data?.state;
  const needsKey = discussion && (keyState === 'missing' || keyState === 'rejected');
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
  const chosen = topics.filter((t) => selected.includes(t.slug));
  const available = chosen.reduce((n, t) => n + questionsFor(t, mode), 0);

  return (
    <section aria-labelledby="setup-heading" className="rounded-lg border border-border bg-surface">
      <div className="space-y-5 p-4">
        <div className="space-y-1.5">
          <h2 id="setup-heading" className="scroll-mt-20 text-sm font-medium">
            Mode
          </h2>
          <Segmented
            aria-label="Mode"
            className={cn('flex w-full', TOUCH_SEGMENTS)}
            value={mode}
            onValueChange={(m) => update({ mode: m })}
            options={(['practice', 'exam', 'discussion'] as const).map((m) => ({
              value: m,
              label: MODE_LABEL[m],
            }))}
          />
          <p className="text-xs text-fg-muted">{MODE_HINT[mode]}</p>
        </div>
        <div className="space-y-1.5">
          <Label>Difficulty</Label>
          <Segmented
            aria-label="Difficulty"
            className={cn('flex w-full', TOUCH_SEGMENTS)}
            value={difficulty}
            onValueChange={(d) => update({ difficulty: d })}
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
          {discussion ? (
            <Segmented
              aria-label="Number of questions"
              className={cn('flex w-full', TOUCH_SEGMENTS)}
              value={setup.discussionCount}
              onValueChange={(c) => update({ discussionCount: c })}
              options={DISCUSSION_COUNTS.map((c) => ({ value: c, label: c }))}
            />
          ) : (
            <Segmented
              aria-label="Number of questions"
              className={cn('flex w-full', TOUCH_SEGMENTS)}
              value={setup.count}
              onValueChange={(c) => update({ count: c })}
              options={QUIZ_COUNTS.map((c) => ({ value: c, label: c }))}
            />
          )}
        </div>
        <div className="flex items-center gap-3">
          <label htmlFor="focus-weak" className="min-w-0 flex-1 text-sm font-medium">
            Prefer questions I missed or haven&apos;t seen
          </label>
          <Switch
            id="focus-weak"
            checked={focusWeak}
            onCheckedChange={(v) => update({ focusWeak: v })}
          />
        </div>
        {needsKey && (
          <AiKeyPrompt
            size="sm"
            testId="discussion-key-prompt"
            state={keyState}
            title={
              keyState === 'rejected'
                ? 'Your API key was rejected'
                : 'A discussion runs on your own AI API key'
            }
          />
        )}
        <InlineError error={start.error} />
        <div>
          <Button
            variant="primary"
            size="lg"
            className="w-full"
            disabled={selected.length === 0 || needsKey || start.isPending || wait > 0}
            onClick={() => start.mutate()}
          >
            {start.isPending ? <Spinner /> : discussion ? <MessagesSquareIcon /> : <PlayIcon />}
            {wait > 0 ? `Try again in ${wait}s` : discussion ? 'Start discussion' : 'Start quiz'}
          </Button>
          <p className="mt-2 text-center text-xs text-fg-muted" data-testid="setup-summary">
            {selected.length === 0
              ? 'Select one or more topics first.'
              : `${chosen.map((t) => t.title).join(', ')} · ${plural(available, discussion ? 'open question' : 'question')} to draw from`}
          </p>
        </div>
      </div>
    </section>
  );
}

function scoreTone(score: number) {
  return score >= 0.8 ? 'text-ok-text' : score >= 0.5 ? 'text-warn-text' : 'text-bad-text';
}

function HistoryList({ topics }: { topics: QuizTopicStats[] }) {
  // The same query as the page's tab count, so one request.
  const attempts = useQuery({ queryKey: qk.attempts, queryFn: api.attempts });
  const title = (slug: string) => topics.find((t) => t.slug === slug)?.title ?? slug;
  const items = attempts.data ?? [];
  return (
    <Card aria-labelledby="quiz-history-heading">
      <CardHeader>
        <CardTitle id="quiz-history-heading">Past quizzes</CardTitle>
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
          Quizzes and discussions you start show up here with their scores.
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
                    <Badge tone="outline">{MODE_LABEL[a.mode]}</Badge>
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
  const [view, setView] = usePageView(VIEWS);
  const topics = useQuery({ queryKey: qk.quizTopics, queryFn: api.quizTopics });
  const attempts = useQuery({ queryKey: qk.attempts, queryFn: api.attempts });
  const params = useSearchParams();
  // The choices are remembered in this browser, so leaving the page and coming back keeps them.
  // "Take a quiz instead" in the question bank links here with its topic preselected.
  const [setup, setSetup] = useState<QuizSetup>(() => {
    const stored = parseSetup(storage.get<unknown>(SETUP_STORAGE_KEY, null));
    const t = params.get('topic');
    return t ? { ...stored, topics: [t] } : stored;
  });
  useEffect(() => storage.set(SETUP_STORAGE_KEY, setup), [setup]);
  const update = (patch: Partial<QuizSetup>) => setSetup((s) => ({ ...s, ...patch }));
  const selected = setup.topics;
  // Ignore a remembered or preselected slug that is not a topic.
  const known = topics.data;
  if (known && selected.some((s) => !known.some((t) => t.slug === s)))
    update({ topics: selected.filter((s) => known.some((t) => t.slug === s)) });
  const toggle = (slug: string) =>
    update({
      topics: selected.includes(slug) ? selected.filter((x) => x !== slug) : [...selected, slug],
    });
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
  // Phones: the bar that leads to the setup gives way once the setup itself is in view.
  const setupColumn = useRef<HTMLDivElement>(null);
  const setupOnScreen = useOnScreen(setupColumn);
  const showBar = view === 'start' && selected.length > 0 && !setupOnScreen;

  return (
    <div
      className={cn(
        'mx-auto max-w-6xl px-4 pt-8 sm:px-6 lg:pb-8',
        // Room for the bar fixed to the bottom of phones (start view only).
        view === 'start'
          ? 'pb-[calc(6rem_+_env(safe-area-inset-bottom))]'
          : 'pb-[calc(2rem_+_env(safe-area-inset-bottom))]',
      )}
    >
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
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

      <PageTabs
        className="mt-6"
        label="Quizzes"
        value={view}
        onValueChange={setView}
        tabs={[
          { value: 'start', label: 'Start a quiz' },
          { value: 'history', label: 'History', count: attempts.data?.length ?? null },
        ]}
      >
        {/* Kept mounted while hidden, like the setup on the Interviews page. */}
        <PageTabPanel value="start" keepMounted className="mt-5">
          <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
            <div className="min-w-0 space-y-3">
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
            <div ref={setupColumn} className="min-w-0 lg:sticky lg:top-20">
              {topics.data && topics.data.length > 0 ? (
                <SetupPanel topics={topics.data} setup={setup} update={update} />
              ) : (
                topics.isPending && <Skeleton className="h-96 w-full rounded-lg" />
              )}
            </div>
          </div>
        </PageTabPanel>
        <PageTabPanel value="history" className="mt-5">
          <HistoryList topics={topics.data ?? []} />
        </PageTabPanel>
      </PageTabs>
      {showBar && (
        <div className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-surface/95 px-4 pt-2 pb-[calc(0.5rem_+_env(safe-area-inset-bottom))] backdrop-blur-sm lg:hidden">
          <div className="mx-auto flex max-w-6xl items-center gap-3">
            <span className="min-w-0 flex-1 truncate text-sm">
              <span className="font-medium">{plural(selected.length, 'topic')}</span> selected
            </span>
            <Button
              variant="primary"
              size="lg"
              onClick={() =>
                document
                  .getElementById('setup-heading')
                  ?.scrollIntoView({ behavior: 'smooth', block: 'start' })
              }
            >
              Choose mode
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
