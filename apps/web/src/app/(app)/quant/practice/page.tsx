import type { Metadata } from 'next';
import { QuizHub } from '@/features/quiz/hub';

export const metadata: Metadata = { title: 'Quant practice' };

export default function QuantPracticePage() {
  return <QuizHub track="quant" />;
}
