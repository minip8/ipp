'use client';
/**
 * The invite link. A practice pad is shared between accounts (sign in, then join). An interview
 * room takes anyone: whoever opens the link types their name and is in, no account needed.
 */
import { GUEST_NAME_MAX, type InviteInfo } from '@ipp/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowRightIcon } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useId, useState } from 'react';
import { cleanGuestName } from '@/features/room/logic';
import { ApiRequestError, api } from '@/lib/api';
import { qk, useMe } from '@/lib/queries';
import type { Me } from '@/lib/schemas';
import { AuthGate } from './auth-gate';
import { Logo } from './logo';
import { ErrorState, InlineError, useRetryCountdown } from './states';
import { Button } from './ui/button';
import { Input, Label } from './ui/input';
import { Spinner } from './ui/spinner';

/** Practice pads: join as the signed-in account, straight away. */
function Joining({ token }: { token: string }) {
  const router = useRouter();
  const join = useMutation({
    mutationFn: () => api.joinPad(token),
    onSuccess: ({ padId }) => router.replace(`/pads/${padId}`),
  });
  // biome-ignore lint/correctness/useExhaustiveDependencies: join once on mount
  useEffect(() => {
    join.mutate();
  }, []);
  if (join.isError)
    return (
      <div className="text-center">
        <ErrorState
          error={join.error}
          title="This invite link does not work"
          onRetry={() => join.mutate()}
        />
        <Button asChild variant="ghost">
          <Link href="/dashboard">Go to your interviews</Link>
        </Button>
      </div>
    );
  return (
    <p className="flex items-center gap-2 text-sm text-fg-muted" role="status">
      <Spinner /> Joining the interview…
    </p>
  );
}

function Shell({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="w-full max-w-sm px-4">
      <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
      {children}
    </div>
  );
}

/** A room: someone with an account joins as themselves; anyone else gives a name. */
function JoinRoom({ token, invite, me }: { token: string; invite: InviteInfo; me: Me | null }) {
  const router = useRouter();
  const qc = useQueryClient();
  const nameId = useId();
  const account = me && !me.guest ? me : null;
  // A returning guest keeps the name they used, and may change it.
  const [name, setName] = useState(me?.guest ? me.name : '');
  const join = useMutation({
    mutationFn: () => (account ? api.joinPad(token) : api.joinAsGuest(token, cleanGuestName(name))),
    onSuccess: async ({ padId }) => {
      // The session may be new (a guest was just created): everything keyed on "me" is stale.
      await qc.invalidateQueries({ queryKey: qk.me });
      router.replace(`/pads/${padId}`);
    },
  });
  const wait = useRetryCountdown(join.error);
  const ended =
    invite.status === 'ended' ||
    (join.error instanceof ApiRequestError && join.error.code === 'pad_ended');

  if (ended)
    return (
      <Shell title="This interview has ended">
        <p className="mt-2 text-sm text-fg-muted">
          {invite.hostName} has closed the room, so the link no longer lets anyone in.
        </p>
      </Shell>
    );
  const valid = Boolean(account) || cleanGuestName(name).length > 0;
  return (
    <Shell title={`${invite.hostName} invited you to an interview`}>
      <p className="mt-2 text-sm text-fg-muted">
        You&apos;ll share a code editor and a chat with {invite.hostName}. They see your code as you
        type.
      </p>
      <form
        className="mt-6 space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (valid && !join.isPending && wait === 0) join.mutate();
        }}
      >
        {account ? (
          <p className="rounded-md border border-border bg-surface-2 px-3 py-2 text-sm">
            You&apos;ll join as <span className="font-medium">{account.name}</span>.
          </p>
        ) : (
          <div className="space-y-1.5">
            <Label htmlFor={nameId}>Your name</Label>
            <Input
              id={nameId}
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={GUEST_NAME_MAX}
              autoComplete="name"
              autoCapitalize="words"
              enterKeyHint="go"
              autoFocus
              placeholder="As your interviewer should see it"
            />
          </div>
        )}
        <InlineError error={join.error} />
        <Button
          type="submit"
          variant="primary"
          size="lg"
          className="w-full"
          disabled={!valid || join.isPending || wait > 0}
        >
          {join.isPending ? <Spinner /> : null}
          {wait > 0 ? `Try again in ${wait}s` : 'Join the interview'}
          {!join.isPending && wait === 0 && <ArrowRightIcon />}
        </Button>
        {!account && (
          <p className="text-center text-xs text-fg-muted">
            No account needed.{' '}
            <Link
              href={`/sign-in?next=${encodeURIComponent(`/join/${token}`)}`}
              className="font-medium text-accent-text hover:underline"
            >
              Sign in instead
            </Link>
          </p>
        )}
      </form>
    </Shell>
  );
}

function Invite({ token }: { token: string }) {
  const me = useMe();
  const invite = useQuery({
    queryKey: qk.invite(token),
    queryFn: () => api.invite(token),
    retry: false,
    staleTime: 30_000,
  });
  if (invite.isPending || me.isPending)
    return (
      <p className="flex items-center gap-2 text-sm text-fg-muted" role="status">
        <Spinner /> Opening the invite…
      </p>
    );
  if (invite.isError)
    return invite.error instanceof ApiRequestError && invite.error.isNotFound ? (
      <Shell title="This invite link does not work">
        <p className="mt-2 text-sm text-fg-muted">
          The interview it led to was deleted, or the link is incomplete. Ask whoever invited you
          for a new one.
        </p>
      </Shell>
    ) : (
      <ErrorState error={invite.error} onRetry={() => invite.refetch()} />
    );
  if (invite.data.kind === 'room')
    return <JoinRoom token={token} invite={invite.data} me={me.data ?? null} />;
  return (
    <AuthGate fallback={<Spinner />}>
      <Joining token={token} />
    </AuthGate>
  );
}

export function JoinPad({ token }: { token: string }) {
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="flex h-14 shrink-0 items-center px-4">
        <Logo />
      </header>
      <main className="flex flex-1 items-start justify-center pt-[6vh] pb-16 sm:pt-[15vh] sm:pb-0">
        <Invite token={token} />
      </main>
    </div>
  );
}
