import type { Metadata } from 'next';
import { QuizHub } from '@/features/quiz/hub';

export const metadata: Metadata = { title: 'Quizzes' };

export default function QuizPage() {
  return <QuizHub />;
}
