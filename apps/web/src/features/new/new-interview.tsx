'use client';
import {
  type Difficulty,
  type InterviewerSettings,
  LANGUAGES,
  type Language,
  type ProblemSummary,
} from '@ipp/contracts';
import { useMutation, useQuery } from '@tanstack/react-query';
import {
  ArrowLeftIcon,
  BotIcon,
  BotOffIcon,
  CheckIcon,
  MicIcon,
  SearchIcon,
  ShuffleIcon,
  XIcon,
} from 'lucide-react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useDeferredValue, useEffect, useId, useMemo, useState } from 'react';
import { DifficultyBadge, LANG_LABEL } from '@/components/domain';
import { Markdown } from '@/components/markdown';
import { EmptyState, ErrorState, InlineError } from '@/components/states';
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
import { AiKeyDialog } from '@/features/ai-key/ai-key-dialog';
import { AiKeyPrompt } from '@/features/ai-key/ai-key-prompt';
import { api } from '@/lib/api';
import { humanize } from '@/lib/format';
import { loadStartPrefs, type StartPrefs, saveStartPrefs } from '@/lib/prefs';
import { qk, useAiKey } from '@/lib/queries';
import { cn } from '@/lib/utils';

type DiffFilter = 'all' | Difficulty;
const RANDOM = '__random__';

function speechSupported() {
  if (typeof window === 'undefined') return true;
  const w = window as unknown as Record<string, unknown>;
  return Boolean(w.SpeechRecognition || w.webkitSpeechRecognition) && 'speechSynthesis' in window;
}

function ProblemRow({
  p,
  selected,
  onSelect,
}: {
  p: ProblemSummary;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <li>
      <button
        type="button"
        onClick={onSelect}
        aria-pressed={selected}
        className={cn(
          'flex w-full items-center gap-3 border-l-2 px-4 py-2.5 text-left transition-colors focus-visible:outline-offset-[-2px]',
          selected
            ? 'border-l-accent bg-accent-soft/50'
            : 'border-l-transparent hover:bg-surface-2',
        )}
      >
        <span className="min-w-0 flex-1">
          <span className="block truncate font-medium">{p.title}</span>
          <span className="mt-0.5 block truncate text-xs text-fg-muted">
            {p.tags.map(humanize).join(' · ')}
          </span>
        </span>
        <DifficultyBadge difficulty={p.difficulty} />
      </button>
    </li>
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

const DURATIONS = [30, 45, 60, 90] as const;

export function NewInterview() {
  const router = useRouter();
  const params = useSearchParams();
  const aiKey = useAiKey();
  const [keyDialog, setKeyDialog] = useState(false);
  const [query, setQuery] = useState('');
  const deferredQuery = useDeferredValue(query);
  const [difficulty, setDifficulty] = useState<DiffFilter>(
    (params.get('difficulty') as DiffFilter) || 'all',
  );
  const [tag, setTag] = useState<string>('all');
  const [selected, setSelected] = useState<string>(params.get('problem') ?? RANDOM);
  const [prefs, setPrefs] = useState<StartPrefs>(() => loadStartPrefs());
  const [voiceOk, setVoiceOk] = useState(true);
  useEffect(() => setVoiceOk(speechSupported()), []);
  const ids = { lang: useId(), dur: useId(), style: useId(), pro: useId() };

  // Load the whole library once and filter locally: it is small and filtering feels instant.
  const problems = useQuery({ queryKey: qk.problems({}), queryFn: () => api.problems() });
  const allTags = useMemo(
    () => [...new Set(problems.data?.flatMap((p) => p.tags) ?? [])].sort(),
    [problems.data],
  );
  const filtered = useMemo(() => {
    const text = deferredQuery.trim().toLowerCase();
    return (problems.data ?? []).filter(
      (p) =>
        (difficulty === 'all' || p.difficulty === difficulty) &&
        (tag === 'all' || p.tags.includes(tag)) &&
        (!text || p.title.toLowerCase().includes(text) || p.tags.some((t) => t.includes(text))),
    );
  }, [problems.data, deferredQuery, difficulty, tag]);
  const current = problems.data?.find((p) => p.slug === selected);
  // Unknown (loading or failed) counts as fine: never block starting on this.
  const keyState = aiKey.data?.state ?? 'active';
  const interviewerOn = prefs.interviewer.enabled;
  const needsKey = interviewerOn && keyState !== 'active';

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
      return api.createPad(
        selected === RANDOM
          ? {
              random: {
                difficulty: difficulty === 'all' ? undefined : difficulty,
                tag: tag === 'all' ? undefined : tag,
              },
              language: prefs.language,
              durationMin: prefs.durationMin,
              interviewer,
            }
          : {
              problemSlug: selected,
              language: prefs.language,
              durationMin: prefs.durationMin,
              interviewer,
            },
      );
    },
    onSuccess: (pad) => router.push(`/pads/${pad.id}`),
  });

  const filtersActive = query !== '' || difficulty !== 'all' || tag !== 'all';
  const randomDescription = [
    difficulty !== 'all' ? difficulty : null,
    tag !== 'all' ? humanize(tag).toLowerCase() : null,
  ]
    .filter(Boolean)
    .join(', ');

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
      <Link
        href="/dashboard"
        className="inline-flex items-center gap-1 text-sm text-fg-muted hover:text-fg"
      >
        <ArrowLeftIcon className="size-3.5" /> Interviews
      </Link>
      <h1 className="mt-2 text-xl font-semibold tracking-tight">New interview</h1>
      <p className="mt-1 text-sm text-fg-muted">
        Choose a problem and how you want to be interviewed.
      </p>

      <div className="mt-6 grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
        {/* Library */}
        <section
          aria-labelledby="library-heading"
          className="min-w-0 rounded-lg border border-border bg-surface"
        >
          <h2 id="library-heading" className="sr-only">
            Problem library
          </h2>
          <div className="flex flex-wrap items-center gap-2 border-b border-border p-3">
            <div className="relative min-w-48 flex-1">
              <SearchIcon
                className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-fg-subtle"
                aria-hidden
              />
              <Input
                type="search"
                placeholder="Search problems or tags"
                aria-label="Search problems"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="h-8 pl-8"
              />
            </div>
            <Segmented
              aria-label="Difficulty"
              value={difficulty}
              onValueChange={setDifficulty}
              options={[
                { value: 'all', label: 'All' },
                { value: 'easy', label: 'Easy' },
                { value: 'medium', label: 'Medium' },
                { value: 'hard', label: 'Hard' },
              ]}
            />
            <Select value={tag} onValueChange={setTag}>
              <SelectTrigger className="w-40" aria-label="Topic">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All topics</SelectItem>
                {allTags.map((t) => (
                  <SelectItem key={t} value={t}>
                    {humanize(t)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <ul className="divide-y divide-border">
            <li>
              <button
                type="button"
                onClick={() => setSelected(RANDOM)}
                aria-pressed={selected === RANDOM}
                className={cn(
                  'flex w-full items-center gap-3 border-l-2 px-4 py-3 text-left transition-colors focus-visible:outline-offset-[-2px]',
                  selected === RANDOM
                    ? 'border-l-accent bg-accent-soft/50'
                    : 'border-l-transparent hover:bg-surface-2',
                )}
              >
                <span className="flex size-8 shrink-0 items-center justify-center rounded-md border border-border bg-surface-2 text-accent-text">
                  <ShuffleIcon className="size-4" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block font-medium">Surprise me</span>
                  <span className="block text-xs text-fg-muted">
                    A random problem{randomDescription ? ` (${randomDescription})` : ''}. You see it
                    when the interview starts.
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
                selected={selected === p.slug}
                onSelect={() => setSelected(p.slug)}
              />
            ))}
            {problems.data && problems.data.length > 0 && filtered.length === 0 && (
              <li>
                <EmptyState
                  icon={SearchIcon}
                  title="No problems match these filters"
                  action={
                    filtersActive && (
                      <Button
                        size="sm"
                        onClick={() => {
                          setQuery('');
                          setDifficulty('all');
                          setTag('all');
                        }}
                      >
                        <XIcon /> Clear filters
                      </Button>
                    )
                  }
                >
                  Try a different search, or pick a random problem instead.
                </EmptyState>
              </li>
            )}
          </ul>
          {problems.isError && (
            <ErrorState error={problems.error} onRetry={() => problems.refetch()} compact />
          )}
        </section>

        {/* Settings */}
        <section
          aria-labelledby="setup-heading"
          id="interview-setup"
          className="min-w-0 scroll-mt-20 rounded-lg border border-border bg-surface lg:sticky lg:top-20"
        >
          <div className="border-b border-border p-4">
            <h2
              id="setup-heading"
              className="text-2xs font-medium tracking-wider text-fg-subtle uppercase"
            >
              Problem
            </h2>
            {selected === RANDOM || !current ? (
              <div className="mt-2 flex items-center gap-2">
                <ShuffleIcon className="size-4 text-accent-text" />
                <span className="font-medium">Random problem</span>
                {difficulty !== 'all' && <DifficultyBadge difficulty={difficulty} />}
              </div>
            ) : (
              <>
                <div className="mt-2 flex items-center gap-2">
                  <span className="font-medium">{current.title}</span>
                  <DifficultyBadge difficulty={current.difficulty} />
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
                className="flex w-full"
                value={prefs.language}
                onValueChange={(language: Language) => update({ language })}
                options={LANGUAGES.map((l) => ({ value: l, label: LANG_LABEL[l] }))}
              />
              <p className="text-xs text-fg-muted">
                You can switch languages during the interview.
              </p>
            </div>

            <div className="space-y-1.5">
              <Label id={ids.dur}>Duration</Label>
              <Segmented
                aria-label="Duration"
                className="flex w-full"
                value={String(prefs.durationMin)}
                onValueChange={(v) => update({ durationMin: Number(v) })}
                options={DURATIONS.map((d) => ({ value: String(d), label: `${d} min` }))}
              />
            </div>

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
                      ? 'Anthropic rejected your API key'
                      : 'Runs on your own Anthropic API key'
                  }
                >
                  {keyState === 'rejected'
                    ? 'Save a working key to interview with the AI.'
                    : 'Add one to be interviewed by the AI. You can also add it later from the pad.'}
                </AiKeyPrompt>
              )}
              {interviewerOn && (
                <div className="space-y-4 border-t border-border px-3 pt-3 pb-3.5">
                  <div className="space-y-1.5">
                    <Label id={ids.style} className="text-xs text-fg-muted">
                      Style
                    </Label>
                    <Segmented
                      aria-label="Interviewer style"
                      size="sm"
                      className="flex w-full"
                      value={prefs.interviewer.style}
                      onValueChange={(style) => updateInterviewer({ style })}
                      options={[
                        {
                          value: 'supportive',
                          label: 'Supportive',
                          hint: 'Encouraging, more hints',
                        },
                        { value: 'neutral', label: 'Neutral', hint: 'Like most real interviews' },
                        { value: 'tough', label: 'Tough', hint: 'Probing, few hints' },
                      ]}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label id={ids.pro} className="text-xs text-fg-muted">
                      Speaks up unprompted
                    </Label>
                    <Segmented
                      aria-label="Proactivity"
                      size="sm"
                      className="flex w-full"
                      value={prefs.interviewer.proactivity}
                      onValueChange={(proactivity) => updateInterviewer({ proactivity })}
                      options={[
                        { value: 'low', label: 'Rarely' },
                        { value: 'normal', label: 'Sometimes' },
                        { value: 'high', label: 'Often' },
                      ]}
                    />
                  </div>
                  <div className="flex items-start gap-3">
                    <MicIcon className="mt-0.5 size-4 text-fg-subtle" aria-hidden />
                    <div className="min-w-0 flex-1">
                      <label htmlFor="voice" className="block text-sm font-medium">
                        Voice
                      </label>
                      <p className="text-xs text-fg-muted">
                        {voiceOk
                          ? 'Talk to the interviewer and hear replies. You can turn this on or off later.'
                          : 'This browser does not support speech. Chrome and Edge do.'}
                      </p>
                    </div>
                    <Switch
                      id="voice"
                      checked={prefs.interviewer.voice && voiceOk}
                      disabled={!voiceOk}
                      onCheckedChange={(voice) => updateInterviewer({ voice })}
                    />
                  </div>
                </div>
              )}
            </div>

            <InlineError error={start.error} />
            <Button
              variant="primary"
              size="lg"
              className="w-full"
              onClick={() => (needsKey ? setKeyDialog(true) : start.mutate({}))}
              disabled={start.isPending}
            >
              {start.isPending ? <Spinner /> : <CheckIcon />}
              Start interview
            </Button>
          </div>
        </section>
      </div>

      <AiKeyDialog
        open={keyDialog}
        onOpenChange={setKeyDialog}
        title="Add your API key to start"
        description="The AI interviewer runs on your own Anthropic API key. Add it now, or start without the interviewer and add a key later."
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
      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-surface/95 px-4 py-2.5 backdrop-blur-sm lg:hidden">
        <div className="mx-auto flex max-w-6xl items-center gap-3">
          <p className="min-w-0 flex-1 truncate text-sm">
            <span className="text-fg-muted">Problem: </span>
            <span className="font-medium">
              {selected === RANDOM || !current ? 'Random' : current.title}
            </span>
          </p>
          <Button
            size="sm"
            variant="primary"
            onClick={() =>
              document.getElementById('interview-setup')?.scrollIntoView({ behavior: 'smooth' })
            }
          >
            Set up interview
          </Button>
        </div>
      </div>
      <div className="h-16 lg:hidden" aria-hidden />
    </div>
  );
}
