'use client';
/**
 * Finding a question in the bank: the filter bar, the overview of subtopics, and one subtopic's
 * question list (shown beside the open question).
 */
import type { QuizBankItem, QuizQuestionStatus } from '@ipp/contracts';
import {
  ArrowRightIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  CircleCheckIcon,
  CircleDashedIcon,
  SearchIcon,
  SearchXIcon,
  XIcon,
} from 'lucide-react';
import type * as React from 'react';
import { useEffect, useRef } from 'react';
import { DifficultyBadge } from '@/components/domain';
import { EmptyState } from '@/components/states';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Kbd } from '@/components/ui/kbd';
import { Segmented } from '@/components/ui/segmented';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Tooltip } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { isTyping } from './attempt';
import {
  type BankFilters,
  bankHref,
  type DifficultyFilter,
  STATUS_LABEL,
  type StatusCounts,
  type StatusFilter,
  type SubtopicSummary,
  type TypeFilter,
} from './bank-logic';
import { promptSummary } from './logic';
import { OUTCOME_ICON, OUTCOME_TEXT } from './question';

export const TYPE_SHORT: Record<Exclude<TypeFilter, 'all'>, string> = {
  single: 'Single choice',
  multiple: 'Multiple choice',
  output: 'Program output',
  short: 'Open question',
};

/** A plain left click: anything else (new tab, new window) is left to the browser. */
export function isPlainClick(e: React.MouseEvent) {
  return !(e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0);
}

export function StatusIcon({
  status,
  className,
}: {
  status: QuizQuestionStatus;
  className?: string;
}) {
  if (status === 'unanswered')
    return <CircleDashedIcon aria-hidden className={cn('size-4 text-fg-subtle', className)} />;
  const Icon = OUTCOME_ICON[status];
  return <Icon aria-hidden className={cn('size-4', OUTCOME_TEXT[status], className)} />;
}

/** Correct / missed / new as one stacked bar. */
export function ProgressBar({ counts }: { counts: StatusCounts }) {
  const pct = (n: number) => `${counts.total ? (n / counts.total) * 100 : 0}%`;
  return (
    <div className="flex h-1.5 w-full overflow-hidden rounded-full bg-surface-3" aria-hidden>
      <div className="h-full bg-ok" style={{ width: pct(counts.correct) }} />
      <div className="h-full bg-warn" style={{ width: pct(counts.missed) }} />
    </div>
  );
}

/** Search and filters. They decide which questions are listed and the order Next walks them in. */
export function BankToolbar({
  filters,
  query,
  counts,
  onChange,
  onQuery,
  onSubmit,
  onClear,
  className,
}: {
  filters: BankFilters;
  query: string;
  /** per status, over the questions the other filters and the search leave */
  counts: StatusCounts;
  onChange: (patch: Partial<BankFilters>) => void;
  onQuery: (text: string) => void;
  /** Enter in the search box */
  onSubmit?: () => void;
  onClear?: () => void;
  className?: string;
}) {
  const input = useRef<HTMLInputElement>(null);
  // "/" jumps to the search box, as on most sites with one.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== '/' || e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return;
      if (isTyping(e.target) || document.querySelector('[role="dialog"], [role="listbox"]')) return;
      // Hidden while a question is open on a phone.
      if (!input.current?.offsetParent) return;
      e.preventDefault();
      input.current.focus();
      input.current.select();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className={cn('flex flex-wrap items-center gap-2', className)}>
      <div className="relative min-w-0 flex-1 basis-56 lg:max-w-xs">
        <SearchIcon
          aria-hidden
          className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-fg-subtle"
        />
        <Input
          ref={input}
          type="search"
          value={query}
          onChange={(e) => onQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              onSubmit?.();
            } else if (e.key === 'Escape' && query) {
              e.preventDefault();
              onQuery('');
            }
          }}
          aria-label="Search questions"
          placeholder="Search subtopics and questions"
          autoComplete="off"
          spellCheck={false}
          className="h-8 pr-8 pl-8 text-sm [&::-webkit-search-cancel-button]:hidden"
        />
        {query ? (
          <button
            type="button"
            aria-label="Clear search"
            onClick={() => {
              onQuery('');
              input.current?.focus();
            }}
            className="absolute top-1/2 right-1.5 flex size-5 -translate-y-1/2 items-center justify-center rounded text-fg-subtle hover:bg-surface-3 hover:text-fg"
          >
            <XIcon className="size-3.5" />
          </button>
        ) : (
          <Kbd
            keys="/"
            aria-hidden
            className="pointer-events-none absolute top-1/2 right-2 hidden -translate-y-1/2 lg:inline-flex"
          />
        )}
      </div>
      <Segmented<StatusFilter>
        aria-label="Status"
        className="max-sm:flex max-sm:w-full"
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
      <div className="flex gap-2 max-sm:w-full">
        <Select
          value={filters.difficulty}
          onValueChange={(v) => onChange({ difficulty: v as DifficultyFilter })}
        >
          <SelectTrigger aria-label="Difficulty" className="max-sm:flex-1 sm:w-36">
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
          <SelectTrigger aria-label="Question type" className="max-sm:flex-1 sm:w-40">
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
        <Button variant="ghost" size="sm" onClick={onClear}>
          <XIcon /> Clear filters
        </Button>
      )}
    </div>
  );
}

/** The overview: every subtopic as a card, with how far along it is. */
export function SubtopicGrid({
  topic,
  filters,
  summaries,
  narrowed,
  lastOpened,
  onEnter,
}: {
  topic: string;
  filters: BankFilters;
  summaries: SubtopicSummary[];
  /** a filter or a search is on, so a card may hold fewer questions than its subtopic */
  narrowed: boolean;
  /** the subtopic the user just came back from: scrolled to and marked */
  lastOpened: string | null;
  onEnter: (subtopic: string) => void;
}) {
  const ref = useRef<HTMLUListElement>(null);
  // Coming back from a subtopic lands on its card, not at the top of a long page. Not while the
  // user is typing a search, which is what brought the overview up.
  // biome-ignore lint/correctness/useExhaustiveDependencies: only when the overview appears
  useEffect(() => {
    if (!lastOpened || isTyping(document.activeElement)) return;
    const card = ref.current?.querySelector<HTMLElement>(
      `[data-subtopic="${CSS.escape(lastOpened)}"]`,
    );
    card?.scrollIntoView({ block: 'center' });
    card?.focus({ preventScroll: true });
  }, []);

  return (
    <ul ref={ref} data-testid="bank-subtopics" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {summaries.map((s) => {
        const { overall } = s;
        const done = overall.correct === overall.total;
        return (
          <li key={s.subtopic}>
            <a
              href={bankHref(topic, filters, null, s.subtopic)}
              data-subtopic={s.subtopic}
              onClick={(e) => {
                if (!isPlainClick(e)) return;
                e.preventDefault();
                onEnter(s.subtopic);
              }}
              className={cn(
                'group flex h-full flex-col rounded-lg border bg-surface px-4 pt-3 pb-3.5 transition-colors hover:border-border-strong hover:bg-surface-2',
                s.subtopic === lastOpened ? 'border-accent/60' : 'border-border',
              )}
            >
              <span className="flex items-start gap-3">
                <span className="min-w-0 flex-1 text-sm font-medium text-fg">{s.subtopic}</span>
                <span
                  aria-hidden
                  className={cn(
                    'mt-px inline-flex items-center gap-1 text-xs tabular',
                    done ? 'font-medium text-ok-text' : 'text-fg-muted',
                  )}
                >
                  {done && <CircleCheckIcon className="size-3.5" />}
                  {overall.correct}/{overall.total}
                </span>
                <span className="sr-only">
                  {overall.correct} of {overall.total} correct
                  {narrowed && '.'}
                </span>
              </span>
              <span className="mt-auto block pt-3">
                <ProgressBar counts={overall} />
              </span>
              {narrowed && (
                <span className="mt-2 block text-xs text-fg-muted">
                  {s.items.length} of {overall.total} {s.items.length === 1 ? 'matches' : 'match'}
                </span>
              )}
            </a>
          </li>
        );
      })}
    </ul>
  );
}

/** One subtopic's questions: the list beside the open question. */
export function SubtopicPanel({
  topic,
  filters,
  subtopic,
  items,
  overall,
  index,
  count,
  prev,
  next,
  selected,
  onOpen,
  onSubtopic,
  onClear,
}: {
  topic: string;
  filters: BankFilters;
  subtopic: string;
  /** the subtopic's questions that the filters and the search leave */
  items: QuizBankItem[];
  /** progress over every question of the subtopic */
  overall: StatusCounts;
  /** position among the listed subtopics (-1 when the filters leave none of its questions) */
  index: number;
  count: number;
  prev: string | null;
  next: string | null;
  selected: string | null;
  onOpen: (id: string) => void;
  onSubtopic: (subtopic: string) => void;
  onClear?: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  // Keep the open question visible in the list as the user steps through.
  useEffect(() => {
    if (!selected) return;
    const row = ref.current?.querySelector(`[data-question-id="${CSS.escape(selected)}"]`);
    row?.scrollIntoView({ block: 'nearest' });
  }, [selected]);
  const done = overall.total > 0 && overall.correct === overall.total;

  return (
    <>
      <div className="shrink-0 pb-3">
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <p className="text-2xs font-medium tracking-wider text-fg-subtle uppercase">
              {index >= 0 ? `Subtopic ${index + 1} of ${count}` : 'Subtopic'}
            </p>
            <h2 className="mt-0.5 text-base font-semibold tracking-tight text-fg">{subtopic}</h2>
          </div>
          <div className="flex shrink-0 gap-1">
            <Tooltip label={prev ? `Previous: ${prev}` : 'First subtopic'}>
              <Button
                variant="secondary"
                size="icon-sm"
                aria-label={prev ? `Previous subtopic: ${prev}` : 'Previous subtopic'}
                aria-disabled={!prev}
                className={cn(!prev && 'opacity-50')}
                onClick={() => prev && onSubtopic(prev)}
              >
                <ChevronLeftIcon />
              </Button>
            </Tooltip>
            <Tooltip label={next ? `Next: ${next}` : 'Last subtopic'}>
              <Button
                variant="secondary"
                size="icon-sm"
                aria-label={next ? `Next subtopic: ${next}` : 'Next subtopic'}
                aria-disabled={!next}
                className={cn(!next && 'opacity-50')}
                onClick={() => next && onSubtopic(next)}
              >
                <ChevronRightIcon />
              </Button>
            </Tooltip>
          </div>
        </div>
        <div className="mt-3">
          <ProgressBar counts={overall} />
        </div>
        <p className="mt-1.5 text-xs text-fg-muted tabular" data-testid="bank-subtopic-progress">
          <span className={cn(done && 'font-medium text-ok-text')}>
            {overall.correct} of {overall.total} correct
          </span>
          {overall.missed > 0 && ` · ${overall.missed} to revisit`}
          {items.length !== overall.total && ` · showing ${items.length}`}
        </p>
      </div>

      {items.length === 0 ? (
        <div className="rounded-lg border border-border bg-surface">
          <EmptyState
            icon={SearchXIcon}
            title="No questions match here"
            action={
              onClear && (
                <Button size="sm" onClick={onClear}>
                  Clear filters
                </Button>
              )
            }
          >
            Nothing in this subtopic fits the search and filters.
          </EmptyState>
        </div>
      ) : (
        <div ref={ref} className="min-h-0 space-y-2 lg:overflow-y-auto" data-testid="bank-list">
          <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-surface">
            {items.map((i) => {
              const q = i.question;
              const current = q.id === selected;
              return (
                <li key={q.id}>
                  <a
                    href={bankHref(topic, filters, q.id)}
                    data-question-id={q.id}
                    aria-current={current ? 'true' : undefined}
                    onClick={(e) => {
                      if (!isPlainClick(e)) return;
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
          {next && (
            <button
              type="button"
              onClick={() => onSubtopic(next)}
              className="group flex w-full items-center gap-2 rounded-lg border border-dashed border-border-strong px-3 py-2 text-left text-sm text-fg-muted transition-colors hover:border-solid hover:bg-surface-2 hover:text-fg focus-visible:outline-offset-[-2px]"
            >
              <span className="min-w-0 flex-1">
                <span className="block text-2xs tracking-wider text-fg-subtle uppercase">
                  Next subtopic
                </span>
                <span className="block truncate">{next}</span>
              </span>
              <ArrowRightIcon aria-hidden className="size-4 shrink-0 text-fg-subtle" />
            </button>
          )}
        </div>
      )}
    </>
  );
}
