'use client';
import { type Language, type Run, YDOC } from '@ipp/contracts';
import type * as MonacoNS from 'monaco-editor';
import { useTheme } from 'next-themes';
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import type { Collab } from '../collab';
import { MonacoBinding } from './binding';
import { parseDiagnostics } from './diagnostics';
import { loadKeymap, loadMonaco, type Monaco } from './monaco-loader';
import type { EditorSettings } from './settings';

type Editor = MonacoNS.editor.IStandaloneCodeEditor;

export type EditorHandle = {
  focus(): void;
  revealLine(line: number, column?: number): void;
  /** Replace the whole buffer as one undoable edit (used by "reset to starter code"). */
  replaceAll(text: string): void;
  /** Measure the container again (after it was hidden, e.g. on another phone pane). */
  layout(): void;
};

export type EditorCommand = { keys: string; run: () => void };

const MONACO_LANG: Record<Language, string> = { cpp: 'cpp', python: 'python', java: 'java' };
const FILE: Record<Language, string> = { cpp: 'main.cpp', python: 'main.py', java: 'Main.java' };

let themesDefined = false;
function defineThemes(monaco: Monaco) {
  if (themesDefined) return;
  themesDefined = true;
  monaco.editor.defineTheme('ipp-light', {
    base: 'vs',
    inherit: true,
    rules: [
      { token: 'comment', foreground: '6e7781', fontStyle: 'italic' },
      { token: 'keyword', foreground: 'a626a4' },
      { token: 'string', foreground: '0a7d3f' },
      { token: 'number', foreground: 'b35900' },
      { token: 'type', foreground: '0b6e99' },
    ],
    colors: {
      'editor.background': '#ffffff',
      'editor.lineHighlightBackground': '#f5f6f8',
      'editor.lineHighlightBorder': '#00000000',
      'editorLineNumber.foreground': '#a8adb7',
      'editorLineNumber.activeForeground': '#3b3f47',
      'editorIndentGuide.background1': '#eceef1',
      'editorGutter.background': '#ffffff',
      'editor.selectionBackground': '#cfe0ff',
      'editorCursor.foreground': '#2a62d6',
      'scrollbarSlider.background': '#c8ccd455',
      'scrollbarSlider.hoverBackground': '#b3b8c288',
      'editorWidget.background': '#ffffff',
      'editorWidget.border': '#dfe2e7',
      'editorSuggestWidget.selectedBackground': '#e8efff',
      focusBorder: '#00000000',
    },
  });
  monaco.editor.defineTheme('ipp-dark', {
    base: 'vs-dark',
    inherit: true,
    rules: [
      { token: 'comment', foreground: '7d8590', fontStyle: 'italic' },
      { token: 'keyword', foreground: 'c792ea' },
      { token: 'string', foreground: '9ece6a' },
      { token: 'number', foreground: 'f2a65a' },
      { token: 'type', foreground: '7dcfff' },
    ],
    colors: {
      'editor.background': '#17181c',
      'editor.lineHighlightBackground': '#1f2126',
      'editor.lineHighlightBorder': '#00000000',
      'editorLineNumber.foreground': '#4b505a',
      'editorLineNumber.activeForeground': '#b8bdc7',
      'editorIndentGuide.background1': '#25272d',
      'editorGutter.background': '#17181c',
      'editor.selectionBackground': '#2c4a7a',
      'editorCursor.foreground': '#7fb0ff',
      'scrollbarSlider.background': '#4b505a55',
      'scrollbarSlider.hoverBackground': '#5b616d88',
      'editorWidget.background': '#1f2126',
      'editorWidget.border': '#30333a',
      'editorSuggestWidget.selectedBackground': '#2a3550',
      focusBorder: '#00000000',
    },
  });
}

/** "Mod+Shift+Enter" -> Monaco keybinding number. */
function toKeybinding(monaco: Monaco, keys: string): number {
  let kb = 0;
  for (const part of keys.split('+')) {
    if (part === 'Mod') kb |= monaco.KeyMod.CtrlCmd;
    else if (part === 'Shift') kb |= monaco.KeyMod.Shift;
    else if (part === 'Alt') kb |= monaco.KeyMod.Alt;
    else if (part === 'Enter') kb |= monaco.KeyCode.Enter;
    else if (part === "'") kb |= monaco.KeyCode.Quote;
    else if (part === '/') kb |= monaco.KeyCode.Slash;
    else if (part === '.') kb |= monaco.KeyCode.Period;
    else if (/^[A-Z]$/.test(part))
      kb |= monaco.KeyCode[`Key${part}` as keyof typeof monaco.KeyCode] as number;
    else if (/^[0-9]$/.test(part))
      kb |= monaco.KeyCode[`Digit${part}` as keyof typeof monaco.KeyCode] as number;
  }
  return kb;
}

function monoFamily() {
  const v = getComputedStyle(document.documentElement).getPropertyValue('--font-geist-mono').trim();
  return `${v ? `${v}, ` : ''}ui-monospace, 'SF Mono', Menlo, Consolas, monospace`;
}

export const CodeEditor = forwardRef<
  EditorHandle,
  {
    collab: Collab | null;
    synced: boolean;
    language: Language;
    readOnly: boolean;
    settings: EditorSettings;
    commands: EditorCommand[];
    diagnosticsRun: Run | null;
    onPaste: (chars: number) => void;
    onCursor?: (line: number, col: number) => void;
    /** The phone layout: a narrow touch screen, so less chrome around the code. */
    compact?: boolean;
    className?: string;
  }
>(function CodeEditor(
  {
    collab,
    synced,
    language,
    readOnly,
    settings,
    commands,
    diagnosticsRun,
    onPaste,
    onCursor,
    compact = false,
    className,
  },
  ref,
) {
  const host = useRef<HTMLDivElement>(null);
  const statusBar = useRef<HTMLDivElement>(null);
  const [monaco, setMonaco] = useState<Monaco | null>(null);
  const [editor, setEditor] = useState<Editor | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [keymapStatus, setKeymapStatus] = useState(false);
  const models = useRef(new Map<Language, MonacoNS.editor.ITextModel>());
  const viewStates = useRef(new Map<Language, MonacoNS.editor.ICodeEditorViewState | null>());
  const bindingRef = useRef<MonacoBinding | null>(null);
  const commandsRef = useRef(commands);
  commandsRef.current = commands;
  const onPasteRef = useRef(onPaste);
  onPasteRef.current = onPaste;
  const onCursorRef = useRef(onCursor);
  onCursorRef.current = onCursor;
  const { resolvedTheme } = useTheme();

  useImperativeHandle(ref, () => ({
    focus: () => editor?.focus(),
    revealLine: (line, column = 1) => {
      if (!editor) return;
      editor.revealLineInCenter(line);
      editor.setPosition({ lineNumber: line, column });
      editor.focus();
    },
    replaceAll: (text) => {
      const model = editor?.getModel();
      if (!editor || !model) return;
      editor.pushUndoStop();
      editor.executeEdits('reset', [{ range: model.getFullModelRange(), text }]);
      editor.pushUndoStop();
      editor.setPosition({ lineNumber: 1, column: 1 });
    },
    layout: () => editor?.layout(),
  }));

  // Create the editor once.
  useEffect(() => {
    let disposed = false;
    let ed: Editor | null = null;
    loadMonaco()
      .then((m) => {
        if (disposed || !host.current) return;
        defineThemes(m);
        ed = m.editor.create(host.current, {
          model: null,
          automaticLayout: true,
          fontFamily: monoFamily(),
          fontSize: 14,
          lineHeight: 1.6,
          padding: { top: 12, bottom: 12 },
          scrollBeyondLastLine: false,
          smoothScrolling: true,
          cursorBlinking: 'smooth',
          cursorSmoothCaretAnimation: 'on',
          renderLineHighlight: 'all',
          bracketPairColorization: { enabled: true },
          guides: { indentation: true, bracketPairs: false },
          stickyScroll: { enabled: false },
          overviewRulerBorder: false,
          hideCursorInOverviewRuler: true,
          scrollbar: { verticalScrollbarSize: 10, horizontalScrollbarSize: 10, useShadows: false },
          fixedOverflowWidgets: true,
          ariaLabel: 'Code editor',
          tabFocusMode: false,
          'semanticHighlighting.enabled': false,
        });
        ed.onDidPaste((e) => {
          const model = ed?.getModel();
          if (model) onPasteRef.current(model.getValueLengthInRange(e.range));
        });
        ed.onDidChangeCursorPosition((e) =>
          onCursorRef.current?.(e.position.lineNumber, e.position.column),
        );
        setMonaco(m);
        setEditor(ed);
      })
      .catch((e: unknown) =>
        setLoadError(e instanceof Error ? e.message : 'The editor failed to load.'),
      );
    return () => {
      disposed = true;
      bindingRef.current?.destroy();
      bindingRef.current = null;
      ed?.dispose();
      for (const model of models.current.values()) model.dispose();
      models.current.clear();
    };
  }, []);

  // Theme.
  useEffect(() => {
    monaco?.editor.setTheme(resolvedTheme === 'dark' ? 'ipp-dark' : 'ipp-light');
  }, [monaco, resolvedTheme]);

  // Settings.
  useEffect(() => {
    if (!editor) return;
    editor.updateOptions({
      fontSize: settings.fontSize,
      wordWrap: settings.wordWrap ? 'on' : 'off',
      minimap: { enabled: settings.minimap, renderCharacters: false, scale: 1 },
      lineNumbers: settings.lineNumbers,
      fontLigatures: settings.ligatures,
      quickSuggestions: settings.autocomplete
        ? { other: true, comments: false, strings: false }
        : false,
      suggestOnTriggerCharacters: settings.autocomplete,
      wordBasedSuggestions: settings.autocomplete ? 'currentDocument' : 'off',
      parameterHints: { enabled: settings.autocomplete },
    });
    for (const model of models.current.values())
      model.updateOptions({ tabSize: settings.tabSize, insertSpaces: true });
  }, [editor, settings]);

  // A narrow touch screen: every column counts, and there is no mouse to hover the gutter.
  useEffect(() => {
    editor?.updateOptions(
      compact
        ? {
            lineNumbersMinChars: 3,
            lineDecorationsWidth: 6,
            folding: false,
            glyphMargin: false,
            padding: { top: 8, bottom: 8 },
            scrollbar: { verticalScrollbarSize: 6, horizontalScrollbarSize: 6, useShadows: false },
            renderLineHighlight: 'line',
            contextmenu: false,
          }
        : {
            lineNumbersMinChars: 5,
            lineDecorationsWidth: 10,
            folding: true,
            glyphMargin: true,
            padding: { top: 12, bottom: 12 },
            scrollbar: {
              verticalScrollbarSize: 10,
              horizontalScrollbarSize: 10,
              useShadows: false,
            },
            renderLineHighlight: 'all',
            contextmenu: true,
          },
    );
  }, [editor, compact]);

  useEffect(() => {
    editor?.updateOptions({
      readOnly,
      domReadOnly: readOnly,
      readOnlyMessage: { value: 'This interview has ended. The code is read-only.' },
    });
  }, [editor, readOnly]);

  // Keymaps (Vim / Emacs) loaded on demand.
  useEffect(() => {
    if (!editor || settings.keymap === 'standard') {
      setKeymapStatus(false);
      return;
    }
    let disposed = false;
    let handle: { dispose(): void } | null = null;
    if (settings.keymap === 'vim') {
      loadKeymap('vim').then((vim) => {
        if (disposed || !statusBar.current) return;
        handle = vim.initVimMode(editor, statusBar.current);
        setKeymapStatus(true);
      });
    } else {
      loadKeymap('emacs').then((em) => {
        if (disposed) return;
        const ext = new em.EmacsExtension(editor);
        ext.start();
        handle = ext;
        setKeymapStatus(false);
      });
    }
    return () => {
      disposed = true;
      handle?.dispose();
      if (statusBar.current) statusBar.current.textContent = '';
    };
  }, [editor, settings.keymap]);

  // Bind the active language's Y.Text to its model.
  useEffect(() => {
    if (!monaco || !editor || !collab || !synced) return;
    let model = models.current.get(language);
    if (!model) {
      model = monaco.editor.createModel(
        '',
        MONACO_LANG[language],
        monaco.Uri.parse(`inmemory://pad/${FILE[language]}`),
      );
      model.updateOptions({ tabSize: settings.tabSize, insertSpaces: true });
      models.current.set(language, model);
    }
    const prevModel = editor.getModel();
    if (prevModel && prevModel !== model) {
      const prevLang = [...models.current.entries()].find(([, m]) => m === prevModel)?.[0];
      if (prevLang) viewStates.current.set(prevLang, editor.saveViewState());
    }
    editor.setModel(model);
    const binding = new MonacoBinding(
      monaco,
      collab.doc.getText(YDOC.code(language)),
      model,
      editor,
      collab.awareness,
      YDOC.code(language),
    );
    bindingRef.current = binding;
    // Undo/redo go through Yjs so a collaborator's edits are never undone by us.
    const m = model;
    const origUndo = m.undo.bind(m);
    const origRedo = m.redo.bind(m);
    m.undo = () => {
      binding.undoManager.undo();
    };
    m.redo = () => {
      binding.undoManager.redo();
    };
    const vs = viewStates.current.get(language);
    if (vs) editor.restoreViewState(vs);
    return () => {
      m.undo = origUndo;
      m.redo = origRedo;
      binding.destroy();
      if (bindingRef.current === binding) bindingRef.current = null;
    };
  }, [monaco, editor, collab, synced, language, settings.tabSize]);

  // App shortcuts work while the editor has focus.
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-register when the command list changes
  useEffect(() => {
    if (!monaco || !editor) return;
    const disposables = commandsRef.current.map((c, i) =>
      monaco.editor.addKeybindingRule({
        keybinding: toKeybinding(monaco, c.keys),
        command: `ipp.cmd.${i}`,
      }),
    );
    const registrations = commandsRef.current.map((_, i) =>
      monaco.editor.registerCommand(`ipp.cmd.${i}`, () => commandsRef.current[i]?.run()),
    );
    const undo = editor.addAction({
      id: 'ipp.undo',
      label: 'Undo',
      keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyZ],
      run: (ed) => ed.getModel()?.undo(),
    });
    const redo = editor.addAction({
      id: 'ipp.redo',
      label: 'Redo',
      keybindings: [
        monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.KeyZ,
        monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyY,
      ],
      run: (ed) => ed.getModel()?.redo(),
    });
    return () => {
      for (const d of [...disposables, ...registrations, undo, redo]) d.dispose();
    };
  }, [monaco, editor, commands.length]);

  // Compiler diagnostics from the latest compile error, mapped onto the model as markers.
  // biome-ignore lint/correctness/useExhaustiveDependencies: markers are re-applied once the model exists (after sync)
  useEffect(() => {
    if (!monaco || !editor) return;
    const model = models.current.get(language);
    if (!model) return;
    const diags =
      diagnosticsRun && diagnosticsRun.language === language
        ? parseDiagnostics(diagnosticsRun)
        : [];
    monaco.editor.setModelMarkers(
      model,
      'judge',
      diags
        .filter((d) => d.line <= model.getLineCount())
        .map((d) => ({
          severity:
            d.severity === 'error' ? monaco.MarkerSeverity.Error : monaco.MarkerSeverity.Warning,
          message: d.message,
          startLineNumber: d.line,
          startColumn: d.column ?? 1,
          endLineNumber: d.line,
          endColumn: d.column
            ? (model.getWordAtPosition({ lineNumber: d.line, column: d.column })?.endColumn ??
              d.column + 1)
            : model.getLineMaxColumn(d.line),
          source: 'compiler',
        })),
    );
  }, [monaco, editor, diagnosticsRun, language, synced]);

  return (
    <div
      className={cn(
        'relative flex min-h-0 flex-col bg-editor',
        // iOS zooms the page into any focused text field under 16 px. Monaco types into a hidden
        // textarea sized like the code, so give it 16 px (it is invisible either way).
        compact && '[&_textarea]:text-[16px]!',
        className,
      )}
    >
      <div ref={host} className="min-h-0 flex-1" data-testid="code-editor" />
      <div
        ref={statusBar}
        aria-live="polite"
        className={cn(
          'shrink-0 border-t border-border bg-surface-2 px-3 font-mono text-xs text-fg-muted',
          keymapStatus ? 'flex h-6 items-center' : 'hidden',
        )}
      />
      {(!editor || !synced) && !loadError && (
        <div
          className="absolute inset-0 z-10 bg-editor px-4 pt-4"
          role="status"
          aria-busy="true"
          aria-label="Loading the editor"
        >
          <div className="space-y-2.5">
            {[40, 62, 55, 30, 70, 48, 22, 58].map((w, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: placeholder lines
              <div key={i} className="flex items-center gap-4">
                <span className="w-4 text-right font-mono text-xs text-fg-subtle/50">{i + 1}</span>
                <Skeleton className="h-3.5" style={{ width: `${w}%` }} />
              </div>
            ))}
          </div>
          {editor && !synced && (
            <p className="mt-6 text-sm text-fg-muted">Connecting to the shared editor…</p>
          )}
        </div>
      )}
      {loadError && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-editor p-6 text-center text-sm text-fg-muted">
          The code editor failed to load ({loadError}). Reload the page to try again.
        </div>
      )}
    </div>
  );
});
