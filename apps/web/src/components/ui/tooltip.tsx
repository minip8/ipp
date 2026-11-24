'use client';
import { Tooltip as T } from 'radix-ui';
import type * as React from 'react';
import { cn } from '@/lib/utils';
import { Kbd } from './kbd';

export const TooltipProvider = T.Provider;

/** Wraps a single focusable child. `shortcut` renders a key chord after the label. */
export function Tooltip({
  label,
  shortcut,
  side = 'bottom',
  children,
  className,
}: {
  label: React.ReactNode;
  shortcut?: string;
  side?: 'top' | 'bottom' | 'left' | 'right';
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <T.Root>
      <T.Trigger asChild>{children}</T.Trigger>
      <T.Portal>
        <T.Content
          side={side}
          sideOffset={6}
          className={cn(
            'z-[60] flex items-center gap-2 rounded-md bg-fg px-2 py-1 text-xs font-medium text-bg shadow-pop data-[state=delayed-open]:animate-fade-in',
            className,
          )}
        >
          {label}
          {shortcut && (
            <Kbd
              keys={shortcut}
              className="[&>span]:border-transparent [&>span]:bg-bg/15 [&>span]:text-bg [&>span]:shadow-none"
            />
          )}
        </T.Content>
      </T.Portal>
    </T.Root>
  );
}
