import type { Metadata } from 'next';
import { QuantPage } from '@/features/quant/quant-page';

export const metadata: Metadata = { title: 'Quant' };

export default function QuantRoute() {
  return <QuantPage />;
}
