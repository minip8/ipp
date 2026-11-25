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

/** What is stored: only the settings the user changed, so defaults can differ per device. */
function readSaved(): Record<string, unknown> {
  const raw = storage.get<unknown>(KEY, {});
  return raw && typeof raw === 'object' && !Array.isArray(raw)
    ? (raw as Record<string, unknown>)
    : {};
}

function read(): EditorSettings {
  cache ??= EditorSettings.parse(readSaved());
  return cache;
}

/** The settings the user has set themselves (the others take their defaults). */
export function savedEditorSettingKeys(): Set<keyof EditorSettings> {
  const saved = readSaved();
  return new Set(
    (Object.keys(EditorSettings.shape) as (keyof EditorSettings)[]).filter((k) => k in saved),
  );
}

export function updateEditorSettings(patch: Partial<EditorSettings>) {
  const saved = { ...readSaved(), ...patch };
  storage.set(KEY, saved);
  cache = EditorSettings.parse(saved);
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
