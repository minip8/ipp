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
export function TabsTrigger({ className, ...props }: React.ComponentProps<typeof T.Trigger>) {
  return (
    <T.Trigger
      className={cn(
        'relative inline-flex items-center gap-1.5 px-2 text-sm font-medium text-fg-muted transition-colors hover:text-fg data-[state=active]:text-fg [&_svg]:size-3.5',
        'after:absolute after:inset-x-1.5 after:-bottom-px after:h-0.5 after:rounded-full after:bg-transparent data-[state=active]:after:bg-accent',
        'focus-visible:outline-offset-[-2px]',
        className,
      )}
      {...props}
    />
  );
}
