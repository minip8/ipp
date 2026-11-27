'use client';
import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { api } from '@/lib/api';
import { qk } from '@/lib/queries';
import type { Names } from './logic';

/**
 * Problem and topic titles for naming stages, from the library and the topic list (the same
 * queries the problem library and the quizzes use, so usually already cached). A failure only
 * leaves the slugs shown readably.
 */
export function useStageNames(): Names {
  const problems = useQuery({ queryKey: qk.problems({}), queryFn: () => api.problems() });
  const topics = useQuery({ queryKey: qk.quizTopics, queryFn: api.quizTopics });
  const p = problems.data;
  const t = topics.data;
  return useMemo(
    () => ({
      problem: (slug: string) => p?.find((x) => x.slug === slug)?.title,
      topic: (slug: string) => t?.find((x) => x.slug === slug)?.title,
    }),
    [p, t],
  );
}
