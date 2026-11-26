'use client';
/**
 * The host's side of a quant room, shared by the desk, the bank and the second opinion: the
 * host's view of the round (`GET …/host`, refetched when `round.updated` says the round moved on)
 * and the host's steps (`…/host/round/*`), each answered with the new view. HOST-ONLY: mounted
 * only for the room's owner, and nothing it holds goes into the shared document or the chat.
 */
import type { HostRoundView, HostView } from '@ipp/contracts';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { toast } from 'sonner';
import { usePad } from '@/features/pad/session';
import { ApiRequestError, api, errorMessage } from '@/lib/api';
import { qk } from '@/lib/queries';
import { EMPTY_VERDICT, newerHostRound, openQuestion, type VerdictDraft, verdictOf } from './logic';

type Action = 'queue' | 'pose' | 'hint' | 'follow-up' | 'close' | 'verdict';

export type HostRoom = {
  padId: string;
  view: HostView | undefined;
  round: HostRoundView | null;
  loading: boolean;
  error: unknown;
  refetch: () => void;
  /** The pad has ended: only missing verdicts can be given. */
  ended: boolean;
  /** The step in flight, if any (its buttons show a spinner, the others wait). */
  busy: Action | null;
  setQueue: (ids: string[]) => Promise<boolean>;
  /** Asks a question now; while another is open, the host confirms first (see `confirmPose`). */
  requestPose: (questionId: string) => void;
  pose: (questionId: string) => Promise<boolean>;
  hint: (index: number, rung: number) => Promise<boolean>;
  followUp: (index: number) => Promise<boolean>;
  close: (index: number) => Promise<boolean>;
  verdict: (index: number, d: VerdictDraft) => Promise<boolean>;
  /** The verdict being written for the open question (kept across tabs and the bank). */
  draft: VerdictDraft;
  setDraft: (d: VerdictDraft) => void;
  /** A pose waiting for the host to confirm closing the open question. */
  confirmPose: string | null;
  cancelPose: () => void;
  bankOpen: boolean;
  setBankOpen: (open: boolean) => void;
};

const Ctx = createContext<HostRoom | null>(null);

export function useHostRoom(): HostRoom {
  const v = useContext(Ctx);
  if (!v) throw new Error('useHostRoom outside HostRoomProvider');
  return v;
}

/** Refusals that mean the host's view is behind the round: fetch it again. */
const STALE = new Set(['not_open', 'wrong_index', 'already_posed', 'not_closed', 'stale']);

export function HostRoomProvider({ children }: { children: ReactNode }) {
  const { state, readOnly } = usePad();
  const padId = state.pad.id;
  const qc = useQueryClient();
  const view = useQuery({
    queryKey: qk.hostView(padId),
    queryFn: () => api.hostView(padId),
    staleTime: Number.POSITIVE_INFINITY,
    refetchOnWindowFocus: false,
  });
  const round = view.data?.round ?? null;
  const [busy, setBusy] = useState<Action | null>(null);
  const [draft, setDraft] = useState<VerdictDraft>(EMPTY_VERDICT);
  const [confirmPose, setConfirmPose] = useState<string | null>(null);
  const [bankOpen, setBankOpen] = useState(false);

  // The members' view moved past the host's (a pose, a hint, a close, the end from another tab):
  // there is no host-only event, so the host's view is fetched again.
  const memberVersion = state.round?.version ?? -1;
  const hostVersion = round?.version ?? -1;
  useEffect(() => {
    if (round && memberVersion > hostVersion)
      void qc.invalidateQueries({ queryKey: qk.hostView(padId), exact: true });
  }, [memberVersion, hostVersion, round, padId, qc]);

  // A new open question starts with an empty verdict.
  const openIndex = round?.open ?? null;
  const lastOpen = useRef(openIndex);
  useEffect(() => {
    if (lastOpen.current !== openIndex) setDraft(EMPTY_VERDICT);
    lastOpen.current = openIndex;
  }, [openIndex]);

  const apply = useCallback(
    (next: HostRoundView) => {
      qc.setQueryData<HostView>(qk.hostView(padId), (old) =>
        old ? { ...old, round: newerHostRound(old.round, next) } : old,
      );
      // What is queued or asked shows in the bank's rows.
      void qc.invalidateQueries({ queryKey: ['pad', padId, 'host', 'bank'] });
    },
    [qc, padId],
  );

  const run = useCallback(
    async (action: Action, call: () => Promise<HostRoundView>, failure: string) => {
      setBusy(action);
      try {
        apply(await call());
        return true;
      } catch (e) {
        if (e instanceof ApiRequestError && STALE.has(e.code))
          void qc.invalidateQueries({ queryKey: qk.hostView(padId), exact: true });
        toast.error(failure, { description: errorMessage(e) });
        return false;
      } finally {
        setBusy(null);
      }
    },
    [apply, qc, padId],
  );

  const value = useMemo<HostRoom>(() => {
    const pose = (questionId: string) =>
      run('pose', () => api.poseQuestion(padId, questionId), 'Could not ask that question');
    const close = (index: number) =>
      run(
        'close',
        () => api.closeQuestion(padId, index, verdictOf(draft)),
        'Could not close the question',
      );
    return {
      padId,
      view: view.data,
      round,
      loading: view.isPending,
      error: view.error,
      refetch: () => void view.refetch(),
      ended: readOnly || round?.ended === true,
      busy,
      setQueue: (ids) => run('queue', () => api.setQueue(padId, ids), 'Could not change the queue'),
      requestPose: (questionId) => {
        if (openQuestion(round)) setConfirmPose(questionId);
        else
          void pose(questionId).then((ok) => {
            if (ok) setBankOpen(false);
          });
      },
      pose: async (questionId) => {
        setConfirmPose(null);
        const open = openQuestion(round);
        // A verdict already chosen for the open question is not lost by moving on.
        if (open && verdictOf(draft) && !(await close(open.index))) return false;
        const ok = await pose(questionId);
        // Back to the desk, where the question just asked is.
        if (ok) setBankOpen(false);
        return ok;
      },
      hint: (index, rung) =>
        run('hint', () => api.recordHint(padId, index, rung), 'Could not record the hint'),
      followUp: (index) =>
        run('follow-up', () => api.recordFollowUp(padId, index), 'Could not record the follow-up'),
      close,
      verdict: async (index, d) => {
        const v = verdictOf(d);
        if (!v) return false;
        return run('verdict', () => api.setVerdict(padId, index, v), 'Could not save the verdict');
      },
      draft,
      setDraft,
      confirmPose,
      cancelPose: () => setConfirmPose(null),
      bankOpen,
      setBankOpen,
    };
  }, [padId, view, round, readOnly, busy, run, draft, confirmPose, bankOpen]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
