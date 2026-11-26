'use client';
/**
 * Confirms a deletion from the user's history, the way deleting an interview does: what is
 * lost, Cancel, and a danger button. `onConfirm` does the request and the cache updates; on
 * failure the dialog stays open with the error and the button offers to try again, so nothing
 * leaves a list until it is gone. A toast confirms success after the dialog closes.
 */
import { useMutation } from '@tanstack/react-query';
import { AlertTriangleIcon, Trash2Icon } from 'lucide-react';
import { useEffect } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Spinner } from '@/components/ui/spinner';
import { Tooltip } from '@/components/ui/tooltip';
import { errorMessage } from '@/lib/api';
import { cn } from '@/lib/utils';
import type { DeleteCopy } from './logic';

export function ConfirmDeleteDialog({
  copy,
  confirmKey,
  onConfirm,
  onClose,
  onDone,
  toastDetail,
}: {
  /** null: closed. */
  copy: DeleteCopy | null;
  /** Identifies what is being deleted, so reopening for another item clears an old error. */
  confirmKey: string | null;
  onConfirm: () => Promise<void>;
  onClose: () => void;
  /** After success, once the dialog has closed (navigate away, say). */
  onDone?: () => void;
  toastDetail?: string;
}) {
  const del = useMutation({
    mutationFn: onConfirm,
    onSuccess: () => {
      if (copy) toast.success(copy.done, toastDetail ? { description: toastDetail } : undefined);
      onClose();
      onDone?.();
    },
  });
  const { reset } = del;
  useEffect(() => {
    if (confirmKey) reset();
  }, [confirmKey, reset]);

  const busy = del.isPending;
  return (
    <Dialog open={copy !== null} onOpenChange={(o) => !o && !busy && onClose()}>
      {copy && (
        <DialogContent className="max-w-md" hideClose={busy}>
          <DialogHeader>
            <DialogTitle>{copy.title}</DialogTitle>
            <DialogDescription>{copy.description}</DialogDescription>
          </DialogHeader>
          <DialogBody>
            <p className="text-xs font-medium text-fg-muted">{copy.lostHeading}</p>
            <ul className="mt-1.5 list-disc space-y-1 pl-5 text-sm">
              {copy.lost.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
            {del.isError && (
              <p
                role="alert"
                className="mt-3 flex items-start gap-2 rounded-md border border-bad/40 bg-bad-soft/60 px-3 py-2 text-sm text-bad-text"
              >
                <AlertTriangleIcon className="mt-0.5 size-4 shrink-0" aria-hidden />
                <span>
                  {copy.failed} {errorMessage(del.error)}
                </span>
              </p>
            )}
          </DialogBody>
          <DialogFooter>
            <Button variant="ghost" disabled={busy} onClick={onClose}>
              Cancel
            </Button>
            <Button
              variant="danger"
              disabled={busy}
              className={cn(busy && 'cursor-wait')}
              onClick={() => del.mutate()}
            >
              {busy ? <Spinner /> : <Trash2Icon />}
              {busy ? copy.pending : del.isError ? 'Try again' : copy.confirm}
            </Button>
          </DialogFooter>
        </DialogContent>
      )}
    </Dialog>
  );
}

/** Small icon button that opens the dialog for one row; labelled with the action and the item. */
export function DeleteRowButton({
  action,
  name,
  onClick,
  className,
}: {
  action: string;
  name: string;
  onClick: () => void;
  className?: string;
}) {
  return (
    <Tooltip label={action}>
      <Button
        variant="ghost"
        size="icon-xs"
        aria-label={`${action}: ${name}`}
        className={cn('hover:bg-bad-soft hover:text-bad-text', className)}
        onClick={onClick}
      >
        <Trash2Icon />
      </Button>
    </Tooltip>
  );
}
