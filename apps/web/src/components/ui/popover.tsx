'use client';
import { Popover as P } from 'radix-ui';
import type * as React from 'react';
import { cn } from '@/lib/utils';

export const Popover = P.Root;
export const PopoverTrigger = P.Trigger;
export const PopoverAnchor = P.Anchor;
export const PopoverClose = P.Close;

export function PopoverContent({
  className,
  sideOffset = 6,
  align = 'center',
  collisionPadding = 8,
  ...props
}: React.ComponentProps<typeof P.Content>) {
  return (
    <P.Portal>
      <P.Content
        sideOffset={sideOffset}
        align={align}
        collisionPadding={collisionPadding}
        className={cn(
          'z-50 w-72 max-w-[var(--radix-popover-content-available-width)] rounded-lg border border-border bg-surface p-3 text-sm text-fg shadow-overlay outline-none data-[state=open]:animate-pop-in',
          className,
        )}
        {...props}
      />
    </P.Portal>
  );
}
