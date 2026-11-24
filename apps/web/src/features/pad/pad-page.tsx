'use client';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { AuthGate } from '@/components/auth-gate';
import { Logo } from '@/components/logo';
import { ErrorState } from '@/components/states';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { ApiRequestError, api } from '@/lib/api';
import { qk, useMe } from '@/lib/queries';
import { PadSessionProvider } from './session';
import { Workspace } from './workspace';

function PadSkeleton() {
  return (
    <div
      className="flex h-dvh flex-col"
      role="status"
      aria-busy="true"
      aria-label="Loading the interview"
    >
      <div className="flex h-11 items-center gap-3 border-b border-border bg-surface px-3">
        <Skeleton className="size-6" />
        <Skeleton className="h-4 w-40" />
        <Skeleton className="ml-auto h-6 w-48" />
      </div>
      <div className="flex min-h-0 flex-1">
        <div className="w-1/4 space-y-3 border-r border-border bg-surface p-4">
          <Skeleton className="h-5 w-2/3" />
          <Skeleton className="h-3 w-full" />
          <Skeleton className="h-3 w-5/6" />
          <Skeleton className="h-3 w-4/6" />
        </div>
        <div className="flex flex-1 flex-col">
          <div className="h-9 border-b border-border bg-surface" />
          <div className="flex-1 bg-editor" />
          <div className="h-1/3 border-t border-border bg-surface" />
        </div>
        <div className="w-1/4 border-l border-border bg-surface" />
      </div>
    </div>
  );
}

function PadLoader({ id }: { id: string }) {
  const me = useMe();
  const q = useQuery({
    queryKey: qk.pad(id),
    queryFn: () => api.pad(id),
    staleTime: Number.POSITIVE_INFINITY,
    refetchOnWindowFocus: false,
  });
  if (q.isPending || !me.data) return <PadSkeleton />;
  if (q.isError) {
    const notFound =
      q.error instanceof ApiRequestError && (q.error.status === 404 || q.error.status === 403);
    return (
      <div className="flex min-h-dvh flex-col">
        <header className="flex h-14 items-center px-4">
          <Logo href="/dashboard" />
        </header>
        <div className="flex flex-1 items-start justify-center pt-[12vh]">
          {notFound ? (
            <div className="max-w-sm text-center">
              <h1 className="text-lg font-semibold">This pad is not available</h1>
              <p className="mt-1 text-sm text-fg-muted">
                It was deleted, it does not exist, or you are not a member. If someone invited you,
                open their invite link again.
              </p>
              <Button asChild className="mt-5" variant="primary">
                <Link href="/dashboard">Go to your interviews</Link>
              </Button>
            </div>
          ) : (
            <ErrorState error={q.error} onRetry={() => q.refetch()} />
          )}
        </div>
      </div>
    );
  }
  return (
    <PadSessionProvider key={id} detail={q.data} me={me.data}>
      <Workspace />
    </PadSessionProvider>
  );
}

export function PadPage({ id }: { id: string }) {
  return (
    <AuthGate fallback={<PadSkeleton />}>
      <PadLoader id={id} />
    </AuthGate>
  );
}
