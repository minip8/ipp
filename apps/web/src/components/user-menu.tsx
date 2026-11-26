'use client';
import { useQueryClient } from '@tanstack/react-query';
import { KeyRoundIcon, LayoutGridIcon, ListChecksIcon, LogOutIcon } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { errorMessage } from '@/lib/api';
import { auth } from '@/lib/auth';
import { useAiKey, useMe } from '@/lib/queries';
import { cn } from '@/lib/utils';
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from './ui/menu';

export function Avatar({
  name,
  image,
  className,
}: {
  name: string;
  image?: string | null;
  className?: string;
}) {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((s) => s[0]?.toUpperCase())
    .join('');
  if (image) {
    return (
      // biome-ignore lint/performance/noImgElement: tiny remote avatar, no optimisation needed
      <img
        src={image}
        alt=""
        className={cn('size-7 rounded-full border border-border object-cover', className)}
      />
    );
  }
  return (
    <span
      className={cn(
        'inline-flex size-7 items-center justify-center rounded-full bg-accent-soft text-2xs font-semibold text-accent-text',
        className,
      )}
    >
      {initials || '?'}
    </span>
  );
}

export function UserMenu() {
  const me = useMe();
  const qc = useQueryClient();
  const router = useRouter();
  // A guest has no key and may not ask (403 account_required): only an account has one.
  const key = useAiKey(Boolean(me.data && !me.data.guest));
  if (!me.data) return <span className="skeleton size-7 rounded-full" />;
  const u = me.data;
  return (
    <Menu>
      <MenuTrigger className="touch-hit rounded-full" aria-label="Account menu">
        <Avatar name={u.name} image={u.image} />
      </MenuTrigger>
      <MenuContent align="end" className="w-56">
        <div className="px-2 py-1.5">
          <p className="truncate text-sm font-medium">{u.name}</p>
          <p className="truncate text-xs text-fg-muted">{u.email}</p>
        </div>
        <MenuSeparator />
        <MenuItem asChild>
          <Link href="/dashboard">
            <LayoutGridIcon /> Interviews
          </Link>
        </MenuItem>
        <MenuItem asChild>
          <Link href="/quiz">
            <ListChecksIcon /> Quizzes
          </Link>
        </MenuItem>
        <MenuSeparator />
        <MenuItem asChild>
          <Link href="/settings/ai-key">
            <KeyRoundIcon /> AI key
            {key.data && (
              <span
                className={cn(
                  'ml-auto text-2xs',
                  key.data.state === 'active'
                    ? 'font-mono text-fg-subtle'
                    : key.data.state === 'rejected'
                      ? 'text-warn-text'
                      : 'text-fg-subtle',
                )}
              >
                {key.data.state === 'active'
                  ? `…${key.data.last4 ?? ''}`
                  : key.data.state === 'rejected'
                    ? 'Rejected'
                    : 'Not set'}
              </span>
            )}
          </Link>
        </MenuItem>
        <MenuItem
          onSelect={async () => {
            try {
              await auth.signOut();
            } catch (e) {
              toast.error(errorMessage(e));
              return;
            }
            qc.clear();
            router.replace('/');
          }}
        >
          <LogOutIcon /> Sign out
        </MenuItem>
      </MenuContent>
    </Menu>
  );
}
