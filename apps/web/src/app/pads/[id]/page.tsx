import type { Metadata } from 'next';
import { Suspense } from 'react';
import { PadPage } from '@/features/pad/pad-page';

export const metadata: Metadata = { title: 'Interview' };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <Suspense>
      <PadPage id={id} />
    </Suspense>
  );
}
