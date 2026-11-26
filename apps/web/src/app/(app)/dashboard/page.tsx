import type { Metadata } from 'next';
import { Suspense } from 'react';
import { HomeRedirect } from '@/features/track/home-redirect';

export const metadata: Metadata = { title: 'Interviews' };

/**
 * The app's home (sign-in lands here): on to the remembered track's Interviews with the query
 * kept, after the first-visit question when no track is remembered yet.
 */
export default function DashboardPage() {
  return (
    <Suspense>
      <HomeRedirect />
    </Suspense>
  );
}
