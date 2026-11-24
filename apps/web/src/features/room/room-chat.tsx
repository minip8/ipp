'use client';
/**
 * The chat of an interview room: people talking to each other (the host and whoever they
 * invited). No AI takes part, so there is nothing to configure here.
 */
import { CAPS } from '@ipp/contracts';
import { ArrowDownIcon, ArrowUpIcon, MessagesSquareIcon } from 'lucide-react';
import {
  forwardRef,
  useCallback,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Button } from '@/components/ui/button';
import { Kbd } from '@/components/ui/kbd';
import { CandidateBubble, type ChatHandle } from '@/features/pad/chat-panel';
import { usePad } from '@/features/pad/session';
import { type ChatItem, chatItems } from '@/features/pad/state';
import { formatTimeOfDay } from '@/lib/format';
import { cn } from '@/lib/utils';
import { authorName, roomSubtitle } from './logic';

function Item({ item }: { item: ChatItem }) {
  const { me, state, retryPending } = usePad();
  if (item.kind === 'streaming') return null;
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
  return (
    <CandidateBubble
      text={m.text}
      via={m.via}
      who={m.userId === me.id ? undefined : authorName(m, state.members)}
      meta={formatTimeOfDay(m.createdAt)}
    />
  );
}

export const RoomChat = forwardRef<ChatHandle, { className?: string; bare?: boolean }>(
  function RoomChat({ className, bare }, ref) {
    const { state, me, isHost, sendChat, readOnly, socketStatus } = usePad();
    const [draft, setDraft] = useState('');
    const input = useRef<HTMLTextAreaElement>(null);
    const scroller = useRef<HTMLDivElement>(null);
    const [stuck, setStuck] = useState(true);
    const [unseen, setUnseen] = useState(0);
    const items = useMemo(() => chatItems(state), [state]);

    useImperativeHandle(ref, () => ({
      focus: () => input.current?.focus(),
      toggleMic: () => {},
    }));

    // Stick to the bottom unless the reader scrolled up.
    const lastLen = useRef(0);
    useLayoutEffect(() => {
      const el = scroller.current;
      if (!el) return;
      if (stuck) el.scrollTop = el.scrollHeight;
      else if (items.length > lastLen.current)
        setUnseen((u) => u + (items.length - lastLen.current));
      lastLen.current = items.length;
    }, [items.length, stuck]);
    const onScroll = useCallback(() => {
      const el = scroller.current;
      if (!el) return;
      const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
      setStuck(atBottom);
      if (atBottom) setUnseen(0);
    }, []);

    const over = draft.length > CAPS.chatChars;
    const send = () => {
      const t = draft.trim();
      if (!t || over) return;
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

    const subtitle = roomSubtitle(state.members, me.id);

    return (
      <section aria-label="Chat" className={cn('flex h-full flex-col bg-surface', className)}>
        {!bare && (
          <header className="flex h-9 shrink-0 items-center gap-2 border-b border-border px-3">
            <span className="text-sm font-medium">Chat</span>
            <span className="flex min-w-0 items-center gap-1.5 text-xs text-fg-subtle">
              <span
                className={cn(
                  'size-1.5 shrink-0 rounded-full',
                  socketStatus === 'open' ? 'bg-ok' : 'bg-warn',
                )}
                aria-hidden
              />
              <span className="truncate" data-testid="room-people">
                {socketStatus === 'open' ? subtitle : 'connecting'}
              </span>
            </span>
          </header>
        )}

        <div className="relative min-h-0 flex-1">
          <div
            ref={scroller}
            onScroll={onScroll}
            className="h-full overflow-y-auto px-3 py-4"
            aria-live="polite"
            aria-relevant="additions"
          >
            {items.length === 0 ? (
              <div className="flex h-full flex-col items-center justify-center px-4 text-center text-sm text-fg-muted">
                <MessagesSquareIcon className="mb-2 size-5 text-fg-subtle" aria-hidden />
                <p className="font-medium text-fg">No messages yet</p>
                <p className="mt-1 max-w-60 text-xs">
                  {isHost
                    ? 'Everyone in the room sees what is written here. Your notes and the AI second opinion stay with you.'
                    : 'Ask your interviewer anything here. Everyone in the room sees what you write.'}
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

        {!readOnly && (
          <form
            className="shrink-0 border-t border-border p-2.5"
            onSubmit={(e) => {
              e.preventDefault();
              send();
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
                    send();
                  }
                  if (e.key === 'Escape') input.current?.blur();
                }}
                placeholder={isHost ? 'Message your candidate…' : 'Message your interviewer…'}
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
  },
);
