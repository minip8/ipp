'use client';
import { BLANK_SCAFFOLDS, LANGUAGES, type Language } from '@ipp/contracts';
import {
  CodeXmlIcon,
  FileCode2Icon,
  FileTextIcon,
  FlaskConicalIcon,
  LockIcon,
  type LucideIcon,
  MessagesSquareIcon,
  PenToolIcon,
  PlayIcon,
  RotateCcwIcon,
  SendIcon,
  SquareTerminalIcon,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Group, Panel, type PanelImperativeHandle, useDefaultLayout } from 'react-resizable-panels';
import { toast } from 'sonner';
import { LANG_FILE, LANG_LABEL } from '@/components/domain';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Spinner } from '@/components/ui/spinner';
import { Tooltip } from '@/components/ui/tooltip';
import { ChangeProblemDialog } from '@/features/room/change-problem-dialog';
import { InviteBanner } from '@/features/room/invite-banner';
import { RoomSidePanel } from '@/features/room/side-panel';
import { cn } from '@/lib/utils';
import { type ChatHandle, ChatPanel } from './chat-panel';
import { ConsolePanel, compileAll, useConsoleState } from './console/console-panel';
import { EndDialog, ResetDialog, SettingsDialog, ShareDialog, ShortcutsDialog } from './dialogs';
import { CodeEditor, type EditorCommand, type EditorHandle } from './editor/code-editor';
import { savedEditorSettingKeys, useEditorSettings } from './editor/settings';
import {
  clearUnread,
  incomingMessages,
  initialPane,
  NO_UNREAD,
  newlyFinished,
  noteActivity,
  PANES,
  type Pane,
  togglePane,
  touchEditorSettings,
  type Unread,
} from './layout';
import { EndedBanner, ResizeHandle } from './pad-chrome';
import { ProblemPanel } from './problem-panel';
import { usePad } from './session';
import { SHORTCUTS, type ShortcutId, useShortcuts } from './shortcuts';
import { TopBar } from './top-bar';
import { PortalSlot, useIsDesktop, useKeyboardBox, usePortalNode } from './use-layout';
import { Whiteboard } from './whiteboard';

const storage = typeof window === 'undefined' ? undefined : window.localStorage;

/** Under the editor on a phone: one row of big buttons where the thumb is. */
function CompactRunButtons({
  onRun,
  onTests,
  onSubmit,
}: {
  onRun: () => void;
  onTests: () => void;
  onSubmit: () => void;
}) {
  const { state, running, readOnly, synced } = usePad();
  if (readOnly) return null;
  const disabled = !synced || Boolean(running);
  const spin = (mode: string) => running?.mode === mode;
  return (
    <div
      className="flex shrink-0 items-center gap-2 border-t border-border bg-surface px-2 py-2"
      role="toolbar"
      aria-label="Run"
    >
      <Button
        size="lg"
        variant={state.problem ? 'secondary' : 'primary'}
        className="min-w-0 flex-1 px-2 text-sm"
        onClick={onRun}
        disabled={disabled}
        data-testid="run-file"
      >
        {spin('file') ? <Spinner /> : <PlayIcon className="fill-current" />} Run
      </Button>
      {state.problem && (
        <>
          <Button
            size="lg"
            variant="secondary"
            className="min-w-0 flex-1 px-2 text-sm"
            onClick={onTests}
            disabled={disabled}
            data-testid="run-tests"
          >
            {spin('samples') || spin('custom') ? <Spinner /> : <FlaskConicalIcon />} Run tests
          </Button>
          <Button
            size="lg"
            variant="primary"
            className="min-w-0 flex-1 px-2 text-sm"
            onClick={onSubmit}
            disabled={disabled}
            data-testid="submit"
          >
            {spin('submit') ? <Spinner /> : <SendIcon />} Submit
          </Button>
        </>
      )}
    </div>
  );
}

function RunButtons({
  onRun,
  onTests,
  onSubmit,
}: {
  onRun: () => void;
  onTests: () => void;
  onSubmit: () => void;
}) {
  const { state, running, readOnly, synced } = usePad();
  const disabled = readOnly || !synced || Boolean(running);
  const spin = (mode: string) => running?.mode === mode;
  // A blank room has nothing to test against: the program is simply run.
  if (!state.problem)
    return (
      <Tooltip label="Run the file as written" shortcut="Mod+Enter">
        <Button
          size="sm"
          variant="primary"
          onClick={onRun}
          disabled={disabled}
          data-testid="run-file"
        >
          {spin('file') ? <Spinner /> : <PlayIcon className="fill-current" />} Run
        </Button>
      </Tooltip>
    );
  return (
    <div className="flex items-center gap-1.5">
      <Tooltip label="Run the file as written, with your own main()" shortcut="Mod+Enter">
        <Button
          size="sm"
          variant="secondary"
          onClick={onRun}
          disabled={disabled}
          data-testid="run-file"
        >
          {spin('file') ? <Spinner /> : <PlayIcon className="fill-current" />} Run
        </Button>
      </Tooltip>
      <Tooltip label="Check your class against the sample tests" shortcut="Mod+'">
        <Button
          size="sm"
          variant="secondary"
          onClick={onTests}
          disabled={disabled}
          data-testid="run-tests"
        >
          {spin('samples') || spin('custom') ? <Spinner /> : <FlaskConicalIcon />} Run tests
        </Button>
      </Tooltip>
      <Tooltip label="Run all tests, including hidden ones" shortcut="Mod+Shift+Enter">
        <Button
          size="sm"
          variant="primary"
          onClick={onSubmit}
          disabled={disabled}
          data-testid="submit"
        >
          {spin('submit') ? <Spinner /> : <SendIcon />} Submit
        </Button>
      </Tooltip>
    </div>
  );
}

function StatusBar({ cursor }: { cursor: { line: number; col: number } }) {
  const { state, readOnly } = usePad();
  const settings = useEditorSettings();
  return (
    <footer className="flex h-6 shrink-0 items-center gap-4 border-t border-border bg-surface-2 px-3 text-2xs text-fg-subtle">
      {readOnly && (
        <span className="flex items-center gap-1 text-fg-muted">
          <LockIcon className="size-3" aria-hidden /> Read-only
        </span>
      )}
      <span className="tabular">
        Ln {cursor.line}, Col {cursor.col}
      </span>
      <span>Spaces: {settings.tabSize}</span>
      {settings.keymap !== 'standard' && <span className="capitalize">{settings.keymap}</span>}
      <span className="ml-auto">{LANG_LABEL[state.pad.language]}</span>
      <span>Saved automatically</span>
    </footer>
  );
}

const PANE_ICON: Record<Pane, LucideIcon> = {
  problem: FileTextIcon,
  code: CodeXmlIcon,
  console: SquareTerminalIcon,
  chat: MessagesSquareIcon,
};

/** The phone layout's bottom bar: one tab per pane. */
function PaneTabs({
  pane,
  onPane,
  unread,
  chatLabel,
}: {
  pane: Pane;
  onPane: (p: Pane) => void;
  unread: Unread;
  chatLabel: string;
}) {
  const { running } = usePad();
  const label: Record<Pane, string> = {
    problem: 'Problem',
    code: 'Code',
    console: 'Console',
    chat: chatLabel,
  };
  return (
    <div
      role="tablist"
      aria-label="Pad sections"
      className="flex shrink-0 border-t border-border bg-surface pb-[env(safe-area-inset-bottom)]"
    >
      {PANES.map((p) => {
        const Icon = PANE_ICON[p];
        const active = pane === p;
        const busy = p === 'console' && Boolean(running);
        const dot = p === 'console' && unread.console;
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
              {busy && (
                <span className="absolute -top-0.5 -right-1 size-2 animate-pulse rounded-full bg-accent ring-2 ring-surface" />
              )}
              {!busy && dot && (
                <span
                  className="absolute -top-0.5 -right-1 size-2 rounded-full bg-accent ring-2 ring-surface"
                  data-testid="console-unread"
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
            <span className="max-w-full truncate px-1">{label[p]}</span>
            {busy && <span className="sr-only">(running)</span>}
            {!busy && dot && <span className="sr-only">(new result)</span>}
            {count > 0 && <span className="sr-only">({count} new)</span>}
          </button>
        );
      })}
    </div>
  );
}

export function Workspace() {
  const pad = usePad();
  const { state, readOnly, collab, startRun, setLanguage, telemetry, running } = pad;
  const router = useRouter();
  const settings = useEditorSettings();
  const cs = useConsoleState(state.pad.id);
  const editorRef = useRef<EditorHandle>(null);
  const chatRef = useRef<ChatHandle>(null);
  const problemPanel = useRef<PanelImperativeHandle>(null);
  const chatPanel = useRef<PanelImperativeHandle>(null);
  const consolePanel = useRef<PanelImperativeHandle>(null);
  const [view, setView] = useState<'code' | 'board'>('code');
  const [dialog, setDialog] = useState<
    null | 'settings' | 'shortcuts' | 'end' | 'reset' | 'problem' | 'share'
  >(null);
  const problem = state.problem;
  const languages = problem?.languages ?? LANGUAGES;
  // In a room the telemetry is about the candidate, not about the host looking something up.
  const watched = !readOnly && !pad.isHost;
  const [cursor, setCursor] = useState({ line: 1, col: 1 });

  // Below lg the pad is one pane at a time with a tab bar (see layout.ts). The panels are rendered
  // once, into nodes that each layout attaches where it wants them, so crossing the breakpoint
  // (a tablet turning round, a window resized) keeps the editor, the chat and the console as they
  // were instead of remounting them.
  const desktop = useIsDesktop();
  const compact = !desktop;
  const keyboard = useKeyboardBox(compact);
  const [pane, setPaneState] = useState<Pane>(() => initialPane(Boolean(state.problem)));
  const paneRef = useRef(pane);
  paneRef.current = pane;
  const [unread, setUnread] = useState<Unread>(NO_UNREAD);
  const setPane = (p: Pane) => {
    setPaneState(p);
    setUnread((u) => clearUnread(u, p));
  };
  const nodeClass = 'relative h-full w-full overflow-hidden';
  const problemNode = usePortalNode(nodeClass);
  const editorNode = usePortalNode(nodeClass);
  const consoleNode = usePortalNode(nodeClass);
  const chatNode = usePortalNode(nodeClass);

  // What arrives on a pane that is not showing marks its tab.
  const seenMessages = useRef(state.messages.length);
  const finishedRuns = useRef(
    new Set(state.runs.filter((r) => r.status === 'finished').map((r) => r.id)),
  );
  useEffect(() => {
    const messages = incomingMessages(state.messages, seenMessages.current, state.me);
    seenMessages.current = state.messages.length;
    const finished = newlyFinished(finishedRuns.current, state.runs);
    for (const id of finished) finishedRuns.current.add(id);
    if (!compact) return;
    setUnread((u) => noteActivity(u, paneRef.current, { messages, finishedRuns: finished.length }));
  }, [state.messages, state.runs, state.me, compact]);

  // Monaco measures its box; a pane that was display:none measured 0 x 0.
  useEffect(() => {
    if (!compact || pane !== 'code') return;
    const f = requestAnimationFrame(() => editorRef.current?.layout());
    return () => cancelAnimationFrame(f);
  }, [compact, pane]);

  const editorSettings = useMemo(
    () => (compact ? touchEditorSettings(settings, savedEditorSettingKeys()) : settings),
    [compact, settings],
  );

  const mainLayout = useDefaultLayout({
    id: 'ipp-pad-main',
    storage,
    panelIds: ['problem', 'center', 'chat'],
  });
  const centerLayout = useDefaultLayout({
    id: 'ipp-pad-center',
    storage,
    panelIds: ['editor', 'console'],
  });

  const lang = state.pad.language;
  const latestFinished = useMemo(
    () => [...state.runs].reverse().find((r) => r.status === 'finished') ?? null,
    [state.runs],
  );

  const showResults = () => {
    cs.setTab('result');
    if (compact) setPane('console');
    else if (consolePanel.current?.isCollapsed()) consolePanel.current.expand();
  };
  const run = () => {
    showResults();
    void startRun('file', { stdin: cs.stdin });
  };
  const runTests = () => {
    if (!problem) return;
    showResults();
    void startRun('samples');
  };
  const submit = () => {
    if (!problem) return;
    showResults();
    void startRun('submit');
  };
  const runCustom = () => {
    if (!problem) return;
    const c = compileAll(problem.signature, cs.drafts);
    if (!c.ok || c.tests.length === 0) {
      cs.setTab('custom');
      if (compact) setPane('console');
      toast.error('Fix the custom tests first', {
        description:
          c.results.find((r) => r.errors.length)?.errors[0]?.message ?? 'Add at least one test.',
      });
      return;
    }
    showResults();
    void startRun('custom', { customTests: c.tests });
  };
  const toggle = (p: PanelImperativeHandle | null) => {
    if (!p) return;
    if (p.isCollapsed()) p.expand();
    else p.collapse();
  };

  const handlers: Partial<Record<ShortcutId, () => void>> = {
    run: () => !readOnly && !running && run(),
    runTests: () => !readOnly && !running && runTests(),
    submit: () => !readOnly && !running && submit(),
    save: () =>
      toast.message('Your code saves automatically', {
        description: 'Everyone in the pad sees every keystroke.',
      }),
    toggleProblem: () =>
      compact ? setPane(togglePane(pane, 'problem')) : toggle(problemPanel.current),
    toggleConsole: () =>
      compact ? setPane(togglePane(pane, 'console')) : toggle(consolePanel.current),
    toggleChat: () => (compact ? setPane(togglePane(pane, 'chat')) : toggle(chatPanel.current)),
    focusChat: () => {
      if (compact) setPane('chat');
      else if (chatPanel.current?.isCollapsed()) chatPanel.current.expand();
      requestAnimationFrame(() => chatRef.current?.focus());
    },
    focusEditor: () => {
      setView('code');
      if (compact) {
        setPane('code');
        requestAnimationFrame(() => editorRef.current?.focus());
      } else editorRef.current?.focus();
    },
    toggleMic: () => chatRef.current?.toggleMic(),
    settings: () => setDialog('settings'),
    shortcuts: () => setDialog('shortcuts'),
  };
  useShortcuts(handlers);
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;
  const editorCommands = useMemo<EditorCommand[]>(
    () =>
      SHORTCUTS.filter((s) => s.inEditor).map((s) => ({
        keys: s.keys,
        run: () => handlersRef.current[s.id]?.(),
      })),
    [],
  );

  // Blur telemetry: how long the candidate was away from the tab.
  useEffect(() => {
    if (!watched) return;
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
  }, [watched, telemetry]);

  const viewTab = (v: 'code' | 'board') =>
    cn(
      'flex items-center gap-1.5 border-r border-border px-3 text-sm',
      view === v
        ? 'bg-editor font-medium text-fg shadow-[inset_0_2px_0_var(--accent)]'
        : 'text-fg-muted hover:text-fg',
    );

  // The four panels, each rendered once into its own node (see usePortalNode).
  const problemContent = <ProblemPanel onChangeProblem={() => setDialog('problem')} />;
  const editorContent = (
    <div className="flex h-full flex-col">
      <div
        className={cn(
          'flex shrink-0 items-center gap-2 border-b border-border bg-surface pr-2',
          compact ? 'h-10' : 'h-9',
        )}
      >
        <div className="flex h-full items-stretch" role="tablist" aria-label="Editor view">
          <button
            type="button"
            role="tab"
            aria-selected={view === 'code'}
            onClick={() => setView('code')}
            className={viewTab('code')}
          >
            <FileCode2Icon className="size-3.5" aria-hidden /> {LANG_FILE[lang]}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={view === 'board'}
            onClick={() => setView('board')}
            className={viewTab('board')}
          >
            <PenToolIcon className={compact ? 'size-4' : 'size-3.5'} aria-hidden />{' '}
            {compact ? <span className="max-[400px]:sr-only">Whiteboard</span> : 'Whiteboard'}
          </button>
        </div>
        {view === 'code' && (
          <>
            <Select
              value={lang}
              onValueChange={(v) => void setLanguage(v as Language)}
              // A language-restricted problem offers only its own languages.
              disabled={readOnly || languages.length < 2}
            >
              <SelectTrigger
                className={cn('text-xs', compact ? 'h-8 w-24 min-w-0' : 'h-7 w-28')}
                aria-label="Language"
                title={
                  languages.length < LANGUAGES.length
                    ? `This problem can only be solved in ${languages.map((l) => LANG_LABEL[l]).join(' or ')}`
                    : undefined
                }
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {languages.map((l) => (
                  <SelectItem key={l} value={l}>
                    {LANG_LABEL[l]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {!readOnly && (
              <Tooltip label="Reset to starter code">
                <Button
                  size="icon-sm"
                  variant="ghost"
                  aria-label="Reset to starter code"
                  onClick={() => setDialog('reset')}
                  className={cn(compact && 'size-9')}
                >
                  <RotateCcwIcon />
                </Button>
              </Tooltip>
            )}
          </>
        )}
        {!compact && (
          <div className="ml-auto">
            <RunButtons onRun={run} onTests={runTests} onSubmit={submit} />
          </div>
        )}
      </div>
      <div className="relative min-h-0 flex-1">
        <CodeEditor
          ref={editorRef}
          className={cn('absolute inset-0', view !== 'code' && 'invisible')}
          collab={collab}
          synced={pad.synced}
          language={lang}
          readOnly={readOnly}
          settings={editorSettings}
          commands={editorCommands}
          diagnosticsRun={latestFinished}
          onPaste={(chars) => chars > 0 && watched && telemetry('paste', chars)}
          onCursor={(line, col) => setCursor({ line, col })}
          compact={compact}
        />
        {view === 'board' && (
          <div className="absolute inset-0">
            <Whiteboard active />
          </div>
        )}
      </div>
      {compact && <CompactRunButtons onRun={run} onTests={runTests} onSubmit={submit} />}
    </div>
  );
  const consoleContent = (
    <ConsolePanel
      cs={cs}
      onRunCustom={runCustom}
      onJump={(line, col) => {
        setView('code');
        if (compact) {
          setPane('code');
          requestAnimationFrame(() => {
            editorRef.current?.layout();
            editorRef.current?.revealLine(line, col ?? 1);
          });
        } else editorRef.current?.revealLine(line, col ?? 1);
      }}
    />
  );
  const chatContent = pad.isRoom ? <RoomSidePanel ref={chatRef} /> : <ChatPanel ref={chatRef} />;
  const nodes: Record<Pane, HTMLDivElement | null> = {
    problem: problemNode,
    code: editorNode,
    console: consoleNode,
    chat: chatNode,
  };

  return (
    // `relative`: visually hidden (sr-only) labels are absolutely positioned. Without a positioned
    // ancestor they sit in the document, outside every panel's clipping, at wherever their panel's
    // content put them, and one far down a scrolled panel made the whole page scrollable.
    // On a phone the pad is fixed to the screen, and while the on-screen keyboard is open it fits
    // the part above it, so the chat's composer and the code being typed stay in view.
    <div
      className={cn(
        'flex h-dvh flex-col overflow-hidden bg-bg',
        // viewport-fit=cover: keep clear of the notch (landscape) and the status bar (standalone).
        compact
          ? 'fixed inset-x-0 top-0 pt-[env(safe-area-inset-top)] pr-[env(safe-area-inset-right)] pl-[env(safe-area-inset-left)]'
          : 'relative',
      )}
      style={keyboard ? { top: keyboard.top, height: keyboard.height } : undefined}
    >
      <TopBar
        onSettings={() => setDialog('settings')}
        onShortcuts={() => setDialog('shortcuts')}
        onEnd={() => setDialog('end')}
        onShare={() => setDialog('share')}
        compact={compact}
      />

      <EndedBanner />
      <InviteBanner />

      {desktop ? (
        <Group
          orientation="horizontal"
          id="ipp-pad-main"
          className="min-h-0 flex-1"
          defaultLayout={mainLayout.defaultLayout}
          onLayoutChanged={mainLayout.onLayoutChanged}
        >
          <Panel
            id="problem"
            panelRef={problemPanel}
            defaultSize="25%"
            minSize="200px"
            collapsible
            collapsedSize={0}
          >
            <PortalSlot node={problemNode} className="h-full" />
          </Panel>
          <ResizeHandle />
          <Panel id="center" minSize="30%" defaultSize="50%">
            <Group
              orientation="vertical"
              id="ipp-pad-center"
              defaultLayout={centerLayout.defaultLayout}
              onLayoutChanged={centerLayout.onLayoutChanged}
            >
              <Panel id="editor" minSize="120px" defaultSize="64%">
                <PortalSlot node={editorNode} className="h-full" />
              </Panel>
              <ResizeHandle vertical />
              <Panel
                id="console"
                panelRef={consolePanel}
                defaultSize="36%"
                minSize="120px"
                collapsible
                collapsedSize={36}
              >
                <PortalSlot node={consoleNode} className="h-full" />
              </Panel>
            </Group>
          </Panel>
          <ResizeHandle />
          <Panel
            id="chat"
            panelRef={chatPanel}
            defaultSize="25%"
            minSize="260px"
            collapsible
            collapsedSize={0}
          >
            <PortalSlot node={chatNode} className="h-full" />
          </Panel>
        </Group>
      ) : (
        <div className="relative min-h-0 flex-1" data-testid="pad-panes">
          {PANES.map((p) => (
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
      {desktop ? (
        <StatusBar cursor={cursor} />
      ) : (
        // The keyboard leaves little room: the tab bar steps aside until it closes.
        !keyboard && (
          <PaneTabs
            pane={pane}
            onPane={setPane}
            unread={unread}
            chatLabel={pad.isRoom && pad.isHost ? 'Chat & notes' : 'Chat'}
          />
        )
      )}

      {/* After the layout, so each node is in the document before its content's layout effects. */}
      {problemNode && createPortal(problemContent, problemNode, 'problem')}
      {editorNode && createPortal(editorContent, editorNode, 'editor')}
      {consoleNode && createPortal(consoleContent, consoleNode, 'console')}
      {chatNode && createPortal(chatContent, chatNode, 'chat')}

      <SettingsDialog
        open={dialog === 'settings'}
        onOpenChange={(o) => setDialog(o ? 'settings' : null)}
        compact={compact}
      />
      <ShortcutsDialog
        open={dialog === 'shortcuts'}
        onOpenChange={(o) => setDialog(o ? 'shortcuts' : null)}
      />
      {compact && (
        <ShareDialog
          open={dialog === 'share'}
          onOpenChange={(o) => setDialog(o ? 'share' : null)}
        />
      )}
      <ResetDialog
        open={dialog === 'reset'}
        onOpenChange={(o) => setDialog(o ? 'reset' : null)}
        onConfirm={() => {
          const starter = problem ? problem.scaffolds[lang] : BLANK_SCAFFOLDS[lang];
          if (starter !== undefined) editorRef.current?.replaceAll(starter);
        }}
      />
      {pad.isHost && (
        <ChangeProblemDialog
          open={dialog === 'problem'}
          onOpenChange={(o) => setDialog(o ? 'problem' : null)}
        />
      )}
      <EndDialog
        open={dialog === 'end'}
        onOpenChange={(o) => setDialog(o ? 'end' : null)}
        onEnded={() => router.push(`/pads/${state.pad.id}/report`)}
      />
    </div>
  );
}
