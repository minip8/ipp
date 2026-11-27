import type { Metadata } from 'next';
import { InterviewPage } from '@/features/interview/interview-page';

export const metadata: Metadata = { title: 'Interview' };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <InterviewPage id={id} />;
}
