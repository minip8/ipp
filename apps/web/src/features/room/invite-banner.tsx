'use client';
/** The host is alone in a new room: the next thing to do is send the invite link. */
import { CheckIcon, CopyIcon, UserPlusIcon } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { usePad } from '@/features/pad/session';
import { candidatesOf } from './logic';

export function InviteBanner() {
  const { state, isHost, readOnly } = usePad();
  const [copied, setCopied] = useState(false);
  const token = state.pad.shareToken;
  if (!isHost || readOnly || !token || candidatesOf(state.members).length > 0) return null;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}/join/${token}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      // No clipboard access: the Invite button in the top bar shows the link to copy by hand.
    }
  };
  return (
    <div
      className="flex shrink-0 items-center gap-3 border-b border-border bg-accent-soft/50 px-4 py-1.5 text-sm max-lg:gap-2 max-lg:px-3"
      role="status"
      data-testid="invite-banner"
    >
      <UserPlusIcon className="size-4 shrink-0 text-accent-text" aria-hidden />
      <span className="min-w-0 flex-1">
        Nobody has joined yet.
        <span className="max-sm:hidden">
          {' '}
          Send your candidate the invite link: they only need to type their name.
        </span>
      </span>
      <Button
        size="xs"
        variant={copied ? 'secondary' : 'primary'}
        onClick={copy}
        className="max-lg:h-9 max-lg:px-3"
      >
        {copied ? <CheckIcon /> : <CopyIcon />}
        {copied ? 'Copied' : 'Copy invite link'}
      </Button>
    </div>
  );
}
