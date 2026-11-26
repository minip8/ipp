'use client';
import { useQuery } from '@tanstack/react-query';
import { ApiRequestError, api } from './api';

export const qk = {
  me: ['me'] as const,
  config: ['config'] as const,
  aiKey: ['ai-key'] as const,
  aiModels: ['ai-models'] as const,
  problems: (f: object) => ['problems', f] as const,
  problem: (slug: string) => ['problem', slug] as const,
  pads: ['pads'] as const,
  pad: (id: string) => ['pad', id] as const,
  hostView: (id: string) => ['pad', id, 'host'] as const,
  invite: (token: string) => ['invite', token] as const,
  report: (id: string) => ['report', id] as const,
  playback: (id: string) => ['playback', id] as const,
  quizTopics: ['quiz', 'topics'] as const,
  quizRoadmap: ['quiz', 'roadmap'] as const,
  attempts: ['quiz', 'attempts'] as const,
  attempt: (id: string) => ['quiz', 'attempt', id] as const,
  quizBank: (topic: string) => ['quiz', 'bank', topic] as const,
  quizBankQuestion: (id: string) => ['quiz', 'question', id] as const,
};

export function useMe() {
  return useQuery({
    queryKey: qk.me,
    queryFn: async () => {
      try {
        return (await api.me()).user;
      } catch (e) {
        if (e instanceof ApiRequestError && e.isUnauthorized) return null;
        throw e;
      }
    },
    staleTime: 5 * 60_000,
  });
}

export function useConfig() {
  return useQuery({ queryKey: qk.config, queryFn: api.config, staleTime: 10 * 60_000 });
}

/** The signed-in user's AI key status (state, last four, expiry). */
export function useAiKey(enabled = true) {
  return useQuery({ queryKey: qk.aiKey, queryFn: api.aiKey, staleTime: 60_000, enabled });
}

/** The models the saved key can use; only while there is an active key. */
export function useAiModels(enabled = true) {
  return useQuery({
    queryKey: qk.aiModels,
    queryFn: api.aiModels,
    staleTime: 5 * 60_000,
    retry: 1,
    enabled,
  });
}
