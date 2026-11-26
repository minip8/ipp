import type { Metadata } from 'next';
import { DrillPage } from '@/features/drill/drill-page';

export const metadata: Metadata = { title: 'Mental math' };

export default function DrillRoute() {
  return <DrillPage />;
}
