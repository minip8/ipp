'use client';
import { useQuery } from '@tanstack/react-query';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { AuthGate } from '@/components/auth-gate';
import { Logo } from '@/components/logo';
import { ErrorState } from '@/components/states';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { ApiRequestError, api } from '@/lib/api';
import { qk, useMe } from '@/lib/queries';
import { tabHref } from '@/lib/track';
import { useTrack } from '@/lib/track-hooks';
import { PadSessionProvider } from './session';
import { Workspace } from './workspace';

/**
 * A quant pad's workspace, in a chunk of its own: it typesets math, so KaTeX (script, stylesheet
 * and fonts) loads with it and never with a coding pad. It mounts no editor, so Monaco never
 * loads in a quant pad.
 */
const QuantWorkspace = dynamic(
  () => import('@/features/quant-pad/quant-workspace').then((m) => m.QuantWorkspace),
  { ssr: false, loading: () => <PadSkeleton /> },
);

/**
 * Server-rendered too (the auth gate's fallback), so the two layouts are chosen with CSS: three
 * columns from lg up, and below it the phone layout's single pane and tab bar.
 */
function PadSkeleton() {
  return (
    <div
      className="relative flex h-dvh flex-col overflow-hidden"
      role="status"
      aria-busy="true"
      aria-label="Loading the interview"
    >
      <div className="flex h-12 items-center gap-3 border-b border-border bg-surface px-3 lg:h-11">
        <Skeleton className="size-6" />
        <Skeleton className="h-4 w-40 max-lg:w-32" />
        <Skeleton className="ml-auto h-6 w-48 max-lg:w-24" />
      </div>
      <div className="hidden min-h-0 flex-1 lg:flex">
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
      <div className="flex min-h-0 flex-1 flex-col lg:hidden">
        <div className="h-9 border-b border-border bg-surface" />
        <div className="flex-1 space-y-3 bg-surface p-4">
          <Skeleton className="h-5 w-2/3" />
          <Skeleton className="h-3 w-full" />
          <Skeleton className="h-3 w-5/6" />
          <Skeleton className="h-3 w-4/6" />
        </div>
        <div className="flex h-14 shrink-0 items-center justify-around border-t border-border bg-surface pb-[env(safe-area-inset-bottom)]">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="flex flex-col items-center gap-1">
              <Skeleton className="size-5" />
              <Skeleton className="h-2 w-10" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function PadLoader({ id }: { id: string }) {
  const me = useMe();
  const interviews = tabHref(useTrack(), 'interviews');
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
          <Logo href={me.data.guest ? '/' : interviews} />
        </header>
        <div className="flex flex-1 items-start justify-center pt-[12vh]">
          {notFound ? (
            <div className="max-w-sm text-center">
              <h1 className="text-lg font-semibold">This pad is not available</h1>
              <p className="mt-1 text-sm text-fg-muted">
                It was deleted, it does not exist, or you are not a member. If someone invited you,
                open their invite link again.
              </p>
              {!me.data.guest && (
                <Button asChild className="mt-5" variant="primary">
                  <Link href={interviews}>Go to your interviews</Link>
                </Button>
              )}
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
      {q.data.pad.format === 'quant' ? <QuantWorkspace /> : <Workspace />}
    </PadSessionProvider>
  );
}

export function PadPage({ id }: { id: string }) {
  return (
    <AuthGate fallback={<PadSkeleton />} allowGuest>
      <PadLoader id={id} />
    </AuthGate>
  );
}
