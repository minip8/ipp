'use client';
import { useSyncExternalStore } from 'react';
import { z } from 'zod';
import { storage } from '@/lib/storage';

export const EditorSettings = z.object({
  fontSize: z.int().min(10).max(24).catch(14),
  tabSize: z.union([z.literal(2), z.literal(4), z.literal(8)]).catch(4),
  keymap: z.enum(['standard', 'vim', 'emacs']).catch('standard'),
  wordWrap: z.boolean().catch(false),
  autocomplete: z.boolean().catch(true),
  minimap: z.boolean().catch(false),
  lineNumbers: z.enum(['on', 'relative']).catch('on'),
  ligatures: z.boolean().catch(false),
});
export type EditorSettings = z.infer<typeof EditorSettings>;

const KEY = 'ipp:editor-settings';
const listeners = new Set<() => void>();
let cache: EditorSettings | null = null;
const DEFAULTS = EditorSettings.parse({});

function read(): EditorSettings {
  cache ??= EditorSettings.parse(storage.get<unknown>(KEY, {}) ?? {});
  return cache;
}

export function updateEditorSettings(patch: Partial<EditorSettings>) {
  cache = { ...read(), ...patch };
  storage.set(KEY, cache);
  for (const l of listeners) l();
}

export function useEditorSettings(): EditorSettings {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    read,
    () => DEFAULTS,
  );
}
