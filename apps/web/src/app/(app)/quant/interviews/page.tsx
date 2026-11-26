import type { Metadata } from 'next';
import { InterviewsPage } from '@/features/interviews/interviews-page';

export const metadata: Metadata = { title: 'Quant interviews' };

export default function QuantInterviewsPage() {
  return <InterviewsPage track="quant" />;
}
