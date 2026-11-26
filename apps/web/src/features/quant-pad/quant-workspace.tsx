'use client';
/**
 * A quant pad: a live round of quant questions with the AI interviewer. No editor and no runs:
 * the question on one side, the conversation in the middle, the scratchpad (and the whiteboard)
 * on the other. Loaded with `next/dynamic` from the pad page, so its math (KaTeX) never loads
 * with a coding pad, and Monaco never loads here.
 */
import { HelpCircleIcon, type LucideIcon, MessagesSquareIcon, NotebookPenIcon } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Group, Panel, useDefaultLayout } from 'react-resizable-panels';
import { MathMarkdown } from '@/components/math-markdown';
import { type ChatHandle, ChatPanel } from '@/features/pad/chat-panel';
import { EndDialog, ShareDialog } from '@/features/pad/dialogs';
import { incomingMessages } from '@/features/pad/layout';
import { EndedBanner, ResizeHandle } from '@/features/pad/pad-chrome';
import { usePad } from '@/features/pad/session';
import { useShortcuts } from '@/features/pad/shortcuts';
import { TopBar } from '@/features/pad/top-bar';
import { PortalSlot, useIsDesktop, useKeyboardBox, usePortalNode } from '@/features/pad/use-layout';
import { cn } from '@/lib/utils';
import {
  clearQuantUnread,
  gameMoves,
  NO_QUANT_UNREAD,
  noteQuantActivity,
  QUANT_PANES,
  type QuantPane,
  type QuantUnread,
} from './logic';
import { QuestionPanel, QuestionStrip } from './question-panel';
import { Scratchpad } from './scratchpad';

const storage = typeof window === 'undefined' ? undefined : window.localStorage;

const PANE_ICON: Record<QuantPane, LucideIcon> = {
  question: HelpCircleIcon,
  scratch: NotebookPenIcon,
  chat: MessagesSquareIcon,
};
const PANE_LABEL: Record<QuantPane, string> = {
  question: 'Question',
  scratch: 'Scratchpad',
  chat: 'Chat',
};

/** The phone layout's bottom bar, as the coding pad's: one tab per pane. */
function PaneTabs({
  pane,
  onPane,
  unread,
}: {
  pane: QuantPane;
  onPane: (p: QuantPane) => void;
  unread: QuantUnread;
}) {
  return (
    <div
      role="tablist"
      aria-label="Pad sections"
      className="flex shrink-0 border-t border-border bg-surface pb-[env(safe-area-inset-bottom)]"
    >
      {QUANT_PANES.map((p) => {
        const Icon = PANE_ICON[p];
        const active = pane === p;
        const dot = p === 'question' && unread.question;
        const count = p === 'chat' ? unread.chat : 0;
        return (
          <button
            key={p}
            type="button"
            role="tab"
            id={`pane-tab-${p}`}
            aria-controls={`pane-${p}`}
            aria-selected={active}
            data-testid={`pane-tab-${p}`}
            onClick={() => onPane(p)}
            className={cn(
              'relative flex h-14 min-w-0 flex-1 flex-col items-center justify-center gap-0.5 text-[11px] font-medium transition-colors select-none',
              active ? 'text-accent-text' : 'text-fg-muted active:bg-surface-3',
            )}
          >
            <span
              aria-hidden
              className={cn(
                'absolute inset-x-4 top-0 h-0.5 rounded-b-full',
                active ? 'bg-accent' : 'bg-transparent',
              )}
            />
            <span className="relative">
              <Icon className="size-5" aria-hidden />
              {dot && (
                <span
                  className="absolute -top-0.5 -right-1 size-2 rounded-full bg-accent ring-2 ring-surface"
                  data-testid="question-unread"
                />
              )}
              {count > 0 && (
                <span
                  className="absolute -top-1.5 -right-2.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-accent px-1 text-2xs font-semibold text-accent-fg tabular ring-2 ring-surface"
                  data-testid="chat-tab-unread"
                  aria-hidden
                >
                  {count > 9 ? '9+' : count}
                </span>
              )}
            </span>
            <span className="max-w-full truncate px-1">{PANE_LABEL[p]}</span>
            {dot && <span className="sr-only">(new question)</span>}
            {count > 0 && <span className="sr-only">({count} new)</span>}
          </button>
        );
      })}
    </div>
  );
}

export function QuantWorkspace() {
  const pad = usePad();
  const { state, readOnly, telemetry, endPad } = pad;
  const router = useRouter();
  const chatRef = useRef<ChatHandle>(null);
  const [dialog, setDialog] = useState<null | 'end' | 'share'>(null);
  const [ending, setEnding] = useState(false);

  // Below lg one pane at a time, as on the coding pad; each panel is rendered once into a node
  // the current layout attaches (see usePortalNode), so crossing the breakpoint keeps them.
  const desktop = useIsDesktop();
  const compact = !desktop;
  const keyboard = useKeyboardBox(compact);
  const [pane, setPaneState] = useState<QuantPane>('chat');
  const paneRef = useRef(pane);
  paneRef.current = pane;
  const [unread, setUnread] = useState<QuantUnread>(NO_QUANT_UNREAD);
  const setPane = (p: QuantPane) => {
    setPaneState(p);
    setUnread((u) => clearQuantUnread(u, p));
  };
  const nodeClass = 'relative h-full w-full overflow-hidden';
  const questionNode = usePortalNode(nodeClass);
  const scratchNode = usePortalNode(nodeClass);
  const chatNode = usePortalNode(nodeClass);

  const seenMessages = useRef(state.messages.length);
  const seenQuestions = useRef(state.round?.questions.length ?? 0);
  const posed = state.round?.questions.length ?? 0;
  // A game's trades and reveals happen on the question pane too.
  const moves = gameMoves(state.round);
  const seenMoves = useRef(moves);
  useEffect(() => {
    const messages = incomingMessages(state.messages, seenMessages.current, state.me);
    seenMessages.current = state.messages.length;
    const newQuestion = posed > seenQuestions.current || moves > seenMoves.current;
    seenQuestions.current = posed;
    seenMoves.current = moves;
    if (!compact) return;
    setUnread((u) => noteQuantActivity(u, paneRef.current, { messages, newQuestion }));
  }, [state.messages, state.me, posed, moves, compact]);

  const mainLayout = useDefaultLayout({
    id: 'ipp-quant-main',
    storage,
    panelIds: ['question', 'chat', 'scratch'],
  });

  useShortcuts({
    focusChat: () => {
      if (compact) setPane('chat');
      requestAnimationFrame(() => chatRef.current?.focus());
    },
    toggleMic: () => chatRef.current?.toggleMic(),
  });

  // Blur telemetry, as on a coding pad: how long the candidate was away from the tab.
  useEffect(() => {
    if (readOnly) return;
    let since: number | null = null;
    const blur = () => {
      since = Date.now();
    };
    const focus = () => {
      if (since === null) return;
      const ms = Date.now() - since;
      since = null;
      if (ms >= 2000) telemetry('blur', ms);
    };
    window.addEventListener('blur', blur);
    window.addEventListener('focus', focus);
    return () => {
      window.removeEventListener('blur', blur);
      window.removeEventListener('focus', focus);
    };
  }, [readOnly, telemetry]);

  const toReport = () => router.push(`/pads/${state.pad.id}/report`);
  const endNow = async () => {
    setEnding(true);
    const ok = await endPad();
    setEnding(false);
    if (ok) toReport();
  };

  const questionContent = <QuestionPanel onEnd={() => void endNow()} ending={ending} />;
  const scratchContent = <Scratchpad />;
  const chatContent = (
    <div className="flex h-full flex-col">
      {compact && <QuestionStrip onOpen={() => setPane('question')} />}
      <div className="min-h-0 flex-1">
        <ChatPanel
          ref={chatRef}
          Text={MathMarkdown}
          lockInterviewer
          placeholder="Think out loud, or give your answer…"
          emptyState={{
            title: 'The interviewer is about to start',
            body: 'It says hello, then the first question appears. Think out loud here as you work; it reads your scratchpad too.',
          }}
        />
      </div>
    </div>
  );
  const nodes: Record<QuantPane, HTMLDivElement | null> = {
    question: questionNode,
    scratch: scratchNode,
    chat: chatNode,
  };

  return (
    <div
      className={cn(
        'flex h-dvh flex-col overflow-hidden bg-bg',
        compact
          ? 'fixed inset-x-0 top-0 pt-[env(safe-area-inset-top)] pr-[env(safe-area-inset-right)] pl-[env(safe-area-inset-left)]'
          : 'relative',
      )}
      style={keyboard ? { top: keyboard.top, height: keyboard.height } : undefined}
      data-testid="quant-workspace"
    >
      <TopBar onEnd={() => setDialog('end')} onShare={() => setDialog('share')} compact={compact} />
      <EndedBanner />

      {desktop ? (
        <Group
          orientation="horizontal"
          id="ipp-quant-main"
          className="min-h-0 flex-1"
          defaultLayout={mainLayout.defaultLayout}
          onLayoutChanged={mainLayout.onLayoutChanged}
        >
          <Panel id="question" defaultSize="29%" minSize="260px">
            <PortalSlot node={questionNode} className="h-full" />
          </Panel>
          <ResizeHandle />
          <Panel id="chat" minSize="340px" defaultSize="41%">
            <PortalSlot node={chatNode} className="h-full" />
          </Panel>
          <ResizeHandle />
          <Panel id="scratch" defaultSize="30%" minSize="240px" collapsible collapsedSize={0}>
            <PortalSlot node={scratchNode} className="h-full" />
          </Panel>
        </Group>
      ) : (
        <div className="relative min-h-0 flex-1" data-testid="pad-panes">
          {QUANT_PANES.map((p) => (
            <div
              key={p}
              id={`pane-${p}`}
              role="tabpanel"
              aria-labelledby={`pane-tab-${p}`}
              hidden={pane !== p}
              className="absolute inset-0"
            >
              <PortalSlot node={nodes[p]} className="h-full" />
            </div>
          ))}
        </div>
      )}
      {compact && !keyboard && <PaneTabs pane={pane} onPane={setPane} unread={unread} />}

      {questionNode && createPortal(questionContent, questionNode, 'question')}
      {scratchNode && createPortal(scratchContent, scratchNode, 'scratch')}
      {chatNode && createPortal(chatContent, chatNode, 'chat')}

      {compact && (
        <ShareDialog
          open={dialog === 'share'}
          onOpenChange={(o) => setDialog(o ? 'share' : null)}
        />
      )}
      <EndDialog
        open={dialog === 'end'}
        onOpenChange={(o) => setDialog(o ? 'end' : null)}
        onEnded={toReport}
      />
    </div>
  );
}
