'use client';
/**
 * The requests behind each deletion and the caches they change. Lists update in place from what
 * is known (and the API's answer for the drill); everything that reads the user's answers
 * (topic stats, the roadmap, the question bank, the Quant page) is refetched.
 */
import type { DrillHistory, QuizAttemptSummary } from '@ipp/contracts';
import { type QueryClient, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { qk } from '@/lib/queries';
import { alreadyGone, withoutAttempt, withoutRun } from './logic';

/** Every quiz query but the deleted attempt's own (its page may still be on screen). */
function refreshQuiz(qc: QueryClient, except?: string) {
  return qc.invalidateQueries({
    queryKey: ['quiz'],
    predicate: (q) => !(except && q.queryKey[1] === 'attempt' && q.queryKey[2] === except),
  });
}

export function useDeleteAttempt() {
  const qc = useQueryClient();
  return {
    remove: async (id: string) => {
      try {
        await api.deleteAttempt(id);
      } catch (e) {
        if (!alreadyGone(e)) throw e;
      }
      qc.setQueryData<QuizAttemptSummary[]>(qk.attempts, (old) => withoutAttempt(old, id));
      void refreshQuiz(qc, id);
    },
  };
}

export function useClearQuizHistory() {
  const qc = useQueryClient();
  return async () => {
    await api.clearQuizHistory();
    qc.setQueryData<QuizAttemptSummary[]>(qk.attempts, []);
    qc.removeQueries({ queryKey: ['quiz', 'attempt'] });
    qc.removeQueries({ queryKey: ['quiz', 'question'] });
    void refreshQuiz(qc);
  };
}

export function useDeleteDrillRun() {
  const qc = useQueryClient();
  return async (id: string) => {
    try {
      qc.setQueryData<DrillHistory>(qk.drillRuns, await api.deleteDrillRun(id));
    } catch (e) {
      if (!alreadyGone(e)) throw e;
      qc.setQueryData<DrillHistory>(qk.drillRuns, (old) => withoutRun(old, id));
      void qc.invalidateQueries({ queryKey: qk.drillRuns });
    }
  };
}

export function useClearDrillHistory() {
  const qc = useQueryClient();
  return async () => {
    qc.setQueryData<DrillHistory>(qk.drillRuns, await api.clearDrillHistory());
  };
}
