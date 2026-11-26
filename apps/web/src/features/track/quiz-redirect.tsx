'use client';
/**
 * The old Quizzes page (`/quiz`, `/quiz/topics`): on to the current track's Practice with the
 * query kept, or for `?view=roadmap` to its Roadmap's topic maps (`quizTarget`). A topic of the
 * other track there is sent on again by that page.
 */
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect } from 'react';
import { Spinner } from '@/components/ui/spinner';
import { quizTarget } from '@/lib/track';
import { useTrack } from '@/lib/track-hooks';

export function QuizRedirect() {
  const router = useRouter();
  const search = useSearchParams().toString();
  const track = useTrack();
  useEffect(() => {
    router.replace(quizTarget(search, track));
  }, [router, search, track]);
  return (
    <div className="flex justify-center pt-24" role="status" aria-label="Loading">
      <Spinner />
    </div>
  );
}
