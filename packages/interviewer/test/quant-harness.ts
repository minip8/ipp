/**
 * Fake platform for quant rounds: an in-memory round driven by the shared `advanceRound` (the
 * same transition the API wraps in a compare-and-swap), the fake model of ./harness.ts and a fake
 * clock. Every model call is recorded with the round's current question at the time, so tests can
 * assert what the model could and could not see.
 */
import { randomUUID } from 'node:crypto';
import {
  advanceRound,
  createQuantRound,
  type InterviewerSettings,
  type Message,
  type Pad,
  type QuantRoundState,
  type QuantStep,
  type QuantStepResult,
  QuizQuestion,
  quantClock,
  quantPhase,
  quantRoundEndsAt,
  quantTimeSec,
  type ServerEvent,
} from '@ipp/contracts';
import {
  createInterviewer,
  type InterviewerOptions,
  type InterviewerRuntime,
  type TraceEvent,
} from '../src/interviewer';
import type { ModelClient, ModelRequest } from '../src/model';
import type { QuantTurn } from '../src/quant/turn';
import type {
  AiScope,
  ModelUsage,
  NewMessage,
  QuantContext,
  QuantQuestion,
  ResolvedKey,
  Trigger,
} from '../src/types';
import { FakeModel, type Reply, TEST_KEY } from './harness';

const N = ['ZERO', 'ONE', 'TWO', 'THREE'] as const;

/**
 * Four questions whose every private field carries a token naming the question (`HINT-TWO-1`,
 * `REFERENCE-ONE`, …), so a leak shows up as a plain substring.
 */
export const BANK: QuantQuestion[] = [
  QuizQuestion.parse({
    id: 'q-zero',
    topic: 'probability',
    subtopic: 'Dice',
    type: 'numeric',
    difficulty: 'easy',
    prompt: 'PROMPT-ZERO: two fair dice are rolled. What is the probability that the sum is $7$?',
    answer: '1/6',
    answerText: 'ANSWER-ZERO $\\frac{1}{6}$',
    hints: ['HINT-ZERO-1 count the outcomes', 'HINT-ZERO-2 fix the first die'],
    followUps: ['FOLLOW-ZERO-1 what about a sum of 8?'],
    explanation: 'EXPLAIN-ZERO six of thirty-six outcomes.',
  }),
  QuizQuestion.parse({
    id: 'q-one',
    topic: 'brainteasers',
    subtopic: 'Invariants',
    type: 'short',
    difficulty: 'medium',
    prompt: 'PROMPT-ONE: can a chessboard with two opposite corners removed be tiled by dominoes?',
    reference: 'REFERENCE-ONE no, by colouring.',
    keyPoints: ['KEYPOINT-ONE-A each domino covers one of each colour', 'KEYPOINT-ONE-B 30 vs 32'],
    hints: [
      'HINT-ONE-1 colour the board',
      'HINT-ONE-2 what does a domino cover?',
      'HINT-ONE-3 count',
    ],
    followUps: ['FOLLOW-ONE-1 what if two adjacent corners are removed?'],
    explanation: 'EXPLAIN-ONE the colouring argument.',
  }),
  QuizQuestion.parse({
    id: 'q-two',
    topic: 'betting-market-making',
    subtopic: 'Quoting',
    type: 'numeric',
    difficulty: 'medium',
    prompt: 'PROMPT-TWO: make me a market on the sum of two dice. Where is your mid?',
    answer: '7',
    unit: 'pips',
    hints: [],
    followUps: ['FOLLOW-TWO-1 I buy at your offer: what do you do?'],
    explanation: 'EXPLAIN-TWO the expected sum is 7.',
  }),
  QuizQuestion.parse({
    id: 'q-three',
    topic: 'statistics',
    subtopic: 'Estimation',
    type: 'numeric',
    difficulty: 'hard',
    prompt: 'PROMPT-THREE: estimate the standard deviation of one die roll.',
    answer: '1.7078',
    answerText: 'ANSWER-THREE about 1.71',
    tolerance: { abs: 0.05 },
    hints: ['HINT-THREE-1 compute the variance first'],
    followUps: [],
    explanation: 'EXPLAIN-THREE variance 35/12.',
  }),
] as QuantQuestion[];

/** Every token of question `i` that only the server may know (its prompt is public once posed). */
export function privateTokens(i: number): string[] {
  const n = N[i] as string;
  return [
    `ANSWER-${n}`,
    `REFERENCE-${n}`,
    `KEYPOINT-${n}`,
    `EXPLAIN-${n}`,
    `HINT-${n}`,
    `FOLLOW-${n}`,
  ];
}
export const promptToken = (i: number) => `PROMPT-${N[i]}`;

export const turn = (t: Partial<QuantTurn> & { action: QuantTurn['action'] }): string =>
  JSON.stringify({
    reason: 'test',
    hint_rung: 0,
    message: '',
    score: 0,
    summary: '',
    note: '',
    ...t,
  });

/** The kind of call, from the task in the final system message ("reply", "nudge", "timeout", …). */
export function taskOf(req: ModelRequest): string {
  const last = req.messages[req.messages.length - 1];
  const text = typeof last?.content === 'string' ? last.content : '';
  return /TASK \(([^)]+)\)/.exec(text)?.[1] ?? '?';
}

export const ASSESSMENT = JSON.stringify({
  recommendation: 'lean_hire',
  summary: 'You set problems up well.',
  scores: {
    structuring: { score: 3, evidence: 'Defined the outcomes at [01:10] on Q1.' },
    correctness: { score: 9, evidence: 'Q1 right.' },
    communication: { score: 3, evidence: 'Thought aloud.' },
    speed: { score: 0, evidence: 'Q2 ran out of time.' },
    independence: { score: 2, evidence: 'Two hints on Q2.' },
  },
  strengths: ['Clear setup.', ' '],
  improvements: ['Practise $\u000crac{a}{b}$ manipulations.'],
});

/** Default script: a polite interviewer that never closes on its own. */
export function defaultQuantRespond(req: ModelRequest, _n = 0): Reply {
  switch (taskOf(req)) {
    case 'opening':
      return turn({ action: 'stay', message: 'Welcome to the round. Think out loud as you go.' });
    case 'reply':
      return turn({ action: 'stay', message: 'Go on.' });
    case 'nudge':
      return turn({ action: 'stay', message: "That's about time on this one. Your best answer?" });
    case 'timeout':
      return turn({
        action: 'close',
        message: "That's time on this one.",
        score: 0.3,
        summary: 'Set it up but ran out of time.',
      });
    case 'round time':
      return turn({
        action: 'close',
        message: "We're out of time. Thanks for your work today.",
        score: 0.2,
        summary: 'Unfinished.',
      });
    case 'stall':
      return turn({ action: 'silent', reason: 'thinking' });
    case 'after the round':
      return turn({ action: 'stay', message: 'End the pad to see the report.' });
    case 'verdict':
      return JSON.stringify({ score: 0.4, summary: 'Partial progress before time ran out.' });
    case 'assessment':
      return ASSESSMENT;
    default:
      return turn({ action: 'stay', message: 'Hm.' });
  }
}

export interface QuantHarnessOptions {
  settings?: Partial<InterviewerSettings>;
  durationMin?: number;
  questions?: number;
  respond?: (req: ModelRequest, n: number) => Reply;
  key?: ResolvedKey;
  budget?: () => { ok: true } | { ok: false; reason: string };
  clientFor?: InterviewerOptions['clientFor'];
  voiceSettleMs?: number;
}

export interface RecordedCall {
  req: ModelRequest;
  /** The round's `current` when the call was made (-1 pending, total when finished). */
  current: number;
  model: string;
}

export function quantHarness(opts: QuantHarnessOptions = {}) {
  const START = Date.parse('2026-11-24T10:00:00.000Z');
  const state = { clock: START };
  const padId = randomUUID();
  const durationMin = opts.durationMin ?? 30;
  const count = opts.questions ?? 4;
  const bank = BANK.slice(0, count);
  const pad: Pad = {
    id: padId,
    ownerId: 'u1',
    title: 'Quant round',
    kind: 'practice',
    format: 'quant',
    problemSlug: null,
    language: 'python',
    status: 'active',
    durationMin,
    interviewer: {
      enabled: true,
      style: 'neutral',
      proactivity: 'normal',
      voice: false,
      ...opts.settings,
    },
    shareToken: null,
    startedAt: new Date(START).toISOString(),
    endedAt: null,
  };
  const roundEndsAt = quantRoundEndsAt(pad.startedAt, durationMin);
  const platform = {
    round: createQuantRound(
      'trader',
      durationMin,
      bank.map((q) => ({
        questionId: q.id,
        topic: q.topic,
        topicTitle: q.topic,
        difficulty: q.difficulty,
        prompt: q.prompt,
        unit: q.type === 'numeric' ? (q.unit ?? null) : null,
        hintsAvailable: (q.hints ?? []).length,
      })),
    ) as QuantRoundState,
    version: 0,
  };
  const model = new FakeModel(opts.respond ?? defaultQuantRespond);
  const calls: RecordedCall[] = [];
  const transcript: Message[] = [];
  const notes: string[] = [];
  const saved: NewMessage[] = [];
  const events: ServerEvent[] = [];
  const traces: TraceEvent[] = [];
  const usage: ModelUsage[] = [];
  const logs: { level: string; msg?: string; obj: object }[] = [];
  const steps: { step: QuantStep; result: QuantStepResult }[] = [];
  const unavailable: unknown[] = [];
  const keyState: { current: ResolvedKey } = {
    current: opts.key ?? { ok: true, keyId: 'k1', provider: 'anthropic', apiKey: TEST_KEY },
  };
  let scratch = '';
  const iso = () => new Date(state.clock).toISOString();

  const recorded = (inner: ModelClient): ModelClient => ({
    model: inner.model,
    call(req) {
      calls.push({ req, current: platform.round.current, model: inner.model });
      return inner.call(req);
    },
  });

  function entry(i: number): QuantContext['questions'][number] {
    const q = platform.round.questions[i];
    if (!q) throw new Error(`no question ${i}`);
    return {
      index: i,
      question: bank[i] as QuantQuestion,
      hintRungs: [...q.hintRungs],
      followUpAsked: q.followUpAsked,
    };
  }

  function context(scope: 'current' | 'all' = 'current'): QuantContext {
    const r = platform.round;
    const phase = quantPhase(r);
    const posed = r.questions.flatMap((q, i) => (q.posedAt ? [i] : []));
    let shown: Message[] = transcript;
    if (scope === 'current') {
      const last = posed.at(-1);
      const cut = last === undefined ? null : r.questions[last]?.posedMessageId;
      const at = cut ? transcript.findIndex((m) => m.id === cut) : -1;
      shown = at >= 0 ? transcript.slice(at + 1) : transcript;
    } else shown = transcript.slice(-200);
    return {
      pad: { ...pad, interviewer: { ...pad.interviewer } },
      round: {
        version: platform.version,
        total: r.questions.length,
        phase,
        clock: quantClock(r, roundEndsAt),
        path: r.path,
        closed: r.questions.flatMap((q, i) =>
          q.closedAt
            ? [
                {
                  index: i,
                  topic: q.topic,
                  difficulty: q.difficulty,
                  hints: q.hintRungs.length,
                  timeSec: quantTimeSec(q) ?? 0,
                  verdict: q.verdict,
                  budgetSec: q.budgetSec,
                  closedBy: q.closedBy,
                },
              ]
            : [],
        ),
      },
      questions: scope === 'all' ? posed.map(entry) : phase === 'asking' ? [entry(r.current)] : [],
      transcript: [...shown],
      scratch,
      privateNotes: [...notes],
      now: new Date(state.clock),
    };
  }

  function post(
    m: Omit<Message, 'id' | 'padId' | 'via' | 'userId' | 'createdAt'> & { id?: string },
  ) {
    const msg: Message = {
      id: m.id ?? randomUUID(),
      padId,
      role: m.role,
      kind: m.kind,
      intent: m.intent,
      text: m.text,
      via: 'text',
      userId: null,
      createdAt: iso(),
    };
    transcript.push(msg);
    return msg;
  }

  function applyStep(step: QuantStep | { type: 'end' }): QuantStepResult {
    const adv = advanceRound(platform.round, step, {
      version: platform.version,
      now: new Date(state.clock),
      roundEndsAt,
      newId: randomUUID,
    });
    if (!adv.ok) return { ok: false, reason: adv.reason };
    platform.round = adv.state;
    platform.version = adv.version;
    const e = adv.effects;
    if (e.say)
      post({ role: 'interviewer', kind: e.say.kind, intent: e.say.intent, text: e.say.text });
    if (e.reveal)
      post({
        id: e.reveal.messageId,
        role: 'interviewer',
        kind: 'proactive',
        intent: 'question',
        text: e.reveal.text,
      });
    if (e.note) notes.push(e.note);
    return {
      ok: true,
      version: platform.version,
      phase: quantPhase(platform.round),
      clock: quantClock(platform.round, roundEndsAt),
    };
  }

  const make = (): InterviewerRuntime =>
    createInterviewer(
      { model: 'fake-model' },
      {
        now: () => new Date(state.clock),
        async resolveKey(_scope: AiScope) {
          return keyState.current;
        },
        async keyRejected() {
          keyState.current = { ok: false, state: 'rejected' };
        },
        async loadContext() {
          throw new Error('a quant pad has no problem');
        },
        async loadQuantContext(_id, scope) {
          return context(scope);
        },
        async applyQuantStep(_id, step) {
          const result = applyStep(step);
          steps.push({ step, result });
          return result;
        },
        async saveMessage(_id, m) {
          saved.push(m);
          return post({
            id: m.id,
            role: 'interviewer',
            kind: m.kind,
            intent: m.intent,
            text: m.text,
          });
        },
        async modelUnavailable(id, m) {
          unavailable.push({ id, m });
        },
        async appendPrivateNote(_id, note) {
          notes.push(note);
        },
        emit(_id, e) {
          events.push(e);
        },
        async checkBudget() {
          return opts.budget ? opts.budget() : { ok: true };
        },
        recordUsage(_scope, u) {
          usage.push(u);
        },
        log: {
          info: (obj, msg) => logs.push({ level: 'info', obj, msg }),
          warn: (obj, msg) => logs.push({ level: 'warn', obj, msg }),
          error: (obj, msg) => logs.push({ level: 'error', obj, msg }),
        },
      },
      {
        clientFor: (key, m) =>
          recorded(opts.clientFor ? opts.clientFor(key, m) : (model as ModelClient)),
        trace: (_p, e) => traces.push(e),
        voiceSettleMs: opts.voiceSettleMs ?? 0,
      },
    );

  let iv = make();

  const h = {
    padId,
    pad,
    model,
    calls,
    transcript,
    notes,
    saved,
    events,
    traces,
    usage,
    logs,
    steps,
    unavailable,
    state,
    roundEndsAt,
    platform,
    get iv() {
      return iv;
    },
    get round() {
      return platform.round;
    },
    get key() {
      return keyState.current;
    },
    set key(k: ResolvedKey) {
      keyState.current = k;
    },
    get scratch() {
      return scratch;
    },
    set scratch(s: string) {
      scratch = s;
    },
    context,
    elapsed: () => (state.clock - START) / 1000,
    async send(t: Trigger) {
      iv.handle(padId, t);
      await iv.idle(padId);
    },
    /** Advance the clock, ticking every 5 s. */
    async advance(seconds: number) {
      const end = state.clock + seconds * 1000;
      while (state.clock < end) {
        state.clock = Math.min(end, state.clock + 5000);
        await h.send({ type: 'tick' });
      }
    },
    /** Advance to `ms` epoch (ticking). */
    async advanceTo(ms: number) {
      if (ms > state.clock) await h.advance(Math.ceil((ms - state.clock) / 1000));
    },
    candidate(text: string, via: 'text' | 'voice' = 'text'): Message {
      const m: Message = {
        id: randomUUID(),
        padId,
        role: 'candidate',
        kind: 'chat',
        intent: null,
        text,
        via,
        userId: 'u1',
        createdAt: iso(),
      };
      transcript.push(m);
      return m;
    },
    async say(text: string, via: 'text' | 'voice' = 'text') {
      h.candidate(text, via);
      await h.send({ type: 'candidate_message', text, via, userId: 'u1' });
    },
    /** The candidate works on the scratchpad for `seconds` (scratch_changed every second). */
    async work(seconds: number, text = 'working') {
      for (let i = 1; i <= seconds; i++) {
        state.clock += 1000;
        scratch += i === seconds ? `\n${text}` : '.';
        await h.send({ type: 'scratch_changed' });
        if (i % 5 === 0) await h.send({ type: 'tick' });
      }
    },
    async start() {
      await h.send({ type: 'session_started' });
    },
    /** A new interviewer over the same platform (an API restart). */
    restart() {
      iv.release(padId);
      iv = make();
    },
    /** The pad is ended (the API's endPad): the round's `end` step, then session_ended. */
    async endPad() {
      applyStep({ type: 'end' });
      pad.status = 'ended';
      pad.endedAt = iso();
      await h.send({ type: 'session_ended' });
    },
    /** Another writer changed the round (the version moves, nothing else does). */
    bumpVersion() {
      platform.version += 1;
    },
    /** The current question's clock (epoch ms), throws unless asking. */
    clock() {
      const c = quantClock(platform.round, roundEndsAt);
      if (!c) throw new Error('not asking');
      return c;
    },
    interviewerSaid: () =>
      transcript.filter((m) => m.role === 'interviewer' && m.intent !== 'question'),
    posted: () => transcript.filter((m) => m.intent === 'question'),
    turnCalls: () => calls.filter((c) => c.req.purpose === 'turn'),
    tasks: () => calls.map((c) => taskOf(c.req)),
    applied: () => steps.filter((s) => s.result.ok).map((s) => s.step),
    quantTraces: () =>
      traces.filter((t): t is Extract<TraceEvent, { type: 'quant' }> => t.type === 'quant'),
  };
  return h;
}

export type QuantHarness = ReturnType<typeof quantHarness>;
