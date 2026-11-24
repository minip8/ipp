import type * as React from 'react';
import { cn } from '@/lib/utils';

export const fieldClass =
  'w-full rounded-md border border-border-strong bg-surface px-2.5 text-base text-fg placeholder:text-fg-subtle transition-[border-color,box-shadow] duration-100 outline-none focus-visible:border-accent focus-visible:ring-3 focus-visible:ring-accent/20 focus-visible:outline-none disabled:opacity-50 aria-invalid:border-bad aria-invalid:ring-bad/20';

export function Input({ className, ...props }: React.ComponentProps<'input'>) {
  return <input data-slot="input" className={cn(fieldClass, 'h-9', className)} {...props} />;
}

export function Textarea({ className, ...props }: React.ComponentProps<'textarea'>) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(fieldClass, 'min-h-20 py-2 leading-relaxed', className)}
      {...props}
    />
  );
}

export function Label({ className, ...props }: React.ComponentProps<'label'>) {
  return (
    // biome-ignore lint/a11y/noLabelWithoutControl: htmlFor is passed through props
    <label className={cn('text-sm font-medium text-fg select-none', className)} {...props} />
  );
}

export function FieldHint({ className, ...props }: React.ComponentProps<'p'>) {
  return <p className={cn('text-xs text-fg-muted', className)} {...props} />;
}
