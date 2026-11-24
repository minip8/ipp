'use client';
/**
 * "Add your API key" without leaving the page: used by every prompt (new interview, pad chat,
 * report, quiz). Whatever the user was doing stays as it was underneath.
 */
import type { AiKeyStatus } from '@ipp/contracts';
import { LockKeyholeIcon, TimerResetIcon, WalletIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useAiKey } from '@/lib/queries';
import { AiKeyForm, ConsoleLink } from './ai-key-form';

/** The three things to know before pasting a key here. */
export function KeyFacts({ ttlHours = 24, className }: { ttlHours?: number; className?: string }) {
  const facts: [ReactNode, ReactNode][] = [
    [
      <LockKeyholeIcon key="i" className="size-4" />,
      <>
        Stored encrypted on our server, never in the database or logs, and never shown again (only
        its last four characters).
      </>,
    ],
    [
      <TimerResetIcon key="i" className="size-4" />,
      <>
        Deleted after {ttlHours === 24 ? 'a day' : `${ttlHours} hours`} without use, when you sign
        out, or whenever you remove it.
      </>,
    ],
    [
      <WalletIcon key="i" className="size-4" />,
      <>
        Usage is billed to your Anthropic account. Create a dedicated key with a spend limit in the{' '}
        <ConsoleLink />.
      </>,
    ],
  ];
  return (
    <ul className={className ?? 'space-y-2'}>
      {facts.map(([icon, text], i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: static list
        <li key={i} className="flex items-start gap-2.5 text-sm text-fg-muted">
          <span className="mt-0.5 shrink-0 text-fg-subtle" aria-hidden>
            {icon}
          </span>
          <span>{text}</span>
        </li>
      ))}
    </ul>
  );
}

export function AiKeyDialog({
  open,
  onOpenChange,
  onSaved,
  title = 'Add your Anthropic API key',
  description = 'The AI interviewer, the written assessment and AI grading run on your own key; interview++ does not pay for model usage.',
  submitLabel,
  secondary,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called after the key was checked and saved (the dialog closes itself). */
  onSaved?: (s: AiKeyStatus) => void;
  title?: string;
  description?: string;
  submitLabel?: string;
  secondary?: ReactNode;
}) {
  const status = useAiKey(open);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-md"
        // Keys typed here must not reach page-level shortcuts (quiz, pad) underneath.
        onKeyDown={(e) => e.stopPropagation()}
      >
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <DialogBody className="space-y-4 pb-5">
          <KeyFacts ttlHours={status.data?.ttlHours} />
          <AiKeyForm
            status={status.data?.state === 'active' ? undefined : status.data}
            compact
            autoFocus
            submitLabel={submitLabel}
            secondary={secondary}
            onSaved={(s) => {
              onOpenChange(false);
              onSaved?.(s);
            }}
          />
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}
