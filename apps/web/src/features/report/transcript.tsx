'use client';
import {
  LANGUAGE_LABELS,
  type Message,
  type RunVerdict,
  RunVerdict as RunVerdictSchema,
  type TimelineEvent,
} from '@ipp/contracts';
import {
  ArrowDownLeftIcon,
  ArrowLeftRightIcon,
  ArrowUpRightIcon,
  ClipboardPasteIcon,
  CodeIcon,
  EyeIcon,
  EyeOffIcon,
  FlagIcon,
  HelpCircleIcon,
  MicIcon,
  ScaleIcon,
  TagIcon,
  UserPlusIcon,
} from 'lucide-react';
import { type ComponentType, forwardRef } from 'react';
import { RunVerdictIcon, toneText } from '@/components/domain';
import { Markdown } from '@/components/markdown';
import { entryText } from '@/features/quant-game/logic';
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
  return items.sort((a, b) => a.t - b.t || rank(a) - rank(b));
}

/**
 * At the same moment an event comes before a message (a question's marker before its text),
 * except a game's: the quote follows the candidate's message that posted it, and a trade or a
 * reveal the interviewer's message that made it.
 */
function rank(i: TranscriptItem): number {
  if (i.kind === 'message') return 1;
  return i.event.type === 'game' ? 2 : 0;
}

type GameEvent = Extract<TimelineEvent['event'], { type: 'game' }>;

/** A game's quote, trade, reveal or settlement, as one quiet line among the messages. */
function GameEventRow({ event }: { event: GameEvent }) {
  const e = event.entry;
  const Icon =
    e.kind === 'quote'
      ? TagIcon
      : e.kind === 'trade'
        ? e.candidateSide === 'buy'
          ? ArrowDownLeftIcon
          : ArrowUpRightIcon
        : e.kind === 'reveal'
          ? EyeIcon
          : ScaleIcon;
  const tone =
    e.kind === 'trade'
      ? e.candidateSide === 'buy'
        ? 'text-ok-text'
        : 'text-bad-text'
      : e.kind === 'settle'
        ? 'text-accent-text'
        : 'text-fg-subtle';
  return (
    <span
      className={cn(
        'flex min-w-0 items-center gap-2',
        e.kind === 'quote' ? 'text-fg-muted' : 'font-medium text-fg',
      )}
      data-testid="game-event"
      data-kind={e.kind}
    >
      <Icon className={cn('size-4 shrink-0', tone)} aria-hidden />
      <span className="truncate tabular">{entryText(e)}</span>
    </span>
  );
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
          <UserPlusIcon className="size-4 text-fg-subtle" aria-hidden /> Someone joined
        </span>
      );
    case 'problem':
      return (
        <span className="flex min-w-0 items-center gap-2 text-fg-muted">
          <ArrowLeftRightIcon className="size-4 shrink-0 text-fg-subtle" aria-hidden />
          <span className="truncate">
            Problem changed to <span className="font-medium text-fg">{event.title}</span>
          </span>
        </span>
      );
    case 'question':
      return (
        <span className="flex items-center gap-2 font-medium text-fg" data-testid="question-event">
          <HelpCircleIcon className="size-4 text-accent-text" aria-hidden /> Question{' '}
          {event.index + 1}
          {event.total === null ? '' : ` of ${event.total}`}
        </span>
      );
    case 'game':
      return <GameEventRow event={event} />;
    case 'ended':
      return (
        <span className="flex items-center gap-2 text-fg-muted">
          <FlagIcon className="size-4 text-fg-subtle" aria-hidden /> Interview ended
        </span>
      );
  }
}

/**
 * Who said it. In an interview room (`names` given) both sides are people, named; elsewhere the
 * interviewer is the AI and the candidate is the reader, or a collaborator of theirs.
 */
export function speaker(message: Message, selfId?: string, names?: Map<string, string>): string {
  if (message.userId && selfId && message.userId === selfId) return 'You';
  const named = message.userId ? names?.get(message.userId) : undefined;
  if (named) return named;
  if (message.role === 'interviewer') return 'Interviewer';
  if (names) return 'Candidate';
  return message.userId && selfId ? 'Collaborator' : 'You';
}

/** How interviewer messages are rendered: plain Markdown, or with math for a quant pad. */
export type TranscriptText = ComponentType<{ children: string; className?: string }>;

function MessageBody({
  message,
  selfId,
  names,
  Text,
}: {
  message: Message;
  selfId?: string;
  names?: Map<string, string>;
  Text: TranscriptText;
}) {
  const interviewer = message.role === 'interviewer';
  const question = interviewer && message.intent === 'question';
  const proactive = interviewer && message.kind === 'proactive' && !question;
  const who = speaker(message, selfId, names);
  return (
    <div
      className={cn(
        'rounded-lg px-3 py-2 text-sm',
        question
          ? 'border border-accent/40 bg-accent-soft/30'
          : proactive
            ? 'border border-proactive/40 bg-proactive-soft/60'
            : interviewer
              ? 'border border-border bg-surface'
              : 'bg-accent-soft/70',
      )}
    >
      <p
        className={cn(
          'mb-0.5 flex items-center gap-1.5 text-2xs font-medium',
          question ? 'text-accent-text' : proactive ? 'text-proactive' : 'text-fg-subtle',
        )}
      >
        {question
          ? 'Question'
          : proactive
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
        <Text className="text-sm leading-relaxed">{message.text}</Text>
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
    names?: Map<string, string>;
    Text?: TranscriptText;
  }
>(function TranscriptRow(
  { item, start, past, current, onSeek, selfId, names, Text = Markdown },
  ref,
) {
  const time = formatClock(Math.max(0, (item.t - start) / 1000));
  return (
    <li ref={ref} className={cn('group relative transition-opacity', !past && 'opacity-45')}>
      <button
        type="button"
        onClick={() => onSeek(item.t)}
        className={cn(
          'touch-hit absolute top-0 left-0 z-10 rounded px-1 py-0.5 font-mono text-2xs text-fg-subtle tabular hover:bg-surface-3 hover:text-fg',
          current && 'text-accent-text',
          item.kind === 'event' && 'top-1/2 -translate-y-1/2',
        )}
        aria-label={`Seek playback to ${time}`}
      >
        {time}
      </button>
      <div className={cn('pl-12', item.kind === 'message' ? '' : 'py-1 text-xs')}>
        {item.kind === 'message' ? (
          <MessageBody message={item.message} selfId={selfId} names={names} Text={Text} />
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
