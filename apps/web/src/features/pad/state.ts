/**
 * Client-side state of an open pad, driven by HTTP responses and ServerEvents. Pure reducer so
 * the event-ordering rules (deltas before created, finished before the POST returns, echoes of
 * our own optimistic messages) are unit-tested.
 */
import {
  effectiveModel,
  type JudgeProgress,
  type Message,
  type Pad,
  type PadDetail,
  type QuantRoundView,
  type Run,
  type ServerEvent,
} from '@ipp/contracts';

export type RunProgress = {
  phase: 'queued' | 'started' | 'compiling' | 'running';
  done: number | null;
  total: number | null;
  stdout: string;
  stderr: string;
};

export type PendingMessage = {
  localId: string;
  text: string;
  via: 'text' | 'voice';
  createdAt: string;
  /** sent = written to an open socket; the server may or may not echo it back to us. */
  status: 'sending' | 'sent' | 'queued' | 'failed';
};

export type PadState = {
  me: string;
  pad: Pad;
  role: PadDetail['role'];
  problem: PadDetail['problem'];
  /** Everyone in the pad, the owner first (names for the chat, and who the host has let in). */
  members: PadDetail['members'];
  /** The pad owner's API key: the interviewer speaks only when this is `active`. */
  interviewerKey: PadDetail['interviewerKey'];
  interviewerAvailable: boolean;
  /** The model the interviewer runs on (the owner's key provider); null without a usable key. */
  interviewerModel: PadDetail['interviewerModel'];
  messages: Message[];
  pending: PendingMessage[];
  /** messageId -> text received so far, plus when the stream started (for ordering). */
  streaming: Record<string, { text: string; startedAt: string }>;
  thinking: boolean;
  /**
   * Display order of chat items, as keys `m:<id>` (final), `s:<id>` (streaming), `p:<localId>`
   * (ours, not yet echoed). Arrival order, so client/server clock skew never reorders the chat;
   * a streaming reply or an echoed message takes over the slot of what it replaces.
   */
  order: string[];
  runs: Run[];
  progress: Record<string, RunProgress>;
  /** Last error event from the server, shown once as a toast. */
  serverError: { code: string; message: string; at: number } | null;
  /**
   * A quant pad's round as the browser may see it (null for a coding pad). Replaced only by a
   * view with a higher version, so an older `round.updated` arriving late never wins.
   */
  round: QuantRoundView | null;
};

export type PadAction =
  | { type: 'event'; event: ServerEvent }
  | { type: 'pending.add'; message: PendingMessage }
  | { type: 'pending.status'; localId: string; status: PendingMessage['status'] }
  | { type: 'pending.remove'; localId: string }
  | { type: 'run.upsert'; run: Run }
  | { type: 'pad.set'; pad: Pad }
  | { type: 'thinking.reset' };

const OUTPUT_CAP = 64 * 1024;

/** The interviewer model after the pad's choice changed (same key provider and default). */
function modelFor(pad: Pad, current: PadState['interviewerModel']): PadState['interviewerModel'] {
  return current
    ? effectiveModel(pad.interviewer.model, current.provider, current.defaultModel)
    : null;
}

export function initPadState(detail: PadDetail, me: string): PadState {
  return {
    me,
    pad: detail.pad,
    role: detail.role,
    problem: detail.problem,
    members: detail.members,
    interviewerKey: detail.interviewerKey,
    interviewerAvailable: detail.interviewerAvailable,
    interviewerModel: detail.interviewerModel ?? null,
    messages: sortMessages(detail.messages),
    order: sortMessages(detail.messages).map((m) => `m:${m.id}`),
    pending: [],
    streaming: {},
    thinking: false,
    runs: [...detail.runs].sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
    progress: {},
    serverError: null,
    round: detail.round ?? null,
  };
}

/** The newer of two views of a round: a view replaces another only with a higher version. */
export function newerRound(
  current: QuantRoundView | null,
  next: QuantRoundView,
): QuantRoundView | null {
  return current && current.version >= next.version ? current : next;
}

const sortMessages = (m: Message[]) =>
  [...m].sort((a, b) => a.createdAt.localeCompare(b.createdAt));

const isFinal = (r: Run) => r.status === 'finished';

/** Merge a run snapshot without ever regressing a finished run to queued/running. */
export function upsertRun(runs: Run[], run: Run): Run[] {
  const i = runs.findIndex((r) => r.id === run.id);
  if (i === -1) return [...runs, run].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const existing = runs[i] as Run;
  if (isFinal(existing) && !isFinal(run)) return runs;
  const next = runs.slice();
  next[i] = run;
  return next;
}

function applyProgress(prev: RunProgress | undefined, ev: JudgeProgress['event']): RunProgress {
  const p: RunProgress = prev ?? {
    phase: 'queued',
    done: null,
    total: null,
    stdout: '',
    stderr: '',
  };
  switch (ev.type) {
    case 'started':
      return { ...p, phase: p.phase === 'queued' ? 'started' : p.phase };
    case 'compiling':
      return { ...p, phase: 'compiling' };
    case 'running':
      return { ...p, phase: 'running', done: ev.done, total: ev.total };
    case 'output': {
      const key = ev.stream;
      const text = (p[key] + ev.chunk).slice(-OUTPUT_CAP);
      return { ...p, phase: 'running', [key]: text };
    }
  }
}

export function padReducer(state: PadState, action: PadAction): PadState {
  switch (action.type) {
    case 'pending.add':
      return {
        ...state,
        pending: [...state.pending, action.message],
        order: [...state.order, `p:${action.message.localId}`],
      };
    case 'pending.status':
      return {
        ...state,
        pending: state.pending.map((p) =>
          p.localId === action.localId ? { ...p, status: action.status } : p,
        ),
      };
    case 'pending.remove':
      return {
        ...state,
        pending: state.pending.filter((p) => p.localId !== action.localId),
        order: state.order.filter((k) => k !== `p:${action.localId}`),
      };
    case 'run.upsert': {
      const runs = upsertRun(state.runs, action.run);
      const merged = runs.find((r) => r.id === action.run.id) ?? action.run;
      const progress = { ...state.progress };
      if (isFinal(merged)) delete progress[merged.id];
      else
        progress[merged.id] ??= {
          phase: action.run.status === 'running' ? 'started' : 'queued',
          done: null,
          total: null,
          stdout: '',
          stderr: '',
        };
      return { ...state, runs, progress };
    }
    case 'pad.set':
      return {
        ...state,
        pad: action.pad,
        interviewerModel: modelFor(action.pad, state.interviewerModel),
      };
    case 'thinking.reset':
      return { ...state, thinking: false };
    case 'event':
      return applyEvent(state, action.event);
  }
}

function applyEvent(state: PadState, ev: ServerEvent): PadState {
  switch (ev.type) {
    case 'run.created':
    case 'run.finished':
      return padReducer(state, { type: 'run.upsert', run: ev.run });
    case 'run.progress': {
      const run = state.runs.find((r) => r.id === ev.runId);
      if (run && isFinal(run)) return state;
      return {
        ...state,
        progress: {
          ...state.progress,
          [ev.runId]: applyProgress(state.progress[ev.runId], ev.event),
        },
      };
    }
    case 'message.delta': {
      if (state.messages.some((m) => m.id === ev.messageId)) return state;
      state = markSent(state);
      const prev = state.streaming[ev.messageId];
      return {
        ...state,
        order: prev ? state.order : [...state.order, `s:${ev.messageId}`],
        streaming: {
          ...state.streaming,
          [ev.messageId]: {
            text: (prev?.text ?? '') + ev.delta,
            startedAt: prev?.startedAt ?? new Date().toISOString(),
          },
        },
      };
    }
    case 'message.created': {
      const m = ev.message;
      const streaming = { ...state.streaming };
      delete streaming[m.id];
      const exists = state.messages.some((x) => x.id === m.id);
      const messages = exists
        ? state.messages.map((x) => (x.id === m.id ? m : x))
        : sortMessages([...state.messages, m]);
      const key = `m:${m.id}`;
      let order = state.order;
      let pending = state.pending;
      // Takes the slot of its stream, or of our optimistic copy when it is our own message echoed.
      let slot = order.indexOf(`s:${m.id}`);
      // (In a room the host's own messages have the interviewer role.)
      if (m.userId === state.me) {
        const p = pending.find((x) => x.text.trim() === m.text.trim());
        if (p) {
          pending = pending.filter((x) => x !== p);
          slot = order.indexOf(`p:${p.localId}`);
        }
      }
      if (exists) order = slot === -1 ? order : order.filter((_, i) => i !== slot);
      else if (slot === -1) order = [...order, key];
      else order = order.map((k, i) => (i === slot ? key : k));
      return {
        ...state,
        messages,
        streaming,
        pending,
        order,
        thinking: m.role === 'interviewer' ? false : state.thinking,
      };
    }
    case 'interviewer.thinking':
      return { ...markSent(state), thinking: ev.active };
    case 'pad.updated':
      return {
        ...state,
        // Broadcasts carry no share token; keep the one the owner has.
        pad: { ...ev.pad, shareToken: state.pad.shareToken },
        interviewerModel: modelFor(ev.pad, state.interviewerModel),
      };
    case 'pad.problem':
      // A room's host moved on: the editor document already holds the new problem's code.
      return {
        ...state,
        // The event is broadcast without the share token; keep the one the host has.
        pad: { ...ev.pad, shareToken: state.pad.shareToken },
        problem: ev.problem,
      };
    case 'member.joined':
      return state.members.some((m) => m.userId === ev.member.userId)
        ? state
        : { ...state, members: [...state.members, ev.member] };
    case 'interviewer.status':
      return {
        ...state,
        interviewerKey: ev.key,
        interviewerAvailable: ev.key === 'active',
        // Older servers send no model: keep what we know while the key stays usable.
        interviewerModel:
          ev.model !== undefined ? ev.model : ev.key === 'active' ? state.interviewerModel : null,
        thinking: ev.key === 'active' ? state.thinking : false,
      };
    case 'error': {
      // A refused chat message: mark our latest unconfirmed one as not sent so it can be retried.
      let pending = state.pending;
      if (['too_long', 'rate_limited', 'pad_ended'].includes(ev.code)) {
        const last = [...pending]
          .reverse()
          .find((p) => p.status === 'sending' || p.status === 'sent');
        if (last) pending = pending.map((p) => (p === last ? { ...p, status: 'failed' } : p));
      }
      return {
        ...state,
        pending,
        serverError: { code: ev.code, message: ev.message, at: Date.now() },
      };
    }
    case 'pong':
      return state;
    case 'round.updated': {
      const round = newerRound(state.round, ev.round);
      return round === state.round ? state : { ...state, round };
    }
  }
}

/** The server is answering, so whatever we were sending has arrived. */
function markSent(state: PadState): PadState {
  if (!state.pending.some((p) => p.status === 'sending')) return state;
  return {
    ...state,
    pending: state.pending.map((p) => (p.status === 'sending' ? { ...p, status: 'sent' } : p)),
  };
}

/** Chat items in display order: finalized, then streaming replies, then our pending ones. */
export type ChatItem =
  | { kind: 'message'; message: Message }
  | { kind: 'streaming'; id: string; text: string }
  | { kind: 'pending'; pending: PendingMessage };

export function chatItems(
  state: Pick<PadState, 'messages' | 'streaming' | 'pending' | 'order'>,
): ChatItem[] {
  const byId = new Map(state.messages.map((m) => [m.id, m]));
  const pend = new Map(state.pending.map((p) => [p.localId, p]));
  const items: ChatItem[] = [];
  for (const key of state.order) {
    const id = key.slice(2);
    if (key.startsWith('m:')) {
      const m = byId.get(id);
      if (m) items.push({ kind: 'message', message: m });
    } else if (key.startsWith('s:')) {
      const st = state.streaming[id];
      if (st) items.push({ kind: 'streaming', id, text: st.text });
    } else {
      const p = pend.get(id);
      if (p) items.push({ kind: 'pending', pending: p });
    }
  }
  return items;
}

export function activeRun(state: Pick<PadState, 'runs'>): Run | undefined {
  return [...state.runs].reverse().find((r) => !isFinal(r));
}
