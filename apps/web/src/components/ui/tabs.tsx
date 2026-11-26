'use client';
import { Tabs as T } from 'radix-ui';
import type * as React from 'react';
import { cn } from '@/lib/utils';

export const Tabs = T.Root;
export const TabsContent = T.Content;

/** Underlined tabs used for panel headers. */
export function TabsList({ className, ...props }: React.ComponentProps<typeof T.List>) {
  return <T.List className={cn('flex items-stretch gap-1', className)} {...props} />;
}

/**
 * Keeps a clicked or tapped tab from showing the keyboard focus ring.
 *
 * Radix focuses a trigger from script on mousedown (Safari does not focus a clicked button).
 * Chromium decides `:focus-visible` for script focus from whatever had focus before, so on a
 * page where nothing was focused yet the clicked tab got the ring, and kept it until a click
 * elsewhere. This runs first: it focuses the tab as a pointer focus (`focusVisible: false`), so
 * Radix's call is a no-op. Where that option is not supported and the ring shows anyway, the
 * tab is blurred once React's handlers are done, and the browser's own mousedown focus (which
 * never shows the ring) takes over. Keyboard focus (Tab, arrow keys) is untouched.
 */
function focusWithoutRing(e: React.MouseEvent<HTMLButtonElement>) {
  if (e.defaultPrevented || e.button !== 0 || e.ctrlKey) return;
  const el = e.currentTarget;
  el.focus({ focusVisible: false } as FocusOptions);
  queueMicrotask(() => {
    if (document.activeElement === el && el.matches(':focus-visible')) el.blur();
  });
}

export function TabsTrigger({
  className,
  onMouseDown,
  ...props
}: React.ComponentProps<typeof T.Trigger>) {
  return (
    <T.Trigger
      className={cn(
        'relative inline-flex items-center gap-1.5 px-2 text-sm font-medium text-fg-muted transition-colors hover:text-fg data-[state=active]:text-fg [&_svg]:size-3.5',
        'after:absolute after:inset-x-1.5 after:-bottom-px after:h-0.5 after:rounded-full after:bg-transparent data-[state=active]:after:bg-accent',
        'focus-visible:outline-offset-[-2px]',
        className,
      )}
      onMouseDown={(e) => {
        onMouseDown?.(e);
        focusWithoutRing(e);
      }}
      {...props}
    />
  );
}
