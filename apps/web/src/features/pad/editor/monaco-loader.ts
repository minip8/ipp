/**
 * Loads Monaco's AMD build from /monaco (copied by scripts/copy-monaco.mjs) on first use.
 * Types come from the monaco-editor package; nothing from it is bundled.
 */
import type * as MonacoNS from 'monaco-editor';

export type Monaco = typeof MonacoNS;

type AmdRequire = {
  (deps: string[], cb: (...mods: unknown[]) => void, err?: (e: unknown) => void): void;
  config(c: { paths?: Record<string, string>; baseUrl?: string }): void;
};
type AmdDefine = {
  (id: string, deps: string[], factory: (...a: unknown[]) => unknown): void;
  amd?: unknown;
};

declare global {
  interface Window {
    MonacoEnvironment?: { getWorker?: (id: string, label: string) => Worker };
    monaco?: Monaco;
    require?: AmdRequire;
    define?: AmdDefine;
  }
}

const BASE = '/monaco';
let monacoPromise: Promise<Monaco> | null = null;

function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error(`Failed to load ${src}`));
    document.head.appendChild(s);
  });
}

export function loadMonaco(): Promise<Monaco> {
  if (monacoPromise) return monacoPromise;
  monacoPromise = (async () => {
    window.MonacoEnvironment = {
      getWorker: () => new Worker(`${BASE}/editor.worker.js`, { name: 'monaco-editor-worker' }),
    };
    if (!window.require?.config) await loadScript(`${BASE}/vs/loader.js`);
    const req = window.require;
    if (!req) throw new Error('Monaco loader did not initialise');
    req.config({
      paths: {
        vs: `${BASE}/vs`,
        'monaco-vim': `${BASE}/monaco-vim`,
        'monaco-emacs': `${BASE}/monaco-emacs`,
      },
    });
    const monaco = await new Promise<Monaco>((resolve, reject) =>
      req(['vs/editor/editor.main'], (m) => resolve(m as Monaco), reject),
    );
    window.monaco = monaco;
    // monaco-vim's UMD asks for the ESM entry by name; point it at the loaded module.
    window.define?.('monaco-editor/esm/vs/editor/editor.api', [], () => monaco);
    return monaco;
  })();
  monacoPromise.catch(() => {
    monacoPromise = null;
  });
  return monacoPromise;
}

export type VimModule = {
  initVimMode: (
    editor: MonacoNS.editor.IStandaloneCodeEditor,
    statusBar: HTMLElement,
  ) => { dispose(): void };
};
export type EmacsModule = {
  EmacsExtension: new (
    editor: MonacoNS.editor.IStandaloneCodeEditor,
  ) => {
    start(): void;
    dispose(): void;
    onDidMarkChange?: unknown;
    onDidChangeKey?: (cb: (s: string) => void) => void;
  };
};

export async function loadKeymap(kind: 'vim'): Promise<VimModule>;
export async function loadKeymap(kind: 'emacs'): Promise<EmacsModule>;
export async function loadKeymap(kind: 'vim' | 'emacs'): Promise<VimModule | EmacsModule> {
  await loadMonaco();
  const req = window.require;
  if (!req) throw new Error('Monaco loader missing');
  return new Promise((resolve, reject) =>
    req([kind === 'vim' ? 'monaco-vim' : 'monaco-emacs'], (m) => resolve(m as VimModule), reject),
  );
}
