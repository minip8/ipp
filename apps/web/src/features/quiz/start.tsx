'use client';
/**
 * Starting a quiz attempt, shared by Practice, the topic maps and the study path: the request,
 * then straight into the attempt. A quiz needs no AI key.
 */
import type { CreateAttemptRequest } from '@ipp/contracts';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { qk } from '@/lib/queries';

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
