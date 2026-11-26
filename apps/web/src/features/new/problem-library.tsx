'use client';
/**
 * The problem library: the list of coding problems with its search, category tabs, difficulty,
 * topic and status filters, the solved / attempted / new marks and the show-topics toggle. One
 * component for both places it is listed: the Interviews tab's setup (features/new/new-interview)
 * and the Practice tab's Problems view (features/quiz/problems-view). The state lives in
 * `useProblemLibrary`, so a page can use what the filters leave (a random pick, a count) beside
 * the list; the pure filtering is in `logic.ts`.
 */
import {
  CATEGORY_INFO,
  PROBLEM_CATEGORIES,
  type ProblemStatus,
  type ProblemSummary,
} from '@ipp/contracts';
import { useQuery } from '@tanstack/react-query';
import { SearchIcon, XIcon } from 'lucide-react';
import { useSearchParams } from 'next/navigation';
import { type ReactNode, useDeferredValue, useEffect, useMemo, useState } from 'react';
import { DifficultyBadge, LANG_LABEL } from '@/components/domain';
import { Markdown } from '@/components/markdown';
import { EmptyState, ErrorState } from '@/components/states';
import { PROBLEM_STATUS_LABEL, ProblemStatusIcon } from '@/components/status-icon';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Segmented } from '@/components/ui/segmented';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { api } from '@/lib/api';
import { humanize } from '@/lib/format';
import { qk, useProblemProgress } from '@/lib/queries';
import { cn } from '@/lib/utils';
import {
  ALL,
  type CategoryFilter,
  categoryCounts,
  type DifficultyFilter,
  filterProblems,
  groupOptions,
  type LibraryFilters,
  loadShowTopics,
  parseCategory,
  parseDifficulty,
  progressMap,
  restrictionLabel,
  type StatusFilter,
  saveShowTopics,
  statusCounts,
  statusOf,
  subtopicOptions,
} from './logic';

const TOPICS_HINT = 'Topics can give away the intended approach, so they are hidden by default.';

/** Phones: segmented controls at a size a finger can hit (desktop keeps the compact size). */
const TOUCH_SEGMENTS = 'max-sm:[&>*]:h-9';

const CATEGORY_TABS: { value: CategoryFilter; label: string; description: string }[] = [
  { value: ALL, label: 'All', description: 'Every problem in the library, of all three kinds.' },
  ...PROBLEM_CATEGORIES.map((c) => ({
    value: c,
    label: CATEGORY_INFO[c].short,
    description: CATEGORY_INFO[c].description,
  })),
];

/**
 * The library and its filters. The category and difficulty start from the URL (`?category=`,
 * `?difficulty=`), as links into either page set them; the rest starts empty, and whether topics
 * are shown is remembered in this browser.
 */
export function useProblemLibrary() {
  const params = useSearchParams();
  const [query, setQuery] = useState('');
  const deferredQuery = useDeferredValue(query);
  const [category, setCategory] = useState<CategoryFilter>(() =>
    parseCategory(params.get('category')),
  );
  const [difficulty, setDifficulty] = useState<DifficultyFilter>(() =>
    parseDifficulty(params.get('difficulty')),
  );
  const [group, setGroup] = useState<string>(ALL);
  const [subtopic, setSubtopic] = useState<string>(ALL);
  const [status, setStatus] = useState<StatusFilter>(ALL);
  const [showTopics, setShowTopics] = useState(false);
  useEffect(() => setShowTopics(loadShowTopics()), []);

  // Load the whole library once and filter locally: it is small and filtering feels instant.
  const problems = useQuery({ queryKey: qk.problems({}), queryFn: () => api.problems() });
  const library = useMemo(() => problems.data ?? [], [problems.data]);
  // The user's own solved and attempted problems: marks and a filter once they are here.
  const progressQuery = useProblemProgress();
  const known = progressQuery.data !== undefined;
  const progress = useMemo(() => progressMap(progressQuery.data), [progressQuery.data]);
  const filters = useMemo<LibraryFilters>(
    () => ({ query: deferredQuery, category, difficulty, group, subtopic, showTopics, status }),
    [deferredQuery, category, difficulty, group, subtopic, showTopics, status],
  );
  const filtered = useMemo(
    () => filterProblems(library, filters, progress),
    [library, filters, progress],
  );
  const counts = useMemo(
    () => categoryCounts(library, filters, progress),
    [library, filters, progress],
  );
  const byStatus = useMemo(
    () => statusCounts(library, filters, progress),
    [library, filters, progress],
  );
  const groups = useMemo(() => groupOptions(library), [library]);
  const subtopics = useMemo(() => subtopicOptions(library, group), [library, group]);

  const filtersActive =
    query !== '' ||
    category !== ALL ||
    difficulty !== ALL ||
    group !== ALL ||
    subtopic !== ALL ||
    status !== ALL;
  const clearFilters = () => {
    setQuery('');
    setCategory(ALL);
    setDifficulty(ALL);
    setGroup(ALL);
    setSubtopic(ALL);
    setStatus(ALL);
  };
  const toggleTopics = (on: boolean) => {
    setShowTopics(on);
    saveShowTopics(on);
  };
  /** The user's standing on a problem, or null while it is not known. */
  const statusFor = (slug: string): ProblemStatus | null =>
    known ? statusOf(progress, slug) : null;

  return {
    problems,
    library,
    filtered,
    counts,
    byStatus,
    groups,
    subtopics,
    known,
    statusFor,
    filtersActive,
    clearFilters,
    toggleTopics,
    query,
    setQuery,
    category,
    setCategory,
    difficulty,
    setDifficulty,
    group,
    setGroup,
    subtopic,
    setSubtopic,
    status,
    setStatus,
    showTopics,
  };
}

export type ProblemLibraryState = ReturnType<typeof useProblemLibrary>;

function ProblemRow({
  p,
  status,
  selected,
  onSelect,
  showCategory,
  showTopics,
}: {
  p: ProblemSummary;
  /** null while the user's progress is unknown (loading, or it could not be loaded) */
  status: ProblemStatus | null;
  selected: boolean;
  onSelect: () => void;
  showCategory: boolean;
  showTopics: boolean;
}) {
  // Topics hint at the approach, so they stay hidden unless the user asks for them.
  const details = [
    ...(showCategory ? [CATEGORY_INFO[p.category].short] : []),
    ...(showTopics ? p.tags.map(humanize) : []),
  ];
  return (
    <li>
      <button
        type="button"
        onClick={onSelect}
        aria-pressed={selected}
        className={cn(
          'flex w-full items-center gap-3 border-l-2 px-4 py-2.5 text-left transition-colors focus-visible:outline-offset-[-2px] max-sm:py-3',
          selected
            ? 'border-l-accent bg-accent-soft/50'
            : 'border-l-transparent hover:bg-surface-2',
        )}
      >
        {status && <ProblemStatusIcon status={status} className="shrink-0" />}
        <span className="min-w-0 flex-1">
          <span className="block truncate font-medium">{p.title}</span>
          {status && <span className="sr-only">. {PROBLEM_STATUS_LABEL[status]}.</span>}
          {details.length > 0 && (
            <span className="mt-0.5 block truncate text-xs text-fg-muted">
              {details.join(' · ')}
            </span>
          )}
        </span>
        <RestrictionBadge p={p} />
        <DifficultyBadge difficulty={p.difficulty} />
      </button>
    </li>
  );
}

/** "Solved" or "Attempted" beside the chosen problem; nothing for one never tried. */
export function StatusNote({ status }: { status: ProblemStatus | null }) {
  if (!status || status === 'new') return null;
  return (
    <span
      data-testid="selected-problem-status"
      className={cn(
        'inline-flex items-center gap-1 text-xs font-medium whitespace-nowrap',
        status === 'solved' ? 'text-ok-text' : 'text-warn-text',
      )}
    >
      <ProblemStatusIcon status={status} className="size-3.5" />
      {status === 'solved' ? 'Solved' : 'Attempted'}
    </span>
  );
}

/** "C++ only" on problems that cannot be solved in every language; nothing otherwise. */
export function RestrictionBadge({ p }: { p: ProblemSummary }) {
  const label = restrictionLabel(p);
  if (!label) return null;
  return (
    <span
      data-testid="language-restriction"
      title={`This problem can only be solved in ${p.languages.map((l) => LANG_LABEL[l]).join(' or ')}`}
      className="inline-flex h-5 shrink-0 items-center rounded-[4px] border border-border px-1.5 text-2xs font-medium whitespace-nowrap text-fg-muted"
    >
      {label}
    </span>
  );
}

/** The start of a problem's statement, faded out at the bottom. */
export function ProblemPreview({ slug, unavailable }: { slug: string; unavailable: string }) {
  const q = useQuery({ queryKey: qk.problem(slug), queryFn: () => api.problem(slug) });
  if (q.isPending)
    return (
      <div className="space-y-2">
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-5/6" />
        <Skeleton className="h-4 w-2/3" />
      </div>
    );
  if (q.isError) return <p className="text-sm text-fg-muted">{unavailable}</p>;
  return (
    <div className="relative max-h-56 overflow-hidden">
      <Markdown className="text-sm">{q.data.statement}</Markdown>
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-surface to-transparent" />
    </div>
  );
}

/**
 * The library list with its filters. `leading` goes above the problems, inside the list (the
 * interview setup's random pick). Selecting a row calls `onSelect`; what that does is the page's.
 */
export function ProblemLibrary({
  lib,
  selected,
  onSelect,
  leading,
  className,
}: {
  lib: ProblemLibraryState;
  selected: string | null;
  onSelect: (slug: string) => void;
  leading?: ReactNode;
  className?: string;
}) {
  const { problems, filtered, counts, byStatus, groups, subtopics } = lib;
  const tab = CATEGORY_TABS.find((t) => t.value === lib.category) ?? CATEGORY_TABS[0];
  return (
    <section
      aria-labelledby="library-heading"
      className={cn('min-w-0 rounded-lg border border-border bg-surface', className)}
    >
      <h2 id="library-heading" className="sr-only">
        Problem library
      </h2>
      <Tabs value={lib.category} onValueChange={(v) => lib.setCategory(v as CategoryFilter)}>
        {/* Scrolls sideways on narrow phones rather than wrapping; the underline stays inside. */}
        <TabsList
          aria-label="Category"
          className="h-10 overflow-x-auto overflow-y-hidden border-b border-border px-1 sm:px-2"
        >
          {CATEGORY_TABS.map((t) => (
            <TabsTrigger key={t.value} value={t.value} className="shrink-0 after:bottom-0">
              {t.label}
              {problems.data && (
                <span className="hidden text-2xs font-normal text-fg-subtle tabular sm:inline">
                  {counts[t.value]}
                </span>
              )}
            </TabsTrigger>
          ))}
        </TabsList>
        <div className="space-y-2.5 border-b border-border p-3">
          <p className="px-0.5 text-xs text-fg-muted">{tab?.description}</p>
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-48 flex-1 max-sm:min-w-full">
              <SearchIcon
                className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-fg-subtle"
                aria-hidden
              />
              <Input
                type="search"
                placeholder={lib.showTopics ? 'Search problems or topics' : 'Search problems'}
                aria-label="Search problems"
                value={lib.query}
                onChange={(e) => lib.setQuery(e.target.value)}
                // 16px on phones and tablets, or iOS zooms in on focus.
                className="h-8 pl-8 max-lg:text-md max-sm:h-10"
              />
            </div>
            <Segmented
              aria-label="Difficulty"
              className={cn('max-sm:flex max-sm:w-full', TOUCH_SEGMENTS)}
              value={lib.difficulty}
              onValueChange={lib.setDifficulty}
              options={[
                { value: 'all', label: 'All' },
                { value: 'easy', label: 'Easy' },
                { value: 'medium', label: 'Medium' },
                { value: 'hard', label: 'Hard' },
              ]}
            />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Select
              value={lib.group}
              onValueChange={(g) => {
                lib.setGroup(g);
                lib.setSubtopic(ALL);
              }}
            >
              <SelectTrigger className="w-auto min-w-36 max-w-full max-sm:h-10" aria-label="Topic">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All topics</SelectItem>
                {groups.map((g) => (
                  <SelectItem key={g.slug} value={g.slug}>
                    {g.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {lib.group !== ALL && subtopics.length > 0 && (
              <Select value={lib.subtopic} onValueChange={lib.setSubtopic}>
                <SelectTrigger
                  className="w-auto min-w-36 max-w-full max-sm:h-10"
                  aria-label="Subtopic"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>All subtopics</SelectItem>
                  {subtopics.map((t) => (
                    <SelectItem key={t.tag} value={t.tag}>
                      {t.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            {lib.known && (
              <Segmented<StatusFilter>
                aria-label="Status"
                className={cn('max-sm:flex max-sm:w-full', TOUCH_SEGMENTS)}
                value={lib.status}
                onValueChange={lib.setStatus}
                options={[
                  { value: 'all', label: `All ${byStatus.all}` },
                  { value: 'new', label: `New ${byStatus.new}`, hint: 'Not attempted yet' },
                  {
                    value: 'attempted',
                    label: `Attempted ${byStatus.attempted}`,
                    hint: 'Started or run, not solved yet',
                  },
                  {
                    value: 'solved',
                    label: `Solved ${byStatus.solved}`,
                    hint: 'An accepted submission in one of your interviews',
                  },
                ]}
              />
            )}
            <div className="ml-auto flex items-center gap-2 max-sm:min-h-10" title={TOPICS_HINT}>
              <Switch
                id="show-topics"
                checked={lib.showTopics}
                onCheckedChange={lib.toggleTopics}
                aria-describedby="show-topics-hint"
              />
              <label
                htmlFor="show-topics"
                className="text-sm text-fg-muted select-none max-sm:py-2.5"
              >
                Show topics
              </label>
              <span id="show-topics-hint" className="sr-only">
                {TOPICS_HINT}
              </span>
            </div>
          </div>
        </div>

        <TabsContent value={lib.category}>
          <ul className="divide-y divide-border">
            {leading}
            {problems.isPending &&
              Array.from({ length: 6 }, (_, i) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: placeholders
                <li key={i} className="flex items-center gap-3 px-4 py-3">
                  <div className="flex-1 space-y-1.5">
                    <Skeleton className="h-4 w-1/2" />
                    <Skeleton className="h-3 w-1/3" />
                  </div>
                  <Skeleton className="h-5 w-12" />
                </li>
              ))}
            {problems.data?.length === 0 && (
              <li>
                <EmptyState title="The library is empty">
                  No problems have been loaded on this server yet.
                </EmptyState>
              </li>
            )}
            {filtered.map((p) => (
              <ProblemRow
                key={p.slug}
                p={p}
                status={lib.statusFor(p.slug)}
                selected={selected === p.slug}
                onSelect={() => onSelect(p.slug)}
                showCategory={lib.category === ALL}
                showTopics={lib.showTopics}
              />
            ))}
            {problems.data && problems.data.length > 0 && filtered.length === 0 && (
              <li>
                <EmptyState
                  icon={SearchIcon}
                  title="No problems match these filters"
                  action={
                    lib.filtersActive && (
                      <Button size="sm" onClick={lib.clearFilters}>
                        <XIcon /> Clear filters
                      </Button>
                    )
                  }
                >
                  Try a different search, category or topic.
                </EmptyState>
              </li>
            )}
          </ul>
        </TabsContent>
      </Tabs>
      {problems.isError && (
        <ErrorState error={problems.error} onRetry={() => problems.refetch()} compact />
      )}
    </section>
  );
}
