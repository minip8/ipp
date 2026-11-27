'use client';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { type ReactNode, useEffect } from 'react';
import { useHydrated } from '@/lib/hydration';
import { useMe } from '@/lib/queries';
import { ErrorState } from './states';

/**
 * Client-side gate: renders children once /api/me confirms a session, else sends to sign-in.
 * A guest (someone who joined an interview room by its link, with just a name) counts as signed
 * in only where `allowGuest` says so: the room itself. Everywhere else they are asked to sign in.
 */
export function AuthGate({
  children,
  fallback,
  allowGuest = false,
}: {
  children: ReactNode;
  fallback: ReactNode;
  allowGuest?: boolean;
}) {
  const me = useMe();
  const hydrated = useHydrated();
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const refused = me.data === null || (me.data?.guest === true && !allowGuest);
  useEffect(() => {
    // A cached "signed out" answer may be stale right after signing in; wait for the refetch.
    if (refused && !me.isFetching) {
      const here = pathname + (search.size ? `?${search.toString()}` : '');
      router.replace(`/sign-in?next=${encodeURIComponent(here)}`);
    }
  }, [refused, me.isFetching, pathname, search, router]);
  if (me.isError)
    return <ErrorState error={me.error} onRetry={() => me.refetch()} className="min-h-[60vh]" />;
  // The server sent the fallback: the session it did not have must not change the first render.
  if (!hydrated || !me.data || refused) return <>{fallback}</>;
  return <>{children}</>;
}
