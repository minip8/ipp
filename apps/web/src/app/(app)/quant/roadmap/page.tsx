import type { Metadata } from 'next';
import { RoadmapPage } from '@/features/roadmap/roadmap-page';

export const metadata: Metadata = { title: 'Quant roadmap' };

export default function QuantRoadmapPage() {
  return <RoadmapPage track="quant" />;
}
