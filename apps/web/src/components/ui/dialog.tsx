'use client';
import { XIcon } from 'lucide-react';
import { Dialog as D } from 'radix-ui';
import type * as React from 'react';
import { cn } from '@/lib/utils';

export const Dialog = D.Root;
export const DialogTrigger = D.Trigger;
export const DialogClose = D.Close;

export function DialogContent({
  className,
  children,
  hideClose,
  ...props
}: React.ComponentProps<typeof D.Content> & { hideClose?: boolean }) {
  return (
    <D.Portal>
      <D.Overlay className="fixed inset-0 z-50 bg-[oklch(0.15_0.01_260/0.45)] backdrop-blur-[1px] data-[state=open]:animate-fade-in" />
      <D.Content
        className={cn(
          'fixed top-1/2 left-1/2 z-50 flex max-h-[calc(100dvh-2rem-env(safe-area-inset-top)-env(safe-area-inset-bottom))] w-[calc(100vw-2rem-env(safe-area-inset-left)-env(safe-area-inset-right))] max-w-lg -translate-x-1/2 -translate-y-1/2 flex-col overscroll-contain rounded-xl border border-border bg-surface shadow-overlay outline-none data-[state=open]:animate-pop-in max-sm:overflow-y-auto',
          className,
        )}
        {...props}
      >
        {children}
        {!hideClose && (
          <D.Close
            className="touch-hit absolute top-3 right-3 inline-flex size-7 items-center justify-center rounded-md text-fg-subtle hover:bg-surface-3 hover:text-fg"
            aria-label="Close"
          >
            <XIcon className="size-4" />
          </D.Close>
        )}
      </D.Content>
    </D.Portal>
  );
}

export function DialogHeader({ className, ...props }: React.ComponentProps<'div'>) {
  return <div className={cn('flex flex-col gap-1 px-5 pt-5 pb-3 pr-12', className)} {...props} />;
}
export function DialogBody({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      className={cn('min-h-0 overflow-y-auto overscroll-contain px-5 py-2', className)}
      {...props}
    />
  );
}
export function DialogFooter({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      className={cn(
        'flex flex-wrap items-center justify-end gap-2 border-t border-border px-5 py-3 mt-3',
        className,
      )}
      {...props}
    />
  );
}
export function DialogTitle({ className, ...props }: React.ComponentProps<typeof D.Title>) {
  return <D.Title className={cn('text-md font-semibold text-fg', className)} {...props} />;
}
export function DialogDescription({
  className,
  ...props
}: React.ComponentProps<typeof D.Description>) {
  return <D.Description className={cn('text-sm text-fg-muted', className)} {...props} />;
}
