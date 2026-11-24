import type { Metadata } from 'next';
import { AiKeySettings } from '@/features/ai-key/ai-key-settings';

export const metadata: Metadata = { title: 'AI key' };

export default function AiKeyPage() {
  return <AiKeySettings />;
}
