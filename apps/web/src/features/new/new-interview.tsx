'use client';
import {
  CATEGORY_INFO,
  type InterviewerSettings,
  LANGUAGES,
  type Language,
  PROBLEM_CATEGORIES,
  type ProblemStatus,
  type ProblemSummary,
} from '@ipp/contracts';
import { useMutation, useQuery } from '@tanstack/react-query';
import {
  BotIcon,
  BotOffIcon,
  CheckIcon,
  SearchIcon,
  ShuffleIcon,
  UsersIcon,
  XIcon,
} from 'lucide-react';
import dynamic from 'next/dynamic';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  type RefObject,
  useDeferredValue,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from 'react';
import { CategoryBadge, DifficultyBadge, LANG_LABEL } from '@/components/domain';
import { Markdown } from '@/components/markdown';
import { EmptyState, ErrorState, InlineError } from '@/components/states';
import { PROBLEM_STATUS_LABEL, ProblemStatusIcon } from '@/components/status-icon';
import { Button } from '@/components/ui/button';
import { Input, Label } from '@/components/ui/input';
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
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { AiKeyDialog } from '@/features/ai-key/ai-key-dialog';
import { AiKeyPrompt } from '@/features/ai-key/ai-key-prompt';
import { rejectedTitle } from '@/features/ai-key/logic';
import { api } from '@/lib/api';
import { humanize } from '@/lib/format';
import { loadStartPrefs, type StartPrefs, saveStartPrefs } from '@/lib/prefs';
import { qk, useAiKey, useProblemProgress } from '@/lib/queries';
import { cn } from '@/lib/utils';
import { InterviewerOptions, useSpeechSupported } from './interviewer-options';
import {
  ALL,
  type CategoryFilter,
  categoryCounts,
  type DifficultyFilter,
  effectiveLanguage,
  filterProblems,
  groupOptions,
  type LibraryFilters,
  languageNote,
  loadShowTopics,
  NO_FILTERS,
  parseCategory,
  parseDifficulty,
  pickRandom,
  progressMap,
  randomPool,
  restrictionLabel,
  type StatusFilter,
  saveShowTopics,
  statusCounts,
  statusOf,
  subtopicOptions,
} from './logic';

/**
 * Setting up a quant room: its own component and chunk (it typesets math, so KaTeX loads with it
 * and never with the coding setup).
 */
const QuantRoomSetup = dynamic(
  () => import('@/features/quant-room/setup').then((m) => m.QuantRoomSetup),
  { ssr: false, loading: () => <Skeleton className="h-[560px] w-full" /> },
);

const TOPICS_HINT = 'Topics can give away the intended approach, so they are hidden by default.';

const CATEGORY_TABS: { value: CategoryFilter; label: string; description: string }[] = [
  { value: ALL, label: 'All', description: 'Every problem in the library, of all three kinds.' },
  ...PROBLEM_CATEGORIES.map((c) => ({
    value: c,
    label: CATEGORY_INFO[c].short,
    description: CATEGORY_INFO[c].description,
  })),
];

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
function StatusNote({ status }: { status: ProblemStatus | null }) {
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
function RestrictionBadge({ p }: { p: ProblemSummary }) {
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

function ProblemPreview({ slug }: { slug: string }) {
  const q = useQuery({ queryKey: qk.problem(slug), queryFn: () => api.problem(slug) });
  if (q.isPending)
    return (
      <div className="space-y-2">
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-5/6" />
        <Skeleton className="h-4 w-2/3" />
      </div>
    );
  if (q.isError)
    return (
      <p className="text-sm text-fg-muted">
        The statement could not be loaded. You can still start the interview.
      </p>
    );
  return (
    <div className="relative max-h-56 overflow-hidden">
      <Markdown className="text-sm">{q.data.statement}</Markdown>
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-surface to-transparent" />
    </div>
  );
}

/** `inLanguage`: set when some matching problems are left out for not offering that language. */
function randomHint(
  matching: number | null,
  filtersActive: boolean,
  inLanguage: Language | null = null,
): string {
  const lang = inLanguage ? ` in ${LANG_LABEL[inLanguage]}` : '';
  if (matching === 0)
    return inLanguage
      ? `No problems that match your filters can be solved${lang}.`
      : 'No problems match your filters.';
  const which =
    matching === null
      ? 'One of the problems that match your filters.'
      : matching === 1
        ? `The only problem${lang} that matches your filters.`
        : filtersActive || inLanguage
          ? `One of the ${matching} problems${lang} that match your filters.`
          : `One of all ${matching} problems in the library.`;
  return `${which} You see it before you start.`;
}

const DURATIONS = [30, 45, 60, 90] as const;
const NO_LIMIT = 'none';

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

/**
 * Keeps a sticky side panel no taller than the room between its top edge and the bottom of the
 * window. CSS alone cannot: before the panel sticks it starts lower on the page (under the page
 * title), so a fixed `100dvh - offset` either overflows at the top of the page or wastes space
 * once stuck. Only on the two-column layout; on phones the panel is in the page flow.
 */
function useFitBelow(ref: RefObject<HTMLElement | null>, gap = 16) {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const twoColumns = window.matchMedia('(min-width: 1024px)');
    let frame = 0;
    const measure = () => {
      frame = 0;
      el.style.maxHeight = twoColumns.matches
        ? `${Math.max(240, window.innerHeight - el.getBoundingClientRect().top - gap)}px`
        : '';
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(measure);
    };
    measure();
    // Content above the panel can arrive later (interviews in progress) and push it down.
    const layout = new ResizeObserver(schedule);
    layout.observe(document.body);
    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule);
    twoColumns.addEventListener('change', schedule);
    return () => {
      cancelAnimationFrame(frame);
      layout.disconnect();
      window.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
      twoColumns.removeEventListener('change', schedule);
    };
  }, [ref, gap]);
}

export function NewInterview() {
  const router = useRouter();
  const params = useSearchParams();
  const aiKey = useAiKey();
  const [keyDialog, setKeyDialog] = useState(false);
  const setupPanel = useRef<HTMLElement>(null);
  useFitBelow(setupPanel);
  // Phones: the bar that leads to the setup gives way once the setup itself is in view.
  const setupOnScreen = useOnScreen(setupPanel);
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
  // Nothing is selected until the user picks a problem (or asks for a random one).
  const [selected, setSelected] = useState<string | null>(params.get('problem'));
  const [rolled, setRolled] = useState(false);
  // "Host an interview": a room where the user interviews someone they invite, instead of
  // being interviewed by the AI.
  const [host, setHost] = useState(params.get('mode') === 'host');
  const [blankChosen, setBlankChosen] = useState(false);
  // A room on questions of the bank (a quant room) instead of a coding problem.
  const [quantRoom, setQuantRoom] = useState(params.get('format') === 'quant');
  const replaceQuery = (edit: (q: URLSearchParams) => void) => {
    const q = new URLSearchParams(window.location.search);
    edit(q);
    const search = q.toString();
    window.history.replaceState(null, '', search ? `?${search}` : window.location.pathname);
  };
  const setMode = (next: 'practice' | 'host') => {
    setHost(next === 'host');
    replaceQuery((q) => {
      if (next === 'host') q.set('mode', 'host');
      else {
        q.delete('mode');
        q.delete('format');
      }
    });
  };
  const setRoomFormat = (next: 'coding' | 'quant') => {
    setQuantRoom(next === 'quant');
    replaceQuery((q) => {
      if (next === 'quant') q.set('format', 'quant');
      else q.delete('format');
    });
  };
  const [prefs, setPrefs] = useState<StartPrefs>(() => loadStartPrefs());
  const voiceOk = useSpeechSupported();
  const ids = { lang: useId(), dur: useId() };

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
  const current = library.find((p) => p.slug === selected);
  // Random picks stay within the user's language; a problem picked by hand may restrict it.
  const pool = useMemo(() => randomPool(filtered, prefs.language), [filtered, prefs.language]);
  const language = effectiveLanguage(prefs.language, current);
  const offered = current?.languages ?? LANGUAGES;
  // Picking a problem afterwards wins over "blank".
  const blank = host && blankChosen && !current;
  const ready = Boolean(current) || blank;

  const pickAtRandom = () => {
    const p = pickRandom(pool, selected);
    if (!p) return;
    setSelected(p.slug);
    setRolled(true);
  };

  // Quick start from the dashboard (?random=1&difficulty=…): pick one as soon as the library is
  // here, and put it in the URL so a reload keeps the same problem.
  const randomRequested = useRef(params.get('random') !== null);
  useEffect(() => {
    if (!randomRequested.current || !problems.data) return;
    randomRequested.current = false;
    const p = pickRandom(
      randomPool(
        filterProblems(problems.data, { ...NO_FILTERS, category, difficulty, showTopics: false }),
        prefs.language,
      ),
    );
    if (!p) return;
    setSelected(p.slug);
    setRolled(true);
    const next = new URLSearchParams(window.location.search);
    next.delete('random');
    next.set('problem', p.slug);
    window.history.replaceState(null, '', `?${next.toString()}`);
  }, [problems.data, category, difficulty, prefs.language]);

  // Unknown (loading or failed) counts as fine: never block starting on this.
  const keyState = aiKey.data?.state ?? 'active';
  const interviewerOn = prefs.interviewer.enabled;
  const needsKey = !host && interviewerOn && keyState !== 'active';

  const update = (patch: Partial<StartPrefs>) => setPrefs((p) => ({ ...p, ...patch }));
  const updateInterviewer = (patch: Partial<InterviewerSettings>) =>
    setPrefs((p) => ({ ...p, interviewer: { ...p.interviewer, ...patch } }));

  const start = useMutation({
    mutationFn: (opts: { withInterviewer?: boolean } = {}) => {
      saveStartPrefs(prefs);
      const interviewer = {
        ...prefs.interviewer,
        enabled: prefs.interviewer.enabled && (opts.withInterviewer ?? true),
      };
      if (host) {
        if (!current && !blank) throw new Error('Choose a problem, or start with a blank editor.');
        return api.createPad({
          kind: 'room',
          ...(current ? { problemSlug: current.slug } : { blank: true }),
          language,
          durationMin: prefs.durationMin,
        });
      }
      if (!current) throw new Error('Choose a problem first.');
      return api.createPad({
        problemSlug: current.slug,
        language,
        durationMin: prefs.durationMin,
        interviewer,
      });
    },
    onSuccess: (pad) => router.push(`/pads/${pad.id}`),
  });

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
  const tab = CATEGORY_TABS.find((t) => t.value === category) ?? CATEGORY_TABS[0];

  // First, as on the quiz page: what kind of session this is (and for a room, on what).
  const kindSwitch = (
    <div className="space-y-2">
      <Segmented
        aria-label="Kind of interview"
        className={cn('flex w-full max-sm:[&>*]:px-1.5', TOUCH_SEGMENTS)}
        value={host ? 'host' : 'practice'}
        onValueChange={setMode}
        options={[
          { value: 'practice', label: 'Practise with the AI' },
          { value: 'host', label: 'Interview someone' },
        ]}
      />
      {host && (
        <Segmented
          aria-label="Interview on"
          className={cn('flex w-full max-sm:[&>*]:px-1.5', TOUCH_SEGMENTS)}
          value={quantRoom ? 'quant' : 'coding'}
          onValueChange={setRoomFormat}
          options={[
            { value: 'coding', label: 'A coding problem' },
            { value: 'quant', label: 'Quant questions' },
          ]}
        />
      )}
    </div>
  );

  if (host && quantRoom)
    return (
      <section aria-labelledby="new-interview-heading">
        <h2 id="new-interview-heading" className="sr-only">
          Host a quant interview
        </h2>
        <QuantRoomSetup header={kindSwitch} />
      </section>
    );

  return (
    <section aria-labelledby="new-interview-heading">
      <h2 id="new-interview-heading" className="sr-only">
        {host ? 'Host an interview' : 'New interview'}
      </h2>
      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
        {/* Library */}
        <section
          aria-labelledby="library-heading"
          className="min-w-0 rounded-lg border border-border bg-surface"
        >
          <h2 id="library-heading" className="sr-only">
            Problem library
          </h2>
          <Tabs value={category} onValueChange={(v) => setCategory(v as CategoryFilter)}>
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
                    placeholder={showTopics ? 'Search problems or topics' : 'Search problems'}
                    aria-label="Search problems"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    // 16px on phones and tablets, or iOS zooms in on focus.
                    className="h-8 pl-8 max-lg:text-md max-sm:h-10"
                  />
                </div>
                <Segmented
                  aria-label="Difficulty"
                  className={cn('max-sm:flex max-sm:w-full', TOUCH_SEGMENTS)}
                  value={difficulty}
                  onValueChange={setDifficulty}
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
                  value={group}
                  onValueChange={(g) => {
                    setGroup(g);
                    setSubtopic(ALL);
                  }}
                >
                  <SelectTrigger
                    className="w-auto min-w-36 max-w-full max-sm:h-10"
                    aria-label="Topic"
                  >
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
                {group !== ALL && subtopics.length > 0 && (
                  <Select value={subtopic} onValueChange={setSubtopic}>
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
                {known && (
                  <Segmented<StatusFilter>
                    aria-label="Status"
                    className={cn('max-sm:flex max-sm:w-full', TOUCH_SEGMENTS)}
                    value={status}
                    onValueChange={setStatus}
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
                <div
                  className="ml-auto flex items-center gap-2 max-sm:min-h-10"
                  title={TOPICS_HINT}
                >
                  <Switch
                    id="show-topics"
                    checked={showTopics}
                    onCheckedChange={toggleTopics}
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

            <TabsContent value={category}>
              <ul className="divide-y divide-border">
                <li>
                  <button
                    type="button"
                    onClick={pickAtRandom}
                    disabled={pool.length === 0}
                    className="flex w-full items-center gap-3 border-l-2 border-l-transparent px-4 py-3 text-left transition-colors hover:bg-surface-2 focus-visible:outline-offset-[-2px] disabled:opacity-50"
                  >
                    <span className="flex size-8 shrink-0 items-center justify-center rounded-md border border-border bg-surface-2 text-accent-text">
                      <ShuffleIcon className="size-4" aria-hidden />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block font-medium">Pick a random problem</span>
                      <span className="block text-xs text-fg-muted">
                        {randomHint(
                          problems.data ? pool.length : null,
                          filtersActive,
                          pool.length < filtered.length ? prefs.language : null,
                        )}
                      </span>
                    </span>
                  </button>
                </li>
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
                    status={known ? statusOf(progress, p.slug) : null}
                    selected={selected === p.slug}
                    onSelect={() => {
                      setSelected(p.slug);
                      setRolled(false);
                    }}
                    showCategory={category === ALL}
                    showTopics={showTopics}
                  />
                ))}
                {problems.data && problems.data.length > 0 && filtered.length === 0 && (
                  <li>
                    <EmptyState
                      icon={SearchIcon}
                      title="No problems match these filters"
                      action={
                        filtersActive && (
                          <Button size="sm" onClick={clearFilters}>
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

        {/* Settings */}
        <section
          aria-labelledby="setup-heading"
          id="interview-setup"
          ref={setupPanel}
          // Never taller than the window (useFitBelow refines the height): the settings scroll
          // inside the panel and Start stays in view.
          className="min-w-0 scroll-mt-20 rounded-lg border border-border bg-surface lg:sticky lg:top-20 lg:max-h-[calc(100dvh-6rem)] lg:overflow-y-auto"
        >
          <div className="border-b border-border p-4">{kindSwitch}</div>
          <div className="border-b border-border p-4">
            <h2
              id="setup-heading"
              className="text-2xs font-medium tracking-wider text-fg-subtle uppercase"
            >
              Problem
            </h2>
            {blank ? (
              <div className="mt-2">
                <p className="font-medium" data-testid="selected-problem">
                  Blank editor
                </p>
                <p className="mt-0.5 text-sm text-fg-muted">
                  No statement or tests: you give the task yourself, and the code runs as a program.
                  You can switch to a library problem during the interview.
                </p>
                <Button
                  size="sm"
                  className="mt-3 max-sm:h-10"
                  onClick={() => setBlankChosen(false)}
                >
                  Choose a problem instead
                </Button>
              </div>
            ) : !current ? (
              <div className="mt-2">
                <p className="font-medium">No problem selected</p>
                <p className="mt-0.5 text-sm text-fg-muted">
                  {host
                    ? 'Choose one from the library, pick one at random, or start with a blank editor.'
                    : 'Choose one from the library, or let us pick one for you.'}
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    className="max-sm:h-10"
                    onClick={pickAtRandom}
                    disabled={pool.length === 0}
                  >
                    <ShuffleIcon /> Pick one at random
                  </Button>
                  {host && (
                    <Button size="sm" className="max-sm:h-10" onClick={() => setBlankChosen(true)}>
                      Start with a blank editor
                    </Button>
                  )}
                </div>
              </div>
            ) : (
              <>
                <div className="mt-2 flex items-start gap-2">
                  <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="font-medium" data-testid="selected-problem">
                      {current.title}
                    </span>
                    <DifficultyBadge difficulty={current.difficulty} />
                    <CategoryBadge category={current.category} />
                    <RestrictionBadge p={current} />
                    <StatusNote status={known ? statusOf(progress, current.slug) : null} />
                  </div>
                  {rolled && (
                    <Button
                      variant="ghost"
                      size="xs"
                      className="-mr-1 max-sm:h-9"
                      onClick={pickAtRandom}
                      disabled={pool.length === 0}
                      aria-label="Pick another random problem"
                      title="Pick another random problem matching your filters"
                    >
                      <ShuffleIcon /> Re-roll
                    </Button>
                  )}
                </div>
                <div className="mt-3">
                  <ProblemPreview slug={current.slug} />
                </div>
              </>
            )}
          </div>

          <div className="space-y-5 p-4">
            <div className="space-y-1.5">
              <Label id={ids.lang}>Language</Label>
              <Segmented
                aria-label="Language"
                className={cn('flex w-full', TOUCH_SEGMENTS)}
                value={language}
                onValueChange={(l: Language) => update({ language: l })}
                options={offered.map((l) => ({ value: l, label: LANG_LABEL[l] }))}
              />
              <p className="text-xs text-fg-muted" data-testid="language-note">
                {languageNote(prefs.language, current) ??
                  (host
                    ? 'You or your candidate can switch languages during the interview.'
                    : 'You can switch languages during the interview.')}
              </p>
            </div>

            <div className="space-y-1.5">
              <Label id={ids.dur}>Duration</Label>
              <Segmented
                aria-label="Duration"
                // Five choices: less padding, so they fit a 360px phone.
                className={cn('flex w-full max-sm:[&>*]:px-1', TOUCH_SEGMENTS)}
                value={prefs.durationMin === null ? NO_LIMIT : String(prefs.durationMin)}
                onValueChange={(v) => update({ durationMin: v === NO_LIMIT ? null : Number(v) })}
                options={[
                  ...DURATIONS.map((d) => ({ value: String(d), label: `${d} min` })),
                  { value: NO_LIMIT, label: 'No limit' },
                ]}
              />
              {prefs.durationMin === null && (
                <p className="text-xs text-fg-muted" data-testid="duration-note">
                  {host
                    ? 'The clock shows the time elapsed and never counts down.'
                    : 'The clock shows the time elapsed, and the interviewer never brings up the time.'}
                </p>
              )}
            </div>

            {host && (
              <div className="rounded-md border border-border bg-surface-2 px-3 py-2.5">
                <p className="flex items-center gap-2 text-sm font-medium">
                  <UsersIcon className="size-4 text-accent-text" aria-hidden /> You are the
                  interviewer
                </p>
                <ul className="mt-1.5 list-disc space-y-1 pl-5 text-xs text-fg-muted">
                  <li>A shared editor, chat and whiteboard with whoever you invite.</li>
                  <li>
                    Only you see the interviewer notes, the reference solution and your own notes.
                  </li>
                  <li>
                    The AI stays out of the conversation. With your API key it can give you a second
                    opinion on the code, and an assessment afterwards.
                  </li>
                  <li>You can change the problem during the interview.</li>
                </ul>
              </div>
            )}
            {!host && (
              <div className="rounded-md border border-border">
                <div className="flex items-center gap-3 px-3 py-2.5">
                  {interviewerOn ? (
                    <BotIcon className="size-4 text-accent-text" aria-hidden />
                  ) : (
                    <BotOffIcon className="size-4 text-fg-subtle" aria-hidden />
                  )}
                  <div className="min-w-0 flex-1">
                    <label htmlFor="interviewer-enabled" className="block text-sm font-medium">
                      AI interviewer
                    </label>
                    {!interviewerOn && (
                      <p className="text-xs text-fg-muted">
                        Off. You can still code, run tests and chat.
                      </p>
                    )}
                  </div>
                  <Switch
                    id="interviewer-enabled"
                    checked={interviewerOn}
                    onCheckedChange={(enabled) => updateInterviewer({ enabled })}
                  />
                </div>
                {needsKey && (
                  <AiKeyPrompt
                    className="mx-3 mb-3"
                    size="sm"
                    state={keyState === 'rejected' ? 'rejected' : 'missing'}
                    title={
                      keyState === 'rejected'
                        ? rejectedTitle(aiKey.data?.provider)
                        : 'Runs on your own AI API key'
                    }
                  >
                    {keyState === 'rejected'
                      ? 'Save a working key to interview with the AI.'
                      : 'Add one to be interviewed by the AI. You can also add it later from the pad.'}
                  </AiKeyPrompt>
                )}
                {interviewerOn && (
                  <InterviewerOptions
                    className="border-t border-border px-3 pt-3 pb-3.5"
                    value={prefs.interviewer}
                    onChange={updateInterviewer}
                    voiceOk={voiceOk}
                  />
                )}
              </div>
            )}
          </div>
          {/* A child of the panel itself, so it stays pinned however short the panel is. On
              phones it sticks to the bottom of the window while the panel is in view, so Start is
              always in reach once the setup is. */}
          <div className="sticky bottom-0 z-10 space-y-2 rounded-b-lg border-t border-border bg-surface p-4 pb-[calc(1rem_+_env(safe-area-inset-bottom))] lg:pb-4">
            <InlineError error={start.error} />
            <Button
              variant="primary"
              size="lg"
              className="w-full"
              onClick={() => (needsKey ? setKeyDialog(true) : start.mutate({}))}
              disabled={start.isPending || !ready}
              aria-describedby={ready ? undefined : 'start-hint'}
            >
              {start.isPending ? <Spinner /> : host ? <UsersIcon /> : <CheckIcon />}
              {host ? 'Create room' : 'Start interview'}
            </Button>
            {!ready && (
              <p id="start-hint" className="text-center text-xs text-fg-muted">
                {host
                  ? 'Choose a problem or a blank editor to start.'
                  : 'Choose a problem to start.'}
              </p>
            )}
          </div>
        </section>
      </div>

      <AiKeyDialog
        open={keyDialog}
        onOpenChange={setKeyDialog}
        title="Add your API key to start"
        description="The AI interviewer runs on your own API key (Anthropic, OpenAI, Google Gemini or OpenRouter). Add it now, or start without the interviewer and add a key later."
        submitLabel="Save key and start"
        onSaved={() => start.mutate({})}
        secondary={
          <Button
            variant="ghost"
            onClick={() => {
              setKeyDialog(false);
              start.mutate({ withInterviewer: false });
            }}
          >
            Start without the interviewer
          </Button>
        }
      />

      {/* Phones: the setup panel sits below a long list, so keep the next step in reach. */}
      <div
        className={cn(
          'fixed inset-x-0 bottom-0 z-30 border-t border-border bg-surface/95 px-4 pt-2 pb-[calc(0.5rem_+_env(safe-area-inset-bottom))] backdrop-blur-sm lg:hidden',
          setupOnScreen && 'hidden',
        )}
      >
        <div className="mx-auto flex max-w-6xl items-center gap-3">
          <p className="min-w-0 flex-1 truncate text-sm">
            <span className="text-fg-muted">Problem: </span>
            <span className={cn('font-medium', !ready && 'text-fg-muted')}>
              {current ? current.title : blank ? 'Blank editor' : 'None selected'}
            </span>
          </p>
          <Button
            size="lg"
            variant="primary"
            onClick={() =>
              document.getElementById('interview-setup')?.scrollIntoView({ behavior: 'smooth' })
            }
          >
            Set up interview
          </Button>
        </div>
      </div>
    </section>
  );
}
