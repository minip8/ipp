'use client';
/**
 * The AI interviewer's options when setting up a session: style, how often it speaks up, the
 * model, the saved key and voice. Shared by the coding interview setup and the Quant track's live
 * round, so both offer the same choices in the same words.
 */
import type { InterviewerSettings } from '@ipp/contracts';
import { MicIcon } from 'lucide-react';
import { useEffect, useId, useState } from 'react';
import { Label } from '@/components/ui/input';
import { Segmented } from '@/components/ui/segmented';
import { Switch } from '@/components/ui/switch';
import { ModelPicker } from '@/features/ai-key/model-picker';
import { SavedKeyLine } from '@/features/ai-key/saved-key-line';
import { cn } from '@/lib/utils';

/** Phones: small segmented controls at a size a finger can hit. */
const TOUCH_SEGMENTS_SM = 'max-sm:[&>*]:h-8';

/** Whether this browser can both recognise speech and speak (voice mode needs both). */
export function speechSupported() {
  if (typeof window === 'undefined') return true;
  const w = window as unknown as Record<string, unknown>;
  return Boolean(w.SpeechRecognition || w.webkitSpeechRecognition) && 'speechSynthesis' in window;
}

/** `speechSupported()`, read after mount (the server renders as if it were). */
export function useSpeechSupported() {
  const [ok, setOk] = useState(true);
  useEffect(() => setOk(speechSupported()), []);
  return ok;
}

export type InterviewerChoices = Omit<InterviewerSettings, 'enabled'>;

export function InterviewerOptions({
  value,
  onChange,
  voiceOk,
  className,
}: {
  value: InterviewerChoices;
  onChange: (patch: Partial<InterviewerChoices>) => void;
  voiceOk: boolean;
  className?: string;
}) {
  const ids = { style: useId(), pro: useId() };
  return (
    <div className={cn('space-y-4', className)}>
      <div className="space-y-1.5">
        <Label id={ids.style} className="text-xs text-fg-muted">
          Style
        </Label>
        <Segmented
          aria-label="Interviewer style"
          size="sm"
          className={cn('flex w-full', TOUCH_SEGMENTS_SM)}
          value={value.style}
          onValueChange={(style) => onChange({ style })}
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
          className={cn('flex w-full', TOUCH_SEGMENTS_SM)}
          value={value.proactivity}
          onValueChange={(proactivity) => onChange({ proactivity })}
          options={[
            { value: 'low', label: 'Rarely' },
            { value: 'normal', label: 'Sometimes' },
            { value: 'high', label: 'Often' },
          ]}
        />
      </div>
      <ModelPicker value={value.model} onChange={(model) => onChange({ model })} />
      <SavedKeyLine />
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
          checked={value.voice && voiceOk}
          disabled={!voiceOk}
          onCheckedChange={(voice) => onChange({ voice })}
        />
      </div>
    </div>
  );
}
