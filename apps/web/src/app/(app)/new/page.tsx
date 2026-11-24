import type { Metadata } from 'next';
import { Suspense } from 'react';
import { NewInterview } from '@/features/new/new-interview';

export const metadata: Metadata = { title: 'New interview' };

export default function NewPage() {
  return (
    <Suspense>
      <NewInterview />
    </Suspense>
  );
}
