'use client';
import { useMutation } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { api } from '@/lib/api';
import { AuthGate } from './auth-gate';
import { Logo } from './logo';
import { ErrorState } from './states';
import { Button } from './ui/button';
import { Spinner } from './ui/spinner';

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

export function JoinPad({ token }: { token: string }) {
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="flex h-14 items-center px-4">
        <Logo />
      </header>
      <main className="flex flex-1 items-start justify-center pt-[15vh]">
        <AuthGate fallback={<Spinner />}>
          <Joining token={token} />
        </AuthGate>
      </main>
    </div>
  );
}
