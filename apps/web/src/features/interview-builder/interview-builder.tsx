'use client';
/**
 * The interview builder: the Interviews tab's "Practise with the AI" in both tracks. A staged
 * mock interview is assembled on the left (the track's presets as a row of cards, then the plan:
 * its stages in order, each editable in place, movable and removable, and buttons to add any
 * kind of stage); the setup panel on the right (on a phone, after the plan) has the page's
 * `header` (the kind-of-interview switch), the plan's total, the interviewer's options, the key
 * every stage runs on, and Start, which creates the interview and opens its first stage's pad.
 *
 * The plan and the preset it came from are remembered per track in this browser; a link may
 * name a plan instead (`planFromLink`: `?problem=`, `?preset=`, `?path=`, `?random=1`).
 */
import {
  INTERVIEW_STAGES_MAX,
  type InterviewPreset,
  type InterviewSettings,
  type InterviewStage,
  type Language,
  presetsOf,
  STAGE_KIND_INFO,
  STAGE_KINDS,
  type StageKind,
  type Track,
} from '@ipp/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangleIcon, PlayIcon, PlusIcon } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { useRetryCountdown } from '@/components/states';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { AiKeyDialog } from '@/features/ai-key/ai-key-dialog';
import { AiKeyPrompt } from '@/features/ai-key/ai-key-prompt';
import { rejectedTitle } from '@/features/ai-key/logic';
import { planTotal } from '@/features/interview/logic';
import { STAGE_ICON } from '@/features/interview/stage-icon';
import { useStageNames } from '@/features/interview/use-names';
import { InterviewerOptions, useSpeechSupported } from '@/features/new/interviewer-options';
import { ApiRequestError, api } from '@/lib/api';
import { useFitBelow, useOnScreen } from '@/lib/layout-hooks';
import { loadStartPrefs, saveStartPrefs } from '@/lib/prefs';
import { qk, useAiKey } from '@/lib/queries';
import { cn } from '@/lib/utils';
import {
  addStage,
  canAddStage,
  canRemoveStage,
  createRequest,
  defaultTopics,
  fitLanguages,
  fitTopics,
  loadPlan,
  moveStage,
  type Plan,
  planFromLink,
  planSelection,
  presetPlan,
  removeStage,
  replaceStage,
  savePlan,
  startError,
} from './logic';
import { PresetPicker } from './preset-picker';
import { StageCard } from './stage-card';

type Builder = { plan: Plan; language: Language };

function initialBuilder(track: Track, params: URLSearchParams): Builder {
  const usual = loadStartPrefs().language;
  const stored = loadPlan(track, usual);
  const linked = planFromLink(params, track, stored.language);
  return linked ? { plan: linked, language: stored.language } : stored;
}

function initialInterviewer(): InterviewSettings {
  const { style, proactivity, voice, model } = loadStartPrefs().interviewer;
  return { style, proactivity, voice, ...(model ? { model } : {}) };
}

export function InterviewBuilder({ track, header }: { track: Track; header?: ReactNode }) {
  const router = useRouter();
  const params = useSearchParams();
  const qc = useQueryClient();
  const aiKey = useAiKey();
  const voiceOk = useSpeechSupported();
  const names = useStageNames();
  const presets = useMemo(() => presetsOf(track), [track]);
  const panel = useRef<HTMLElement>(null);
  useFitBelow(panel);
  const panelOnScreen = useOnScreen(panel);
  const [{ plan, language }, setBuilder] = useState<Builder>(() =>
    initialBuilder(track, new URLSearchParams(params.toString())),
  );
  const [interviewer, setInterviewer] = useState<InterviewSettings>(initialInterviewer);
  // One stage open for editing at a time, followed when it moves.
  const [expanded, setExpanded] = useState<number | null>(null);
  const [keyDialog, setKeyDialog] = useState(false);

  const setStages = (stages: InterviewStage[]) =>
    setBuilder((b) => ({ ...b, plan: { ...b.plan, stages } }));
  const selection = planSelection(plan, track);
  const total = planTotal(plan.stages);

  // What the stored plan or a link names is fitted to what the server has once it is known: a
  // problem's own languages, and only topics that exist.
  const problems = useQuery({ queryKey: qk.problems({}), queryFn: () => api.problems() });
  const topics = useQuery({ queryKey: qk.quizTopics, queryFn: api.quizTopics });
  useEffect(() => {
    if (!problems.data) return;
    const list = problems.data;
    setBuilder((b) => {
      const stages = fitLanguages(b.plan.stages, list);
      return stages.every((s, i) => s === b.plan.stages[i])
        ? b
        : { ...b, plan: { ...b.plan, stages } };
    });
  }, [problems.data]);
  useEffect(() => {
    if (!topics.data) return;
    const list = topics.data;
    setBuilder((b) => {
      const stages = fitTopics(b.plan.stages, list, defaultTopics(list, track, b.language));
      return stages.every((s, i) => s === b.plan.stages[i])
        ? b
        : { ...b, plan: { ...b.plan, stages } };
    });
  }, [topics.data, track]);

  useEffect(() => savePlan(track, plan, language), [track, plan, language]);

  // Unknown (loading or failed) counts as usable: the server says so if it is not.
  const keyState = aiKey.data?.state ?? 'active';
  const needsKey = keyState !== 'active';

  const start = useMutation({
    mutationFn: () => {
      const prefs = loadStartPrefs();
      saveStartPrefs({ ...prefs, language, interviewer: { ...interviewer, enabled: true } });
      return api.createInterview(createRequest(track, plan, interviewer, names));
    },
    onSuccess: ({ interview, padId }) => {
      qc.setQueryData(qk.interview(interview.id), interview);
      void qc.invalidateQueries({ queryKey: qk.interviews });
      void qc.invalidateQueries({ queryKey: qk.pads });
      router.push(padId ? `/pads/${padId}` : `/interviews/${interview.id}`);
    },
    onError: (e) => {
      // The key went missing since the page loaded: show the prompt for it.
      if (e instanceof ApiRequestError && e.code === 'ai_key_missing')
        void qc.invalidateQueries({ queryKey: qk.aiKey });
    },
  });
  const wait = useRetryCountdown(start.error);
  // An error was about the plan it was started with.
  const { reset } = start;
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset when the plan changes
  useEffect(() => reset(), [plan, reset]);

  const choosePreset = (p: InterviewPreset) => {
    setBuilder((b) => ({ ...b, plan: presetPlan(p, b.language) }));
    setExpanded(null);
  };
  const add = (kind: StageKind) => {
    if (!canAddStage(plan.stages)) return;
    setStages(
      addStage(plan.stages, kind, {
        language,
        topics: defaultTopics(topics.data ?? [], track, language),
      }),
    );
    setExpanded(plan.stages.length);
  };
  const move = (index: number, by: -1 | 1) => {
    setStages(moveStage(plan.stages, index, by));
    if (expanded === index) setExpanded(index + by);
    else if (expanded === index + by) setExpanded(index);
  };
  const remove = (index: number) => {
    if (!canRemoveStage(plan.stages)) return;
    setStages(removeStage(plan.stages, index));
    if (expanded === index) setExpanded(null);
    else if (expanded !== null && expanded > index) setExpanded(expanded - 1);
  };

  const full = !canAddStage(plan.stages);
  const begin = () => (needsKey ? setKeyDialog(true) : start.mutate());

  return (
    <div
      className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_380px]"
      data-testid="builder"
    >
      <section aria-labelledby="plan-heading" className="min-w-0 space-y-5">
        <div>
          <h3 className="mb-2 text-2xs font-medium tracking-wider text-fg-subtle uppercase">
            Start from
          </h3>
          <PresetPicker
            presets={presets}
            value={selection}
            customTotal={total}
            onChoose={choosePreset}
          />
        </div>

        <div className="rounded-lg border border-border bg-surface">
          <div className="flex h-11 items-center justify-between gap-3 border-b border-border px-4">
            <h2 id="plan-heading" className="text-sm font-semibold">
              Your interview
            </h2>
            <span className="text-xs text-fg-muted tabular" data-testid="plan-total-inline">
              {total}
            </span>
          </div>
          <ol className="space-y-2 p-3 sm:p-4" aria-label="Stages" data-testid="plan">
            {plan.stages.map((stage, i) => (
              <StageCard
                // Stages have no identity of their own: the position is the key, and the card
                // that is open follows its stage when it moves.
                // biome-ignore lint/suspicious/noArrayIndexKey: see above
                key={i}
                stage={stage}
                index={i}
                count={plan.stages.length}
                track={track}
                names={names}
                expanded={expanded === i}
                onExpandedChange={(open) => setExpanded(open ? i : null)}
                onChange={(s) => setStages(replaceStage(plan.stages, i, s))}
                onLanguage={(l) => setBuilder((b) => ({ ...b, language: l }))}
                onMove={(by) => move(i, by)}
                onRemove={() => remove(i)}
                canRemove={canRemoveStage(plan.stages)}
              />
            ))}
          </ol>
          <div className="border-t border-border px-4 py-3">
            <p className="text-xs font-medium text-fg-muted" id="add-stage-label">
              Add a stage
            </p>
            {/* biome-ignore lint/a11y/useSemanticElements: a row of buttons named by the label */}
            <div
              role="group"
              aria-labelledby="add-stage-label"
              className="mt-2 flex flex-wrap gap-2"
            >
              {STAGE_KINDS.map((kind) => {
                const Icon = STAGE_ICON[kind];
                return (
                  <Button
                    key={kind}
                    size="sm"
                    className="max-sm:h-10 max-sm:flex-1"
                    disabled={full}
                    onClick={() => add(kind)}
                    title={STAGE_KIND_INFO[kind].description}
                    aria-label={`Add ${STAGE_KIND_INFO[kind].label.toLowerCase()}`}
                  >
                    <PlusIcon aria-hidden className="max-sm:hidden" />
                    <Icon aria-hidden className="sm:hidden" />
                    {STAGE_KIND_INFO[kind].label}
                  </Button>
                );
              })}
            </div>
            {full && (
              <p className="mt-2 text-xs text-fg-muted" data-testid="stages-full">
                An interview has at most {INTERVIEW_STAGES_MAX} stages. Remove one to add another.
              </p>
            )}
          </div>
        </div>
      </section>

      <section
        ref={panel}
        aria-label="Interview setup"
        id="interview-setup"
        // Never taller than the window (useFitBelow refines it): the options scroll inside and
        // Start stays in view.
        className="min-w-0 scroll-mt-20 rounded-lg border border-border bg-surface lg:sticky lg:top-20 lg:max-h-[calc(100dvh-6rem)] lg:overflow-y-auto"
        data-testid="builder-setup"
      >
        {header && <div className="border-b border-border p-4">{header}</div>}
        <div className="border-b border-border p-4">
          <p className="text-2xs font-medium tracking-wider text-fg-subtle uppercase">
            Your interview
          </p>
          <p className="mt-1.5 font-medium tabular" aria-live="polite" data-testid="plan-total">
            {total}
          </p>
          <p className="mt-1 text-sm text-fg-muted">
            Each stage opens in its own pad with its own clock, and you start the next when you are
            ready. Every stage gets a report, and the interview an overall result.
          </p>
        </div>
        <div className="space-y-5 p-4">
          {needsKey && (
            <AiKeyPrompt
              size="sm"
              testId="interview-key-prompt"
              state={keyState === 'rejected' ? 'rejected' : 'missing'}
              title={
                keyState === 'rejected'
                  ? rejectedTitle(aiKey.data?.provider)
                  : 'The interview runs on your own AI API key'
              }
            >
              {keyState === 'rejected'
                ? 'Save a working key to start an interview.'
                : 'The interviewer runs every stage on it, so an interview cannot start without one.'}
            </AiKeyPrompt>
          )}
          <div className="rounded-md border border-border px-3 pt-3 pb-3.5">
            <p className="mb-3 text-sm font-medium">Interviewer</p>
            <InterviewerOptions
              value={interviewer}
              onChange={(patch) => setInterviewer((i) => ({ ...i, ...patch }))}
              voiceOk={voiceOk}
            />
          </div>
        </div>
        {/* Pinned to the bottom of the panel, as the other setups' Start is. */}
        <div className="sticky bottom-0 z-10 space-y-2 rounded-b-lg border-t border-border bg-surface p-4 pb-[calc(1rem_+_env(safe-area-inset-bottom))] lg:pb-4">
          {start.error && (
            <p
              role="alert"
              className="flex items-start gap-2 text-sm text-bad-text"
              data-testid="start-error"
            >
              <AlertTriangleIcon className="mt-0.5 size-4 shrink-0" aria-hidden />
              <span>{startError(start.error)}</span>
            </p>
          )}
          <Button
            variant="primary"
            size="lg"
            className="w-full"
            disabled={start.isPending || wait > 0}
            onClick={begin}
          >
            {start.isPending ? <Spinner /> : <PlayIcon />}
            Start the interview
          </Button>
          <p className="text-center text-xs text-fg-muted">
            The first stage’s clock starts when its pad opens.
          </p>
        </div>
      </section>

      <AiKeyDialog
        open={keyDialog}
        onOpenChange={setKeyDialog}
        title="Add your API key to start"
        description="The interviewer runs every stage on your own API key (Anthropic, OpenAI, Google Gemini or OpenRouter)."
        submitLabel="Save key and start"
        onSaved={() => start.mutate()}
      />

      {/* Phones: the setup panel sits below the plan, so keep the next step in reach. */}
      <div
        className={cn(
          'fixed inset-x-0 bottom-0 z-30 border-t border-border bg-surface/95 px-4 pt-2 pb-[calc(0.5rem_+_env(safe-area-inset-bottom))] backdrop-blur-sm lg:hidden',
          panelOnScreen && 'hidden',
        )}
      >
        <div className="mx-auto flex max-w-6xl items-center gap-3">
          <p className="min-w-0 flex-1 truncate text-sm font-medium tabular">{total}</p>
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
    </div>
  );
}
