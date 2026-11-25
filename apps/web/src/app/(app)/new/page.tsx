import type { Metadata } from 'next';
import { Suspense } from 'react';
import { NewRedirect } from '@/features/new/new-redirect';

export const metadata: Metadata = { title: 'New interview' };

/** Starting an interview is on the Interviews page now; old links here are sent on with their query. */
export default function NewPage() {
  return (
    <Suspense>
      <NewRedirect />
    </Suspense>
  );
}
