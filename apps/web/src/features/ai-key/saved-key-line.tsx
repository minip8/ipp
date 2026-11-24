'use client';
/**
 * One line naming the saved key (provider and last four) with a way to change or remove it,
 * for places where the key is in use but its settings page is elsewhere: the interview setup
 * panel and the interviewer's options in a pad.
 */
import { KeyRoundIcon } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useAiKey } from '@/lib/queries';
import { cn } from '@/lib/utils';
import { AiKeyDialog } from './ai-key-dialog';
import { maskedKey, providerLabel } from './logic';

export const MANAGE_KEY_TITLE = 'Your AI API key';
export const MANAGE_KEY_DESCRIPTION =
  'Replace it with another key (from any provider) or remove it. Removing it pauses the AI interviewer, assessments and AI grading until you add one again.';

/** The manage dialog on its own, for callers that open it from a menu. */
export function ManageKeyDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  // Removing the key is the end of "change or remove": close rather than fall through to the
  // empty "add a key" form. The page underneath shows its own prompt for a key from then on.
  const key = useAiKey(open);
  const state = key.data?.state;
  const hadKey = useRef(false);
  useEffect(() => {
    if (!open) hadKey.current = false;
    else if (state === 'active') hadKey.current = true;
    else if (state && hadKey.current) {
      hadKey.current = false;
      onOpenChange(false);
    }
  }, [open, state, onOpenChange]);
  return (
    <AiKeyDialog
      manage
      open={open}
      onOpenChange={onOpenChange}
      title={MANAGE_KEY_TITLE}
      description={MANAGE_KEY_DESCRIPTION}
    />
  );
}

/** Renders nothing unless a key is saved. */
export function SavedKeyLine({ className }: { className?: string }) {
  const key = useAiKey();
  const [open, setOpen] = useState(false);
  if (key.data?.state !== 'active') return null;
  return (
    <div
      className={cn('flex items-center gap-2 text-xs text-fg-muted', className)}
      data-testid="saved-key-line"
    >
      <KeyRoundIcon className="size-3.5 shrink-0 text-fg-subtle" aria-hidden />
      <span className="min-w-0 flex-1 truncate">
        {providerLabel(key.data.provider)} key{' '}
        <span className="font-mono">{maskedKey(key.data.last4, key.data.provider)}</span>
      </span>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="shrink-0 rounded-sm font-medium text-accent-text underline-offset-2 hover:underline"
      >
        Change or remove
      </button>
      <ManageKeyDialog open={open} onOpenChange={setOpen} />
    </div>
  );
}
