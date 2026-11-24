'use client';
/**
 * A quiet, inline "this needs your API key" callout with a one-click way to add it. Shown only
 * where the missing key actually matters (starting an interview, the pad's interviewer panel,
 * the report's assessment, quiz short answers). It never blocks the page.
 */
import type { AiKeyState, AiKeyStatus } from '@ipp/contracts';
import { AlertTriangleIcon, KeyRoundIcon } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { AiKeyDialog } from './ai-key-dialog';

export function AiKeyPrompt({
  state,
  title,
  children,
  action = state === 'rejected' ? 'Update key' : 'Add API key',
  onSaved,
  dialogTitle,
  dialogDescription,
  className,
  size = 'md',
  testId = 'ai-key-prompt',
  quiet,
}: {
  state: Exclude<AiKeyState, 'active'>;
  title: ReactNode;
  children?: ReactNode;
  action?: string;
  onSaved?: (s: AiKeyStatus) => void;
  dialogTitle?: string;
  dialogDescription?: string;
  className?: string;
  size?: 'sm' | 'md';
  testId?: string;
  /** A secondary button, where the page already has a primary action nearby. */
  quiet?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const rejected = state === 'rejected';
  return (
    <div
      className={cn(
        'flex items-start gap-3 rounded-lg border',
        rejected ? 'border-warn/40 bg-warn-soft/60' : 'border-border bg-surface-2',
        size === 'sm' ? 'px-3 py-2.5' : 'px-4 py-3.5',
        className,
      )}
      data-testid={testId}
      data-state={state}
    >
      <span
        aria-hidden
        className={cn(
          'flex shrink-0 items-center justify-center rounded-md',
          size === 'sm' ? 'mt-px size-6' : 'size-8',
          rejected ? 'bg-warn-soft text-warn-text' : 'bg-accent-soft text-accent-text',
        )}
      >
        {rejected ? (
          <AlertTriangleIcon className={size === 'sm' ? 'size-3.5' : 'size-4'} />
        ) : (
          <KeyRoundIcon className={size === 'sm' ? 'size-3.5' : 'size-4'} />
        )}
      </span>
      <div className="min-w-0 flex-1">
        <p className={cn('font-medium text-fg', size === 'sm' ? 'text-xs' : 'text-sm')}>{title}</p>
        {children && (
          <div className={cn('mt-0.5 text-fg-muted', size === 'sm' ? 'text-xs' : 'text-sm')}>
            {children}
          </div>
        )}
        <Button
          size={size === 'sm' ? 'xs' : 'sm'}
          variant={rejected || quiet ? 'secondary' : 'primary'}
          className="mt-2"
          onClick={() => setOpen(true)}
        >
          <KeyRoundIcon /> {action}
        </Button>
      </div>
      <AiKeyDialog
        open={open}
        onOpenChange={setOpen}
        onSaved={onSaved}
        title={dialogTitle}
        description={dialogDescription}
      />
    </div>
  );
}
