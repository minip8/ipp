'use client';
/**
 * Starting a live quant round (the Quant track's Interviews tab, "Practise with the AI"), in the
 * Interviews tab's skeleton: what the round is and what the chosen path draws on, on the left;
 * the setup panel on the right (on a phone, first), with the page's `header` (the kind-of-interview
 * switch) at its top, then the path (Trader | Researcher), its length, the game, the
 * interviewer's options and, without a usable key, the way to add one (the interviewer runs the
 * round, so it cannot start without). Start creates the pad and opens it.
 */
import { QUANT_PATH_INFO, type QuantPath, quantQuestionCount } from '@ipp/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangleIcon, PlayIcon } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { type ReactNode, useEffect, useId, useRef, useState } from 'react';
import { useRetryCountdown } from '@/components/states';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/input';
import { Segmented } from '@/components/ui/segmented';
import { Skeleton } from '@/components/ui/skeleton';
import { Spinner } from '@/components/ui/spinner';
import { Switch } from '@/components/ui/switch';
import { AiKeyDialog } from '@/features/ai-key/ai-key-dialog';
import { AiKeyPrompt } from '@/features/ai-key/ai-key-prompt';
import { rejectedTitle } from '@/features/ai-key/logic';
import { InterviewerOptions, useSpeechSupported } from '@/features/new/interviewer-options';
import { TopicProgress } from '@/features/quiz/topic-progress';
import { ApiRequestError, api } from '@/lib/api';
import { useFitBelow } from '@/lib/layout-hooks';
import { loadStartPrefs } from '@/lib/prefs';
import { qk, useAiKey } from '@/lib/queries';
import {
  includesGame,
  loadRoundPrefs,
  ROUND_OPTIONS,
  type RoundPrefs,
  roundShape,
  roundStartError,
  saveRoundPrefs,
} from './logic';
import { QuantPathPicker } from './path-picker';

function initialPrefs(): RoundPrefs {
  const { style, proactivity, voice, model } = loadStartPrefs().interviewer;
  return loadRoundPrefs({ style, proactivity, voice, model });
}

/** The path's topics in order, each with how far the user is through its questions. */
function PathTopics({ path }: { path: QuantPath }) {
  const topics = useQuery({ queryKey: qk.quizTopics, queryFn: api.quizTopics });
  const steps = QUANT_PATH_INFO[path].topics.flatMap((slug) => {
    const t = topics.data?.find((x) => x.slug === slug);
    return t ? [t] : [];
  });
  if (topics.isPending)
    return (
      <div className="space-y-3" role="status" aria-label="Loading topics">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
      </div>
    );
  // The round still starts without them: the server draws the questions.
  if (steps.length === 0) return null;
  return (
    <ol className="divide-y divide-border" data-testid="round-topics">
      {steps.map((t, i) => (
        <li key={t.slug} className="flex items-start gap-3 py-3 first:pt-0 last:pb-0">
          <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-surface-3 text-2xs font-semibold text-fg-muted tabular">
            {i + 1}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-medium">{t.title}</span>
            <span className="mt-0.5 line-clamp-1 block text-xs text-fg-muted">{t.description}</span>
            <TopicProgress t={t} className="mt-2" />
          </span>
        </li>
      ))}
    </ol>
  );
}

export function RoundSetup({
  path,
  onPathChange,
  header,
}: {
  path: QuantPath;
  onPathChange: (p: QuantPath) => void;
  /** Shown at the top of the setup panel (the kind-of-interview switch). */
  header?: ReactNode;
}) {
  const router = useRouter();
  const qc = useQueryClient();
  const aiKey = useAiKey();
  const voiceOk = useSpeechSupported();
  const durationId = useId();
  const gameId = useId();
  const panel = useRef<HTMLElement>(null);
  useFitBelow(panel);
  const [prefs, setPrefs] = useState<RoundPrefs>(initialPrefs);
  const [keyDialog, setKeyDialog] = useState(false);
  // Unknown (loading or failed) counts as usable: the server says so if it is not.
  const keyState = aiKey.data?.state ?? 'active';
  const needsKey = keyState !== 'active';
  const questions = quantQuestionCount(prefs.durationMin);
  const info = QUANT_PATH_INFO[path];
  const game = includesGame(prefs, path);

  const update = (patch: Partial<RoundPrefs>) => setPrefs((p) => ({ ...p, ...patch }));
  const start = useMutation({
    mutationFn: () => {
      saveRoundPrefs(prefs);
      return api.createQuantPad({
        path,
        durationMin: prefs.durationMin,
        interviewer: prefs.interviewer,
        includeGame: game,
      });
    },
    onSuccess: (pad) => {
      void qc.invalidateQueries({ queryKey: qk.pads });
      router.push(`/pads/${pad.id}`);
    },
    onError: (e) => {
      // The key went missing since the page loaded: show the prompt for it.
      if (e instanceof ApiRequestError && e.code === 'ai_key_missing')
        void qc.invalidateQueries({ queryKey: qk.aiKey });
    },
  });
  const wait = useRetryCountdown(start.error);
  // An error was about the path it was started on.
  const { reset } = start;
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset when the path changes
  useEffect(() => reset(), [path, reset]);

  return (
    <div
      className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_380px]"
      data-testid="round-setup"
    >
      <section
        aria-labelledby="quant-round-heading"
        className="min-w-0 rounded-lg border border-border bg-surface max-lg:order-2"
      >
        <div className="space-y-1.5 border-b border-border p-4 sm:p-5">
          <h2 id="quant-round-heading" className="text-base font-semibold">
            Live interview round
          </h2>
          <p className="text-sm text-fg-muted">
            The AI interviewer asks you {questions} questions from the {info.label.toLowerCase()}{' '}
            path, one after another, against the clock. Think out loud in the chat or by voice and
            work on a shared scratchpad; it probes your reasoning, gives a hint when you are stuck
            and asks a follow-up before it moves on.
          </p>
          <p className="text-sm text-fg-muted">
            Afterwards the report scores each answer and shows the solutions.
          </p>
        </div>
        <div className="p-4 sm:p-5">
          <h3 className="mb-3 text-2xs font-medium tracking-wider text-fg-subtle uppercase">
            What the {info.label.toLowerCase()} path draws on
          </h3>
          <PathTopics path={path} />
        </div>
      </section>

      <section
        ref={panel}
        aria-label="Round setup"
        id="round-setup-panel"
        // Never taller than the window (useFitBelow refines it): the options scroll inside and
        // Start stays in view, as on the Software setup.
        className="min-w-0 scroll-mt-20 rounded-lg border border-border bg-surface max-lg:order-1 lg:sticky lg:top-20 lg:max-h-[calc(100dvh-6rem)] lg:overflow-y-auto"
      >
        {header && <div className="border-b border-border p-4">{header}</div>}
        <div className="space-y-1.5 border-b border-border p-4">
          <Label>Path</Label>
          <QuantPathPicker value={path} onValueChange={onPathChange} className="flex w-full" />
          <p className="text-xs text-fg-muted" data-testid="path-description">
            {info.description}
          </p>
        </div>
        <div className="space-y-5 p-4">
          <div className="space-y-1.5">
            <Label id={durationId}>Length</Label>
            <Segmented
              aria-label="Round length"
              className="flex w-full max-sm:[&>*]:h-9"
              value={String(prefs.durationMin)}
              onValueChange={(v) => update({ durationMin: Number(v) as RoundPrefs['durationMin'] })}
              options={ROUND_OPTIONS.map((o) => ({
                value: String(o.durationMin),
                label: `${o.durationMin} min`,
                hint: `${o.questions} questions`,
              }))}
            />
            <p className="text-xs text-fg-muted" data-testid="round-shape">
              {roundShape(prefs.durationMin)}. Time you save on one question carries over to the
              next.
            </p>
          </div>
          <div className="flex items-start gap-3" data-testid="round-game">
            <Switch
              id={gameId}
              checked={game}
              onCheckedChange={(on) =>
                setPrefs((p) => ({ ...p, games: { ...p.games, [path]: on } }))
              }
              aria-describedby={`${gameId}-hint`}
              className="mt-0.5"
            />
            <div className="min-w-0 space-y-0.5">
              <Label htmlFor={gameId}>Include a market-making game</Label>
              <p id={`${gameId}-hint`} className="text-xs text-fg-muted">
                One question becomes a live market on hidden dice: you quote, the interviewer trades
                against you, and the report shows the edge of every trade.
              </p>
            </div>
          </div>
          {needsKey && (
            <AiKeyPrompt
              size="sm"
              testId="round-key-prompt"
              state={keyState === 'rejected' ? 'rejected' : 'missing'}
              title={
                keyState === 'rejected'
                  ? rejectedTitle(aiKey.data?.provider)
                  : 'The round runs on your own AI API key'
              }
            >
              {keyState === 'rejected'
                ? 'Save a working key to start a round.'
                : 'The interviewer asks the questions on it, so a round cannot start without one.'}
            </AiKeyPrompt>
          )}
          <div className="rounded-md border border-border px-3 pt-3 pb-3.5">
            <p className="mb-3 text-sm font-medium">Interviewer</p>
            <InterviewerOptions
              value={prefs.interviewer}
              onChange={(patch) =>
                setPrefs((p) => ({ ...p, interviewer: { ...p.interviewer, ...patch } }))
              }
              voiceOk={voiceOk}
            />
          </div>
        </div>
        {/* Pinned to the bottom of the panel, as the Software setup's Start is. */}
        <div className="sticky bottom-0 z-10 space-y-2 rounded-b-lg border-t border-border bg-surface p-4 pb-[calc(1rem_+_env(safe-area-inset-bottom))] lg:pb-4">
          {start.error && (
            <p
              role="alert"
              className="flex items-start gap-2 text-sm text-bad-text"
              data-testid="round-error"
            >
              <AlertTriangleIcon className="mt-0.5 size-4 shrink-0" aria-hidden />
              <span>{roundStartError(start.error, prefs.durationMin)}</span>
            </p>
          )}
          <Button
            variant="primary"
            size="lg"
            className="w-full"
            disabled={start.isPending || wait > 0}
            onClick={() => (needsKey ? setKeyDialog(true) : start.mutate())}
          >
            {start.isPending ? <Spinner /> : <PlayIcon />}
            Start the round
          </Button>
          <p className="text-center text-xs text-fg-muted">The clock starts when the pad opens.</p>
        </div>
      </section>
      <AiKeyDialog
        open={keyDialog}
        onOpenChange={setKeyDialog}
        title="Add your API key to start"
        description="The interviewer runs the round on your own API key (Anthropic, OpenAI, Google Gemini or OpenRouter)."
        submitLabel="Save key and start"
        onSaved={() => start.mutate()}
      />
    </div>
  );
}
