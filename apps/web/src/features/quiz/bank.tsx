'use client';
/**
 * The question bank: a topic's whole question list, filterable, with each question answerable in
 * place (immediate feedback, answer again any time). No attempt to set up, start or finish.
 * URL: /quiz/topics/:slug?status=&difficulty=&type=&question=
 */
import type {
  AnswerFeedback,
  QuizBankItem,
  QuizBankQuestion,
  QuizQuestionStatus,
  QuizResponse,
} from '@ipp/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  CircleDashedIcon,
  ListChecksIcon,
  ListIcon,
  PlayIcon,
  RotateCcwIcon,
  SearchXIcon,
} from 'lucide-react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DifficultyBadge } from '@/components/domain';
import { Markdown } from '@/components/markdown';
import { EmptyState, ErrorState, InlineError, useRetryCountdown } from '@/components/states';
import { Button } from '@/components/ui/button';
import { Kbd } from '@/components/ui/kbd';
import { Segmented } from '@/components/ui/segmented';
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
  type BankFilters,
  bankHref,
  bankSearch,
  bankWithFeedback,
  DEFAULT_FILTERS,
  type DifficultyFilter,
  filterItems,
  groupBySubtopic,
  itemWithFeedback,
  matches,
  neighbours,
  nextToPractise,
  parseFilters,
  STATUS_LABEL,
  type StatusFilter,
  statusCounts,
  type TypeFilter,
} from './bank-logic';
import {
  type Draft,
  draftForKey,
  draftFromResponse,
  emptyDraft,
  promptSummary,
  toResponse,
} from './logic';
import {
  AnswerInput,
  FeedbackPanel,
  OUTCOME_ICON,
  OUTCOME_TEXT,
  QuestionCode,
  QuestionHeader,
} from './question';

/** What happened to a question on this page since it was opened (survives moving between questions). */
interface Local {
  draft?: Draft;
  /** feedback for an answer given on this page */
  feedback?: AnswerFeedback;
  /** "answer again": hide the previous answer and start from an empty draft */
  retry?: boolean;
}

const TYPE_SHORT: Record<Exclude<TypeFilter, 'all'>, string> = {
  single: 'Single choice',
  multiple: 'Multiple choice',
  output: 'Program output',
  short: 'Short answer',
};

function StatusIcon({ status, className }: { status: QuizQuestionStatus; className?: string }) {
  if (status === 'unanswered')
    return <CircleDashedIcon aria-hidden className={cn('size-4 text-fg-subtle', className)} />;
  const Icon = OUTCOME_ICON[status];
  return <Icon aria-hidden className={cn('size-4', OUTCOME_TEXT[status], className)} />;
}

/** Correct / missed / new as one stacked bar. */
function ProgressBar({ counts }: { counts: ReturnType<typeof statusCounts> }) {
  const pct = (n: number) => `${counts.total ? (n / counts.total) * 100 : 0}%`;
  return (
    <div className="flex h-1.5 w-full overflow-hidden rounded-full bg-surface-3" aria-hidden>
      <div className="h-full bg-ok" style={{ width: pct(counts.correct) }} />
      <div className="h-full bg-warn" style={{ width: pct(counts.missed) }} />
    </div>
  );
}

function BankSkeleton() {
  return (
    <div
      role="status"
      aria-busy="true"
      aria-label="Loading questions"
      className="mt-6 grid gap-6 lg:grid-cols-[340px_minmax(0,1fr)]"
    >
      <div className="space-y-2">
        <Skeleton className="h-7 w-full" />
        <Skeleton className="h-8 w-full" />
        {Array.from({ length: 7 }, (_, i) => (
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
  const bank = useQuery({ queryKey: qk.quizBank(topic), queryFn: () => api.quizBank(topic) });
  const topics = useQuery({ queryKey: qk.quizTopics, queryFn: api.quizTopics, staleTime: 60_000 });
  // Questions answered here stay in the filtered list until the filters change.
  const [keep, setKeep] = useState<Set<string>>(() => new Set(selected ? [selected] : []));
  const [session, setSession] = useState<Record<string, Local>>({});

  const items = bank.data?.items ?? [];
  const list = useMemo(
    () => filterItems(items, { difficulty, type, status }, keep),
    [items, difficulty, type, status, keep],
  );
  // Counts for the status filter: over the questions the other filters leave.
  const counts = useMemo(
    () => statusCounts(items.filter((i) => matches(i, { difficulty, type, status: 'all' }))),
    [items, difficulty, type],
  );
  const overall = useMemo(() => statusCounts(items), [items]);
  const item = selected ? items.find((i) => i.question.id === selected) : undefined;
  const nav = neighbours(list, selected);

  /** Next's router follows history.pushState / replaceState, so useSearchParams stays in sync. */
  const navigate = useCallback(
    (next: { filters?: BankFilters; question?: string | null }, mode: 'push' | 'replace') => {
      const search = bankSearch(
        next.filters ?? { difficulty, type, status },
        next.question === undefined ? selected : next.question,
      );
      const url = `${window.location.pathname}${search}`;
      if (mode === 'push') window.history.pushState(null, '', url);
      else window.history.replaceState(null, '', url);
    },
    [difficulty, type, status, selected],
  );
  const setFilters = (patch: Partial<BankFilters>) => {
    setKeep(new Set(selected ? [selected] : []));
    navigate({ filters: { difficulty, type, status, ...patch } }, 'replace');
  };
  // The question opened from the list or by stepping: its pane takes focus when it mounts.
  const [focusId, setFocusId] = useState<string | null>(null);
  const open = (id: string, mode: 'push' | 'replace') => {
    setKeep((k) => (k.has(id) ? k : new Set([...k, id])));
    setFocusId(id);
    navigate({ question: id }, mode);
  };

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

  const filtersActive = difficulty !== 'all' || type !== 'all' || status !== 'all';
  const title = bank.data?.topic.title ?? humanize(topic);

  return (
    <div className="mx-auto max-w-6xl px-4 pt-6 pb-16 sm:px-6">
      <div className="flex items-center gap-3">
        {selected ? (
          <>
            <Link
              href="/quiz"
              className="hidden items-center gap-1 text-sm text-fg-muted hover:text-fg lg:inline-flex"
            >
              <ArrowLeftIcon className="size-3.5" /> Quizzes
            </Link>
            <button
              type="button"
              onClick={() => navigate({ question: null }, 'replace')}
              className="inline-flex items-center gap-1 text-sm text-fg-muted hover:text-fg lg:hidden"
            >
              <ListIcon className="size-3.5" /> All {title} questions
            </button>
          </>
        ) : (
          <Link
            href="/quiz"
            className="inline-flex items-center gap-1 text-sm text-fg-muted hover:text-fg"
          >
            <ArrowLeftIcon className="size-3.5" /> Quizzes
          </Link>
        )}
        <span className="ml-auto text-xs text-fg-subtle">Answers are saved as you go</span>
      </div>

      <header className={cn('mt-4', selected && 'hidden lg:block')}>
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="min-w-0">
            <p className="text-2xs font-medium tracking-wider text-fg-subtle uppercase">
              Question bank
            </p>
            <h1 className="mt-1 text-xl font-semibold tracking-tight">{title}</h1>
            <p className="mt-1 max-w-xl text-sm text-fg-muted">
              Open any question and answer it right away. Come back to the ones you missed any time.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {topics.data && topics.data.length > 1 && (
              <Select
                value={topic}
                onValueChange={(t) =>
                  router.push(bankHref(t, { ...DEFAULT_FILTERS, type, difficulty }))
                }
              >
                <SelectTrigger className="w-48" aria-label="Topic">
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
            <Button asChild size="md">
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

      {bank.isPending ? (
        <BankSkeleton />
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
      ) : (
        <div className="mt-6 grid items-start gap-6 lg:grid-cols-[340px_minmax(0,1fr)]">
          <aside
            aria-label="Questions"
            className={cn(
              'flex min-w-0 flex-col lg:sticky lg:top-20 lg:max-h-[calc(100dvh-6rem)]',
              selected && 'hidden lg:flex',
            )}
          >
            <Filters
              filters={filters}
              counts={counts}
              onChange={setFilters}
              onClear={filtersActive ? () => setFilters(DEFAULT_FILTERS) : undefined}
            />
            <QuestionList
              list={list}
              selected={selected}
              topic={topic}
              filters={filters}
              onOpen={(id) => open(id, 'push')}
              onClear={filtersActive ? () => setFilters(DEFAULT_FILTERS) : undefined}
            />
          </aside>
          <section aria-label="Question" className={cn('min-w-0', !selected && 'hidden lg:block')}>
            {selected && item ? (
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
            ) : selected ? (
              <div className="rounded-lg border border-border bg-surface">
                <EmptyState
                  icon={SearchXIcon}
                  title="This question is not in the bank"
                  action={
                    <Button size="sm" onClick={() => navigate({ question: null }, 'replace')}>
                      <ListIcon /> Show all questions
                    </Button>
                  }
                >
                  It may have been removed or belong to another topic.
                </EmptyState>
              </div>
            ) : (
              <div className="rounded-lg border border-dashed border-border-strong">
                <EmptyState
                  icon={ListChecksIcon}
                  title="Pick a question"
                  action={
                    nextToPractise(list, null) && (
                      <Button
                        variant="primary"
                        onClick={() => {
                          const id = nextToPractise(list, null);
                          if (id) open(id, 'push');
                        }}
                      >
                        Start with the first open question <ArrowRightIcon />
                      </Button>
                    )
                  }
                >
                  Choose any question on the left. You get the answer and the explanation as soon as
                  you respond, and you can move on with <Kbd keys="J" /> and <Kbd keys="K" />.
                </EmptyState>
              </div>
            )}
          </section>
        </div>
      )}
    </div>
  );
}

function Filters({
  filters,
  counts,
  onChange,
  onClear,
}: {
  filters: BankFilters;
  counts: ReturnType<typeof statusCounts>;
  onChange: (patch: Partial<BankFilters>) => void;
  onClear?: () => void;
}) {
  return (
    <div className="space-y-2 pb-3">
      <Segmented<StatusFilter>
        aria-label="Status"
        size="sm"
        className="flex w-full"
        value={filters.status}
        onValueChange={(status) => onChange({ status })}
        options={[
          { value: 'all', label: `All ${counts.total}` },
          { value: 'new', label: `New ${counts.new}`, hint: 'Not answered yet' },
          {
            value: 'missed',
            label: `Missed ${counts.missed}`,
            hint: 'Latest answer not fully right',
          },
          { value: 'correct', label: `Right ${counts.correct}`, hint: 'Latest answer correct' },
        ]}
      />
      <div className="flex gap-2">
        <Select
          value={filters.difficulty}
          onValueChange={(v) => onChange({ difficulty: v as DifficultyFilter })}
        >
          <SelectTrigger aria-label="Difficulty" className="h-7 flex-1 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Any difficulty</SelectItem>
            <SelectItem value="easy">Easy</SelectItem>
            <SelectItem value="medium">Medium</SelectItem>
            <SelectItem value="hard">Hard</SelectItem>
          </SelectContent>
        </Select>
        <Select value={filters.type} onValueChange={(v) => onChange({ type: v as TypeFilter })}>
          <SelectTrigger aria-label="Question type" className="h-7 flex-1 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Any type</SelectItem>
            {Object.entries(TYPE_SHORT).map(([v, label]) => (
              <SelectItem key={v} value={v}>
                {label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {onClear && (
        <button
          type="button"
          onClick={onClear}
          className="text-xs text-fg-muted hover:text-fg hover:underline"
        >
          Clear filters
        </button>
      )}
    </div>
  );
}

function QuestionList({
  list,
  selected,
  topic,
  filters,
  onOpen,
  onClear,
}: {
  list: QuizBankItem[];
  selected: string | null;
  topic: string;
  filters: BankFilters;
  onOpen: (id: string) => void;
  onClear?: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const groups = useMemo(() => groupBySubtopic(list), [list]);
  // Keep the open question visible in the list as the user steps through.
  useEffect(() => {
    if (!selected) return;
    const row = ref.current?.querySelector(`[data-question-id="${CSS.escape(selected)}"]`);
    row?.scrollIntoView({ block: 'nearest' });
  }, [selected]);

  if (list.length === 0)
    return (
      <div className="rounded-lg border border-border bg-surface">
        <EmptyState
          icon={SearchXIcon}
          title="No questions match"
          action={
            onClear && (
              <Button size="sm" onClick={onClear}>
                Clear filters
              </Button>
            )
          }
        >
          {filters.status === 'missed'
            ? 'Nothing to revisit with these filters.'
            : filters.status === 'new'
              ? 'You have answered every question that matches.'
              : 'Try a different difficulty or question type.'}
        </EmptyState>
      </div>
    );

  return (
    <div
      ref={ref}
      className="min-h-0 flex-1 overflow-y-auto rounded-lg border border-border bg-surface"
      data-testid="bank-list"
    >
      {groups.map((g) => {
        const right = g.items.filter((i) => i.status === 'correct').length;
        return (
          <div key={g.subtopic}>
            <h2 className="sticky top-0 z-10 flex items-center justify-between gap-2 border-b border-border bg-surface-2/95 px-3 py-1.5 text-2xs font-medium tracking-wider text-fg-subtle uppercase backdrop-blur-sm">
              <span className="truncate">{g.subtopic}</span>
              <span className="tabular normal-case tracking-normal">
                {right}/{g.items.length}
              </span>
            </h2>
            <ul className="divide-y divide-border">
              {g.items.map((i) => {
                const q = i.question;
                const current = q.id === selected;
                return (
                  <li key={q.id}>
                    <a
                      href={bankHref(topic, filters, q.id)}
                      data-question-id={q.id}
                      aria-current={current ? 'true' : undefined}
                      onClick={(e) => {
                        if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
                        e.preventDefault();
                        onOpen(q.id);
                      }}
                      className={cn(
                        'flex items-start gap-2.5 px-3 py-2.5 text-left transition-colors hover:bg-surface-2 focus-visible:outline-offset-[-2px]',
                        current &&
                          'bg-accent-soft/40 shadow-[inset_2px_0_0_var(--accent)] hover:bg-accent-soft/50',
                      )}
                    >
                      <StatusIcon status={i.status} className="mt-0.5 shrink-0" />
                      <span className="min-w-0 flex-1">
                        <span className="line-clamp-2 text-sm text-fg">
                          {promptSummary(q.prompt, 110) || TYPE_SHORT[q.type]}
                        </span>
                        <span className="mt-1 flex items-center gap-2 text-2xs text-fg-subtle">
                          <DifficultyBadge difficulty={q.difficulty} />
                          <span>{TYPE_SHORT[q.type]}</span>
                          <span className="sr-only">. {STATUS_LABEL[i.status]}</span>
                        </span>
                      </span>
                    </a>
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
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
    },
    onError: () => setGrading(null),
  });
  const wait = useRetryCountdown(submit.error);

  const go = (id: string | null) => {
    if (id) onGo(id);
  };
  // Moving between questions remounts the pane; bring focus (and the viewport) to the question.
  useEffect(() => {
    if (focus) headingRef.current?.focus({ preventScroll: false });
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
      <div className="flex items-center gap-2 rounded-lg border border-border bg-surface px-3 py-2">
        <Button
          variant="ghost"
          size="icon-sm"
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
          onClick={() => go(next)}
          disabled={!next}
          aria-label="Next question"
        >
          <ChevronRightIcon />
        </Button>
        <span
          className="ml-auto inline-flex items-center gap-1.5 text-xs text-fg-muted"
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
          <div className="mt-5 space-y-2">
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

        <div className="mt-6 flex flex-wrap items-center gap-2 border-t border-border pt-4">
          {locked && (
            <Button variant="ghost" size="sm" onClick={again} disabled={submit.isPending}>
              <RotateCcwIcon /> Answer again
            </Button>
          )}
          {!locked && next && (
            <Button variant="ghost" size="sm" onClick={() => go(next)}>
              Skip
            </Button>
          )}
          <span className="ml-auto hidden items-center gap-1.5 text-xs text-fg-subtle md:inline-flex">
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
            className="ml-auto md:ml-2"
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
          <p className="mt-3 text-right text-sm text-fg-muted">
            {practise
              ? 'That was the last question in this list.'
              : 'Every question in this list is answered correctly.'}
          </p>
        )}
      </div>
    </article>
  );
}
