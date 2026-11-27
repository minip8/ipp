'use client';
/**
 * A question the builder asks before it throws work away (replacing the custom draft, discarding
 * it): what is lost, a way back, and the action, named for what it does.
 */
import type { ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useReturnFocus } from './return-focus';

export function ConfirmDialog({
  open,
  title,
  children,
  cancel = 'Cancel',
  confirm,
  onConfirm,
  onCancel,
  testId,
}: {
  open: boolean;
  title: string;
  children: ReactNode;
  cancel?: string;
  confirm: string;
  onConfirm: () => void;
  onCancel: () => void;
  testId?: string;
}) {
  const returnFocus = useReturnFocus(open);
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onCancel()}>
      <DialogContent className="max-w-md" data-testid={testId} onCloseAutoFocus={returnFocus}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{children}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="ghost" onClick={onCancel}>
            {cancel}
          </Button>
          <Button variant="danger" onClick={onConfirm}>
            {confirm}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
