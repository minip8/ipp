'use client';
import { CheckIcon, ChevronRightIcon } from 'lucide-react';
import { DropdownMenu as M } from 'radix-ui';
import type * as React from 'react';
import { cn } from '@/lib/utils';

export const Menu = M.Root;
export const MenuTrigger = M.Trigger;
export const MenuGroup = M.Group;
export const MenuSub = M.Sub;
export const MenuRadioGroup = M.RadioGroup;

const panel =
  'z-50 min-w-44 overflow-hidden rounded-lg border border-border bg-surface p-1 text-sm text-fg shadow-overlay data-[state=open]:animate-pop-in';
const item =
  'relative flex h-8 cursor-default items-center gap-2 rounded-md px-2 outline-none select-none data-[highlighted]:bg-surface-3 data-[disabled]:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:text-fg-muted';

export function MenuContent({
  className,
  sideOffset = 6,
  ...props
}: React.ComponentProps<typeof M.Content>) {
  return (
    <M.Portal>
      <M.Content sideOffset={sideOffset} className={cn(panel, className)} {...props} />
    </M.Portal>
  );
}
export function MenuItem({
  className,
  tone,
  ...props
}: React.ComponentProps<typeof M.Item> & { tone?: 'danger' }) {
  return (
    <M.Item
      className={cn(item, tone === 'danger' && 'text-bad-text [&_svg]:text-bad-text', className)}
      {...props}
    />
  );
}
export function MenuCheckboxItem({
  className,
  children,
  ...props
}: React.ComponentProps<typeof M.CheckboxItem>) {
  return (
    <M.CheckboxItem className={cn(item, 'pl-7', className)} {...props}>
      <M.ItemIndicator className="absolute left-2">
        <CheckIcon />
      </M.ItemIndicator>
      {children}
    </M.CheckboxItem>
  );
}
export function MenuRadioItem({
  className,
  children,
  ...props
}: React.ComponentProps<typeof M.RadioItem>) {
  return (
    <M.RadioItem className={cn(item, 'pl-7', className)} {...props}>
      <M.ItemIndicator className="absolute left-2">
        <CheckIcon />
      </M.ItemIndicator>
      {children}
    </M.RadioItem>
  );
}
export function MenuLabel({ className, ...props }: React.ComponentProps<typeof M.Label>) {
  return (
    <M.Label
      className={cn(
        'px-2 pt-1.5 pb-1 text-2xs font-medium uppercase tracking-wider text-fg-subtle',
        className,
      )}
      {...props}
    />
  );
}
export function MenuSeparator({ className, ...props }: React.ComponentProps<typeof M.Separator>) {
  return <M.Separator className={cn('-mx-1 my-1 h-px bg-border', className)} {...props} />;
}
export function MenuSubTrigger({
  className,
  children,
  ...props
}: React.ComponentProps<typeof M.SubTrigger>) {
  return (
    <M.SubTrigger className={cn(item, 'data-[state=open]:bg-surface-3', className)} {...props}>
      {children}
      <ChevronRightIcon className="ml-auto" />
    </M.SubTrigger>
  );
}
export function MenuSubContent({ className, ...props }: React.ComponentProps<typeof M.SubContent>) {
  return (
    <M.Portal>
      <M.SubContent className={cn(panel, className)} {...props} />
    </M.Portal>
  );
}
export function MenuShortcut({ className, ...props }: React.ComponentProps<'span'>) {
  return <span className={cn('ml-auto pl-4 text-xs text-fg-subtle', className)} {...props} />;
}
