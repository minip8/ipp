'use client';
import { CheckIcon, ChevronDownIcon } from 'lucide-react';
import { Select as S } from 'radix-ui';
import type * as React from 'react';
import { cn } from '@/lib/utils';

export const Select = S.Root;
export const SelectValue = S.Value;
export const SelectGroup = S.Group;

export function SelectTrigger({
  className,
  children,
  ...props
}: React.ComponentProps<typeof S.Trigger>) {
  return (
    <S.Trigger
      className={cn(
        'inline-flex h-8 w-full items-center justify-between gap-2 rounded-md border border-border-strong bg-surface px-2.5 text-sm text-fg outline-none hover:bg-surface-2 focus-visible:border-accent focus-visible:ring-3 focus-visible:ring-accent/20 data-[placeholder]:text-fg-subtle [&>span]:truncate',
        className,
      )}
      {...props}
    >
      {children}
      <S.Icon asChild>
        <ChevronDownIcon className="size-3.5 shrink-0 text-fg-subtle" />
      </S.Icon>
    </S.Trigger>
  );
}
export function SelectContent({
  className,
  children,
  position = 'popper',
  collisionPadding = 8,
  ...props
}: React.ComponentProps<typeof S.Content>) {
  return (
    <S.Portal>
      <S.Content
        position={position}
        sideOffset={4}
        collisionPadding={collisionPadding}
        className={cn(
          'z-50 max-h-[min(var(--radix-select-content-available-height),320px)] min-w-[var(--radix-select-trigger-width)] max-w-[var(--radix-select-content-available-width)] overflow-hidden rounded-lg border border-border bg-surface text-sm text-fg shadow-overlay data-[state=open]:animate-pop-in',
          className,
        )}
        {...props}
      >
        <S.Viewport className="p-1">{children}</S.Viewport>
      </S.Content>
    </S.Portal>
  );
}
/** A group's heading inside the list (lined up with the items' text, past the check mark). */
export function SelectLabel({ className, ...props }: React.ComponentProps<typeof S.Label>) {
  return (
    <S.Label
      className={cn(
        'pt-2 pr-2 pb-1 pl-7 text-2xs font-medium tracking-wider text-fg-subtle uppercase',
        className,
      )}
      {...props}
    />
  );
}

export function SelectItem({ className, children, ...props }: React.ComponentProps<typeof S.Item>) {
  return (
    <S.Item
      className={cn(
        'relative flex min-h-8 pointer-coarse:min-h-10 cursor-default items-center rounded-md py-1.5 pr-2 pl-7 [overflow-wrap:anywhere] outline-none select-none data-[highlighted]:bg-surface-3 data-[disabled]:opacity-50',
        className,
      )}
      {...props}
    >
      <S.ItemIndicator className="absolute left-2">
        <CheckIcon className="size-3.5" />
      </S.ItemIndicator>
      <S.ItemText>{children}</S.ItemText>
    </S.Item>
  );
}
