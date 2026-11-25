'use client';
import { ToggleGroup } from 'radix-ui';
import type * as React from 'react';
import { cn } from '@/lib/utils';

/** Single-choice segmented control. */
export function Segmented<T extends string>({
  value,
  onValueChange,
  options,
  className,
  size = 'md',
  'aria-label': ariaLabel,
}: {
  value: T;
  onValueChange: (v: T) => void;
  options: { value: T; label: React.ReactNode; hint?: string }[];
  className?: string;
  size?: 'sm' | 'md';
  'aria-label': string;
}) {
  return (
    <ToggleGroup.Root
      type="single"
      value={value}
      onValueChange={(v) => v && onValueChange(v as T)}
      aria-label={ariaLabel}
      className={cn(
        'inline-flex rounded-md border border-border-strong bg-surface-2 p-0.5',
        className,
      )}
    >
      {options.map((o) => (
        <ToggleGroup.Item
          key={o.value}
          value={o.value}
          title={o.hint}
          className={cn(
            'touch-hit flex-1 rounded-[5px] px-2.5 font-medium whitespace-nowrap text-fg-muted transition-colors hover:text-fg data-[state=on]:bg-surface data-[state=on]:text-fg data-[state=on]:shadow-[0_1px_2px_oklch(0_0_0/0.08),0_0_0_1px_var(--border)] focus-visible:outline-offset-0',
            size === 'sm' ? 'h-6 text-xs' : 'h-7 text-sm',
          )}
        >
          {o.label}
        </ToggleGroup.Item>
      ))}
    </ToggleGroup.Root>
  );
}
