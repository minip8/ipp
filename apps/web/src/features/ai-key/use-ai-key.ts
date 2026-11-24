'use client';
import type { AiKeyStatus, AiProvider } from '@ipp/contracts';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { qk } from '@/lib/queries';

/** Save / remove the user's key and refresh everything whose availability depends on it. */
export function useAiKeyMutations() {
  const qc = useQueryClient();
  const settle = (status: AiKeyStatus) => {
    qc.setQueryData(qk.aiKey, status);
    // Another key (or none) means another list of models.
    qc.removeQueries({ queryKey: qk.aiModels });
    // Pads (interviewerAvailable) and reports (assessmentUnavailable) depend on the key.
    void qc.invalidateQueries({ queryKey: ['pad'] });
    void qc.invalidateQueries({ queryKey: ['report'] });
  };
  const save = useMutation({
    mutationFn: ({ provider, apiKey }: { provider: AiProvider; apiKey: string }) =>
      api.saveAiKey(provider, apiKey),
    onSuccess: settle,
  });
  const remove = useMutation({ mutationFn: api.deleteAiKey, onSuccess: settle });
  return { save, remove };
}
