'use client';
/**
 * The right-hand panel of an interview room. A candidate gets the chat. The host gets the chat
 * plus two things that are theirs alone: private notes and the AI second opinion.
 */
import { MessagesSquareIcon, NotebookPenIcon, SparklesIcon } from 'lucide-react';
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import type { ChatHandle } from '@/features/pad/chat-panel';
import { usePad } from '@/features/pad/session';
import { cn } from '@/lib/utils';
import { PrivateNotes, SecondOpinion } from './host-tools';
import { RoomChat } from './room-chat';

export const RoomSidePanel = forwardRef<ChatHandle, { className?: string }>(function RoomSidePanel(
  { className },
  ref,
) {
  const { isHost, state, me } = usePad();
  const chat = useRef<ChatHandle>(null);
  const [tab, setTab] = useState('chat');
  // Messages that arrived while the host was on another tab.
  const [unread, setUnread] = useState(0);
  const seen = useRef(state.messages.length);
  useEffect(() => {
    const fresh = state.messages.slice(seen.current).filter((m) => m.userId !== me.id).length;
    seen.current = state.messages.length;
    if (tab === 'chat') setUnread(0);
    else if (fresh) setUnread((u) => u + fresh);
  }, [state.messages, tab, me.id]);

  useImperativeHandle(ref, () => ({
    focus: () => {
      setTab('chat');
      requestAnimationFrame(() => chat.current?.focus());
    },
    toggleMic: () => {},
  }));

  if (!isHost) return <RoomChat ref={chat} className={className} />;
  return (
    <Tabs
      value={tab}
      onValueChange={setTab}
      className={cn('flex h-full flex-col bg-surface', className)}
    >
      <TabsList aria-label="Room panel" className="h-9 shrink-0 border-b border-border px-2">
        <TabsTrigger value="chat">
          <MessagesSquareIcon /> Chat
          {unread > 0 && (
            <span
              className="flex h-4 min-w-4 items-center justify-center rounded-full bg-accent px-1 text-2xs font-semibold text-accent-fg tabular"
              data-testid="chat-unread"
            >
              {unread}
              <span className="sr-only"> new</span>
            </span>
          )}
        </TabsTrigger>
        <TabsTrigger value="notes">
          <NotebookPenIcon /> My notes
        </TabsTrigger>
        <TabsTrigger value="review">
          <SparklesIcon /> Second opinion
        </TabsTrigger>
      </TabsList>
      {/* Kept mounted: a half-written message, unsaved notes and past reviews survive a tab change. */}
      <TabsContent
        value="chat"
        forceMount
        hidden={tab !== 'chat'}
        className="min-h-0 flex-1 focus-visible:outline-none"
      >
        <RoomChat ref={chat} bare />
      </TabsContent>
      <TabsContent
        value="notes"
        forceMount
        hidden={tab !== 'notes'}
        className="min-h-0 flex-1 focus-visible:outline-none"
      >
        <PrivateNotes padId={state.pad.id} />
      </TabsContent>
      <TabsContent
        value="review"
        forceMount
        hidden={tab !== 'review'}
        className="min-h-0 flex-1 focus-visible:outline-none"
      >
        <SecondOpinion />
      </TabsContent>
    </Tabs>
  );
});
