'use client';
import type { Interview, PadSummary } from '@ipp/contracts';
import { useMutation, useQueryClient } from '@tanstack/react-query';
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
import { api, errorMessage } from '@/lib/api';
import { qk } from '@/lib/queries';
import { cn } from '@/lib/utils';
import { alreadyGone, type DeleteTarget, deleteCopy, withoutInterview, withoutPad } from './logic';

/**
 * Confirms, then deletes the interview (owner) or removes it from the user's history
 * (collaborator). On success the row leaves the interview list, the pad's cached detail, report
 * and playback are dropped, a toast confirms, and `onDeleted` runs (after the dialog closes).
 * On failure the dialog stays open with the error, so nothing is removed. A staged interview is
 * deleted as a whole: it leaves the interviews list, and its stages' pads go with it.
 */
export function DeletePadDialog({
  target,
  onClose,
  onDeleted,
}: {
  target: DeleteTarget | null;
  onClose: () => void;
  onDeleted?: (t: DeleteTarget) => void;
}) {
  const qc = useQueryClient();
  const del = useMutation({
    mutationFn: async (t: DeleteTarget) => {
      try {
        await (t.interview ? api.deleteInterview(t.id) : api.deletePad(t.id));
      } catch (e) {
        if (!alreadyGone(e)) throw e;
      }
    },
    onSuccess: (_, t) => {
      if (t.interview) {
        qc.setQueryData<Interview[]>(qk.interviews, (old) => withoutInterview(old, t.id));
        void qc.invalidateQueries({ queryKey: qk.interviews });
        qc.removeQueries({ queryKey: qk.interview(t.id) });
      } else qc.setQueryData<PadSummary[]>(qk.pads, (old) => withoutPad(old, t.id));
      void qc.invalidateQueries({ queryKey: qk.pads });
      toast.success(deleteCopy(t).done, { description: t.problemTitle });
      onClose();
      onDeleted?.(t);
      for (const queryKey of [qk.pad(t.id), qk.report(t.id), qk.playback(t.id)])
        qc.removeQueries({ queryKey });
    },
  });
  const { reset } = del;
  // A freshly opened dialog never shows the previous attempt's error. Keyed on the id: callers
  // may pass a new target object on every render.
  const openId = target?.id ?? null;
  useEffect(() => {
    if (openId) reset();
  }, [openId, reset]);

  const busy = del.isPending;
  const copy = target ? deleteCopy(target) : null;
  return (
    <Dialog open={target !== null} onOpenChange={(o) => !o && !busy && onClose()}>
      {target && copy && (
        <DialogContent className="max-w-md" hideClose={busy}>
          <DialogHeader>
            <DialogTitle>{copy.title}</DialogTitle>
            <DialogDescription>{copy.description}</DialogDescription>
          </DialogHeader>
          <DialogBody>
            <p className="text-xs font-medium text-fg-muted">
              {target.role === 'owner' ? 'What is lost' : 'What changes for you'}
            </p>
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
                  {target.role === 'owner'
                    ? 'The interview was not deleted.'
                    : 'It was not removed from your history.'}{' '}
                  {errorMessage(del.error)}
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
              onClick={() => del.mutate(target)}
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

/** Small icon button that opens the dialog for one row; labelled with the action and problem. */
export function DeletePadButton({
  target,
  onClick,
  className,
}: {
  target: DeleteTarget;
  onClick: () => void;
  className?: string;
}) {
  const { action } = deleteCopy(target);
  return (
    <Tooltip label={action}>
      <Button
        variant="ghost"
        size="icon-xs"
        aria-label={`${action}: ${target.problemTitle}`}
        className={cn('hover:bg-bad-soft hover:text-bad-text', className)}
        onClick={onClick}
      >
        <Trash2Icon />
      </Button>
    </Tooltip>
  );
}
