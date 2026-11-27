'use client';
/**
 * The interview builder: the Interviews tab's "Practise with the AI" in both tracks. A staged
 * mock interview is assembled on the left (cards to start from: the track's presets, the user's
 * saved plans and their own custom draft; then the plan shown: its stages in order, each editable
 * in place, movable and removable, and buttons to add any kind of stage); the setup panel on the
 * right (on a phone, after the plan) has the page's `header` (the kind-of-interview switch), the
 * plan's total, the interviewer's options, the key every stage runs on, and Start, which creates
 * the interview from the plan shown and opens its first stage's pad.
 *
 * What is selected and the custom draft are separate (`selection.ts`): choosing a preset or a
 * saved plan leaves the draft as it was, and editing either starts a draft from it, asking first
 * when that would replace one holding work. Both are remembered per track in this browser. A link
 * may select a preset or preview a plan of one stage (`linkFromParams`); once the user chooses
 * something else, the link's params leave the URL so a reload shows what was chosen.
 */
import {
  INTERVIEW_STAGES_MAX,
  type InterviewSettings,
  type InterviewTemplate,
  type Language,
  presetsOf,
  STAGE_KIND_INFO,
  STAGE_KINDS,
  type StageKind,
  type Track,
} from '@ipp/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangleIcon, PlayIcon, PlusIcon, SaveIcon, Trash2Icon } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { useRetryCountdown } from '@/components/states';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { AiKeyDialog } from '@/features/ai-key/ai-key-dialog';
import { AiKeyPrompt } from '@/features/ai-key/ai-key-prompt';
import { rejectedTitle } from '@/features/ai-key/logic';
import { ConfirmDeleteDialog } from '@/features/delete-history/confirm-delete-dialog';
import { planTotal } from '@/features/interview/logic';
import { STAGE_ICON } from '@/features/interview/stage-icon';
import { useStageNames } from '@/features/interview/use-names';
import { InterviewerOptions, useSpeechSupported } from '@/features/new/interviewer-options';
import { ApiRequestError, api } from '@/lib/api';
import { useFitBelow, useOnScreen } from '@/lib/layout-hooks';
import { loadStartPrefs, saveStartPrefs } from '@/lib/prefs';
import { qk, useAiKey, useMe } from '@/lib/queries';
import { cn } from '@/lib/utils';
import { ConfirmDialog } from './confirm-dialog';
import {
  addStage,
  canAddStage,
  canRemoveStage,
  createRequest,
  defaultTopics,
  fitLanguages,
  fitTopics,
  moveStage,
  removeStage,
  replaceStage,
  startError,
} from './logic';
import { PresetPicker } from './preset-picker';
import { focusChosenCard } from './return-focus';
import { RenameDialog, SaveDialog } from './save-dialog';
import {
  afterDelete,
  afterRename,
  afterSave,
  applyLink,
  type Builder,
  type Ctx,
  choose,
  discard,
  dropEmptyPreview,
  edit,
  fitBuilder,
  fitProblems,
  linkFromParams,
  linkKey,
  loadBuilder,
  previewLabel,
  reconcile,
  type SavedPlan,
  type Selection,
  saveBuilder,
  saveOffer,
  selectionLabel,
  shownPlan,
  startPlan,
  suggestedName,
  withoutLink,
} from './selection';
import { StageCard } from './stage-card';

function initialBuilder(track: Track, params: URLSearchParams): Builder {
  const stored = loadBuilder(track, loadStartPrefs().language);
  const link = linkFromParams(params, track, stored.language);
  return link ? applyLink(stored, link) : stored;
}

function initialInterviewer(): InterviewSettings {
  const { style, proactivity, voice, model } = loadStartPrefs().interviewer;
  return { style, proactivity, voice, ...(model ? { model } : {}) };
}

/** The link's params leave the URL (replaced, not pushed), so a reload shows what is chosen. */
function dropLink() {
  const search = withoutLink(window.location.search);
  if (search === null) return;
  const { pathname, hash } = window.location;
  window.history.replaceState(null, '', `${pathname}${search ? `?${search}` : ''}${hash}`);
}

/** Saved plans by name, as the server lists them. */
const byName = (list: InterviewTemplate[]) =>
  [...list].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));

type Pending = { next: Builder; language: Language; expanded: number | null };

export function InterviewBuilder({ track, header }: { track: Track; header?: ReactNode }) {
  const router = useRouter();
  const params = useSearchParams();
  const qc = useQueryClient();
  const me = useMe();
  const aiKey = useAiKey();
  const voiceOk = useSpeechSupported();
  const names = useStageNames();
  const presets = useMemo(() => presetsOf(track), [track]);
  const panel = useRef<HTMLElement>(null);
  useFitBelow(panel);
  const panelOnScreen = useOnScreen(panel);
  const [b, setB] = useState<Builder>(() =>
    initialBuilder(track, new URLSearchParams(params.toString())),
  );
  const [interviewer, setInterviewer] = useState<InterviewSettings>(initialInterviewer);
  // One stage open for editing at a time, followed when it moves.
  const [expanded, setExpanded] = useState<number | null>(null);
  const [keyDialog, setKeyDialog] = useState(false);
  // An edit that would replace a draft holding work, waiting for the user's answer.
  const [pending, setPending] = useState<Pending | null>(null);
  const [discarding, setDiscarding] = useState(false);
  const [saving, setSaving] = useState(false);
  const [renaming, setRenaming] = useState<SavedPlan | null>(null);
  const [deleting, setDeleting] = useState<SavedPlan | null>(null);

  // What the stored plan, a link or a saved plan names is fitted to what the server has once it
  // is known: a problem's own languages, only topics that exist, and (a saved plan) a problem
  // that still exists.
  const problems = useQuery({ queryKey: qk.problems({}), queryFn: () => api.problems() });
  const topics = useQuery({ queryKey: qk.quizTopics, queryFn: api.quizTopics });
  const account = me.data ? !me.data.guest : false;
  const templates = useQuery({
    queryKey: qk.interviewTemplates,
    queryFn: api.interviewTemplates,
    enabled: account,
  });

  const fallbackTopics = useMemo(
    () => defaultTopics(topics.data ?? [], track, b.language),
    [topics.data, track, b.language],
  );
  const saved = useMemo<SavedPlan[]>(
    () =>
      (templates.data ?? [])
        .filter((t) => t.track === track)
        .map((t) => {
          let stages = t.stages;
          if (problems.data)
            stages = fitLanguages(fitProblems(stages, problems.data), problems.data);
          if (topics.data) stages = fitTopics(stages, topics.data, fallbackTopics);
          return { id: t.id, name: t.name, stages };
        }),
    [templates.data, track, problems.data, topics.data, fallbackTopics],
  );
  const ctx: Ctx = useMemo(() => ({ track, saved }), [track, saved]);

  useEffect(() => {
    if (!problems.data) return;
    const list = problems.data;
    setB((x) => fitBuilder(x, (stages) => fitLanguages(stages, list)));
  }, [problems.data]);
  useEffect(() => {
    if (!topics.data) return;
    const list = topics.data;
    setB((x) =>
      fitBuilder(dropEmptyPreview(x, list, track), (stages) =>
        fitTopics(stages, list, defaultTopics(list, track, x.language)),
      ),
    );
  }, [topics.data, track]);
  // A selected saved plan takes the server's name and plan, or goes once deleted elsewhere.
  useEffect(() => {
    if (!templates.data) return;
    const list = templates.data.filter((t) => t.track === track);
    setB((x) => reconcile(x, list, track));
  }, [templates.data, track]);

  useEffect(() => saveBuilder(track, b), [track, b]);

  // A link followed while the builder is open (the URL changed under it).
  const link = linkKey(params);
  const appliedLink = useRef(link);
  useEffect(() => {
    if (link === appliedLink.current) return;
    appliedLink.current = link;
    if (!link) return;
    const next = linkFromParams(new URLSearchParams(link), track, b.language);
    if (next) setB((x) => applyLink(x, next));
    setExpanded(null);
  }, [link, track, b.language]);

  const plan = shownPlan(b, ctx);
  const total = planTotal(plan.stages);
  const offer = account ? saveOffer(b, ctx) : null;

  // Unknown (loading or failed) counts as usable: the server says so if it is not.
  const keyState = aiKey.data?.state ?? 'active';
  const needsKey = keyState !== 'active';

  const start = useMutation({
    mutationFn: () => {
      const prefs = loadStartPrefs();
      saveStartPrefs({
        ...prefs,
        language: b.language,
        interviewer: { ...interviewer, enabled: true },
      });
      return api.createInterview(createRequest(track, startPlan(b, ctx, names), interviewer));
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
  const planKey = JSON.stringify(plan.stages);
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset when the plan changes
  useEffect(() => reset(), [planKey, reset]);

  const select = (s: Selection) => {
    setB(choose(b, s, ctx));
    setExpanded(null);
    if (s.kind !== 'preview') dropLink();
  };

  /**
   * The plan shown edited. Off the draft this starts a new draft, which may first ask; `open`
   * is the stage to have open after it.
   */
  const change = (stages: typeof plan.stages, open: number | null = expanded) => {
    const { next, ask } = edit(b, stages, ctx);
    if (next === b) return;
    if (ask) {
      setPending({ next, language: b.language, expanded: open });
      return;
    }
    setB(next);
    setExpanded(open);
    if (next.selection.kind !== b.selection.kind) dropLink();
  };
  const add = (kind: StageKind) => {
    if (!canAddStage(plan.stages)) return;
    const stages = addStage(plan.stages, kind, {
      language: b.language,
      topics: defaultTopics(topics.data ?? [], track, b.language),
    });
    change(stages, plan.stages.length);
  };
  const move = (index: number, by: -1 | 1) => {
    let open = expanded;
    if (expanded === index) open = index + by;
    else if (expanded === index + by) open = index;
    change(moveStage(plan.stages, index, by), open);
  };
  const remove = (index: number) => {
    if (!canRemoveStage(plan.stages)) return;
    let open = expanded;
    if (expanded === index) open = null;
    else if (expanded !== null && expanded > index) open = expanded - 1;
    change(removeStage(plan.stages, index), open);
  };

  const replaceDraft = () => {
    if (!pending) return;
    // The language chosen with the edit, if it chose one, stays.
    setB((x) => ({ ...pending.next, language: x.language }));
    setExpanded(pending.expanded);
    setPending(null);
    dropLink();
  };
  const keepDraft = () => {
    if (!pending) return;
    setB((x) => ({ ...x, language: pending.language }));
    setPending(null);
  };

  const setTemplates = (f: (list: InterviewTemplate[]) => InterviewTemplate[]) =>
    qc.setQueryData<InterviewTemplate[]>(qk.interviewTemplates, (list) =>
      list ? byName(f(list)) : list,
    );
  const onSaved = (t: InterviewTemplate, how: 'update' | 'new') => {
    setTemplates((list) => [...list.filter((x) => x.id !== t.id), t]);
    void qc.invalidateQueries({ queryKey: qk.interviewTemplates });
    setB((x) => afterSave(x, t));
    setSaving(false);
    setExpanded(null);
    dropLink();
    toast.success(how === 'update' ? `Updated “${t.name}”` : `Saved as “${t.name}”`);
  };

  const full = !canAddStage(plan.stages);
  const begin = () => (needsKey ? setKeyDialog(true) : start.mutate());
  const custom = b.selection.kind === 'custom';
  const shownName = selectionLabel(b, ctx, names);

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
            saved={saved}
            preview={
              b.preview ? { label: previewLabel(b.preview, names), stages: b.preview.stages } : null
            }
            draft={b.draft?.stages ?? null}
            value={b.selection}
            onChoose={select}
            onRename={setRenaming}
            onDelete={setDeleting}
          />
        </div>

        <div className="rounded-lg border border-border bg-surface">
          <div className="flex min-h-11 flex-wrap items-center gap-x-3 gap-y-1 border-b border-border py-1.5 pr-2 pl-4">
            <h2 id="plan-heading" className="mr-auto text-sm font-semibold">
              Your interview
            </h2>
            <span
              className="text-xs text-fg-muted tabular max-sm:hidden"
              data-testid="plan-total-inline"
            >
              {total}
            </span>
            {(offer || custom) && (
              <div className="flex items-center gap-1">
                {offer && (
                  <Button size="sm" onClick={() => setSaving(true)} data-testid="save-plan">
                    <SaveIcon /> Save
                  </Button>
                )}
                {custom && (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setDiscarding(true)}
                    aria-label="Discard custom plan"
                  >
                    <Trash2Icon /> Discard
                  </Button>
                )}
              </div>
            )}
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
                onChange={(s) => change(replaceStage(plan.stages, i, s))}
                onLanguage={(l) => setB((x) => ({ ...x, language: l }))}
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

      <ConfirmDialog
        open={pending !== null}
        title="Replace your custom plan?"
        confirm="Replace it"
        cancel="Keep my custom plan"
        onConfirm={replaceDraft}
        onCancel={keepDraft}
        testId="replace-draft"
      >
        Your custom plan ({b.draft ? planTotal(b.draft.stages) : ''}) is not saved. Changing{' '}
        {shownName} starts a new custom plan in its place.
      </ConfirmDialog>

      <ConfirmDialog
        open={discarding}
        title="Discard your custom plan?"
        confirm="Discard"
        onConfirm={() => {
          setB(discard(b, track));
          setExpanded(null);
          setDiscarding(false);
          dropLink();
        }}
        onCancel={() => setDiscarding(false)}
        testId="discard-draft"
      >
        Its {b.draft ? planTotal(b.draft.stages) : 'stages'} are gone for good, and the plan goes
        back to {presets[0]?.label ?? 'the first preset'}.
      </ConfirmDialog>

      {offer && (
        <SaveDialog
          open={saving}
          onOpenChange={setSaving}
          track={track}
          stages={plan.stages}
          suggested={suggestedName(b, ctx, names)}
          update={offer.update}
          onSaved={onSaved}
        />
      )}
      <RenameDialog
        plan={renaming}
        onClose={() => setRenaming(null)}
        onRenamed={(t) => {
          setTemplates((list) => list.map((x) => (x.id === t.id ? t : x)));
          void qc.invalidateQueries({ queryKey: qk.interviewTemplates });
          setB((x) => afterRename(x, t));
          setRenaming(null);
        }}
      />
      <ConfirmDeleteDialog
        copy={
          deleting
            ? {
                action: 'Delete',
                title: `Delete “${deleting.name}”?`,
                description: 'The saved plan goes from Your interviews.',
                lostHeading: 'What happens',
                lost: [
                  `Its plan (${planTotal(deleting.stages)}) is deleted.`,
                  'Interviews you started from it are kept, with their reports.',
                ],
                confirm: 'Delete',
                pending: 'Deleting',
                done: `Deleted “${deleting.name}”`,
                failed: 'It could not be deleted.',
              }
            : null
        }
        confirmKey={deleting?.id ?? null}
        onConfirm={async () => {
          if (!deleting) return;
          const id = deleting.id;
          try {
            await api.deleteInterviewTemplate(id);
          } catch (e) {
            // Gone already (another tab): as good as deleted.
            if (!(e instanceof ApiRequestError && e.isNotFound)) throw e;
          }
          setTemplates((list) => list.filter((x) => x.id !== id));
          void qc.invalidateQueries({ queryKey: qk.interviewTemplates });
          setB((x) => afterDelete(x, id, track));
        }}
        onClose={() => {
          setDeleting(null);
          // A deleted plan's menu button is gone: focus the card now chosen instead.
          setTimeout(() => {
            if (!document.activeElement || document.activeElement === document.body)
              focusChosenCard();
          }, 50);
        }}
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
