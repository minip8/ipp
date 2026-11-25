'use client';
import { CheckIcon } from 'lucide-react';
import { Checkbox as C } from 'radix-ui';
import type * as React from 'react';
import { cn } from '@/lib/utils';

export function Checkbox({ className, ...props }: React.ComponentProps<typeof C.Root>) {
  return (
    <C.Root
      className={cn(
        'touch-hit inline-flex size-4 shrink-0 items-center justify-center rounded-[4px] border border-border-strong bg-surface transition-colors data-[state=checked]:border-accent data-[state=checked]:bg-accent data-[state=checked]:text-accent-fg disabled:opacity-50',
        className,
      )}
      {...props}
    >
      <C.Indicator>
        <CheckIcon className="size-3" strokeWidth={3} />
      </C.Indicator>
    </C.Root>
  );
}
