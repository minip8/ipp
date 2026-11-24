'use client';
import type * as React from 'react';
import { useEffect, useState } from 'react';
import { cn, isMac } from '@/lib/utils';

/** Renders a key chord such as "Mod+Enter" with the platform's modifier names. */
export function Kbd({ keys, className, ...props }: { keys: string } & React.ComponentProps<'kbd'>) {
  const [mac, setMac] = useState(false);
  useEffect(() => setMac(isMac()), []);
  const parts = keys.split('+').map((k) => formatKey(k, mac));
  return (
    <kbd
      className={cn(
        'inline-flex items-center gap-0.5 font-sans text-2xs font-medium text-fg-muted',
        className,
      )}
      {...props}
    >
      {parts.map((p, i) => (
        <span
          // biome-ignore lint/suspicious/noArrayIndexKey: static key list
          key={i}
          className="inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-[4px] border border-border-strong bg-surface-2 px-1 leading-none shadow-[0_1px_0_var(--border-strong)]"
        >
          {p}
        </span>
      ))}
    </kbd>
  );
}

export function formatKey(k: string, mac: boolean): string {
  switch (k) {
    case 'Mod':
      return mac ? '⌘' : 'Ctrl';
    case 'Alt':
      return mac ? '⌥' : 'Alt';
    case 'Shift':
      return mac ? '⇧' : 'Shift';
    case 'Enter':
      return '↵';
    case 'Escape':
      return 'Esc';
    default:
      return k;
  }
}

export function chordLabel(keys: string, mac: boolean) {
  return keys
    .split('+')
    .map((k) => formatKey(k, mac))
    .join(mac ? '' : '+');
}
