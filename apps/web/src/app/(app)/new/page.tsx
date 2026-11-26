import type { Metadata } from 'next';
import { Suspense } from 'react';
import { HomeRedirect } from '@/features/track/home-redirect';

export const metadata: Metadata = { title: 'New interview' };

/** Starting an interview is on the Interviews tab; old links here go on as the home does. */
export default function NewPage() {
  return (
    <Suspense>
      <HomeRedirect />
    </Suspense>
  );
}
