'use client';
/** "Delete" on an attempt's own page (running or finished): confirms, then goes to the history. */
import type { QuizAttempt } from '@ipp/contracts';
import { Trash2Icon } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Tooltip } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { ConfirmDeleteDialog } from './confirm-delete-dialog';
import { useDeleteAttempt } from './hooks';
import { type AttemptTarget, attemptDeleteCopy } from './logic';

export function DeleteAttemptButton({
  attempt,
  topics,
  answered,
  className,
}: {
  attempt: QuizAttempt;
  /** The topics' titles, joined. */
  topics: string;
  /** Questions answered so far, when the page knows more than the attempt it loaded. */
  answered?: number;
  className?: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const { remove } = useDeleteAttempt();
  const target: AttemptTarget = {
    id: attempt.id,
    mode: attempt.mode,
    status: attempt.status,
    topics,
    answered: answered ?? Object.keys(attempt.responses).length,
  };
  const copy = attemptDeleteCopy(target);
  return (
    <>
      <Tooltip label={copy.action}>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={copy.action}
          className={cn('hover:bg-bad-soft hover:text-bad-text max-sm:size-10', className)}
          onClick={() => setOpen(true)}
        >
          <Trash2Icon />
        </Button>
      </Tooltip>
      <ConfirmDeleteDialog
        copy={open ? copy : null}
        confirmKey={open ? attempt.id : null}
        toastDetail={topics}
        onConfirm={() => remove(attempt.id)}
        onClose={() => setOpen(false)}
        // The attempt's cached detail is left to expire: dropping it while this page is still
        // on screen would refetch it, and show "does not exist" on the way out.
        onDone={() => router.push('/quiz?view=history')}
      />
    </>
  );
}
