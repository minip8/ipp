/**
 * Mock of quant rooms (ARCHITECTURE §8.4), kept apart from mock-api.ts (which delegates every
 * request on a quant room here):
 *
 *   POST /api/pads (format quant)            a quant room, with an optional queue
 *   GET  /api/pads/:id/host                  `HostView` with `round` (the host's view)
 *   GET  /api/pads/:id/host/round/bank       the host's bank search (ROOM_BANK), with solutions
 *   PUT  …/host/round/queue                  the whole queue
 *   POST …/host/round/pose|hint|follow-up|close, PUT …/host/round/verdict
 *   POST …/host/round/review                 the AI's second opinion (`opinion` sets its outcome)
 *   PATCH, POST …/end, …/report, …/report/assessment, …/playback
 *   refused as on the API: runs, `…/problem`, `…/review` (wrong_format), quotes (wrong_mode)
 *   WS   on connect                          round.updated to that socket alone
 *   WS   chat.send                           a person's message (no AI ever answers)
 *
 * Every change to a round goes through the contract's own `advanceRound` (a hosted round from
 * `createHostedRound`), with the API's refusals and codes; the views are `publicRound` for
 * members and the host's `HostRoundView`, built as `apps/api/src/quant/room.ts` builds it. A
 * pose posts the host's `question` message, then `round.updated`; the queue, a follow-up and a
 * verdict broadcast nothing (they change nothing a member sees).
 *
 * One room can be shared by two browser contexts (the host's and the candidate's), each with its
 * own MockBackend: `share` puts the candidate's backend in the same world, so both get every
 * event and see the same round, messages and members.
 */
import {
  type AiKeyStatus,
  advanceRound,
  CloseQuantQuestionRequest,
  type CreatePadRequest,
  createHostedRound,
  HostBankQuery,
  type HostBankStatus,
  type HostQuestionMaterial,
  type HostRoundView,
  hostedPick,
  type Message,
  type Pad,
  type PadDetail,
  type PadMember,
  type PadSummary,
  Playback,
  PoseQuantQuestionRequest,
  publicRound,
  QUANT_HOSTED_HINTS_MAX,
  QUANT_HOSTED_QUESTIONS_MAX,
  QUANT_QUEUE_MAX,
  type QuantHostStep,
  type QuantRefusal,
  type QuantRoundState,
  type QuantRoundStep,
  QuantSecondOpinionRequest,
  type QuizQuestion,
  quantPhase,
  quantQuestionStatus,
  quantTimeSec,
  quizSolution,
  RecordQuantFollowUpRequest,
  RecordQuantHintRequest,
  Report,
  type ServerEvent,
  SetQuantVerdictRequest,
  type TimelineEvent,
  UpdatePadRequest,
  UpdateQuantQueueRequest,
  YDOC,
} from '@ipp/contracts';
import type { WebSocketRoute } from '@playwright/test';
import * as Y from 'yjs';
import { makeMessage, makePadDetail, QUIZ_TOPICS, uuid } from './fixtures';
import {
  makeQuantOpinion,
  publicOf,
  QROOM_EMPTY_PAD_ID,
  QROOM_ENDED_PAD_ID,
  QROOM_GUEST,
  QROOM_HOST,
  ROOM_BANK,
  ROOM_BANK_BY_ID,
  topicTitle,
} from './fixtures-quant-room';
import { QUANT_ASSESSMENT } from './mock-quant-round';

/** What the mock needs of a MockBackend (an interface, so the two files do not import each other). */
export interface RoomBackend {
  pads: Map<string, PadDetail>;
  summaries: PadSummary[];
  aiKey: AiKeyStatus;
  me: { id: string; name: string; guest?: boolean };
  hostNotes: Map<string, string>;
  push(event: ServerEvent): void;
}

type Room = {
  padId: string;
  state: QuantRoundState;
  version: number;
  /** `question` and `ended` timeline events, for the playback. */
  timeline: TimelineEvent[];
  /** The scratchpad's history for the playback: [seconds since start, text appended]. */
  notes: [number, string][];
  /** The host asked for the assessment (pending for a moment, then written). */
  assessment: 'none' | 'pending' | 'ready';
};

/** A seeded room's script: host steps (or what a person said) at seconds after the start. */
export type RoomScriptLine =
  | { at: number; pose: string }
  | { at: number; hint: number }
  | { at: number; followUp: true }
  | { at: number; close: { score: number; summary: string } | null }
  | { at: number; verdict: { index: number; score: number; summary: string } }
  | { at: number; candidate: string }
  | { at: number; host: string }
  | { at: number; notes: string };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const b64 = (u: Uint8Array) => Buffer.from(u).toString('base64');

function response(status: number, code: string, message: string) {
  return new Response(JSON.stringify({ error: { code, message } }), { status });
}

/** As `HOST_REFUSALS` in apps/api/src/routes/pads.ts: the round's refusal, `ended` as `pad_ended`. */
const HOST_REFUSALS: Partial<Record<QuantRefusal, string>> = {
  already_posed: 'That question was already asked in this interview',
  not_open: 'No question is open',
  wrong_index: 'That question is not the one open (or not one asked here)',
  hint_rung: 'That is not the next hint of this question',
  hint_limit: `At most ${QUANT_HOSTED_HINTS_MAX} hints can be recorded on one question`,
  follow_up_used: 'The follow-up was already recorded',
  not_closed: 'That question is still open, or was never asked',
  has_verdict: 'That question already has a verdict, and the interview has ended',
  question_limit: `At most ${QUANT_HOSTED_QUESTIONS_MAX} questions can be asked in one interview`,
  queue_limit: `At most ${QUANT_QUEUE_MAX} questions can be queued`,
  invalid: 'That cannot be recorded',
};
const refused = (reason: QuantRefusal) =>
  reason === 'ended'
    ? response(409, 'pad_ended', 'This interview has ended')
    : response(409, reason, HOST_REFUSALS[reason] ?? 'The round refused that');

const TOPIC_RANK = new Map(QUIZ_TOPICS.map((t, i) => [t.slug, i]));
const trackOf = (topic: string) =>
  QUIZ_TOPICS.find((t) => t.slug === topic)?.track ?? 'fundamentals';
const DIFFICULTY_RANK = { easy: 0, medium: 1, hard: 2 } as const;

/** As the API's `correctAnswer`. */
function correctAnswer(q: QuizQuestion): HostQuestionMaterial['correctAnswer'] {
  switch (q.type) {
    case 'single':
    case 'multiple':
    case 'output':
      return q.answer;
    case 'short':
      return q.reference;
    case 'numeric':
      return q.answerText ?? q.answer;
  }
}

/** As the API's `hostMaterial`: the bank question with its solution and interviewer material. */
export function hostMaterial(q: QuizQuestion): HostQuestionMaterial {
  const live = q.type === 'short' || q.type === 'numeric' ? q : null;
  return {
    ...publicOf(q),
    topicTitle: topicTitle(q.topic),
    solution: quizSolution(q),
    correctAnswer: correctAnswer(q),
    keyPoints: q.type === 'short' ? [...q.keyPoints] : [],
    explanation: q.explanation,
    hints: [...(live?.hints ?? [])],
    followUps: [...(live?.followUps ?? [])],
    tolerance: q.type === 'numeric' ? (q.tolerance ?? null) : null,
  };
}

export class MockQuantRooms {
  rooms = new Map<string, Room>();
  /** Every backend in this world: the host's, and a candidate's once `share`d. */
  backends: RoomBackend[];
  /** How the second opinion answers: a review, the daily AI limit, or a failed call. */
  opinion: 'ok' | 'budget' | 'failed' = 'ok';
  opinionDelayMs = 300;
  /** Bodies of the second-opinion requests, in order. */
  opinions: unknown[] = [];
  /** The scratchpad has something on it (the assessment's `nothing_to_assess` reads it). */
  scratchpadWritten = new Set<string>();
  /** Bank questions no longer active (a queued one has no material then, and cannot be posed). */
  inactive = new Set<string>();
  /** Every host step tried, and whether the shared transition accepted it. */
  log: { step: QuantHostStep | { type: 'end' }; ok: boolean; reason?: string }[] = [];

  constructor(host: RoomBackend) {
    this.backends = [host];
    this.seedEnded();
    this.seedEmpty();
  }

  private get host(): RoomBackend {
    // The first backend is the one the world was made for (a spec's host, or a solo backend).
    return this.backends[0] as RoomBackend;
  }

  private broadcast(event: ServerEvent) {
    for (const b of this.backends) b.push(event);
  }

  private details(padId: string): PadDetail[] {
    return this.backends.flatMap((b) => {
      const d = b.pads.get(padId);
      return d ? [d] : [];
    });
  }

  // ---------------------------------------------------------------- rooms

  /** A quant room's detail as one member sees it. */
  private makeDetail(o: {
    id: string;
    as: 'host' | 'candidate';
    owner: PadMember;
    members: PadMember[];
    startedAt: string;
    durationMin: number | null;
    title?: string;
    token?: string;
  }): PadDetail {
    const host = o.as === 'host';
    return makePadDetail({
      pad: {
        id: o.id,
        kind: 'room',
        format: 'quant',
        problemSlug: null,
        language: 'python',
        title: o.title ?? 'Quant interview',
        ownerId: o.owner.userId,
        durationMin: o.durationMin,
        interviewer: { enabled: false, style: 'neutral', proactivity: 'normal', voice: false },
        shareToken: host ? (o.token ?? `qr_${o.id.slice(-8)}`) : null,
        startedAt: o.startedAt,
      },
      role: host ? 'owner' : 'collaborator',
      members: o.members,
      messages: [],
      ...(host ? {} : { interviewerKey: 'missing' as const }),
    });
  }

  /**
   * A quant room in the host backend, played to some point: each line of the script is applied at
   * its time (seconds after the start) through the shared transition.
   */
  seed(o: {
    id: string;
    as?: 'host' | 'candidate';
    owner?: PadMember;
    members?: PadMember[];
    startedAt?: string;
    durationMin?: number | null;
    queue?: string[];
    script?: RoomScriptLine[];
    endedAtSec?: number;
    token?: string;
    title?: string;
  }): PadDetail {
    const owner = o.owner ?? QROOM_HOST;
    const startedAt = o.startedAt ?? new Date(Date.now() - 600_000).toISOString();
    const detail = this.makeDetail({
      id: o.id,
      as: o.as ?? 'host',
      owner,
      members: o.members ?? [owner, QROOM_GUEST],
      startedAt,
      durationMin: o.durationMin === undefined ? 45 : o.durationMin,
      title: o.title,
      token: o.token,
    });
    this.host.pads.set(o.id, detail);
    const room: Room = {
      padId: o.id,
      state: createHostedRound(o.queue ?? []),
      version: 0,
      timeline: [],
      notes: [],
      assessment: 'none',
    };
    this.rooms.set(o.id, room);
    const at = (sec: number) => new Date(Date.parse(startedAt) + sec * 1000);
    const guest = (o.members ?? [owner, QROOM_GUEST]).find((m) => m.role !== 'owner');
    for (const line of o.script ?? []) {
      const now = at(line.at);
      if ('candidate' in line) {
        detail.messages.push(
          makeMessage({
            padId: o.id,
            role: 'candidate',
            userId: guest?.userId ?? null,
            text: line.candidate,
            createdAt: now.toISOString(),
          }),
        );
        continue;
      }
      if ('host' in line) {
        detail.messages.push(
          makeMessage({
            padId: o.id,
            role: 'interviewer',
            userId: owner.userId,
            text: line.host,
            createdAt: now.toISOString(),
          }),
        );
        continue;
      }
      if ('notes' in line) {
        room.notes.push([line.at, line.notes]);
        this.scratchpadWritten.add(o.id);
        continue;
      }
      const open = room.state.current;
      const step: QuantHostStep =
        'pose' in line
          ? { type: 'pose', pick: this.pick(line.pose) }
          : 'hint' in line
            ? { type: 'host_hint', index: open, rung: line.hint }
            : 'followUp' in line
              ? { type: 'host_follow_up', index: open }
              : 'close' in line
                ? { type: 'host_close', index: open, verdict: line.close }
                : { type: 'host_verdict', index: line.verdict.index, verdict: line.verdict };
      if (this.apply(room, step, now, owner.userId, false) !== true)
        throw new Error(`seeded step refused: ${JSON.stringify(line)}`);
    }
    if (o.endedAtSec !== undefined) {
      const endedAt = at(o.endedAtSec);
      detail.pad = { ...detail.pad, status: 'ended', endedAt: endedAt.toISOString() };
      this.apply(room, { type: 'end' }, endedAt, owner.userId, false);
      room.timeline.push({
        id: uuid(),
        padId: o.id,
        at: endedAt.toISOString(),
        event: { type: 'ended' },
      });
    }
    detail.round = publicRound(room.state, room.version);
    return detail;
  }

  /** The ended room the report specs read: an answered question with hints, an unfinished one. */
  private seedEnded() {
    this.seed({
      id: QROOM_ENDED_PAD_ID,
      startedAt: new Date(Date.now() - 86_400_000).toISOString(),
      durationMin: 45,
      title: 'Quant interview with Casey',
      script: [
        { at: 20, host: 'Hi Casey, thanks for joining. Let’s start with some probability.' },
        { at: 40, pose: 'rb-prob-dice-eight' },
        { at: 60, notes: 'pairs summing to 8: (2,6) (3,5) (4,4) (5,3) (6,2)\n' },
        { at: 95, candidate: 'Five ordered pairs out of 36, so 5/36.' },
        { at: 110, followUp: true },
        { at: 150, close: { score: 1, summary: 'Counted the five ordered pairs at once.' } },
        { at: 170, pose: 'rb-teaser-ropes' },
        { at: 260, hint: 1 },
        { at: 330, hint: 2 },
        { at: 400, hint: 0 },
        { at: 480, candidate: 'Light A at both ends and B at one end, then the other end of B.' },
        { at: 520, close: null },
        { at: 540, pose: 'rb-cpp-vector-reserve' },
        { at: 600, candidate: 'It prints 10?' },
      ],
      endedAtSec: 660,
    });
  }

  /** An ended room in which nothing was asked, said or written. */
  private seedEmpty() {
    this.seed({
      id: QROOM_EMPTY_PAD_ID,
      startedAt: new Date(Date.now() - 2 * 86_400_000).toISOString(),
      members: [QROOM_HOST],
      endedAtSec: 120,
    });
  }

  /** Puts the seeded rooms on the dashboard. */
  listOnDashboard(ids: string[] = [QROOM_ENDED_PAD_ID]) {
    for (const id of ids) {
      const s = this.summaryOf(id, this.host);
      if (s && !this.host.summaries.some((x) => x.id === id)) this.host.summaries.unshift(s);
    }
    this.host.summaries.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  }

  summaryOf(id: string, b: RoomBackend): PadSummary | null {
    const d = b.pads.get(id);
    if (!d) return null;
    return {
      id: d.pad.id,
      title: d.pad.title,
      kind: 'room',
      format: 'quant',
      problemSlug: null,
      language: 'python',
      status: d.pad.status,
      startedAt: d.pad.startedAt,
      endedAt: d.pad.endedAt,
      problemTitle: null,
      difficulty: null,
      accepted: false,
      role: d.role,
      quantPath: null,
    };
  }

  /**
   * The candidate's backend joins this world for room `padId`: it gets the room as a candidate
   * sees it (reachable by `token`), and from now on every event of the room.
   */
  share(candidate: RoomBackend & { tokens: Map<string, string> }, padId: string, token: string) {
    const d = this.host.pads.get(padId);
    if (!d) throw new Error(`no room ${padId}`);
    if (!this.backends.includes(candidate)) this.backends.push(candidate);
    const owner = d.members.find((m) => m.role === 'owner') ?? QROOM_HOST;
    const mine = this.makeDetail({
      id: padId,
      as: 'candidate',
      owner,
      members: [...d.members],
      startedAt: d.pad.startedAt,
      durationMin: d.pad.durationMin,
      title: d.pad.title,
    });
    mine.pad = { ...d.pad, shareToken: null };
    mine.messages = d.messages;
    mine.round = d.round;
    candidate.pads.set(padId, mine);
    candidate.tokens.set(token, padId);
    d.pad = { ...d.pad, shareToken: token };
  }

  /** POST /api/pads with format `quant`, with the API's refusals (`createQuantRoom`). */
  create(b: RoomBackend, req: CreatePadRequest): Response | Pad {
    if (req.kind !== 'room')
      return response(
        400,
        'validation_error',
        'A quant pad here is a room; a practice quant round is POST /api/pads/quant',
      );
    if (req.problemSlug || req.random || req.blank)
      return response(400, 'validation_error', 'A quant room takes no problem');
    const queue = req.queue ?? [];
    const bad = this.queueRefusal(queue);
    if (bad) return bad;
    const id = uuid();
    const owner: PadMember = { userId: b.me.id, name: b.me.name, role: 'owner', guest: false };
    const detail = this.makeDetail({
      id,
      as: 'host',
      owner,
      members: [owner],
      startedAt: new Date().toISOString(),
      durationMin: req.durationMin,
      title: req.title?.trim() || 'Quant interview',
    });
    b.pads.set(id, detail);
    const room: Room = {
      padId: id,
      state: createHostedRound(queue),
      version: 0,
      timeline: [],
      notes: [],
      assessment: 'none',
    };
    this.rooms.set(id, room);
    detail.round = publicRound(room.state, 0);
    const s = this.summaryOf(id, b);
    if (s) b.summaries.unshift(s);
    return detail.pad;
  }

  private queueRefusal(ids: readonly string[]): Response | null {
    if (new Set(ids).size !== ids.length)
      return response(400, 'validation_error', 'A question can be queued only once');
    const missing = ids.filter((id) => !this.active(id));
    if (missing.length)
      return response(400, 'unknown_question', `Not a question of the bank: ${missing.join(', ')}`);
    return null;
  }

  private active(id: string) {
    return ROOM_BANK_BY_ID.has(id) && !this.inactive.has(id);
  }

  private pick(id: string) {
    const q = ROOM_BANK_BY_ID.get(id);
    if (!q) throw new Error(`no bank question ${id}`);
    return hostedPick(q, topicTitle(q.topic));
  }

  // ---------------------------------------------------------------- views

  /** As the API's `buildHostRoundView`. */
  hostView(padId: string): HostRoundView | null {
    const r = this.rooms.get(padId);
    if (!r) return null;
    const phase = quantPhase(r.state);
    const material = (id: string) => {
      const q = ROOM_BANK_BY_ID.get(id);
      return q ? hostMaterial(q) : null;
    };
    return {
      version: r.version,
      phase,
      ended: r.state.ended === true,
      open: phase === 'asking' ? r.state.current : null,
      questions: r.state.questions.flatMap((q, index) =>
        q.posedAt === null
          ? []
          : [
              {
                index,
                questionId: q.questionId,
                topic: q.topic,
                topicTitle: q.topicTitle ?? q.topic,
                difficulty: q.difficulty,
                type: q.type ?? 'short',
                prompt: q.prompt,
                posedAt: q.posedAt,
                posedMessageId: q.posedMessageId,
                closedAt: q.closedAt,
                closedBy: q.closedBy,
                timeSec: quantTimeSec(q),
                hintRungs: [...q.hintRungs],
                followUpAsked: q.followUpAsked,
                verdict: q.verdict ? { ...q.verdict } : null,
                material: material(q.questionId),
              },
            ],
      ),
      queue: (r.state.queue ?? []).map((id) => ({
        questionId: id,
        material: this.active(id) ? material(id) : null,
      })),
    };
  }

  /** The host's bank search (`searchBank`), over ROOM_BANK. */
  private searchBank(r: Room, query: HostBankQuery) {
    const text = query.q?.toLowerCase();
    const matching = ROOM_BANK.filter(
      (q) =>
        this.active(q.id) &&
        (!query.track || trackOf(q.topic) === query.track) &&
        (!query.topic || q.topic === query.topic) &&
        (!query.subtopic || q.subtopic === query.subtopic) &&
        (!query.difficulty || q.difficulty === query.difficulty) &&
        (!query.type || q.type === query.type) &&
        (!text ||
          q.prompt.toLowerCase().includes(text) ||
          q.subtopic.toLowerCase().includes(text) ||
          q.id.includes(text)),
    ).sort(
      (a, b) =>
        Number(trackOf(a.topic) !== 'quant') - Number(trackOf(b.topic) !== 'quant') ||
        (TOPIC_RANK.get(a.topic) ?? 99) - (TOPIC_RANK.get(b.topic) ?? 99) ||
        a.subtopic.localeCompare(b.subtopic) ||
        DIFFICULTY_RANK[a.difficulty] - DIFFICULTY_RANK[b.difficulty] ||
        a.id.localeCompare(b.id),
    );
    const posed = new Set(r.state.questions.map((q) => q.questionId));
    const queued = new Set(r.state.queue ?? []);
    const status = (id: string): HostBankStatus =>
      posed.has(id) ? 'posed' : queued.has(id) ? 'queued' : 'available';
    const counts = new Map<string, number>();
    for (const q of ROOM_BANK)
      if (this.active(q.id)) counts.set(q.topic, (counts.get(q.topic) ?? 0) + 1);
    const topics = [...counts.entries()]
      .map(([slug, n]) => ({
        slug,
        title: topicTitle(slug),
        track: trackOf(slug),
        questionCount: n,
      }))
      .sort(
        (a, b) =>
          Number(a.track !== 'quant') - Number(b.track !== 'quant') ||
          (TOPIC_RANK.get(a.slug) ?? 99) - (TOPIC_RANK.get(b.slug) ?? 99),
      );
    return {
      total: matching.length,
      limit: query.limit,
      offset: query.offset,
      items: matching
        .slice(query.offset, query.offset + query.limit)
        .map((q) => ({ ...hostMaterial(q), status: status(q.id) })),
      topics,
      subtopics: query.topic
        ? [
            ...new Set(
              ROOM_BANK.filter((q) => q.topic === query.topic && this.active(q.id)).map(
                (q) => q.subtopic,
              ),
            ),
          ].sort()
        : [],
    };
  }

  // ---------------------------------------------------------------- the transition

  /**
   * One step through `advanceRound`, then its effects in the API's order: the posing message
   * (with its timeline event), then round.updated if the round a member sees changed. Null when
   * the transition refused it (nothing changes, nothing is sent).
   */
  private apply(
    r: Room,
    step: QuantHostStep | { type: 'end' },
    now = new Date(),
    hostId = this.host.me.id,
    send = true,
  ): true | QuantRefusal {
    const res = advanceRound(r.state, step as QuantRoundStep, {
      version: r.version,
      now,
      roundEndsAt: now,
      newId: () => uuid(),
    });
    this.log.push(res.ok ? { step, ok: true } : { step, ok: false, reason: res.reason });
    if (!res.ok) return res.reason;
    const { version: _was, ...before } = publicRound(r.state, r.version);
    r.state = res.state;
    r.version = res.version;
    const view = publicRound(r.state, r.version);
    const { version: _now, ...after } = view;
    const changed = JSON.stringify(before) !== JSON.stringify(after);
    const messages: Message[] = [];
    const reveal = res.effects.reveal;
    if (reveal) {
      const at = new Date(now.getTime() + 1).toISOString();
      messages.push(
        makeMessage({
          id: reveal.messageId,
          padId: r.padId,
          role: 'interviewer',
          kind: 'proactive',
          intent: 'question',
          text: reveal.text,
          userId: hostId,
          createdAt: at,
        }),
      );
      r.timeline.push({
        id: uuid(),
        padId: r.padId,
        at,
        event: { type: 'question', index: reveal.index, total: reveal.total },
      });
    }
    // The candidate's detail shares the host's message list (see `share`).
    for (const list of new Set(this.details(r.padId).map((d) => d.messages)))
      list.push(...messages);
    for (const d of this.details(r.padId)) d.round = view;
    if (send) {
      for (const message of messages) this.broadcast({ type: 'message.created', message });
      if (changed) this.broadcast({ type: 'round.updated', round: view });
    }
    return true;
  }

  /** A host step from a route: the new host view, or the refusal as the API answers it. */
  private step(r: Room, step: QuantHostStep): Response | HostRoundView {
    const out = this.apply(r, step);
    if (out !== true) return refused(out);
    return this.hostView(r.padId) as HostRoundView;
  }

  /** Steps for specs, as the host's routes take them (posted as the host's). */
  pose(padId: string, questionId: string) {
    const r = this.rooms.get(padId);
    if (!r) throw new Error(`no room ${padId}`);
    return this.step(r, { type: 'pose', pick: this.pick(questionId) });
  }

  // ---------------------------------------------------------------- the socket

  /** A pad socket opened: send it the round (asynchronously, as the API does). */
  connected(ws: WebSocketRoute, padId: string) {
    const r = this.rooms.get(padId);
    if (!r) return;
    setTimeout(() => {
      ws.send(JSON.stringify({ type: 'round.updated', round: publicRound(r.state, r.version) }));
    }, 30);
  }

  /** chat.send in a quant room: a person's message, to everyone in it. No AI answers. */
  chat(b: RoomBackend, padId: string, text: string, via: 'text' | 'voice') {
    const d = b.pads.get(padId);
    if (!d) return;
    if (d.pad.status !== 'active') {
      b.push({ type: 'error', code: 'pad_ended', message: 'This interview has ended' });
      return;
    }
    const message = makeMessage({
      padId,
      role: d.role === 'owner' ? 'interviewer' : 'candidate',
      userId: b.me.id,
      text,
      via,
      createdAt: new Date().toISOString(),
    });
    const lists = new Set(this.details(padId).map((x) => x.messages));
    for (const list of lists) list.push(message);
    this.broadcast({ type: 'message.created', message });
  }

  /** Someone joined by the invite link (in one backend): the others hear of it too. */
  joined(from: RoomBackend, padId: string, member: PadMember) {
    for (const b of this.backends) {
      if (b === from) continue;
      const d = b.pads.get(padId);
      if (!d || d.members.some((m) => m.userId === member.userId)) continue;
      d.members = [...d.members, member];
      b.push({ type: 'member.joined', member });
    }
  }

  // ---------------------------------------------------------------- routes

  /** Whether `b`'s user may use the host's routes of `d`: a 403 or 404 as the API's `roomForHost`. */
  private notHost(b: RoomBackend, d: PadDetail): Response | null {
    if (b.me.guest) return response(403, 'account_required', 'Sign in with an account to do this');
    if (d.role !== 'owner')
      return response(403, 'forbidden', 'Only the host of a room can do this');
    return null;
  }

  /**
   * Every request on a quant room. Undefined for what mock-api handles as for any room (GET and
   * DELETE of the pad, the host's notes).
   */
  async handle(
    b: RoomBackend,
    d: PadDetail,
    rest: string,
    method: string,
    query: URLSearchParams,
    body: unknown,
  ): Promise<unknown> {
    const padId = d.pad.id;
    const r = this.rooms.get(padId);
    if (!r) return undefined;
    const active = d.pad.status === 'active';
    const parse = <T>(schema: { safeParse: (v: unknown) => { success: boolean; data?: T } }) => {
      const p = schema.safeParse(body ?? {});
      return p.success ? (p.data as T) : null;
    };
    const invalid = () => response(400, 'validation_error', 'Invalid request body');

    if (rest === '' && method === 'PATCH') {
      const upd = UpdatePadRequest.parse(body);
      if (upd.language) return response(409, 'wrong_format', 'A quant pad has no language');
      for (const x of this.details(padId)) {
        x.pad = {
          ...x.pad,
          ...upd,
          // A room has no AI in the conversation.
          interviewer: { ...x.pad.interviewer, ...upd.interviewer, enabled: false, voice: false },
        };
      }
      const next = b.pads.get(padId)?.pad as Pad;
      this.broadcast({ type: 'pad.updated', pad: { ...next, shareToken: null } });
      return next;
    }
    if (rest === '/end' && method === 'POST') {
      if (d.role !== 'owner') return response(403, 'forbidden', 'Only the host can end it');
      const at = new Date();
      for (const x of this.details(padId))
        x.pad = { ...x.pad, status: 'ended', endedAt: at.toISOString() };
      for (const bk of this.backends) {
        const s = bk.summaries.find((x) => x.id === padId);
        if (s) Object.assign(s, { status: 'ended', endedAt: at.toISOString() });
      }
      this.broadcast({ type: 'pad.updated', pad: { ...d.pad, shareToken: null } });
      this.apply(r, { type: 'end' }, at);
      r.timeline.push({ id: uuid(), padId, at: at.toISOString(), event: { type: 'ended' } });
      return d.pad;
    }
    if (rest === '/runs' && method === 'POST')
      return response(409, 'wrong_format', 'A quant pad has no code to run');
    if (rest === '/round/quote' && method === 'POST')
      return response(409, 'wrong_mode', 'This interview takes no quotes');

    const isHostRoute =
      rest === '/host' ||
      rest.startsWith('/host/round/') ||
      rest === '/review' ||
      rest === '/problem' ||
      rest === '/report' ||
      rest === '/report/assessment' ||
      rest === '/playback';
    if (!isHostRoute) return undefined;
    const denied = this.notHost(b, d);
    if (denied) return denied;

    if (rest === '/host' && method === 'GET')
      return { problem: null, notes: b.hostNotes.get(padId) ?? '', round: this.hostView(padId) };
    if (rest === '/review' && method === 'POST')
      return response(409, 'wrong_format', 'A quant room has no code to review');
    if (rest === '/problem' && method === 'POST')
      return response(409, 'wrong_format', 'A quant room has no problem');

    if (rest === '/host/round/bank' && method === 'GET') {
      const parsed = HostBankQuery.safeParse(Object.fromEntries(query.entries()));
      if (!parsed.success) return response(400, 'validation_error', 'Invalid search');
      return this.searchBank(r, parsed.data);
    }
    if (rest === '/host/round/queue' && method === 'PUT') {
      const req = parse<UpdateQuantQueueRequest>(UpdateQuantQueueRequest);
      if (!req) return invalid();
      if (!active) return refused('ended');
      const bad = this.queueRefusal(req.questionIds);
      if (bad) return bad;
      return this.step(r, { type: 'queue', questionIds: req.questionIds });
    }
    if (rest === '/host/round/pose' && method === 'POST') {
      const req = parse<PoseQuantQuestionRequest>(PoseQuantQuestionRequest);
      if (!req) return invalid();
      if (!active) return refused('ended');
      if (!this.active(req.questionId)) return response(404, 'not_found', 'Question not found');
      return this.step(r, { type: 'pose', pick: this.pick(req.questionId) });
    }
    if (rest === '/host/round/hint' && method === 'POST') {
      const req = parse<RecordQuantHintRequest>(RecordQuantHintRequest);
      if (!req) return invalid();
      if (!active) return refused('ended');
      return this.step(r, { type: 'host_hint', index: req.index, rung: req.rung });
    }
    if (rest === '/host/round/follow-up' && method === 'POST') {
      const req = parse<RecordQuantFollowUpRequest>(RecordQuantFollowUpRequest);
      if (!req) return invalid();
      if (!active) return refused('ended');
      return this.step(r, { type: 'host_follow_up', index: req.index });
    }
    if (rest === '/host/round/close' && method === 'POST') {
      const req = parse<CloseQuantQuestionRequest>(CloseQuantQuestionRequest);
      if (!req) return invalid();
      if (!active) return refused('ended');
      return this.step(r, { type: 'host_close', index: req.index, verdict: req.verdict });
    }
    if (rest === '/host/round/verdict' && method === 'PUT') {
      const req = parse<SetQuantVerdictRequest>(SetQuantVerdictRequest);
      if (!req) return invalid();
      return this.step(r, { type: 'host_verdict', index: req.index, verdict: req.verdict });
    }
    if (rest === '/host/round/review' && method === 'POST') {
      const req = parse<QuantSecondOpinionRequest>(QuantSecondOpinionRequest);
      if (!req) return invalid();
      this.opinions.push(body);
      const open = quantPhase(r.state) === 'asking' ? r.state.current : null;
      const index = req.index ?? open;
      if (index === null)
        return response(409, 'no_question', 'No question is open: say which one to look at');
      if (!r.state.questions[index]?.posedAt)
        return response(409, 'wrong_index', 'That question was not asked in this interview');
      if (b.aiKey.state !== 'active')
        return response(409, 'ai_key_missing', 'Add your AI API key first');
      await sleep(this.opinionDelayMs);
      if (this.opinion === 'budget')
        return response(
          429,
          'ai_budget',
          'You have used today’s AI allowance. It resets at midnight UTC.',
        );
      if (this.opinion === 'failed')
        return response(502, 'review_failed', 'The AI could not look at the question just now');
      return makeQuantOpinion(index, req.question);
    }

    if (rest === '/report' && method === 'GET') return this.report(b, d, r);
    if (rest === '/report/assessment' && method === 'POST') {
      if (active)
        return response(409, 'pad_active', 'The report is written when the interview ends.');
      if (r.assessment === 'none') {
        const said = d.messages.some((m) => m.role === 'candidate');
        if (r.state.questions.length === 0 && !said && !this.scratchpadWritten.has(padId))
          return response(
            409,
            'nothing_to_assess',
            'Nothing to assess: no question was asked, and the candidate wrote nothing',
          );
        if (b.aiKey.state !== 'active')
          return response(409, 'ai_key_missing', 'Add your AI API key first');
        r.assessment = 'pending';
        setTimeout(() => {
          r.assessment = 'ready';
        }, 1500);
      }
      return this.report(b, d, r);
    }
    if (rest === '/playback' && method === 'GET') return this.playback(d, r);
    return undefined;
  }

  /** GET /report for a quant room (`Report.quant` with `mode: 'hosted'`), the host's alone. */
  private report(b: RoomBackend, d: PadDetail, r: Room): Report | Response {
    if (d.pad.status !== 'ended')
      return response(409, 'pad_active', 'The report is written when the interview ends.');
    const questions = r.state.questions.map((q, index) => {
      const bank = ROOM_BANK_BY_ID.get(q.questionId);
      return {
        index,
        questionId: q.questionId,
        topic: q.topic,
        topicTitle: q.topicTitle ?? q.topic,
        subtopic: bank?.subtopic ?? '',
        difficulty: q.difficulty,
        type: q.type ?? bank?.type ?? 'short',
        prompt: q.prompt,
        unit: q.unit,
        solution: bank ? quizSolution(bank) : '',
        keyPoints: bank?.type === 'short' ? [...bank.keyPoints] : [],
        explanation: bank?.explanation ?? '',
        status: quantQuestionStatus(q),
        verdict: q.verdict ? { ...q.verdict } : null,
        hintsGiven: q.hintRungs.length,
        hintsAvailable: q.hintsAvailable,
        hintRungs: [...q.hintRungs],
        followUpAsked: q.followUpAsked,
        timeSec: quantTimeSec(q),
        budgetSec: null,
        game: null,
      };
    });
    const durationSec = d.pad.endedAt
      ? Math.round((Date.parse(d.pad.endedAt) - Date.parse(d.pad.startedAt)) / 1000)
      : 0;
    const said = d.messages.filter((m) => m.intent !== 'question');
    return Report.parse({
      padId: d.pad.id,
      status: r.assessment === 'pending' ? 'pending' : 'ready',
      generatedAt: d.pad.endedAt,
      stats: {
        durationSec,
        runs: null,
        submissions: null,
        accepted: null,
        candidateMessages: said.filter((m) => m.role === 'candidate').length,
        interviewerMessages: said.filter((m) => m.role === 'interviewer').length,
      },
      assessment: r.assessment === 'ready' ? QUANT_ASSESSMENT : null,
      assessmentUnavailable: r.assessment === 'none' ? 'not_requested' : null,
      hostNotes: b.hostNotes.get(d.pad.id) ?? '',
      quant: { mode: 'hosted', path: null, questions },
    });
  }

  /** GET /playback for a quant room: the scratchpad as written, the questions, the chat. */
  private playback(d: PadDetail, r: Room): Playback {
    const doc = new Y.Doc();
    const start = Date.parse(d.pad.startedAt);
    const updates: Playback['updates'] = [];
    let at = start;
    let seq = 0;
    doc.on('update', (u: Uint8Array) => {
      updates.push({ seq: ++seq, at: new Date(at).toISOString(), update: b64(u) });
    });
    const text = doc.getText(YDOC.notes);
    for (const [sec, chunk] of r.notes) {
      chunk.split(/(?<=\n)/).forEach((line, i) => {
        at = start + (sec + i * 3) * 1000;
        doc.transact(() => text.insert(text.length, line));
      });
    }
    return Playback.parse({ updates, events: r.timeline, messages: d.messages });
  }
}
