'use client';
import {
  type CustomTest,
  type InterviewerSettings,
  type Language,
  type PadDetail,
  type PostQuantQuoteRequest,
  type QuantRoundView,
  type Run,
  type RunMode,
  YDOC,
} from '@ipp/contracts';
import { useQueryClient } from '@tanstack/react-query';
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from 'react';
import { toast } from 'sonner';
import { runsForProblem } from '@/features/room/logic';
import { ApiRequestError, api, errorMessage, formatRetry } from '@/lib/api';
import { wsBaseUrl } from '@/lib/env';
import { qk } from '@/lib/queries';
import type { Me } from '@/lib/schemas';
import { type Collab, type CollabStatus, colorFor, createCollab } from './collab';
import { PadSocket, SocketRefused, type SocketStatus } from './socket';
import { activeRun, initPadState, type PadState, padReducer } from './state';

export type RunOptions = { stdin?: string; customTests?: CustomTest[] };

export type PadSession = {
  state: PadState;
  me: Me;
  collab: Collab | null;
  socketStatus: SocketStatus;
  socketRetryInMs: number | null;
  collabStatus: CollabStatus;
  synced: boolean;
  readOnly: boolean;
  running: Run | undefined;
  /** Custom test inputs sent with each custom run (the Run itself does not echo them). */
  runInputs: Map<string, CustomTest[]>;
  /** The run currently shown in the results panel (latest by default). */
  selectedRunId: string | null;
  selectRun: (id: string | null) => void;
  startRun: (mode: RunMode, opts?: RunOptions) => Promise<void>;
  sendChat: (text: string, via?: 'text' | 'voice') => void;
  retryPending: (localId: string) => void;
  setLanguage: (lang: Language) => Promise<void>;
  /** An interview room (the owner hosts; the others are candidates). */
  isRoom: boolean;
  /** The room's host: the only one who sees the host panel, the report and the end button. */
  isHost: boolean;
  /** Room host: move on to another problem, or to a blank editor (null). */
  changeProblem: (problemSlug: string | null) => Promise<boolean>;
  updateInterviewer: (patch: Partial<InterviewerSettings>) => Promise<void>;
  /** The owner just saved a key here; do not wait for the socket to say so. */
  setInterviewerKey: (key: PadDetail['interviewerKey']) => void;
  endPad: () => Promise<boolean>;
  /** A quant round's game: post a market; the round it returns is applied. Throws on refusal. */
  postQuote: (body: PostQuantQuoteRequest) => Promise<QuantRoundView>;
  telemetry: (kind: 'paste' | 'blur', amount: number) => void;
  reconnect: () => void;
  source: (lang?: Language) => string;
};

const Ctx = createContext<PadSession | null>(null);

export function usePad(): PadSession {
  const v = useContext(Ctx);
  if (!v) throw new Error('usePad outside PadSessionProvider');
  return v;
}

const isFatalTicketError = (e: unknown) =>
  e instanceof ApiRequestError && [401, 403, 404].includes(e.status);

/** The pad was deleted, or this user left it: the page should show it is gone. */
const isPadGone = (e: unknown) =>
  (e instanceof SocketRefused && (e.code === 4404 || e.code === 4403)) ||
  (e instanceof ApiRequestError && (e.status === 404 || e.status === 403));

function runErrorToast(e: unknown) {
  if (e instanceof ApiRequestError) {
    if (e.code === 'run_in_flight')
      return toast.message('A run is already in progress', {
        description: 'Wait for it to finish, then try again.',
      });
    if (e.isRateLimited)
      return toast.warning('Run limit reached', {
        description: e.retryAfter
          ? `You can run code again in ${formatRetry(e.retryAfter)}.`
          : e.message,
      });
    if (e.code === 'queue_unavailable')
      return toast.error('Code execution is unavailable', {
        description:
          'The judge cannot be reached right now. Your code is safe; try again in a minute.',
      });
    if (e.status === 503)
      return toast.warning('The judge is busy', {
        description: 'Too many runs are queued right now. Try again in a few seconds.',
      });
    if (e.code === 'pad_ended')
      return toast.message('This interview has ended', {
        description: 'The pad is read-only now.',
      });
    if (e.code === 'invalid_custom_test')
      return toast.error('A custom test does not match the signature', { description: e.message });
    if (e.status === 413)
      return toast.error('Your code is too large to run', {
        description: 'Source files are limited to 64 KB.',
      });
  }
  toast.error('Could not start the run', { description: errorMessage(e) });
}

export function PadSessionProvider({
  detail,
  me,
  children,
}: {
  detail: PadDetail;
  me: Me;
  children: ReactNode;
}) {
  const padId = detail.pad.id;
  const qc = useQueryClient();
  const [state, dispatch] = useReducer(padReducer, detail, (d) => initPadState(d, me.id));
  const stateRef = useRef(state);
  stateRef.current = state;
  const [socketStatus, setSocketStatus] = useState<SocketStatus>('connecting');
  const [socketRetryInMs, setSocketRetryInMs] = useState<number | null>(null);
  const [collabStatus, setCollabStatus] = useState<CollabStatus>('connecting');
  const [synced, setSynced] = useState(false);
  const [collab, setCollab] = useState<Collab | null>(null);
  const [selectedRunId, selectRun] = useState<string | null>(null);
  const socketRef = useRef<PadSocket | null>(null);
  const runInputs = useRef(new Map<string, CustomTest[]>()).current;
  const localSeq = useRef(0);

  const getTicket = useCallback(async () => (await api.wsTicket(padId)).ticket, [padId]);

  // Event socket.
  useEffect(() => {
    const s = new PadSocket({
      url: (ticket) => `${wsBaseUrl()}/ws/pads/${padId}?ticket=${encodeURIComponent(ticket)}`,
      getTicket,
      onEvent: (event) => dispatch({ type: 'event', event }),
      onStatus: (st, d) => {
        setSocketStatus(st);
        setSocketRetryInMs(d?.retryInMs ?? null);
      },
      isFatal: isFatalTicketError,
      // Refetching the pad 404s, and the page swaps the workspace for "not available".
      onFatal: (e) => {
        if (isPadGone(e)) void qc.invalidateQueries({ queryKey: qk.pad(padId) });
      },
    });
    socketRef.current = s;
    s.connect();
    const online = () => s.retryNow();
    window.addEventListener('online', online);
    const vis = () => document.visibilityState === 'visible' && s.retryNow();
    document.addEventListener('visibilitychange', vis);
    return () => {
      window.removeEventListener('online', online);
      document.removeEventListener('visibilitychange', vis);
      s.close();
      socketRef.current = null;
    };
  }, [padId, getTicket, qc]);

  // Collaborative document.
  useEffect(() => {
    const c = createCollab({
      padId,
      getTicket,
      user: { name: me.name, color: colorFor(me.id), userId: me.id },
      onStatus: setCollabStatus,
      onSynced: setSynced,
    });
    setCollab(c);
    return () => {
      // Let child components detach their observers before the doc and awareness go away.
      setTimeout(() => c.destroy(), 0);
      setCollab(null);
      setSynced(false);
    };
  }, [padId, getTicket, me.id, me.name]);

  // Mark queued chat as sent again once the socket is back.
  useEffect(() => {
    if (socketStatus !== 'open') return;
    for (const p of stateRef.current.pending)
      if (p.status === 'queued')
        dispatch({ type: 'pending.status', localId: p.localId, status: 'sending' });
    if (stateRef.current.thinking) dispatch({ type: 'thinking.reset' });
  }, [socketStatus]);

  // Server error events surface as toasts.
  const lastErr = useRef<number>(0);
  useEffect(() => {
    const e = state.serverError;
    if (!e || e.at === lastErr.current) return;
    lastErr.current = e.at;
    if (e.code === 'rate_limited') toast.warning('Slow down a little', { description: e.message });
    else if (e.code === 'interviewer_unavailable')
      toast.warning('The interviewer is unavailable', { description: e.message });
    else if (e.code === 'too_long')
      toast.warning('That message is too long', { description: e.message });
    else if (e.code === 'pad_ended')
      toast.message('This interview has ended', { description: e.message });
    else toast.error(e.message);
  }, [state.serverError]);

  // Fallback polling for the active run if events are not flowing (or were missed).
  const running = activeRun(state);
  useEffect(() => {
    if (!running) return;
    const every = socketStatus === 'open' ? 5000 : 1500;
    const t = setInterval(async () => {
      try {
        const r = await api.run(running.id);
        dispatch({ type: 'run.upsert', run: r });
      } catch {
        /* keep trying */
      }
    }, every);
    return () => clearInterval(t);
  }, [running, socketStatus]);

  const source = useCallback(
    (lang?: Language) =>
      collab?.doc.getText(YDOC.code(lang ?? stateRef.current.pad.language)).toString() ?? '',
    [collab],
  );

  const startRun = useCallback(
    async (mode: RunMode, opts: RunOptions = {}) => {
      const s = stateRef.current;
      if (activeRun(s)) {
        toast.message('A run is already in progress');
        return;
      }
      const language = s.pad.language;
      try {
        const run = await api.createRun(padId, {
          mode,
          language,
          source: source(language),
          stdin: mode === 'file' ? (opts.stdin ?? '') : '',
          customTests: mode === 'custom' ? (opts.customTests ?? []) : [],
        });
        if (mode === 'custom') runInputs.set(run.id, opts.customTests ?? []);
        selectRun(null);
        dispatch({ type: 'run.upsert', run });
      } catch (e) {
        runErrorToast(e);
      }
    },
    [padId, source, runInputs],
  );

  const sendChat = useCallback((text: string, via: 'text' | 'voice' = 'text') => {
    const trimmed = text.trim();
    if (!trimmed) return;
    const localId = `local-${++localSeq.current}`;
    const sent = socketRef.current?.send({ type: 'chat.send', text: trimmed, via }) ?? false;
    dispatch({
      type: 'pending.add',
      message: {
        localId,
        text: trimmed,
        via,
        createdAt: new Date().toISOString(),
        status: sent === true ? 'sending' : sent === 'queued' ? 'queued' : 'failed',
      },
    });
  }, []);

  // No echo or reply within a few seconds on an open socket: treat the message as delivered.
  useEffect(() => {
    const sending = state.pending.filter((p) => p.status === 'sending');
    if (sending.length === 0 || socketStatus !== 'open') return;
    const t = setTimeout(() => {
      for (const p of sending)
        dispatch({ type: 'pending.status', localId: p.localId, status: 'sent' });
    }, 2500);
    return () => clearTimeout(t);
  }, [state.pending, socketStatus]);

  const retryPending = useCallback((localId: string) => {
    const p = stateRef.current.pending.find((x) => x.localId === localId);
    if (!p) return;
    const sent = socketRef.current?.send({ type: 'chat.send', text: p.text, via: p.via }) ?? false;
    dispatch({
      type: 'pending.status',
      localId,
      status: sent === true ? 'sending' : sent === 'queued' ? 'queued' : 'failed',
    });
  }, []);

  const setLanguage = useCallback(
    async (lang: Language) => {
      const prev = stateRef.current.pad;
      if (prev.language === lang) return;
      dispatch({ type: 'pad.set', pad: { ...prev, language: lang } });
      try {
        const pad = await api.updatePad(padId, { language: lang });
        dispatch({ type: 'pad.set', pad });
      } catch (e) {
        dispatch({ type: 'pad.set', pad: prev });
        toast.error('Could not switch language', { description: errorMessage(e) });
      }
    },
    [padId],
  );

  const changeProblem = useCallback(
    async (problemSlug: string | null) => {
      try {
        const { pad, problem } = await api.changeProblem(padId, problemSlug);
        dispatch({ type: 'event', event: { type: 'pad.problem', pad, problem } });
        selectRun(null);
        // The interviewer notes and solutions shown to the host belong to the old problem.
        void qc.invalidateQueries({ queryKey: qk.hostView(padId) });
        return true;
      } catch (e) {
        toast.error('Could not change the problem', { description: errorMessage(e) });
        return false;
      }
    },
    [padId, qc],
  );

  const updateInterviewer = useCallback(
    async (patch: Partial<InterviewerSettings>) => {
      const prev = stateRef.current.pad;
      dispatch({
        type: 'pad.set',
        pad: { ...prev, interviewer: { ...prev.interviewer, ...patch } },
      });
      try {
        const pad = await api.updatePad(padId, { interviewer: patch });
        dispatch({ type: 'pad.set', pad });
      } catch (e) {
        dispatch({ type: 'pad.set', pad: prev });
        toast.error('Could not update the interviewer', { description: errorMessage(e) });
      }
    },
    [padId],
  );

  const setInterviewerKey = useCallback(
    (key: PadDetail['interviewerKey']) =>
      dispatch({ type: 'event', event: { type: 'interviewer.status', key } }),
    [],
  );

  const endPad = useCallback(async () => {
    try {
      const pad = await api.endPad(padId);
      dispatch({ type: 'pad.set', pad });
      void qc.invalidateQueries({ queryKey: ['pads'] });
      return true;
    } catch (e) {
      toast.error('Could not end the interview', { description: errorMessage(e) });
      return false;
    }
  }, [padId, qc]);

  const postQuote = useCallback(
    async (body: PostQuantQuoteRequest) => {
      const round = await api.postQuote(padId, body);
      // As a round.updated: the newest version wins, whichever of the two arrives first.
      dispatch({ type: 'event', event: { type: 'round.updated', round } });
      return round;
    },
    [padId],
  );

  const telemetry = useCallback((kind: 'paste' | 'blur', amount: number) => {
    socketRef.current?.send(
      kind === 'paste'
        ? { type: 'telemetry', kind, chars: amount }
        : { type: 'telemetry', kind, ms: amount },
    );
  }, []);

  const reconnect = useCallback(() => {
    socketRef.current?.retryNow();
    collab?.provider.connect();
  }, [collab]);

  const readOnly = state.pad.status === 'ended';
  const isRoom = state.pad.kind === 'room';
  // A room's problem can change: the console shows the runs of the one on screen.
  const visible = useMemo(
    () =>
      state.pad.kind === 'room'
        ? { ...state, runs: runsForProblem(state.runs, state.pad.problemSlug) }
        : state,
    [state],
  );
  const isHost = isRoom && state.role === 'owner';

  // biome-ignore lint/correctness/useExhaustiveDependencies: runInputs is a stable Map instance
  const value = useMemo<PadSession>(
    () => ({
      state: visible,
      me,
      collab,
      socketStatus,
      socketRetryInMs,
      collabStatus,
      synced,
      readOnly,
      running,
      runInputs,
      selectedRunId,
      selectRun,
      startRun,
      sendChat,
      retryPending,
      setLanguage,
      isRoom,
      isHost,
      changeProblem,
      updateInterviewer,
      setInterviewerKey,
      endPad,
      postQuote,
      telemetry,
      reconnect,
      source,
    }),
    [
      visible,
      me,
      collab,
      socketStatus,
      socketRetryInMs,
      collabStatus,
      synced,
      readOnly,
      running,
      selectedRunId,
      startRun,
      sendChat,
      retryPending,
      setLanguage,
      isRoom,
      isHost,
      changeProblem,
      updateInterviewer,
      setInterviewerKey,
      endPad,
      postQuote,
      telemetry,
      reconnect,
      source,
    ],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
