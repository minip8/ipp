import { Suspense } from 'react';
import { QuizRedirect } from '@/features/track/quiz-redirect';

/** Topics are picked on Practice; without this, /quiz/topics would be read as an attempt id. */
export default function QuizTopicsPage() {
  return (
    <Suspense>
      <QuizRedirect />
    </Suspense>
  );
}
