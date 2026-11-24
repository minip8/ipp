'use client';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { type ReactNode, useEffect } from 'react';
import { useMe } from '@/lib/queries';
import { ErrorState } from './states';

/** Client-side gate: renders children once /api/me confirms a session, else sends to sign-in. */
export function AuthGate({ children, fallback }: { children: ReactNode; fallback: ReactNode }) {
  const me = useMe();
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  useEffect(() => {
    // A cached "signed out" answer may be stale right after signing in; wait for the refetch.
    if (me.data === null && !me.isFetching) {
      const here = pathname + (search.size ? `?${search.toString()}` : '');
      router.replace(`/sign-in?next=${encodeURIComponent(here)}`);
    }
  }, [me.data, me.isFetching, pathname, search, router]);
  if (me.isError)
    return <ErrorState error={me.error} onRetry={() => me.refetch()} className="min-h-[60vh]" />;
  if (!me.data) return <>{fallback}</>;
  return <>{children}</>;
}
