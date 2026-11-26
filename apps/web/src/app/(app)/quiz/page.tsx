import type { Metadata } from 'next';
import { Suspense } from 'react';
import { QuizRedirect } from '@/features/track/quiz-redirect';

export const metadata: Metadata = { title: 'Practice' };

/** The old Quizzes page: on to the current track's Practice (or Roadmap), query kept. */
export default function QuizPage() {
  return (
    <Suspense>
      <QuizRedirect />
    </Suspense>
  );
}
