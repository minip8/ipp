import type { Metadata } from 'next';
import { Suspense } from 'react';
import { JoinPad } from '@/components/join-pad';

export const metadata: Metadata = { title: 'Join interview' };

export default async function Page({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return (
    <Suspense>
      <JoinPad token={token} />
    </Suspense>
  );
}
