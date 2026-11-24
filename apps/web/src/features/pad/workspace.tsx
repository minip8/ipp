'use client';
import { BLANK_SCAFFOLDS, LANGUAGES, type Language } from '@ipp/contracts';
import {
  FileCode2Icon,
  FlaskConicalIcon,
  LockIcon,
  PenToolIcon,
  PlayIcon,
  RotateCcwIcon,
  SendIcon,
  XIcon,
} from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Group,
  Panel,
  type PanelImperativeHandle,
  Separator,
  useDefaultLayout,
} from 'react-resizable-panels';
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
import { EndDialog, ResetDialog, SettingsDialog, ShortcutsDialog } from './dialogs';
import { CodeEditor, type EditorCommand, type EditorHandle } from './editor/code-editor';
import { useEditorSettings } from './editor/settings';
import { ProblemPanel } from './problem-panel';
import { usePad } from './session';
import { SHORTCUTS, type ShortcutId, useShortcuts } from './shortcuts';
import { TopBar } from './top-bar';
import { Whiteboard } from './whiteboard';

const storage = typeof window === 'undefined' ? undefined : window.localStorage;

function ResizeHandle({ vertical }: { vertical?: boolean }) {
  return (
    <Separator
      className={cn(
        'group relative shrink-0 bg-border outline-none transition-colors data-[separator=active]:bg-accent data-[separator=focus]:bg-accent data-[separator=hover]:bg-accent/60',
        vertical ? 'h-px' : 'w-px',
      )}
    >
      <span
        className={cn('absolute', vertical ? '-inset-y-1 inset-x-0' : '-inset-x-1 inset-y-0')}
        aria-hidden
      />
    </Separator>
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
    null | 'settings' | 'shortcuts' | 'end' | 'reset' | 'problem'
  >(null);
  const problem = state.problem;
  const languages = problem?.languages ?? LANGUAGES;
  // In a room the telemetry is about the candidate, not about the host looking something up.
  const watched = !readOnly && !pad.isHost;
  const [cursor, setCursor] = useState({ line: 1, col: 1 });
  const [narrowDismissed, setNarrowDismissed] = useState(false);

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
    if (consolePanel.current?.isCollapsed()) consolePanel.current.expand();
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
    toggleProblem: () => toggle(problemPanel.current),
    toggleConsole: () => toggle(consolePanel.current),
    toggleChat: () => toggle(chatPanel.current),
    focusChat: () => {
      if (chatPanel.current?.isCollapsed()) chatPanel.current.expand();
      requestAnimationFrame(() => chatRef.current?.focus());
    },
    focusEditor: () => {
      setView('code');
      editorRef.current?.focus();
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

  return (
    // `relative`: visually hidden (sr-only) labels are absolutely positioned. Without a positioned
    // ancestor they sit in the document, outside every panel's clipping, at wherever their panel's
    // content put them, and one far down a scrolled panel made the whole page scrollable.
    <div className="relative flex h-dvh flex-col overflow-hidden bg-bg">
      <TopBar
        onSettings={() => setDialog('settings')}
        onShortcuts={() => setDialog('shortcuts')}
        onEnd={() => setDialog('end')}
      />

      {readOnly && (
        <div
          className="flex shrink-0 items-center gap-3 border-b border-border bg-accent-soft/50 px-4 py-1.5 text-sm"
          role="status"
        >
          <LockIcon className="size-4 text-accent-text" aria-hidden />
          <span>This interview has ended. The pad is read-only.</span>
          {/* A room's report belongs to its host. */}
          {(!pad.isRoom || pad.isHost) && (
            <Link
              href={`/pads/${state.pad.id}/report`}
              className="font-medium text-accent-text hover:underline"
            >
              See the report
            </Link>
          )}
        </div>
      )}
      <InviteBanner />
      {!narrowDismissed && (
        <div className="flex shrink-0 items-center gap-3 border-b border-border bg-warn-soft px-4 py-1.5 text-xs text-warn-text lg:hidden">
          <span className="flex-1">
            The pad is built for screens at least 1024 px wide. It works here, but panels are
            cramped.
          </span>
          <Button
            size="icon-xs"
            variant="ghost"
            aria-label="Dismiss"
            onClick={() => setNarrowDismissed(true)}
          >
            <XIcon />
          </Button>
        </div>
      )}

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
          <ProblemPanel onChangeProblem={() => setDialog('problem')} />
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
              <div className="flex h-full flex-col">
                <div className="flex h-9 shrink-0 items-center gap-2 border-b border-border bg-surface pr-2">
                  <div
                    className="flex h-full items-stretch"
                    role="tablist"
                    aria-label="Editor view"
                  >
                    <button
                      type="button"
                      role="tab"
                      aria-selected={view === 'code'}
                      onClick={() => setView('code')}
                      className={cn(
                        'flex items-center gap-1.5 border-r border-border px-3 text-sm',
                        view === 'code'
                          ? 'bg-editor font-medium text-fg shadow-[inset_0_2px_0_var(--accent)]'
                          : 'text-fg-muted hover:text-fg',
                      )}
                    >
                      <FileCode2Icon className="size-3.5" aria-hidden /> {LANG_FILE[lang]}
                    </button>
                    <button
                      type="button"
                      role="tab"
                      aria-selected={view === 'board'}
                      onClick={() => setView('board')}
                      className={cn(
                        'flex items-center gap-1.5 border-r border-border px-3 text-sm',
                        view === 'board'
                          ? 'bg-editor font-medium text-fg shadow-[inset_0_2px_0_var(--accent)]'
                          : 'text-fg-muted hover:text-fg',
                      )}
                    >
                      <PenToolIcon className="size-3.5" aria-hidden /> Whiteboard
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
                          className="h-7 w-28 text-xs"
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
                          >
                            <RotateCcwIcon />
                          </Button>
                        </Tooltip>
                      )}
                    </>
                  )}
                  <div className="ml-auto">
                    <RunButtons onRun={run} onTests={runTests} onSubmit={submit} />
                  </div>
                </div>
                <div className="relative min-h-0 flex-1">
                  <CodeEditor
                    ref={editorRef}
                    className={cn('absolute inset-0', view !== 'code' && 'invisible')}
                    collab={collab}
                    synced={pad.synced}
                    language={lang}
                    readOnly={readOnly}
                    settings={settings}
                    commands={editorCommands}
                    diagnosticsRun={latestFinished}
                    onPaste={(chars) => chars > 0 && watched && telemetry('paste', chars)}
                    onCursor={(line, col) => setCursor({ line, col })}
                  />
                  {view === 'board' && (
                    <div className="absolute inset-0">
                      <Whiteboard active />
                    </div>
                  )}
                </div>
              </div>
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
              <ConsolePanel
                cs={cs}
                onRunCustom={runCustom}
                onJump={(line, col) => {
                  setView('code');
                  editorRef.current?.revealLine(line, col ?? 1);
                }}
              />
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
          {pad.isRoom ? <RoomSidePanel ref={chatRef} /> : <ChatPanel ref={chatRef} />}
        </Panel>
      </Group>
      <StatusBar cursor={cursor} />

      <SettingsDialog
        open={dialog === 'settings'}
        onOpenChange={(o) => setDialog(o ? 'settings' : null)}
      />
      <ShortcutsDialog
        open={dialog === 'shortcuts'}
        onOpenChange={(o) => setDialog(o ? 'shortcuts' : null)}
      />
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
