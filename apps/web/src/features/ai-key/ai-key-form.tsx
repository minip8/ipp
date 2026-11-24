'use client';
/**
 * Entering, replacing and removing the user's Anthropic API key. The input is never pre-filled
 * and is cleared as soon as the key is saved; the only thing ever shown afterwards is the last
 * four characters.
 */
import type { AiKeyStatus } from '@ipp/contracts';
import {
  AlertTriangleIcon,
  CheckCircle2Icon,
  EyeIcon,
  EyeOffIcon,
  KeyRoundIcon,
  Trash2Icon,
} from 'lucide-react';
import { type FormEvent, useId, useRef, useState } from 'react';
import { toast } from 'sonner';
import { useRetryCountdown } from '@/components/states';
import { Button } from '@/components/ui/button';
import { Input, Label } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import { errorMessage, formatRetry } from '@/lib/api';
import { cn } from '@/lib/utils';
import {
  CONSOLE_KEYS_URL,
  expiresIn,
  keyFormatError,
  maskedKey,
  normalizeKey,
  PROBLEM_TEXT,
} from './logic';
import { useAiKeyMutations } from './use-ai-key';

export function ConsoleLink({ children = 'Anthropic Console' }: { children?: React.ReactNode }) {
  return (
    <a
      href={CONSOLE_KEYS_URL}
      target="_blank"
      rel="noopener noreferrer"
      className="font-medium text-accent-text underline-offset-2 hover:underline"
    >
      {children}
    </a>
  );
}

/** Saved key: last four, expiry, replace and remove. */
function SavedKey({
  status,
  onReplace,
  compact,
}: {
  status: AiKeyStatus;
  onReplace: () => void;
  compact?: boolean;
}) {
  const { remove } = useAiKeyMutations();
  const when = expiresIn(status.expiresAt);
  return (
    <div
      className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-surface-2 px-3.5 py-3"
      data-testid="ai-key-saved"
    >
      <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-ok-soft text-ok-text">
        <CheckCircle2Icon className="size-4" aria-hidden />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">
          Key saved <span className="font-mono text-fg-muted">{maskedKey(status.last4)}</span>
        </p>
        <p className="text-xs text-fg-muted">
          {when ? `Removed ${when} unless you use it. ` : ''}
          {compact ? '' : 'Every interview, assessment or graded answer restarts the clock.'}
        </p>
      </div>
      <div className="flex items-center gap-1.5">
        <Button size="sm" onClick={onReplace}>
          Replace
        </Button>
        <Button
          size="sm"
          variant="danger-ghost"
          disabled={remove.isPending}
          onClick={() =>
            remove.mutate(undefined, {
              onSuccess: () => toast.success('API key removed'),
              onError: (e) =>
                toast.error('Could not remove the key', { description: errorMessage(e) }),
            })
          }
        >
          {remove.isPending ? <Spinner /> : <Trash2Icon />} Remove
        </Button>
      </div>
    </div>
  );
}

/** Rejected by Anthropic while in use. */
export function RejectedNotice({ status }: { status: AiKeyStatus }) {
  return (
    <div
      role="status"
      className="flex items-start gap-2.5 rounded-lg border border-warn/40 bg-warn-soft px-3.5 py-3 text-sm text-warn-text"
      data-testid="ai-key-rejected"
    >
      <AlertTriangleIcon className="mt-0.5 size-4 shrink-0" aria-hidden />
      <p>
        <span className="font-medium">Anthropic rejected {maskedKey(status.last4)}.</span>{' '}
        {status.problem ? PROBLEM_TEXT[status.problem] : ''} The AI features are paused until you
        save a working key.
      </p>
    </div>
  );
}

export function AiKeyForm({
  status,
  onSaved,
  autoFocus,
  compact,
  submitLabel = 'Save key',
  secondary,
}: {
  status: AiKeyStatus | undefined;
  onSaved?: (s: AiKeyStatus) => void;
  autoFocus?: boolean;
  /** Dialog version: less text. */
  compact?: boolean;
  submitLabel?: string;
  /** Extra action next to the submit button (e.g. "Start without the interviewer"). */
  secondary?: React.ReactNode;
}) {
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const { save } = useAiKeyMutations();
  const [value, setValue] = useState('');
  const [show, setShow] = useState(false);
  const [touched, setTouched] = useState(false);
  const [replacing, setReplacing] = useState(false);
  const wait = useRetryCountdown(save.error);

  const localError = touched ? keyFormatError(value) : null;
  const serverError = save.error ? errorMessage(save.error) : null;
  const shownError = localError ?? serverError;

  if (status?.state === 'active' && !replacing)
    return <SavedKey status={status} compact={compact} onReplace={() => setReplacing(true)} />;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (keyFormatError(value)) {
      input.current?.focus();
      return;
    }
    save.mutate(normalizeKey(value), {
      onSuccess: (s) => {
        // Drop the plaintext from the page as soon as it is stored.
        setValue('');
        setShow(false);
        setTouched(false);
        setReplacing(false);
        toast.success('API key saved', { description: `Using ${maskedKey(s.last4)}.` });
        onSaved?.(s);
      },
    });
  };

  return (
    <form onSubmit={submit} noValidate className="space-y-3">
      {status?.state === 'rejected' && <RejectedNotice status={status} />}
      <div className="space-y-1.5">
        <Label htmlFor={`${id}-key`}>
          {replacing || status?.state === 'rejected' ? 'New API key' : 'Anthropic API key'}
        </Label>
        <div className="relative">
          <KeyRoundIcon
            className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-fg-subtle"
            aria-hidden
          />
          <Input
            ref={input}
            id={`${id}-key`}
            name="anthropic-api-key"
            type={show ? 'text' : 'password'}
            value={value}
            placeholder="sk-ant-…"
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
            // Password managers should neither offer nor capture this field.
            data-1p-ignore=""
            data-lpignore="true"
            data-bwignore=""
            data-form-type="other"
            autoFocus={autoFocus}
            aria-invalid={shownError ? true : undefined}
            aria-describedby={`${id}-hint${shownError ? ` ${id}-error` : ''}`}
            disabled={save.isPending}
            onChange={(e) => {
              setValue(e.target.value);
              if (save.error) save.reset();
            }}
            onPaste={(e) => {
              // Pasted keys often carry a trailing newline; validate right away.
              const text = e.clipboardData.getData('text');
              if (text) {
                e.preventDefault();
                setValue(normalizeKey(text));
                setTouched(true);
                if (save.error) save.reset();
              }
            }}
            onBlur={() => value && setTouched(true)}
            className="pr-10 pl-8 font-mono text-sm"
          />
          <button
            type="button"
            onClick={() => setShow((s) => !s)}
            aria-label={show ? 'Hide key' : 'Show key'}
            aria-pressed={show}
            className="absolute top-1/2 right-1.5 inline-flex size-7 -translate-y-1/2 items-center justify-center rounded-md text-fg-subtle hover:bg-surface-3 hover:text-fg"
          >
            {show ? <EyeOffIcon className="size-4" /> : <EyeIcon className="size-4" />}
          </button>
        </div>
        {shownError ? (
          <p
            id={`${id}-error`}
            role="alert"
            className="flex items-start gap-1.5 text-xs text-bad-text"
          >
            <AlertTriangleIcon className="mt-px size-3.5 shrink-0" aria-hidden />
            <span>{shownError}</span>
          </p>
        ) : null}
        <p id={`${id}-hint`} className="text-xs text-fg-muted">
          {save.isPending
            ? 'Checking the key with Anthropic…'
            : compact
              ? 'We check it with Anthropic before saving.'
              : 'We make one tiny request with it to check that it works before saving it.'}
        </p>
      </div>
      <div className={cn('flex flex-wrap items-center gap-2', compact && 'justify-end')}>
        {secondary}
        {replacing && (
          <Button
            variant="ghost"
            onClick={() => {
              setReplacing(false);
              setValue('');
              setTouched(false);
              save.reset();
            }}
          >
            Cancel
          </Button>
        )}
        <Button type="submit" variant="primary" disabled={save.isPending || wait > 0}>
          {save.isPending ? <Spinner /> : <KeyRoundIcon />}
          {save.isPending
            ? 'Checking…'
            : wait > 0
              ? `Try again in ${formatRetry(wait)}`
              : submitLabel}
        </Button>
      </div>
    </form>
  );
}
