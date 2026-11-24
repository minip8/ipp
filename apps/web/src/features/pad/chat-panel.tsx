'use client';
import { CAPS, type Message } from '@ipp/contracts';
import {
  AlertCircleIcon,
  ArrowDownIcon,
  ArrowUpIcon,
  BotOffIcon,
  ClockIcon,
  CpuIcon,
  KeyRoundIcon,
  MicIcon,
  MicOffIcon,
  MoreHorizontalIcon,
  RotateCwIcon,
  SparklesIcon,
  SquareIcon,
  Volume2Icon,
} from 'lucide-react';
import {
  forwardRef,
  useCallback,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Markdown } from '@/components/markdown';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Kbd } from '@/components/ui/kbd';
import {
  Menu,
  MenuContent,
  MenuItem,
  MenuLabel,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator,
  MenuTrigger,
} from '@/components/ui/menu';
import { Tooltip } from '@/components/ui/tooltip';
import { AiKeyPrompt } from '@/features/ai-key/ai-key-prompt';
import { providerLabel, rejectedTitle } from '@/features/ai-key/logic';
import { ModelPicker } from '@/features/ai-key/model-picker';
import { ManageKeyDialog } from '@/features/ai-key/saved-key-line';
import { formatTimeOfDay, humanize } from '@/lib/format';
import { useAiKey } from '@/lib/queries';
import { cn } from '@/lib/utils';
import { usePad } from './session';
import { type ChatItem, chatItems, type PendingMessage } from './state';
import { useVoice, type VoiceMode } from './voice/use-voice';

export type ChatHandle = { focus(): void; toggleMic(): void };

const INTENT_LABEL: Partial<Record<NonNullable<Message['intent']>, string>> = {
  greeting: 'intro',
  time_check: 'time check',
  wrap_up: 'wrapping up',
};

function InterviewerMark({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        'flex size-6 shrink-0 items-center justify-center rounded-md bg-surface-3 text-fg-muted',
        className,
      )}
    >
      <SparklesIcon className="size-3.5" />
    </span>
  );
}

function InterviewerMessage({ m }: { m: Message }) {
  const proactive = m.kind === 'proactive';
  return (
    <div
      className="flex gap-2.5 animate-fade-in"
      data-testid={proactive ? 'proactive-message' : 'interviewer-message'}
    >
      <InterviewerMark className={cn(proactive && 'bg-proactive-soft text-proactive')} />
      <div
        className={cn(
          'min-w-0 flex-1',
          proactive && 'rounded-lg border border-proactive/35 bg-proactive-soft/40 px-3 py-2',
        )}
      >
        <p className="mb-0.5 flex items-center gap-1.5 text-2xs text-fg-subtle">
          {proactive ? (
            <span className="font-medium text-proactive">
              Spoke up
              {m.intent ? ` · ${INTENT_LABEL[m.intent] ?? humanize(m.intent).toLowerCase()}` : ''}
            </span>
          ) : (
            <span className="font-medium text-fg-muted">Interviewer</span>
          )}
          <span aria-hidden>·</span>
          <time dateTime={m.createdAt}>{formatTimeOfDay(m.createdAt)}</time>
        </p>
        <Markdown className="text-[13.5px] leading-relaxed">{m.text}</Markdown>
      </div>
    </div>
  );
}

function CandidateBubble({
  text,
  via,
  meta,
  status,
  onRetry,
  who,
}: {
  text: string;
  via: 'text' | 'voice';
  meta: React.ReactNode;
  status?: PendingMessage['status'];
  onRetry?: () => void;
  who?: string;
}) {
  const mine = !who;
  return (
    <div className={cn('flex flex-col animate-fade-in', mine ? 'items-end' : 'items-start')}>
      <div
        className={cn(
          'max-w-[88%] rounded-lg px-3 py-2 text-[13.5px] leading-relaxed whitespace-pre-wrap break-words',
          mine
            ? 'rounded-br-sm bg-accent-soft text-fg'
            : 'rounded-bl-sm border border-border bg-surface-2',
          status === 'failed' && 'border border-bad/40 bg-bad-soft/60',
          (status === 'sending' || status === 'queued') && 'opacity-70',
        )}
      >
        {who && <p className="mb-0.5 text-2xs font-medium text-fg-muted">{who}</p>}
        {text}
      </div>
      <p className="mt-0.5 flex items-center gap-1 px-1 text-2xs text-fg-subtle">
        {via === 'voice' && <MicIcon className="size-3" aria-label="spoken" />}
        {status === 'failed' ? (
          <>
            <AlertCircleIcon className="size-3 text-bad" aria-hidden />
            <span className="text-bad-text">Not sent</span>
            <button
              type="button"
              onClick={onRetry}
              className="ml-1 inline-flex items-center gap-0.5 font-medium text-accent-text hover:underline"
            >
              <RotateCwIcon className="size-3" /> Retry
            </button>
          </>
        ) : status === 'queued' ? (
          <>
            <ClockIcon className="size-3" aria-hidden /> Sends when you are back online
          </>
        ) : status === 'sending' ? (
          'Sending…'
        ) : (
          meta
        )}
      </p>
    </div>
  );
}

function Thinking() {
  return (
    <div
      className="flex items-center gap-2.5 animate-fade-in"
      data-testid="interviewer-thinking"
      role="status"
    >
      <InterviewerMark />
      <span className="flex items-center gap-1" aria-hidden>
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className="size-1.5 animate-pulse-dot rounded-full bg-fg-subtle"
            style={{ animationDelay: `${i * 160}ms` }}
          />
        ))}
      </span>
      <span className="text-xs text-fg-subtle">Interviewer is thinking</span>
    </div>
  );
}

function Item({ item }: { item: ChatItem }) {
  const { me, retryPending } = usePad();
  if (item.kind === 'streaming')
    return (
      <div className="flex gap-2.5" data-testid="streaming-message">
        <InterviewerMark />
        <div className="min-w-0 flex-1">
          <p className="mb-0.5 text-2xs font-medium text-fg-muted">Interviewer</p>
          <div className="relative">
            <Markdown className="text-[13.5px] leading-relaxed">{item.text}</Markdown>
            <span
              aria-hidden
              className="ml-0.5 inline-block h-3.5 w-1.5 translate-y-0.5 animate-pulse rounded-[1px] bg-accent align-baseline"
            />
          </div>
        </div>
      </div>
    );
  if (item.kind === 'pending')
    return (
      <CandidateBubble
        text={item.pending.text}
        via={item.pending.via}
        status={item.pending.status}
        onRetry={() => retryPending(item.pending.localId)}
        meta={formatTimeOfDay(item.pending.createdAt)}
      />
    );
  const m = item.message;
  if (m.role === 'interviewer') return <InterviewerMessage m={m} />;
  return (
    <CandidateBubble
      text={m.text}
      via={m.via}
      who={m.userId && m.userId !== me.id ? 'Collaborator' : undefined}
      meta={formatTimeOfDay(m.createdAt)}
    />
  );
}

function VoiceBar({ voice }: { voice: ReturnType<typeof useVoice> }) {
  const push = voice.mode === 'push';
  return (
    <div className="border-t border-border bg-surface-2/60 px-3 py-2.5" data-testid="voice-bar">
      {!voice.supported.recognition ? (
        <p className="text-xs text-fg-muted">
          This browser cannot recognise speech, so you can type instead. Replies are still read
          aloud{voice.supported.synthesis ? '' : ' where supported'}.
        </p>
      ) : (
        <div className="flex items-center gap-3">
          <button
            type="button"
            aria-pressed={voice.listening}
            aria-label={
              voice.listening ? 'Stop talking' : push ? 'Hold to talk' : 'Start listening'
            }
            onPointerDown={(e) => {
              if (!push) return;
              e.currentTarget.setPointerCapture(e.pointerId);
              voice.start();
            }}
            onPointerUp={() => push && voice.stop()}
            onPointerCancel={() => push && voice.stop()}
            onClick={() => !push && voice.toggle()}
            onKeyDown={(e) => {
              if (push && (e.key === ' ' || e.key === 'Enter') && !e.repeat) {
                e.preventDefault();
                voice.start();
              }
            }}
            onKeyUp={(e) => {
              if (push && (e.key === ' ' || e.key === 'Enter')) voice.stop();
            }}
            className={cn(
              'relative flex size-10 shrink-0 items-center justify-center rounded-full border transition-colors select-none',
              voice.listening
                ? 'border-transparent bg-bad text-white'
                : 'border-border-strong bg-surface text-fg hover:bg-surface-3',
            )}
          >
            {voice.listening && (
              <span className="absolute inset-0 animate-ping rounded-full bg-bad/30" aria-hidden />
            )}
            <MicIcon className="relative size-4.5" />
          </button>
          <div className="min-w-0 flex-1" aria-live="polite">
            {voice.listening ? (
              <p className="truncate text-sm text-fg">
                {voice.interim || <span className="text-fg-muted">Listening…</span>}
              </p>
            ) : voice.speaking ? (
              <p className="flex items-center gap-1.5 text-sm text-fg-muted">
                <Volume2Icon className="size-4 text-accent-text" aria-hidden /> Speaking. Start
                talking to interrupt.
              </p>
            ) : (
              <p className="text-sm text-fg-muted">
                {push ? 'Hold the mic, or press ' : 'Click the mic or press '}
                <Kbd keys="Alt+M" /> {push ? 'to talk' : 'to start hands-free'}
              </p>
            )}
            {voice.error && voice.error.code !== 'unsupported' && (
              <p className="mt-0.5 text-xs text-bad-text">{voice.error.message}</p>
            )}
          </div>
          {voice.speaking && (
            <Tooltip label="Stop speaking">
              <Button
                size="icon-sm"
                variant="ghost"
                onClick={voice.stopSpeaking}
                aria-label="Stop speaking"
              >
                <SquareIcon />
              </Button>
            </Tooltip>
          )}
        </div>
      )}
    </div>
  );
}

/** Changing the interviewer's model mid-interview (owner only; stored on the pad). */
function ModelDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const { state, updateInterviewer } = usePad();
  const m = state.interviewerModel;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md" onKeyDown={(e) => e.stopPropagation()}>
        <DialogHeader>
          <DialogTitle>Interviewer model</DialogTitle>
          <DialogDescription>
            {m
              ? `Now: ${m.id} (${providerLabel(m.provider)}${m.chosen ? '' : ', default'}). The next message uses the new choice.`
              : 'The interviewer runs on your own API key.'}
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="pb-5">
          <ModelPicker
            value={state.pad.interviewer.model}
            onChange={(model) => updateInterviewer({ model })}
          />
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}

/** Shown instead of the interviewer while the pad owner has no usable API key. */
function KeyNeeded() {
  const { state, setInterviewerKey } = usePad();
  const rejected = state.interviewerKey === 'rejected';
  const own = useAiKey(state.role === 'owner');
  if (state.role !== 'owner')
    return (
      <p
        className="m-3 flex items-start gap-2 rounded-md border border-border bg-surface-2 px-3 py-2 text-xs text-fg-muted"
        role="status"
        data-testid="ai-key-prompt"
        data-state={state.interviewerKey}
      >
        <BotOffIcon className="mt-px size-4 shrink-0" aria-hidden />
        <span>
          {rejected
            ? 'The interviewer is paused: the AI provider rejected the pad owner’s API key.'
            : 'The interviewer joins once the pad owner adds their AI API key.'}{' '}
          You can still code, run tests and chat.
        </span>
      </p>
    );
  return (
    <AiKeyPrompt
      className="m-3"
      size="sm"
      state={rejected ? 'rejected' : 'missing'}
      title={
        rejected ? rejectedTitle(own.data?.provider) : 'The interviewer runs on your own AI API key'
      }
      dialogTitle={rejected ? 'Update your API key' : undefined}
      onSaved={() => setInterviewerKey('active')}
    >
      {rejected
        ? 'The interviewer is paused. Save a working key and it picks up from here.'
        : 'Add one and it joins right away. Your code and chat stay as they are.'}
    </AiKeyPrompt>
  );
}

export const ChatPanel = forwardRef<ChatHandle, { className?: string }>(function ChatPanel(
  { className },
  ref,
) {
  const { state, sendChat, readOnly, updateInterviewer, socketStatus } = usePad();
  const [draft, setDraft] = useState('');
  const [modelDialog, setModelDialog] = useState(false);
  const [keyDialog, setKeyDialog] = useState(false);
  const input = useRef<HTMLTextAreaElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const [stuck, setStuck] = useState(true);
  const [unseen, setUnseen] = useState(0);
  const items = useMemo(() => chatItems(state), [state]);
  const enabled = state.pad.interviewer.enabled;
  const available = state.interviewerAvailable && enabled;
  const voiceOn = available && state.pad.interviewer.voice && !readOnly;

  const voice = useVoice({
    enabled: voiceOn,
    messages: state.messages,
    onUtterance: (t) => sendChat(t, 'voice'),
  });

  useImperativeHandle(ref, () => ({
    focus: () => input.current?.focus(),
    toggleMic: () => voiceOn && voice.toggle(),
  }));

  // Stick to the bottom unless the reader scrolled up.
  const lastLen = useRef(0);
  const streamingLen = Object.values(state.streaming).reduce((n, s) => n + s.text.length, 0);
  // biome-ignore lint/correctness/useExhaustiveDependencies: streamed text and the thinking row also grow the list
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    if (stuck) el.scrollTop = el.scrollHeight;
    else if (items.length > lastLen.current) setUnseen((u) => u + (items.length - lastLen.current));
    lastLen.current = items.length;
  }, [items.length, streamingLen, state.thinking, stuck]);
  const onScroll = useCallback(() => {
    const el = scroller.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
    setStuck(atBottom);
    if (atBottom) setUnseen(0);
  }, []);

  const send = () => {
    const t = draft.trim();
    if (!t) return;
    sendChat(t);
    setDraft('');
    setStuck(true);
  };

  // Auto-grow the composer up to ~8 lines.
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-measure when the text changes
  useLayoutEffect(() => {
    const el = input.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 180)}px`;
  }, [draft]);

  const over = draft.length > CAPS.chatChars;

  return (
    <section
      aria-label="Interviewer chat"
      className={cn('flex h-full flex-col bg-surface', className)}
    >
      <header className="flex h-9 shrink-0 items-center gap-2 border-b border-border pr-1.5 pl-3">
        <span className="text-sm font-medium">Interviewer</span>
        {available ? (
          <span className="flex items-center gap-1.5 text-xs text-fg-subtle">
            <span
              className={cn('size-1.5 rounded-full', socketStatus === 'open' ? 'bg-ok' : 'bg-warn')}
              aria-hidden
            />
            {state.thinking
              ? 'thinking'
              : socketStatus === 'open'
                ? humanize(state.pad.interviewer.style)
                : 'connecting'}
          </span>
        ) : (
          <span className="text-xs text-fg-subtle">
            {!enabled
              ? 'off'
              : state.interviewerKey === 'rejected'
                ? 'key rejected'
                : 'needs a key'}
          </span>
        )}
        <div className="ml-auto flex items-center gap-0.5">
          {available && !readOnly && (
            <Tooltip label={voiceOn ? 'Turn voice off' : 'Turn voice on'}>
              <Button
                size="icon-sm"
                variant="ghost"
                aria-pressed={voiceOn}
                aria-label="Voice mode"
                onClick={() => updateInterviewer({ voice: !voiceOn })}
                className={cn(voiceOn && 'text-accent-text')}
              >
                {voiceOn ? <MicIcon /> : <MicOffIcon />}
              </Button>
            </Tooltip>
          )}
          {available && !readOnly && (
            <Menu>
              <MenuTrigger asChild>
                <Button size="icon-sm" variant="ghost" aria-label="Interviewer options">
                  <MoreHorizontalIcon />
                </Button>
              </MenuTrigger>
              <MenuContent align="end" className="w-60">
                <MenuLabel>Speaks up unprompted</MenuLabel>
                <MenuRadioGroup
                  value={state.pad.interviewer.proactivity}
                  onValueChange={(v) =>
                    updateInterviewer({ proactivity: v as 'low' | 'normal' | 'high' })
                  }
                >
                  <MenuRadioItem value="low">Rarely</MenuRadioItem>
                  <MenuRadioItem value="normal">Sometimes</MenuRadioItem>
                  <MenuRadioItem value="high">Often</MenuRadioItem>
                </MenuRadioGroup>
                <MenuSeparator />
                <MenuLabel>Voice input</MenuLabel>
                <MenuRadioGroup
                  value={voice.mode}
                  onValueChange={(v) => voice.setMode(v as VoiceMode)}
                >
                  <MenuRadioItem value="push">Push to talk</MenuRadioItem>
                  <MenuRadioItem value="handsfree">Hands-free</MenuRadioItem>
                </MenuRadioGroup>
                <MenuSeparator />
                <MenuLabel>Model</MenuLabel>
                {state.role === 'owner' ? (
                  <MenuItem onSelect={() => setModelDialog(true)} data-testid="interviewer-model">
                    <CpuIcon />
                    <span className="min-w-0 flex-1 truncate font-mono text-xs">
                      {state.interviewerModel?.id ?? 'Provider default'}
                    </span>
                    <span className="text-xs text-fg-subtle">Change…</span>
                  </MenuItem>
                ) : (
                  <p
                    className="truncate px-2 pb-1.5 font-mono text-xs text-fg-muted"
                    data-testid="interviewer-model"
                  >
                    {state.interviewerModel?.id ?? 'Provider default'}
                  </p>
                )}
                {state.role === 'owner' && (
                  <MenuItem onSelect={() => setKeyDialog(true)} data-testid="interviewer-key">
                    <KeyRoundIcon />
                    <span className="min-w-0 flex-1">API key</span>
                    <span className="text-xs text-fg-subtle">Change or remove…</span>
                  </MenuItem>
                )}
                <MenuSeparator />
                <MenuItem onSelect={() => updateInterviewer({ enabled: false })}>
                  <BotOffIcon /> Turn the interviewer off
                </MenuItem>
              </MenuContent>
            </Menu>
          )}
          {state.role === 'owner' && !readOnly && (
            <>
              <ModelDialog open={modelDialog} onOpenChange={setModelDialog} />
              <ManageKeyDialog open={keyDialog} onOpenChange={setKeyDialog} />
            </>
          )}
        </div>
      </header>

      {!enabled ? (
        <div className="m-3 flex items-center gap-2 rounded-md border border-border bg-surface-2 px-3 py-2 text-xs text-fg-muted">
          <BotOffIcon className="size-4 shrink-0" aria-hidden />
          <span className="flex-1">The interviewer is off for this pad.</span>
          {!readOnly && (
            <Button size="xs" onClick={() => updateInterviewer({ enabled: true })}>
              Turn on
            </Button>
          )}
        </div>
      ) : !state.interviewerAvailable && !readOnly ? (
        <KeyNeeded />
      ) : null}

      <div className="relative min-h-0 flex-1">
        <div
          ref={scroller}
          onScroll={onScroll}
          className="h-full overflow-y-auto px-3 py-4"
          aria-live="polite"
          aria-relevant="additions"
        >
          {items.length === 0 && !state.thinking ? (
            <div className="flex h-full flex-col items-center justify-center px-4 text-center text-sm text-fg-muted">
              <SparklesIcon className="mb-2 size-5 text-fg-subtle" aria-hidden />
              <p className="font-medium text-fg">
                {available ? 'Your interviewer will join shortly' : 'No messages yet'}
              </p>
              <p className="mt-1 max-w-60 text-xs">
                {available
                  ? 'Ask clarifying questions here, and think out loud as you work. The interviewer reads your code as you type.'
                  : 'Messages you send appear here for everyone in the pad.'}
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              {items.map((it) => (
                <Item
                  key={
                    it.kind === 'message'
                      ? it.message.id
                      : it.kind === 'streaming'
                        ? it.id
                        : it.pending.localId
                  }
                  item={it}
                />
              ))}
              {state.thinking && Object.keys(state.streaming).length === 0 && <Thinking />}
            </div>
          )}
        </div>
        {!stuck && unseen > 0 && (
          <button
            type="button"
            onClick={() => {
              setStuck(true);
              setUnseen(0);
            }}
            className="absolute bottom-3 left-1/2 inline-flex -translate-x-1/2 items-center gap-1 rounded-full border border-border bg-surface px-3 py-1 text-xs font-medium shadow-pop hover:bg-surface-2"
          >
            <ArrowDownIcon className="size-3.5" /> {unseen} new
          </button>
        )}
      </div>

      {voiceOn && <VoiceBar voice={voice} />}

      {!readOnly && (
        <form
          className="shrink-0 border-t border-border p-2.5"
          onSubmit={(e) => {
            e.preventDefault();
            if (!over) send();
          }}
        >
          <div className="flex items-end gap-2 rounded-lg border border-border-strong bg-surface px-2.5 py-1.5 focus-within:border-accent focus-within:ring-3 focus-within:ring-accent/20">
            <label htmlFor="chat-input" className="sr-only">
              Message
            </label>
            <textarea
              id="chat-input"
              ref={input}
              rows={1}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  if (!over) send();
                }
                if (e.key === 'Escape') input.current?.blur();
              }}
              placeholder={
                available ? 'Ask a question or explain your approach…' : 'Message collaborators…'
              }
              className="max-h-44 min-h-[22px] flex-1 resize-none bg-transparent py-0.5 text-[13.5px] leading-[22px] outline-none placeholder:text-fg-subtle"
            />
            <Button
              type="submit"
              size="icon-xs"
              variant="primary"
              disabled={!draft.trim() || over}
              aria-label="Send message"
              className="mb-px rounded-md"
            >
              <ArrowUpIcon />
            </Button>
          </div>
          <p className="mt-1 flex justify-between px-1 text-2xs text-fg-subtle">
            <span>
              <Kbd keys="Enter" className="[&>span]:h-4 [&>span]:min-w-4" /> send ·{' '}
              <Kbd keys="Shift+Enter" className="[&>span]:h-4 [&>span]:min-w-4" /> new line
            </span>
            {draft.length > CAPS.chatChars * 0.8 && (
              <span className={cn('tabular', over && 'text-bad-text')}>
                {draft.length} / {CAPS.chatChars}
              </span>
            )}
          </p>
        </form>
      )}
    </section>
  );
});
