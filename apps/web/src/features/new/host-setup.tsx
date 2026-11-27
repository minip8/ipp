'use client';
/**
 * The Software track's interview setup (the Interviews tab's "New interview"): the problem
 * library on the left (shared with Practice's Problems view, `problem-library.tsx`) and the setup
 * on the right, under "Practise with the AI | Interview someone". Practising is with the AI
 * interviewer on a problem; interviewing someone opens a coding room on a problem or a blank
 * editor. `?problem=` preselects a problem (Practice's Problems view links here so).
 */
import { type InterviewerSettings, LANGUAGES, type Language } from '@ipp/contracts';
import { useMutation } from '@tanstack/react-query';
import { BotIcon, BotOffIcon, CheckIcon, ShuffleIcon, UsersIcon } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { CategoryBadge, DifficultyBadge, LANG_LABEL } from '@/components/domain';
import { InlineError } from '@/components/states';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/input';
import { Segmented } from '@/components/ui/segmented';
import { Spinner } from '@/components/ui/spinner';
import { Switch } from '@/components/ui/switch';
import { AiKeyDialog } from '@/features/ai-key/ai-key-dialog';
import { AiKeyPrompt } from '@/features/ai-key/ai-key-prompt';
import { rejectedTitle } from '@/features/ai-key/logic';
import { KindSwitch, useInterviewMode } from '@/features/interviews/kind-switch';
import { api } from '@/lib/api';
import { useFitBelow, useOnScreen } from '@/lib/layout-hooks';
import { loadStartPrefs, type StartPrefs, saveStartPrefs } from '@/lib/prefs';
import { useAiKey } from '@/lib/queries';
import { cn } from '@/lib/utils';
import { InterviewerOptions, useSpeechSupported } from './interviewer-options';
import {
  effectiveLanguage,
  filterProblems,
  languageNote,
  NO_FILTERS,
  pickRandom,
  randomPool,
} from './logic';
import {
  ProblemLibrary,
  ProblemPreview,
  RestrictionBadge,
  StatusNote,
  useProblemLibrary,
} from './problem-library';

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

export function NewInterview() {
  const router = useRouter();
  const params = useSearchParams();
  const aiKey = useAiKey();
  const [keyDialog, setKeyDialog] = useState(false);
  const setupPanel = useRef<HTMLElement>(null);
  useFitBelow(setupPanel);
  // Phones: the bar that leads to the setup gives way once the setup itself is in view.
  const setupOnScreen = useOnScreen(setupPanel);
  const lib = useProblemLibrary();
  const { problems, library, filtered } = lib;
  // Nothing is selected until the user picks a problem (or asks for a random one).
  const [selected, setSelected] = useState<string | null>(params.get('problem'));
  const [rolled, setRolled] = useState(false);
  // "Interview someone": a coding room where the user interviews someone they invite, instead
  // of being interviewed by the AI.
  const [mode, setMode] = useInterviewMode();
  const host = mode === 'host';
  const [blankChosen, setBlankChosen] = useState(false);
  const [prefs, setPrefs] = useState<StartPrefs>(() => loadStartPrefs());
  const voiceOk = useSpeechSupported();
  const ids = { lang: useId(), dur: useId() };

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

  // Quick start from a link (?random=1&difficulty=…): pick one as soon as the library is here,
  // and put it in the URL so a reload keeps the same problem.
  const randomRequested = useRef(params.get('random') !== null);
  const { category, difficulty } = lib;
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

  return (
    <section aria-labelledby="new-interview-heading">
      <h2 id="new-interview-heading" className="sr-only">
        {host ? 'Host an interview' : 'New interview'}
      </h2>
      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
        <ProblemLibrary
          lib={lib}
          selected={selected}
          onSelect={(slug) => {
            setSelected(slug);
            setRolled(false);
          }}
          leading={
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
                      lib.filtersActive,
                      pool.length < filtered.length ? prefs.language : null,
                    )}
                  </span>
                </span>
              </button>
            </li>
          }
        />

        {/* Settings */}
        <section
          aria-labelledby="setup-heading"
          id="interview-setup"
          ref={setupPanel}
          // Never taller than the window (useFitBelow refines the height): the settings scroll
          // inside the panel and Start stays in view.
          className="min-w-0 scroll-mt-20 rounded-lg border border-border bg-surface lg:sticky lg:top-20 lg:max-h-[calc(100dvh-6rem)] lg:overflow-y-auto"
        >
          <div className="border-b border-border p-4">
            <KindSwitch value={mode} onValueChange={setMode} />
          </div>
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
                    <StatusNote status={lib.statusFor(current.slug)} />
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
                  <ProblemPreview
                    slug={current.slug}
                    unavailable="The statement could not be loaded. You can still start the interview."
                  />
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
