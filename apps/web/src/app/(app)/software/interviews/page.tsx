import type { Metadata } from 'next';
import { InterviewsPage } from '@/features/interviews/interviews-page';

export const metadata: Metadata = { title: 'Interviews' };

export default function SoftwareInterviewsPage() {
  return <InterviewsPage track="software" />;
}
