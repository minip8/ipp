import { cva, type VariantProps } from 'class-variance-authority';
import type * as React from 'react';
import { cn } from '@/lib/utils';

export const badgeVariants = cva(
  'inline-flex items-center gap-1 rounded-[4px] border px-1.5 h-5 text-2xs font-medium whitespace-nowrap [&_svg]:size-3 [&_svg]:shrink-0',
  {
    variants: {
      tone: {
        neutral: 'border-border bg-surface-2 text-fg-muted',
        accent: 'border-transparent bg-accent-soft text-accent-text',
        ok: 'border-transparent bg-ok-soft text-ok-text',
        bad: 'border-transparent bg-bad-soft text-bad-text',
        warn: 'border-transparent bg-warn-soft text-warn-text',
        proactive: 'border-transparent bg-proactive-soft text-proactive',
        outline: 'border-border-strong bg-transparent text-fg-muted',
      },
    },
    defaultVariants: { tone: 'neutral' },
  },
);

export function Badge({
  className,
  tone,
  ...props
}: React.ComponentProps<'span'> & VariantProps<typeof badgeVariants>) {
  return <span className={cn(badgeVariants({ tone }), className)} {...props} />;
}
