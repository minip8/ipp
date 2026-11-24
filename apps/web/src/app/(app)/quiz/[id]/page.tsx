import type { Metadata } from 'next';
import { QuizAttemptView } from '@/features/quiz/attempt';

export const metadata: Metadata = { title: 'Quiz' };

export default async function QuizAttemptPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <QuizAttemptView id={id} />;
}
