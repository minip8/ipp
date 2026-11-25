'use client';
import { Switch as S } from 'radix-ui';
import type * as React from 'react';
import { cn } from '@/lib/utils';

export function Switch({ className, ...props }: React.ComponentProps<typeof S.Root>) {
  return (
    <S.Root
      className={cn(
        'touch-hit inline-flex h-[18px] w-8 shrink-0 items-center rounded-full border border-transparent bg-border-strong p-px transition-colors data-[state=checked]:bg-accent disabled:opacity-50',
        className,
      )}
      {...props}
    >
      <S.Thumb className="block size-[14px] rounded-full bg-white shadow-sm transition-transform data-[state=checked]:translate-x-[14px]" />
    </S.Root>
  );
}
