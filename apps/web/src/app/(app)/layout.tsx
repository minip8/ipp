import { type ReactNode, Suspense } from 'react';
import { AppHeader } from '@/components/app-header';
import { AuthGate } from '@/components/auth-gate';
import { Skeleton } from '@/components/ui/skeleton';

function PageSkeleton() {
  return (
    <div
      className="mx-auto max-w-6xl px-4 py-8 sm:px-6"
      role="status"
      aria-busy="true"
      aria-label="Loading"
    >
      <Skeleton className="h-7 w-48" />
      <Skeleton className="mt-3 h-4 w-72" />
      <div className="mt-8 grid gap-4 md:grid-cols-3">
        <Skeleton className="h-28" />
        <Skeleton className="h-28" />
        <Skeleton className="h-28" />
      </div>
    </div>
  );
}

export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    // data-app-shell: globals.css keeps the scrollbar gutter on these pages.
    <div className="min-h-dvh" data-app-shell>
      <AppHeader />
      <main>
        <Suspense fallback={<PageSkeleton />}>
          <AuthGate fallback={<PageSkeleton />}>{children}</AuthGate>
        </Suspense>
      </main>
    </div>
  );
}
