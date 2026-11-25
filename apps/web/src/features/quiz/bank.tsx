'use client';
/**
 * The question bank: every question of a topic, answerable in place (immediate feedback, answer
 * again any time). No attempt to set up, start or finish.
 *
 * The page is at one of three places: the overview (subtopics as cards), a subtopic (its question
 * list) or a question (beside its subtopic's list on a wide screen, alone on a phone).
 * URL: /quiz/topics/:slug?status=&difficulty=&type=&subtopic=|question=
 */
import type { AnswerFeedback, QuizBankItem, QuizBankQuestion, QuizResponse } from '@ipp/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  LayoutGridIcon,
  ListChecksIcon,
  ListIcon,
  PlayIcon,
  RotateCcwIcon,
  SearchXIcon,
} from 'lucide-react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Markdown } from '@/components/markdown';
import { EmptyState, ErrorState, InlineError, useRetryCountdown } from '@/components/states';
import { Button } from '@/components/ui/button';
import { Kbd } from '@/components/ui/kbd';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Spinner } from '@/components/ui/spinner';
import { AiKeyPrompt } from '@/features/ai-key/ai-key-prompt';
import { ApiRequestError, api } from '@/lib/api';
import { formatRelative, humanize, plural } from '@/lib/format';
import { qk, useAiKey } from '@/lib/queries';
import { cn } from '@/lib/utils';
import { isTyping } from './attempt';
import {
  BankToolbar,
  isPlainClick,
  ProgressBar,
  StatusIcon,
  SubtopicGrid,
  SubtopicPanel,
} from './bank-browse';
import {
  type BankFilters,
  bankHref,
  bankSearch,
  bankWithFeedback,
  DEFAULT_FILTERS,
  entryQuestion,
  filterItems,
  itemWithFeedback,
  matches,
  matchesQuery,
  neighbours,
  nextToPractise,
  normalizeQuery,
  parseFilters,
  STATUS_LABEL,
  statusCounts,
  subtopicNeighbours,
  summariseSubtopics,
} from './bank-logic';
import { type Draft, draftForKey, draftFromResponse, emptyDraft, toResponse } from './logic';
import {
  ACTION_BAR,
  AnswerInput,
  FeedbackPanel,
  PHONE_FIT,
  QuestionCode,
  QuestionHeader,
  revealOnNarrow,
} from './question';

/** What happened to a question on this page since it was opened (survives moving between questions). */
interface Local {
  draft?: Draft;
  /** feedback for an answer given on this page */
  feedback?: AnswerFeedback;
  /** "answer again": hide the previous answer and start from an empty draft */
  retry?: boolean;
}

/** From this width the list and the question sit side by side (Tailwind's `lg`). */
const SIDE_BY_SIDE = '(min-width: 1024px)';

const backLink =
  'inline-flex min-w-0 items-center gap-1 text-sm text-fg-muted hover:text-fg max-sm:min-h-10';

function OverviewSkeleton() {
  return (
    <div role="status" aria-busy="true" aria-label="Loading questions" className="mt-6">
      <Skeleton className="h-8 w-full max-w-2xl" />
      <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 9 }, (_, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: placeholders
          <Skeleton key={i} className="h-[5.5rem] w-full" />
        ))}
      </div>
    </div>
  );
}

function PaneSkeleton() {
  return (
    <div
      role="status"
      aria-busy="true"
      aria-label="Loading questions"
      className="mt-4 grid gap-6 lg:grid-cols-[340px_minmax(0,1fr)]"
    >
      <div className="space-y-2">
        <Skeleton className="h-12 w-full" />
        {Array.from({ length: 6 }, (_, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: placeholders
          <Skeleton key={i} className="h-14 w-full" />
        ))}
      </div>
      <div className="hidden space-y-3 lg:block">
        <Skeleton className="h-3 w-48" />
        <Skeleton className="h-6 w-full" />
        <Skeleton className="h-6 w-2/3" />
        <Skeleton className="mt-6 h-14 w-full" />
        <Skeleton className="h-14 w-full" />
        <Skeleton className="h-14 w-full" />
      </div>
    </div>
  );
}

export function QuestionBank({ topic }: { topic: string }) {
  const router = useRouter();
  const qc = useQueryClient();
  const params = useSearchParams();
  const filters = parseFilters(params);
  const { difficulty, type, status } = filters;
  const selected = params.get('question');
  const subtopicParam = params.get('subtopic');
  const bank = useQuery({ queryKey: qk.quizBank(topic), queryFn: () => api.quizBank(topic) });
  const topics = useQuery({ queryKey: qk.quizTopics, queryFn: api.quizTopics, staleTime: 60_000 });
  // Questions answered here stay in the filtered list until the filters change.
  const [keep, setKeep] = useState<Set<string>>(() => new Set(selected ? [selected] : []));
  const [session, setSession] = useState<Record<string, Local>>({});
  // Search is not part of the URL: it is for finding something now, not a place to link to.
  const [query, setQuery] = useState('');

  const items = bank.data?.items ?? [];
  const list = useMemo(
    () => filterItems(items, { difficulty, type, status }, keep, query),
    [items, difficulty, type, status, keep, query],
  );
  // Counts for the status filter: over the questions the other filters leave.
  const counts = useMemo(
    () =>
      statusCounts(
        items.filter(
          (i) => matches(i, { difficulty, type, status: 'all' }) && matchesQuery(i, query),
        ),
      ),
    [items, difficulty, type, query],
  );
  const overall = useMemo(() => statusCounts(items), [items]);
  const summaries = useMemo(() => summariseSubtopics(items, list), [items, list]);
  const item = selected ? items.find((i) => i.question.id === selected) : undefined;
  const nav = neighbours(list, selected);

  // Where the page is. An open question decides the subtopic; otherwise the URL may name one.
  const subtopic = item
    ? item.question.subtopic
    : !selected && subtopicParam && items.some((i) => i.question.subtopic === subtopicParam)
      ? subtopicParam
      : null;
  const view = item ? 'question' : subtopic ? 'subtopic' : 'overview';
  const inSubtopic = useMemo(
    () => (subtopic === null ? [] : items.filter((i) => i.question.subtopic === subtopic)),
    [items, subtopic],
  );
  const listed = summaries.find((s) => s.subtopic === subtopic)?.items ?? [];
  const around = subtopicNeighbours(summaries, subtopic);
  // The subtopic last looked at, so the overview can return to its card.
  const [lastOpened, setLastOpened] = useState<string | null>(null);
  if (subtopic !== null && subtopic !== lastOpened) setLastOpened(subtopic);
  // The overview counts what matches now: nothing is kept for having been answered on the way.
  if (!selected && subtopic === null && keep.size > 0) setKeep(new Set());

  /** Next's router follows history.pushState / replaceState, so useSearchParams stays in sync. */
  const navigate = useCallback(
    (
      next: { filters?: BankFilters; question?: string | null; subtopic?: string | null },
      mode: 'push' | 'replace',
    ) => {
      const search = bankSearch(
        next.filters ?? { difficulty, type, status },
        next.question === undefined ? selected : next.question,
        next.subtopic === undefined ? subtopicParam : next.subtopic,
      );
      const url = `${window.location.pathname}${search}`;
      if (mode === 'push') window.history.pushState(null, '', url);
      else window.history.replaceState(null, '', url);
    },
    [difficulty, type, status, selected, subtopicParam],
  );
  const setFilters = (patch: Partial<BankFilters>) => {
    setKeep(new Set(selected ? [selected] : []));
    navigate({ filters: { difficulty, type, status, ...patch } }, 'replace');
  };
  const search = (text: string) => {
    setQuery(text);
    if (normalizeQuery(text) === normalizeQuery(query)) return;
    // What a search finds is shown as subtopics, so searching from a question goes back to them.
    if (view !== 'overview' && normalizeQuery(text))
      navigate({ question: null, subtopic: null }, 'push');
    else setKeep(new Set(selected ? [selected] : []));
  };
  const narrowed =
    difficulty !== 'all' || type !== 'all' || status !== 'all' || normalizeQuery(query) !== '';
  const clear = narrowed
    ? () => {
        setQuery('');
        setFilters(DEFAULT_FILTERS);
      }
    : undefined;

  // The question opened from the list or by stepping: its pane takes focus when it mounts.
  const [focusId, setFocusId] = useState<string | null>(null);
  const open = (id: string, mode: 'push' | 'replace') => {
    setKeep((k) => (k.has(id) ? k : new Set([...k, id])));
    setFocusId(id);
    navigate({ question: id }, mode);
  };
  /**
   * Go to a subtopic. Beside the list there is room for a question, so a wide screen opens the
   * first one still to get right; a phone shows the list.
   */
  const enterSubtopic = (name: string) => {
    const first = entryQuestion(summaries.find((s) => s.subtopic === name)?.items ?? []);
    if (first && window.matchMedia(SIDE_BY_SIDE).matches) open(first, 'push');
    else navigate({ question: null, subtopic: name }, 'push');
  };
  const toOverview = () => navigate({ question: null, subtopic: null }, 'push');

  // A new place starts at its top: the page on a phone, the question pane (which scrolls on its
  // own) on a wide screen. The overview is left alone: it returns to the card that was opened.
  const pane = useRef<HTMLElement>(null);
  const place = `${view}:${selected ?? subtopic ?? ''}`;
  const placed = useRef<string | null>(null);
  useEffect(() => {
    const moved = placed.current !== null && placed.current !== place;
    placed.current = place;
    if (!moved || place.startsWith('overview:')) return;
    window.scrollTo({ top: 0 });
    pane.current?.scrollTo({ top: 0 });
  }, [place]);

  const onAnswered = useCallback(
    (questionId: string, response: QuizResponse, feedback: AnswerFeedback) => {
      const at = new Date().toISOString();
      setKeep((k) => new Set([...k, questionId]));
      setSession((s) => ({ ...s, [questionId]: { ...s[questionId], feedback, retry: false } }));
      qc.setQueryData(qk.quizBank(topic), (old: typeof bank.data) =>
        old ? bankWithFeedback(old, feedback, at) : old,
      );
      qc.setQueryData(qk.quizBankQuestion(questionId), (old: QuizBankQuestion | undefined) =>
        old ? { ...itemWithFeedback(old, feedback, at), response, feedback } : old,
      );
      // Answers here count toward topic stats (hub, dashboard).
      void qc.invalidateQueries({ queryKey: qk.quizTopics });
    },
    [qc, topic],
  );

  const title = bank.data?.topic.title ?? humanize(topic);
  const loaded = bank.isSuccess && items.length > 0;
  // The question could not be found: nothing to put beside a list.
  const missing = loaded && Boolean(selected) && !item;
  // Beside-the-list layout: the list and the question each scroll, the page itself does not.
  const split = bank.isPending ? Boolean(selected || subtopicParam) : loaded && view !== 'overview';
  const firstOpen = nextToPractise(list, null);

  return (
    <div
      className={cn(
        'mx-auto max-w-6xl px-4 pt-6 pb-16 sm:px-6 max-sm:pt-3',
        split && 'lg:flex lg:h-[calc(100dvh-3.25rem-1px)] lg:flex-col lg:pt-4 lg:pb-0',
        // A question's answer bar sticks to the foot of the screen below lg: no gap under it.
        view === 'question' && loaded && 'max-lg:pb-0',
        PHONE_FIT,
      )}
    >
      <div className="flex min-h-7 shrink-0 items-center gap-3">
        {loaded && view !== 'overview' ? (
          <>
            <a
              href={bankHref(topic, filters)}
              onClick={(e) => {
                if (!isPlainClick(e)) return;
                e.preventDefault();
                toOverview();
              }}
              className={cn(backLink, 'shrink-0', view === 'question' && 'hidden lg:inline-flex')}
            >
              <ArrowLeftIcon className="size-3.5" /> All subtopics
            </a>
            {view === 'question' && subtopic !== null && (
              <a
                href={bankHref(topic, filters, null, subtopic)}
                onClick={(e) => {
                  if (!isPlainClick(e)) return;
                  e.preventDefault();
                  navigate({ question: null, subtopic }, 'replace');
                }}
                className={cn(backLink, 'lg:hidden')}
              >
                <ListIcon className="size-3.5 shrink-0" />
                <span className="truncate">{subtopic}</span>
              </a>
            )}
            <h1 className="truncate border-l border-border-strong pl-3 text-sm font-medium text-fg max-lg:sr-only">
              {title}
            </h1>
          </>
        ) : (
          <Link href="/quiz" className={backLink}>
            <ArrowLeftIcon className="size-3.5" /> Quizzes
          </Link>
        )}
        <span
          className={cn(
            'ml-auto shrink-0 text-xs text-fg-subtle',
            view === 'question' && 'max-sm:hidden',
          )}
        >
          Answers are saved as you go
        </span>
      </div>

      {!split && (
        <header className="mt-4">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div className="min-w-0">
              <p className="text-2xs font-medium tracking-wider text-fg-subtle uppercase">
                Question bank
              </p>
              <h1 className="mt-1 text-xl font-semibold tracking-tight">{title}</h1>
              <p className="mt-1 max-w-xl text-sm text-fg-muted">
                Pick a subtopic and answer its questions right away. Come back to the ones you
                missed any time.
              </p>
            </div>
            <div className="flex items-center gap-2 max-sm:w-full">
              {topics.data && topics.data.length > 1 && (
                <Select
                  value={topic}
                  onValueChange={(t) =>
                    router.push(bankHref(t, { ...DEFAULT_FILTERS, type, difficulty }))
                  }
                >
                  <SelectTrigger className="max-sm:h-10 max-sm:flex-1 sm:w-48" aria-label="Topic">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {topics.data.map((t) => (
                      <SelectItem key={t.slug} value={t.slug}>
                        {t.title}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
              <Button asChild size="md" className="max-sm:h-10">
                <Link href={`/quiz?topic=${encodeURIComponent(topic)}`}>
                  <PlayIcon /> Take a quiz instead
                </Link>
              </Button>
            </div>
          </div>
          {bank.data && overall.total > 0 && (
            <div className="mt-4 max-w-xl">
              <ProgressBar counts={overall} />
              <p className="mt-1.5 text-xs text-fg-muted tabular" data-testid="bank-progress">
                {overall.correct} correct · {overall.missed} to revisit · {overall.new} not answered
                yet, of {plural(overall.total, 'question')}
              </p>
            </div>
          )}
        </header>
      )}

      {bank.isPending ? (
        split ? (
          <PaneSkeleton />
        ) : (
          <OverviewSkeleton />
        )
      ) : bank.isError ? (
        <div className="mt-6 rounded-lg border border-border bg-surface">
          <ErrorState
            error={bank.error}
            title={
              bank.error instanceof ApiRequestError && bank.error.isNotFound
                ? 'This topic does not exist'
                : undefined
            }
            onRetry={
              bank.error instanceof ApiRequestError && bank.error.isNotFound
                ? undefined
                : () => bank.refetch()
            }
          />
        </div>
      ) : items.length === 0 ? (
        <div className="mt-6 rounded-lg border border-border bg-surface">
          <EmptyState icon={ListChecksIcon} title="No questions in this topic yet">
            The question bank has not been loaded for this topic.
          </EmptyState>
        </div>
      ) : missing ? (
        <div className="mt-6 rounded-lg border border-border bg-surface">
          <EmptyState
            icon={SearchXIcon}
            title="This question is not in the bank"
            action={
              <Button size="sm" onClick={toOverview}>
                <LayoutGridIcon /> Show all subtopics
              </Button>
            }
          >
            It may have been removed or belong to another topic.
          </EmptyState>
        </div>
      ) : (
        <>
          <BankToolbar
            className={cn(
              'shrink-0',
              split ? 'mt-3' : 'mt-6',
              view === 'question' && 'hidden lg:flex',
            )}
            filters={filters}
            query={query}
            counts={counts}
            onChange={setFilters}
            onQuery={search}
            onSubmit={
              view === 'overview'
                ? () => {
                    const first = entryQuestion(list);
                    if (first && normalizeQuery(query)) open(first, 'push');
                  }
                : undefined
            }
            onClear={clear}
          />
          {view === 'overview' || subtopic === null ? (
            list.length === 0 ? (
              <div className="mt-4 rounded-lg border border-border bg-surface">
                <EmptyState
                  icon={SearchXIcon}
                  title="No questions match"
                  action={
                    clear && (
                      <Button size="sm" onClick={clear}>
                        Clear filters
                      </Button>
                    )
                  }
                >
                  {normalizeQuery(query)
                    ? 'Try other words, or clear the search and filters.'
                    : status === 'missed'
                      ? 'Nothing to revisit with these filters.'
                      : status === 'new'
                        ? 'You have answered every question that matches.'
                        : 'Try a different difficulty or question type.'}
                </EmptyState>
              </div>
            ) : (
              <>
                <div className="mt-5 mb-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
                  <p className="text-sm text-fg-muted tabular" data-testid="bank-summary">
                    {plural(summaries.length, 'subtopic')} · {plural(list.length, 'question')}
                    {narrowed && (list.length === 1 ? ' matches' : ' match')}
                  </p>
                  {firstOpen && (
                    <Button
                      variant="primary"
                      className="max-sm:h-10 max-sm:w-full"
                      onClick={() => open(firstOpen, 'push')}
                    >
                      Start with the first open question <ArrowRightIcon />
                    </Button>
                  )}
                </div>
                <SubtopicGrid
                  topic={topic}
                  filters={filters}
                  summaries={summaries}
                  narrowed={narrowed}
                  lastOpened={lastOpened}
                  onEnter={enterSubtopic}
                />
              </>
            )
          ) : (
            <div className="mt-4 grid items-start gap-6 lg:min-h-0 lg:flex-1 lg:grid-cols-[340px_minmax(0,1fr)] lg:items-stretch">
              <aside
                aria-label="Questions"
                className={cn(
                  'flex min-w-0 flex-col lg:min-h-0 lg:pb-4',
                  view === 'question' && 'hidden lg:flex',
                )}
              >
                <SubtopicPanel
                  topic={topic}
                  filters={filters}
                  subtopic={subtopic}
                  items={listed}
                  overall={statusCounts(inSubtopic)}
                  index={around.index}
                  count={summaries.length}
                  prev={around.prev?.subtopic ?? null}
                  next={around.next?.subtopic ?? null}
                  selected={selected}
                  onOpen={(id) => open(id, 'push')}
                  onSubtopic={enterSubtopic}
                  onClear={clear}
                />
              </aside>
              {/* The side padding leaves room for focus rings, which a scroll container clips. */}
              <section
                ref={pane}
                aria-label="Question"
                className={cn(
                  'min-w-0 lg:-mx-1 lg:min-h-0 lg:overflow-y-auto lg:px-1',
                  view === 'subtopic' && 'hidden lg:block',
                )}
              >
                {item ? (
                  <QuestionPane
                    key={item.question.id}
                    item={item}
                    position={nav.index}
                    total={list.length}
                    prev={nav.prev}
                    next={nav.next}
                    practise={nextToPractise(list, selected)}
                    local={session[item.question.id] ?? {}}
                    setLocal={(patch) =>
                      setSession((s) => ({
                        ...s,
                        [item.question.id]: { ...s[item.question.id], ...patch },
                      }))
                    }
                    focus={focusId === item.question.id}
                    onGo={(id) => open(id, 'replace')}
                    onAnswered={onAnswered}
                  />
                ) : (
                  <div className="rounded-lg border border-dashed border-border-strong">
                    <EmptyState
                      icon={ListChecksIcon}
                      title="Pick a question"
                      action={
                        entryQuestion(listed) && (
                          <Button
                            variant="primary"
                            onClick={() => {
                              const id = entryQuestion(listed);
                              if (id) open(id, 'push');
                            }}
                          >
                            Start this subtopic <ArrowRightIcon />
                          </Button>
                        )
                      }
                    >
                      Choose any question on the left. You get the answer and the explanation as
                      soon as you respond, and you can move on with <Kbd keys="J" /> and{' '}
                      <Kbd keys="K" />.
                    </EmptyState>
                  </div>
                )}
              </section>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function QuestionPane({
  item,
  position,
  total,
  prev,
  next,
  practise,
  local,
  setLocal,
  focus,
  onGo,
  onAnswered,
}: {
  item: QuizBankItem;
  position: number;
  total: number;
  prev: string | null;
  next: string | null;
  practise: string | null;
  local: Local;
  setLocal: (patch: Local) => void;
  focus: boolean;
  onGo: (id: string) => void;
  onAnswered: (questionId: string, response: QuizResponse, feedback: AnswerFeedback) => void;
}) {
  const q = item.question;
  const qc = useQueryClient();
  const aiKey = useAiKey();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const feedbackRef = useRef<HTMLDivElement>(null);
  const [grading, setGrading] = useState<number | null>(null);
  // Previous answer and its feedback: only exists once a response was recorded.
  const detail = useQuery({
    queryKey: qk.quizBankQuestion(q.id),
    queryFn: () => api.quizBankQuestion(q.id),
  });
  const waitingForPrior =
    item.status !== 'unanswered' && detail.isPending && !local.feedback && !local.retry;

  const prior = local.retry ? undefined : detail.data;
  const feedback = local.feedback ?? prior?.feedback ?? undefined;
  const draft =
    local.draft ?? (prior?.response ? draftFromResponse(q, prior.response) : emptyDraft(q));
  const locked = Boolean(feedback);
  const settled = Boolean(feedback && !feedback.needsSelfGrade);
  const response = toResponse(draft);

  // Warm the neighbours so stepping through feels instant.
  useEffect(() => {
    for (const id of [next, prev])
      if (id)
        void qc.prefetchQuery({
          queryKey: qk.quizBankQuestion(id),
          queryFn: () => api.quizBankQuestion(id),
          staleTime: 30_000,
        });
  }, [qc, next, prev]);

  const submit = useMutation({
    mutationFn: (r: QuizResponse) => api.answerQuestion(q.id, r),
    onSuccess: (fb, r) => {
      if (q.type === 'short') void qc.invalidateQueries({ queryKey: qk.aiKey });
      onAnswered(q.id, r, fb);
      setGrading(null);
      // On a phone the feedback lands below the choices, often off screen: bring it up.
      requestAnimationFrame(() => revealOnNarrow(feedbackRef.current));
    },
    onError: () => setGrading(null),
  });
  const wait = useRetryCountdown(submit.error);

  const go = (id: string | null) => {
    if (id) onGo(id);
  };
  // Moving between questions remounts the pane; bring focus to the question (the page has
  // already gone to its top).
  useEffect(() => {
    if (focus) headingRef.current?.focus({ preventScroll: true });
  }, [focus]);
  const setDraft = (d: Draft) => setLocal({ draft: d });
  const again = () => {
    submit.reset();
    setLocal({ retry: true, feedback: undefined, draft: emptyDraft(q) });
  };
  const forward = next ?? practise;

  const primary = () => {
    if (submit.isPending || wait > 0 || waitingForPrior) return;
    if (settled) return go(forward);
    if (locked) return; // waiting for a self-grade
    if (response) submit.mutate(response);
  };

  // Same keys as an attempt: 1-9 / A-Z choose, Enter submits or moves on, arrows and J/K step
  // through the list, R answers again.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.altKey) return;
      if (document.querySelector('[role="dialog"], [role="listbox"]')) return;
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        primary();
        return;
      }
      if (isTyping(e.target) || e.metaKey || e.ctrlKey) return;
      const target = e.target as HTMLElement | null;
      if (e.key === 'Enter') {
        if (target?.tagName === 'BUTTON' || target?.tagName === 'A') return;
        e.preventDefault();
        primary();
        return;
      }
      if (
        target?.getAttribute('role') === 'radio' &&
        target.closest('[data-radix-collection-item]') &&
        e.key.startsWith('Arrow')
      )
        return;
      if (e.key === 'ArrowRight' || e.key === 'j' || e.key === 'ArrowLeft' || e.key === 'k') {
        e.preventDefault();
        go(e.key === 'ArrowRight' || e.key === 'j' ? next : prev);
        return;
      }
      if (locked && e.key === 'r' && !submit.isPending) {
        e.preventDefault();
        again();
        return;
      }
      if (locked || waitingForPrior) return;
      const d = draftForKey(q, draft, e.key);
      if (d) {
        e.preventDefault();
        setDraft(d);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  let primaryLabel = 'Submit answer';
  if (settled) primaryLabel = next ? 'Next question' : practise ? 'Next open question' : 'All done';
  else if (locked) primaryLabel = 'Grade to continue';
  const primaryDisabled =
    submit.isPending || wait > 0 || waitingForPrior || (settled ? !forward : locked || !response);

  return (
    <article aria-labelledby={`bank-q-${q.id}`}>
      <div className="flex items-center gap-2 rounded-lg border border-border bg-surface px-3 py-2 max-sm:gap-1 max-sm:px-1.5 max-sm:py-1">
        <Button
          variant="ghost"
          size="icon-sm"
          className="max-sm:size-9"
          onClick={() => go(prev)}
          disabled={!prev}
          aria-label="Previous question"
        >
          <ChevronLeftIcon />
        </Button>
        <span className="text-sm text-fg-muted tabular" data-testid="bank-counter">
          {position >= 0 ? `Question ${position + 1} of ${total}` : 'Question'}
        </span>
        <Button
          variant="ghost"
          size="icon-sm"
          className="max-sm:size-9"
          onClick={() => go(next)}
          disabled={!next}
          aria-label="Next question"
        >
          <ChevronRightIcon />
        </Button>
        <span
          className="ml-auto inline-flex items-center gap-1.5 text-xs text-fg-muted max-sm:pr-1.5 max-sm:text-right"
          data-testid="bank-status"
        >
          <StatusIcon status={item.status} className="size-3.5" />
          {STATUS_LABEL[item.status]}
          {item.answeredAt && item.status !== 'unanswered' && (
            <span className="hidden text-fg-subtle sm:inline">
              · {formatRelative(item.answeredAt)}
            </span>
          )}
        </span>
      </div>

      <div className="mt-5">
        <QuestionHeader q={q} />
        <h2 ref={headingRef} tabIndex={-1} className="sr-only">
          {position >= 0 ? `Question ${position + 1} of ${total}` : 'Question'}
        </h2>
        <div id={`bank-q-${q.id}`} className="mt-2">
          <Markdown className="text-md text-fg">{q.prompt}</Markdown>
        </div>
        {q.code && (
          <div className="mt-4">
            <QuestionCode q={q} />
          </div>
        )}
        <div className="mt-5">
          {waitingForPrior ? (
            <div
              role="status"
              aria-busy="true"
              aria-label="Loading your answer"
              className="space-y-2"
            >
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
            </div>
          ) : detail.isError && item.status !== 'unanswered' && !local.feedback && !local.retry ? (
            <ErrorState error={detail.error} onRetry={() => detail.refetch()} compact />
          ) : (
            <AnswerInput
              q={q}
              draft={draft}
              setDraft={setDraft}
              feedback={feedback}
              locked={locked}
            />
          )}
        </div>
        {q.type === 'short' && !locked && aiKey.data && aiKey.data.state !== 'active' && (
          <AiKeyPrompt
            className="mt-3"
            size="sm"
            testId="quiz-key-prompt"
            quiet
            state={aiKey.data.state}
            title={
              aiKey.data.state === 'rejected'
                ? 'Your API key was rejected, so you will grade this answer yourself'
                : 'AI grading runs on your own API key'
            }
          >
            Without one you compare your answer with the reference and grade it yourself.
          </AiKeyPrompt>
        )}

        {feedback && (
          <div ref={feedbackRef} className="mt-5 space-y-2 max-lg:scroll-mb-24">
            {!local.feedback && item.answeredAt && (
              <p className="text-xs text-fg-muted">
                Your previous answer, {formatRelative(item.answeredAt)}.
              </p>
            )}
            <FeedbackPanel
              q={q}
              feedback={feedback}
              grading={grading}
              onSelfGrade={(g) => {
                const r = toResponse(draft);
                if (r?.type !== 'short') return;
                setGrading(g);
                submit.mutate({ ...r, selfGrade: g });
              }}
            />
          </div>
        )}

        <InlineError error={submit.error} className="mt-4" />

        {/* Beside the list the pane scrolls on its own, and the actions stay at its foot. */}
        <div
          className={cn(
            'mt-6 border-t border-border bg-bg pt-4 lg:sticky lg:bottom-0 lg:z-10 lg:-mx-1 lg:px-1 lg:pb-4',
            ACTION_BAR,
          )}
        >
          <div className="flex flex-wrap items-center gap-2">
            {locked && (
              <Button
                variant="ghost"
                size="sm"
                className="max-sm:h-10 max-sm:px-3"
                onClick={again}
                disabled={submit.isPending}
              >
                <RotateCcwIcon /> Answer again
              </Button>
            )}
            {!locked && next && (
              <Button
                variant="ghost"
                size="sm"
                className="max-sm:h-10 max-sm:px-3"
                onClick={() => go(next)}
              >
                Skip
              </Button>
            )}
            <span className="ml-auto hidden items-center gap-1.5 text-xs text-fg-subtle md:inline-flex pointer-coarse:hidden!">
              <Kbd keys="J" />/<Kbd keys="K" /> move ·{' '}
              {q.type === 'short' || (draft.type === 'output' && draft.kind === 'output') ? (
                <>
                  <Kbd keys="Mod+Enter" /> {settled ? 'next' : 'submit'}
                </>
              ) : (
                <>
                  <Kbd keys="Enter" /> {settled ? 'next' : 'submit'}
                </>
              )}
              {settled && (
                <>
                  {' '}
                  · <Kbd keys="R" /> again
                </>
              )}
            </span>
            <Button
              variant="primary"
              className="ml-auto md:ml-2 max-sm:h-10 max-sm:flex-1"
              onClick={primary}
              disabled={primaryDisabled}
              data-testid="bank-primary"
            >
              {submit.isPending && grading === null && <Spinner />}
              {wait > 0 ? `Try again in ${wait}s` : primaryLabel}
              {!submit.isPending && wait === 0 && (settled ? Boolean(forward) : true) && (
                <ArrowRightIcon />
              )}
            </Button>
          </div>
          {settled && !next && (
            <p className="mt-3 text-right text-sm text-fg-muted max-sm:mt-2 max-sm:text-center">
              {practise
                ? 'That was the last question in this list.'
                : 'Every question in this list is answered correctly.'}
            </p>
          )}
        </div>
      </div>
    </article>
  );
}
