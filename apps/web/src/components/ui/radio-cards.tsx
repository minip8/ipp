'use client';
import { RadioGroup } from 'radix-ui';
import type * as React from 'react';
import { cn } from '@/lib/utils';

export const RadioRoot = RadioGroup.Root;

/** A selectable row/card inside a RadioGroup.Root. */
export function RadioCard({
  className,
  children,
  ...props
}: React.ComponentProps<typeof RadioGroup.Item>) {
  return (
    <RadioGroup.Item
      className={cn(
        'group relative flex w-full items-start gap-3 rounded-md border border-border-strong bg-surface px-3 py-2.5 text-left transition-colors hover:bg-surface-2 data-[state=checked]:border-accent data-[state=checked]:bg-accent-soft/40 disabled:opacity-50',
        className,
      )}
      {...props}
    >
      <span className="mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border border-border-strong bg-surface group-data-[state=checked]:border-accent">
        <RadioGroup.Indicator className="size-2 rounded-full bg-accent" />
      </span>
      <span className="min-w-0 flex-1">{children}</span>
    </RadioGroup.Item>
  );
}
