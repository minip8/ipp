'use client';
/**
 * Starting a quiz attempt, shared by the Quizzes hub, the roadmap and the Quant page: the request,
 * then straight into the attempt. A discussion needs the user's own AI key, so the places that
 * offer one also share how a missing or rejected key is asked for.
 */
import type { AiKeyState, CreateAttemptRequest } from '@ipp/contracts';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { AiKeyPrompt } from '@/features/ai-key/ai-key-prompt';
import { api } from '@/lib/api';
import { qk, useAiKey } from '@/lib/queries';

/** Creates an attempt and opens it. `variables` says which request is in flight. */
export function useStartAttempt() {
  const router = useRouter();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (req: CreateAttemptRequest) => api.createAttempt(req),
    onSuccess: (a) => {
      qc.setQueryData(qk.attempt(a.id), a);
      qc.invalidateQueries({ queryKey: qk.attempts });
      router.push(`/quiz/${a.id}`);
    },
  });
}

/** The user's AI key state, and whether a discussion has to wait for a working key. */
export function useDiscussionKey() {
  const aiKey = useAiKey();
  const keyState = aiKey.data?.state;
  const missing = keyState === 'missing' || keyState === 'rejected' ? keyState : null;
  return { keyState, missing } as const;
}

/** Why a discussion cannot start yet, with the way to add (or replace) the key. */
export function DiscussionKeyPrompt({
  state,
  testId,
  onSaved,
}: {
  state: Exclude<AiKeyState, 'active'>;
  testId: string;
  onSaved?: () => void;
}) {
  return (
    <AiKeyPrompt
      size="sm"
      testId={testId}
      state={state}
      title={
        state === 'rejected'
          ? 'Your API key was rejected'
          : 'A discussion runs on your own AI API key'
      }
      onSaved={onSaved}
    />
  );
}
