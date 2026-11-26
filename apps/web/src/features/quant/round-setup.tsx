'use client';
/**
 * Starting a live quant round from the Quant page, on the chosen path: its length, the
 * interviewer's options and, without a usable key, the way to add one (the interviewer runs the
 * round, so it cannot start without). Start creates the pad and opens it.
 */
import { QUANT_PATH_INFO, type QuantPath, quantQuestionCount } from '@ipp/contracts';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { AlertTriangleIcon, PlayIcon } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useId, useState } from 'react';
import { useRetryCountdown } from '@/components/states';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Label } from '@/components/ui/input';
import { Segmented } from '@/components/ui/segmented';
import { Spinner } from '@/components/ui/spinner';
import { AiKeyDialog } from '@/features/ai-key/ai-key-dialog';
import { AiKeyPrompt } from '@/features/ai-key/ai-key-prompt';
import { rejectedTitle } from '@/features/ai-key/logic';
import { InterviewerOptions, useSpeechSupported } from '@/features/new/interviewer-options';
import { ApiRequestError, api } from '@/lib/api';
import { loadStartPrefs } from '@/lib/prefs';
import { qk, useAiKey } from '@/lib/queries';
import {
  loadRoundPrefs,
  ROUND_OPTIONS,
  type RoundPrefs,
  roundShape,
  roundStartError,
  saveRoundPrefs,
} from './logic';

function initialPrefs(): RoundPrefs {
  const { style, proactivity, voice, model } = loadStartPrefs().interviewer;
  return loadRoundPrefs({ style, proactivity, voice, model });
}

export function RoundSetup({ path }: { path: QuantPath }) {
  const router = useRouter();
  const qc = useQueryClient();
  const aiKey = useAiKey();
  const voiceOk = useSpeechSupported();
  const durationId = useId();
  const [prefs, setPrefs] = useState<RoundPrefs>(initialPrefs);
  const [keyDialog, setKeyDialog] = useState(false);
  // Unknown (loading or failed) counts as usable: the server says so if it is not.
  const keyState = aiKey.data?.state ?? 'active';
  const needsKey = keyState !== 'active';
  const questions = quantQuestionCount(prefs.durationMin);
  const info = QUANT_PATH_INFO[path];

  const update = (patch: Partial<RoundPrefs>) => setPrefs((p) => ({ ...p, ...patch }));
  const start = useMutation({
    mutationFn: () => {
      saveRoundPrefs(prefs);
      return api.createQuantPad({
        path,
        durationMin: prefs.durationMin,
        interviewer: prefs.interviewer,
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

  return (
    <Card
      aria-labelledby={`quant-round-${path}-heading`}
      className="border-accent/50 ring-1 ring-accent/20"
      data-testid="round-setup"
    >
      <div className="grid gap-x-8 gap-y-5 p-4 sm:p-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,400px)] lg:grid-rows-[auto_1fr]">
        <div className="min-w-0 space-y-4 lg:col-start-1 lg:row-start-1">
          <div className="space-y-1.5">
            <h2 id={`quant-round-${path}-heading`} className="text-base font-semibold">
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
          <div className="space-y-1.5">
            <Label id={durationId}>Length</Label>
            <Segmented
              aria-label="Round length"
              className="flex w-full max-w-sm max-sm:max-w-none max-sm:[&>*]:h-9"
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
        </div>
        <div className="min-w-0 space-y-3 lg:col-start-2 lg:row-span-2 lg:row-start-1">
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
        {/* Last on a phone (after the options), under the description on a wide screen. */}
        <div className="min-w-0 space-y-2.5 lg:col-start-1 lg:row-start-2 lg:self-end">
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
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <Button
              variant="primary"
              size="lg"
              className="max-sm:w-full"
              disabled={start.isPending || wait > 0}
              onClick={() => (needsKey ? setKeyDialog(true) : start.mutate())}
            >
              {start.isPending ? <Spinner /> : <PlayIcon />}
              Start the round
            </Button>
            <p className="text-xs text-fg-muted">The clock starts when the pad opens.</p>
          </div>
        </div>
      </div>
      <AiKeyDialog
        open={keyDialog}
        onOpenChange={setKeyDialog}
        title="Add your API key to start"
        description="The interviewer runs the round on your own API key (Anthropic, OpenAI, Google Gemini or OpenRouter)."
        submitLabel="Save key and start"
        onSaved={() => start.mutate()}
      />
    </Card>
  );
}
