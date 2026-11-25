'use client';
import { Tooltip as T } from 'radix-ui';
import type * as React from 'react';
import { cn } from '@/lib/utils';
import { Kbd } from './kbd';

export const TooltipProvider = T.Provider;

/**
 * Whether the last thing the user did was move focus with the keyboard (Tab or an arrow key).
 * `:focus-visible` cannot answer this: browsers also report it for focus that a script moved.
 */
let keyboardNavigating = false;
const NAVIGATION_KEYS = new Set([
  'Tab',
  'ArrowLeft',
  'ArrowRight',
  'ArrowUp',
  'ArrowDown',
  'Home',
  'End',
]);
if (typeof document !== 'undefined') {
  document.addEventListener(
    'keydown',
    (e) => {
      keyboardNavigating = NAVIGATION_KEYS.has(e.key);
    },
    true,
  );
  document.addEventListener(
    'pointerdown',
    () => {
      keyboardNavigating = false;
    },
    true,
  );
}

/**
 * Wraps a single focusable child. `shortcut` renders a key chord after the label.
 *
 * Opens on hover and when the user moves focus to the child with the keyboard. Radix would also
 * open it on any other focus, including the one a menu, popover or dialog hands back to the
 * child when it closes: after picking a menu item the label popped up over the button.
 */
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
      <T.Trigger
        asChild
        onFocus={(e) => {
          // Radix skips its own handler when the event is already default-prevented.
          if (!keyboardNavigating) e.preventDefault();
        }}
      >
        {children}
      </T.Trigger>
      <T.Portal>
        <T.Content
          side={side}
          sideOffset={6}
          collisionPadding={8}
          className={cn(
            'z-[60] flex max-w-[var(--radix-tooltip-content-available-width)] items-center gap-2 rounded-md bg-fg px-2 py-1 text-xs font-medium text-bg shadow-pop data-[state=delayed-open]:animate-fade-in',
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
