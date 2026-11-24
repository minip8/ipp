'use client';
import { useEffect, useRef } from 'react';
import { isMac } from '@/lib/utils';

export type ShortcutId =
  | 'run'
  | 'runTests'
  | 'submit'
  | 'toggleConsole'
  | 'toggleProblem'
  | 'toggleChat'
  | 'focusChat'
  | 'focusEditor'
  | 'toggleMic'
  | 'shortcuts'
  | 'settings'
  | 'save';

export const SHORTCUTS: {
  id: ShortcutId;
  keys: string;
  label: string;
  group: 'Code' | 'Layout' | 'Interviewer' | 'General';
  inEditor: boolean;
}[] = [
  { id: 'run', keys: 'Mod+Enter', label: 'Run the file', group: 'Code', inEditor: true },
  { id: 'runTests', keys: "Mod+'", label: 'Run sample tests', group: 'Code', inEditor: true },
  { id: 'submit', keys: 'Mod+Shift+Enter', label: 'Submit', group: 'Code', inEditor: true },
  {
    id: 'save',
    keys: 'Mod+S',
    label: 'Save (it saves as you type)',
    group: 'Code',
    inEditor: true,
  },
  {
    id: 'toggleProblem',
    keys: 'Mod+B',
    label: 'Show or hide the problem',
    group: 'Layout',
    inEditor: true,
  },
  {
    id: 'toggleConsole',
    keys: 'Mod+J',
    label: 'Show or hide the console',
    group: 'Layout',
    inEditor: true,
  },
  {
    id: 'toggleChat',
    keys: 'Mod+Alt+B',
    label: 'Show or hide the chat',
    group: 'Layout',
    inEditor: true,
  },
  {
    id: 'focusChat',
    keys: 'Mod+I',
    label: 'Message the interviewer',
    group: 'Interviewer',
    inEditor: true,
  },
  {
    id: 'focusEditor',
    keys: 'Mod+E',
    label: 'Focus the editor',
    group: 'General',
    inEditor: false,
  },
  {
    id: 'toggleMic',
    keys: 'Alt+M',
    label: 'Talk to the interviewer (voice)',
    group: 'Interviewer',
    inEditor: true,
  },
  { id: 'settings', keys: 'Mod+.', label: 'Editor settings', group: 'General', inEditor: true },
  {
    id: 'shortcuts',
    keys: 'Mod+/',
    label: 'Keyboard shortcuts',
    group: 'General',
    inEditor: false,
  },
];

/** Does a keyboard event match a chord like "Mod+Shift+Enter"? */
export function matches(e: KeyboardEvent, keys: string, mac = isMac()): boolean {
  const parts = keys.split('+');
  const key = parts[parts.length - 1] ?? '';
  const want = {
    mod: parts.includes('Mod'),
    shift: parts.includes('Shift'),
    alt: parts.includes('Alt'),
  };
  const mod = mac ? e.metaKey : e.ctrlKey;
  if (mod !== want.mod || e.shiftKey !== want.shift || e.altKey !== want.alt) return false;
  if (mac ? e.ctrlKey : e.metaKey) return false;
  const codeFor: Record<string, string> = {
    "'": 'Quote',
    '/': 'Slash',
    '.': 'Period',
    Enter: 'Enter',
  };
  const code = codeFor[key] ?? (/^[A-Z]$/.test(key) ? `Key${key}` : key);
  return e.code === code;
}

/** Window-level shortcuts. The editor registers the same chords itself (it swallows keys). */
export function useShortcuts(handlers: Partial<Record<ShortcutId, () => void>>) {
  const ref = useRef(handlers);
  ref.current = handlers;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target?.closest('.monaco-editor')) return; // handled by editor commands
      for (const s of SHORTCUTS) {
        if (!matches(e, s.keys)) continue;
        const h = ref.current[s.id];
        if (!h) continue;
        e.preventDefault();
        h();
        return;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}
