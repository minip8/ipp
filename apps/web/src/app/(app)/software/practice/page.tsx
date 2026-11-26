import type { Metadata } from 'next';
import { QuizHub } from '@/features/quiz/hub';

export const metadata: Metadata = { title: 'Practice' };

export default function SoftwarePracticePage() {
  return <QuizHub track="software" />;
}
