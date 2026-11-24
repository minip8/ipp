'use client';
import {
  LANGUAGE_LABELS,
  type Message,
  type RunVerdict,
  RunVerdict as RunVerdictSchema,
  type TimelineEvent,
} from '@ipp/contracts';
import {
  ClipboardPasteIcon,
  CodeIcon,
  EyeOffIcon,
  FlagIcon,
  MicIcon,
  UserPlusIcon,
} from 'lucide-react';
import { forwardRef } from 'react';
import { RunVerdictIcon, toneText } from '@/components/domain';
import { Markdown } from '@/components/markdown';
import { formatClock, formatDuration, humanize } from '@/lib/format';
import { cn } from '@/lib/utils';
import { MODE_LABEL, RUN_VERDICT } from '@/lib/verdict';

export type TranscriptItem =
  | { kind: 'message'; t: number; key: string; message: Message }
  | { kind: 'event'; t: number; key: string; event: TimelineEvent['event'] };

export function buildTranscript(
  messages: readonly Message[],
  events: readonly TimelineEvent[],
): TranscriptItem[] {
  const items: TranscriptItem[] = [
    ...messages.map((m) => ({
      kind: 'message' as const,
      t: Date.parse(m.createdAt),
      key: m.id,
      message: m,
    })),
    ...events.map((e) => ({
      kind: 'event' as const,
      t: Date.parse(e.at),
      key: e.id,
      event: e.event,
    })),
  ];
  return items.sort((a, b) => a.t - b.t || (a.kind === 'event' ? -1 : 1));
}

export function asRunVerdict(v: string | null): RunVerdict | null {
  const p = RunVerdictSchema.safeParse(v);
  return p.success ? p.data : null;
}

export function runEventLabel(e: Extract<TimelineEvent['event'], { type: 'run' }>) {
  const verdict = asRunVerdict(e.verdict);
  const mode = MODE_LABEL[e.mode as keyof typeof MODE_LABEL] ?? humanize(e.mode);
  const label = verdict
    ? e.mode === 'file' && verdict === 'ok'
      ? 'Exited normally'
      : RUN_VERDICT[verdict].label
    : 'No result';
  return { verdict, mode, label, counts: e.total > 0 ? `${e.passed}/${e.total} passed` : null };
}

function EventRow({ event }: { event: TimelineEvent['event'] }) {
  switch (event.type) {
    case 'run': {
      const { verdict, mode, label, counts } = runEventLabel(event);
      return (
        <span className="flex min-w-0 items-center gap-2">
          {verdict ? (
            <RunVerdictIcon verdict={verdict} />
          ) : (
            <CodeIcon className="size-4 text-fg-subtle" aria-hidden />
          )}
          <span className="font-medium text-fg">{mode}</span>
          <span
            className={cn(
              'truncate',
              verdict ? toneText[RUN_VERDICT[verdict].tone] : 'text-fg-muted',
            )}
          >
            {label}
          </span>
          {counts && <span className="shrink-0 text-fg-subtle tabular">{counts}</span>}
        </span>
      );
    }
    case 'language':
      return (
        <span className="flex items-center gap-2 text-fg-muted">
          <CodeIcon className="size-4 text-fg-subtle" aria-hidden /> Switched to{' '}
          {LANGUAGE_LABELS[event.language]}
        </span>
      );
    case 'paste':
      return (
        <span className="flex items-center gap-2 text-fg-muted">
          <ClipboardPasteIcon className="size-4 text-fg-subtle" aria-hidden /> Pasted {event.chars}{' '}
          characters
        </span>
      );
    case 'blur':
      return (
        <span className="flex items-center gap-2 text-fg-muted">
          <EyeOffIcon className="size-4 text-fg-subtle" aria-hidden /> Left the pad for{' '}
          {formatDuration(event.ms / 1000)}
        </span>
      );
    case 'joined':
      return (
        <span className="flex items-center gap-2 text-fg-muted">
          <UserPlusIcon className="size-4 text-fg-subtle" aria-hidden /> A collaborator joined
        </span>
      );
    case 'ended':
      return (
        <span className="flex items-center gap-2 text-fg-muted">
          <FlagIcon className="size-4 text-fg-subtle" aria-hidden /> Interview ended
        </span>
      );
  }
}

function MessageBody({ message, selfId }: { message: Message; selfId?: string }) {
  const interviewer = message.role === 'interviewer';
  const proactive = interviewer && message.kind === 'proactive';
  const who = interviewer
    ? 'Interviewer'
    : message.userId && selfId && message.userId !== selfId
      ? 'Collaborator'
      : 'You';
  return (
    <div
      className={cn(
        'rounded-lg px-3 py-2 text-sm',
        proactive
          ? 'border border-proactive/40 bg-proactive-soft/60'
          : interviewer
            ? 'border border-border bg-surface'
            : 'bg-accent-soft/70',
      )}
    >
      <p
        className={cn(
          'mb-0.5 flex items-center gap-1.5 text-2xs font-medium',
          proactive ? 'text-proactive' : 'text-fg-subtle',
        )}
      >
        {proactive
          ? `Spoke up${message.intent ? ` · ${humanize(message.intent).toLowerCase()}` : ''}`
          : who}
        {message.via === 'voice' && (
          <span className="inline-flex items-center gap-0.5 text-fg-subtle">
            <MicIcon className="size-3" aria-hidden />
            <span className="sr-only">spoken</span>
          </span>
        )}
      </p>
      {interviewer ? (
        <Markdown className="text-sm leading-relaxed">{message.text}</Markdown>
      ) : (
        <p className="leading-relaxed whitespace-pre-wrap">{message.text}</p>
      )}
    </div>
  );
}

export const TranscriptRow = forwardRef<
  HTMLLIElement,
  {
    item: TranscriptItem;
    start: number;
    past: boolean;
    current: boolean;
    onSeek: (t: number) => void;
    selfId?: string;
  }
>(function TranscriptRow({ item, start, past, current, onSeek, selfId }, ref) {
  const time = formatClock(Math.max(0, (item.t - start) / 1000));
  return (
    <li ref={ref} className={cn('group relative transition-opacity', !past && 'opacity-45')}>
      <button
        type="button"
        onClick={() => onSeek(item.t)}
        className={cn(
          'absolute top-0 left-0 z-10 rounded px-1 py-0.5 font-mono text-2xs text-fg-subtle tabular hover:bg-surface-3 hover:text-fg',
          current && 'text-accent-text',
          item.kind === 'event' && 'top-1/2 -translate-y-1/2',
        )}
        aria-label={`Seek playback to ${time}`}
      >
        {time}
      </button>
      <div className={cn('pl-12', item.kind === 'message' ? '' : 'py-1 text-xs')}>
        {item.kind === 'message' ? (
          <MessageBody message={item.message} selfId={selfId} />
        ) : (
          <EventRow event={item.event} />
        )}
      </div>
      {current && (
        <span
          aria-hidden
          className="absolute top-0 bottom-0 -left-3 w-0.5 rounded-full bg-accent"
        />
      )}
    </li>
  );
});
