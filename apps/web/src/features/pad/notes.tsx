'use client';
/**
 * The pad's shared notes (`YDOC.notes`) as a plain textarea, live for everyone in the pad. The
 * coding pad shows it as the problem panel's Notes tab; a quant pad as its scratchpad.
 */
import { CAPS, YDOC } from '@ipp/contracts';
import { useEffect, useRef, useState } from 'react';
import type * as Y from 'yjs';
import { cn } from '@/lib/utils';
import { usePad } from './session';

/** Applies the minimal edit between two strings to a Y.Text. */
export function applyTextDiff(ytext: Y.Text, prev: string, next: string) {
  let start = 0;
  while (start < prev.length && start < next.length && prev[start] === next[start]) start++;
  let endPrev = prev.length;
  let endNext = next.length;
  while (endPrev > start && endNext > start && prev[endPrev - 1] === next[endNext - 1]) {
    endPrev--;
    endNext--;
  }
  ytext.doc?.transact(() => {
    if (endPrev > start) ytext.delete(start, endPrev - start);
    if (endNext > start) ytext.insert(start, next.slice(start, endNext));
  }, 'notes');
}

export function NotesEditor({
  id,
  label,
  placeholder,
  className,
}: {
  id: string;
  /** For screen readers; the panel's own tab names it on screen. */
  label: string;
  placeholder: string;
  /** Extra classes for the textarea (its size and spacing). */
  className?: string;
}) {
  const { collab, synced, readOnly } = usePad();
  const [value, setValue] = useState('');
  const ref = useRef<HTMLTextAreaElement>(null);
  const ytext = collab?.doc.getText(YDOC.notes);

  useEffect(() => {
    if (!ytext) return;
    setValue(ytext.toString());
    const obs = (e: Y.YTextEvent) => {
      if (e.transaction.origin === 'notes' && e.transaction.local) return;
      const el = ref.current;
      const next = ytext.toString();
      if (el && document.activeElement === el) {
        // Keep the caret where it was relative to the text around it.
        const { selectionStart, selectionEnd } = el;
        let shift = 0;
        let idx = 0;
        for (const op of e.delta) {
          if (op.retain) idx += op.retain;
          else if (op.insert && typeof op.insert === 'string') {
            if (idx < selectionStart) shift += op.insert.length;
            idx += op.insert.length;
          } else if (op.delete) {
            if (idx < selectionStart) shift -= Math.min(op.delete, selectionStart - idx);
          }
        }
        setValue(next);
        requestAnimationFrame(() =>
          el.setSelectionRange(selectionStart + shift, selectionEnd + shift),
        );
      } else {
        setValue(next);
      }
    };
    ytext.observe(obs);
    return () => ytext.unobserve(obs);
  }, [ytext]);

  return (
    <div className="flex h-full flex-col">
      <label htmlFor={id} className="sr-only">
        {label}
      </label>
      <textarea
        id={id}
        ref={ref}
        value={value}
        readOnly={readOnly || !synced}
        maxLength={CAPS.notesChars}
        placeholder={placeholder}
        onChange={(e) => {
          if (!ytext) return;
          const next = e.target.value;
          applyTextDiff(ytext, value, next);
          setValue(next);
        }}
        className={cn(
          'min-h-0 flex-1 resize-none bg-transparent px-4 py-3 font-mono text-[13px] leading-relaxed text-fg outline-none placeholder:font-sans placeholder:text-fg-subtle max-lg:text-base',
          className,
        )}
      />
      <p className="shrink-0 border-t border-border px-4 py-1.5 text-right text-2xs text-fg-subtle tabular">
        {value.length.toLocaleString()} / {CAPS.notesChars.toLocaleString()}
      </p>
    </div>
  );
}
