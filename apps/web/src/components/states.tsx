'use client';
import { AlertTriangleIcon, ClockIcon, LockIcon, RotateCwIcon, WifiOffIcon } from 'lucide-react';
import type * as React from 'react';
import { useEffect, useState } from 'react';
import { ApiRequestError, errorMessage, formatRetry } from '@/lib/api';
import { cn } from '@/lib/utils';
import { Button } from './ui/button';

export function EmptyState({
  icon: Icon,
  title,
  children,
  action,
  className,
}: {
  icon?: React.ComponentType<{ className?: string }>;
  title: string;
  children?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn('flex flex-col items-center justify-center px-6 py-10 text-center', className)}
    >
      {Icon && (
        <div className="mb-3 flex size-10 items-center justify-center rounded-lg border border-border bg-surface-2 text-fg-subtle">
          <Icon className="size-5" />
        </div>
      )}
      <p className="text-base font-medium text-fg">{title}</p>
      {children && <div className="mt-1 max-w-sm text-sm text-fg-muted">{children}</div>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

/** Ticks down a 429's retryAfter so the user sees when they can try again. */
export function useRetryCountdown(err: unknown) {
  const retryAfter =
    err instanceof ApiRequestError && err.isRateLimited ? err.retryAfter : undefined;
  const [left, setLeft] = useState(retryAfter ?? 0);
  useEffect(() => {
    if (!retryAfter) return;
    const until = Date.now() + retryAfter * 1000;
    setLeft(retryAfter);
    const t = setInterval(() => {
      const s = Math.max(0, Math.ceil((until - Date.now()) / 1000));
      setLeft(s);
      if (s === 0) clearInterval(t);
    }, 500);
    return () => clearInterval(t);
  }, [retryAfter]);
  return retryAfter ? left : 0;
}

/**
 * The quiz refuses answers to a candidate in a quant interview that is still going (409
 * `in_quant_interview`, ARCHITECTURE §8.4): not a fault, so it is explained, not shown as one.
 */
export const isQuantInterviewGuard = (e: unknown) =>
  e instanceof ApiRequestError && e.code === 'in_quant_interview';
export const QUANT_GUARD_TITLE = 'Answers are hidden during your interview';
export const QUANT_GUARD_TEXT =
  'You are the candidate in a quant interview that is still going, so the quiz keeps its answers and explanations to itself until it ends. You can still browse the questions. Once the interview is over, everything is back.';

export function ErrorState({
  error,
  onRetry,
  title,
  className,
  compact,
}: {
  error: unknown;
  onRetry?: () => void;
  title?: string;
  className?: string;
  compact?: boolean;
}) {
  const wait = useRetryCountdown(error);
  if (isQuantInterviewGuard(error))
    return (
      <div
        role="status"
        data-testid="quant-interview-guard"
        className={cn(
          'flex flex-col items-center justify-center text-center',
          compact ? 'px-4 py-6' : 'px-6 py-12',
          className,
        )}
      >
        <div className="mb-3 flex size-10 items-center justify-center rounded-lg border border-border bg-surface-2 text-fg-subtle">
          <LockIcon className="size-5" />
        </div>
        <p className="text-base font-medium text-fg">{QUANT_GUARD_TITLE}</p>
        <p className="mt-1 max-w-sm text-sm text-fg-muted">{QUANT_GUARD_TEXT}</p>
        {onRetry && (
          <Button className="mt-4" size="sm" onClick={onRetry}>
            <RotateCwIcon /> Check again
          </Button>
        )}
      </div>
    );
  const isNetwork = error instanceof ApiRequestError && error.status === 0;
  const isRate = error instanceof ApiRequestError && error.isRateLimited;
  const Icon = isNetwork ? WifiOffIcon : isRate ? ClockIcon : AlertTriangleIcon;
  const heading =
    title ??
    (isNetwork
      ? 'You appear to be offline'
      : isRate
        ? 'Slow down a little'
        : error instanceof ApiRequestError && error.isNotFound
          ? 'Not found'
          : 'Something went wrong');
  return (
    <div
      role="alert"
      className={cn(
        'flex flex-col items-center justify-center text-center',
        compact ? 'px-4 py-6' : 'px-6 py-12',
        className,
      )}
    >
      <div
        className={cn(
          'mb-3 flex size-10 items-center justify-center rounded-lg',
          isRate ? 'bg-warn-soft text-warn-text' : 'bg-bad-soft text-bad-text',
        )}
      >
        <Icon className="size-5" />
      </div>
      <p className="text-base font-medium text-fg">{heading}</p>
      <p className="mt-1 max-w-sm text-sm text-fg-muted">{errorMessage(error)}</p>
      {onRetry && (
        <Button className="mt-4" size="sm" onClick={onRetry} disabled={wait > 0}>
          <RotateCwIcon />
          {wait > 0 ? `Try again in ${formatRetry(wait)}` : 'Try again'}
        </Button>
      )}
    </div>
  );
}

export function InlineError({ error, className }: { error: unknown; className?: string }) {
  if (!error) return null;
  if (isQuantInterviewGuard(error))
    return (
      <p
        role="status"
        data-testid="quant-interview-guard"
        className={cn(
          'flex items-start gap-2 rounded-md border border-border bg-surface-2 px-3 py-2 text-sm text-fg-muted',
          className,
        )}
      >
        <LockIcon className="mt-0.5 size-4 shrink-0 text-fg-subtle" />
        <span>
          <span className="font-medium text-fg">{QUANT_GUARD_TITLE}.</span> {QUANT_GUARD_TEXT}
        </span>
      </p>
    );
  return (
    <p
      role="alert"
      className={cn(
        'flex items-start gap-2 rounded-md border border-bad/30 bg-bad-soft px-3 py-2 text-sm text-bad-text',
        className,
      )}
    >
      <AlertTriangleIcon className="mt-0.5 size-4 shrink-0" />
      <span>{errorMessage(error)}</span>
    </p>
  );
}
