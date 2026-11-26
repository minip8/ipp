import type { Metadata } from 'next';
import { Dashboard } from '@/features/dashboard/dashboard';

export const metadata: Metadata = { title: 'Interviews' };

export default function SoftwareInterviewsPage() {
  return <Dashboard />;
}
