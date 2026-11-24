import type { Metadata } from 'next';
import { ReportPage } from '@/features/report/report-page';

export const metadata: Metadata = { title: 'Interview report' };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ReportPage id={id} />;
}
