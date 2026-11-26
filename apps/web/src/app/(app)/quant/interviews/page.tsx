import type { Metadata } from 'next';
import { QuantInterviews } from '@/features/quant/quant-interviews';

export const metadata: Metadata = { title: 'Quant interviews' };

export default function QuantInterviewsPage() {
  return <QuantInterviews />;
}
