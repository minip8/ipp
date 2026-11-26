/**
 * The interviewer's side of a quant round: turns a trigger into (at most) one model call and then
 * into exactly one `applyQuantStep`, or into nothing. The server keeps every book (current
 * question, hints, follow-up, nudge, time, verdicts) and refuses any step its books do not allow;
 * this module only decides what to say and which step to ask for, and keeps a mirror of the round's
 * version, phase and clock so the pump knows when the clock requires something.
 *
 * Per pass of the pad's pump, in this order:
 *  1. a candidate message (replies first, as for coding pads): a `turn` or a `close` (forced when
 *     the clock is up); before the first question, the opening (`start`); after the round, a
 *     plain message;
 *  2. the clock (`quantDue`): a nudge (`turn` with `nudge`), or a close for time
 *     (`close` by `timeout` / `round_time`), which happen with or without a usable model;
 *  3. the policy's moments: the greeting (the opening and `start`) and stalls (usually silent).
 *
 * Failure rules: a failed, refused or unparseable call on a candidate message gets the canned
 * reply and changes nothing; a close the clock requires still closes, with a canned line and no
 * verdict; a candidate message aborts an in-flight clock turn and its reply does what the clock
 * required; a step refused because the round moved on (`stale`, …) posts nothing, and one refused
 * for its own content gets the canned reply.
 */
import type {
  AiProvider,
  Pad,
  QuantClock,
  QuantPhase,
  QuantStep,
  QuantStepResult,
  QuantVerdict,
  ReportAssessment,
} from '@ipp/contracts';
import { ModelError, type ModelRequest, type ModelResponse } from '../model';
import * as policy from '../policy';
import type { AiScope, InterviewerDeps, QuantContext, ResolvedKey } from '../types';
import {
  QuantAssessmentSchema,
  quantAssessmentRequest,
  toQuantAssessment,
  verdictRequest,
} from './assessment';
import { budgetUp, closingEndsRound, QUANT_RETRY_MS, type QuantDue, quantDue } from './clock';
import { parseModelJson } from './latex';
import {
  afterRoundTask,
  forcedCloseTask,
  nudgeTask,
  openingTask,
  quantMessages,
  quantStateText,
  quantSystem,
  replyTask,
  stallTask,
} from './prompts';
import {
  normaliseTurn,
  parseTurn,
  type QuantMove,
  type QuantTurn,
  QuantTurnSchema,
  QuantVerdictSchema,
  sayOf,
  type TurnBooks,
  verdictOf,
} from './turn';

type UsableKey = Extract<ResolvedKey, { ok: true }>;

/**
 * Call settings. Every live call (replies, the opening, nudges, stalls, closes for time) uses the
 * same effort and the same schema: a change of either would invalidate the cached prefix.
 */
export const QUANT_CALLS = {
  turn: { effort: 'medium', maxTokens: 8_000, timeoutMs: 60_000 },
  verdict: { effort: 'medium', maxTokens: 8_000, timeoutMs: 90_000 },
  assessment: { effort: 'high', maxTokens: 32_000, timeoutMs: 240_000 },
} as const;

/** Refusals that mean the round moved on under a turn, as opposed to the turn being wrong. */
const MOVED_ON: ReadonlySet<string> = new Set(['stale', 'ended', 'wrong_index', 'wrong_phase']);

/** What is said when the model cannot say it (no key, out of budget, failed or refused). */
export const QUANT_MESSAGES = {
  opening:
    "Welcome. I'll ask you a few quant questions, one at a time, and each one will appear on your screen. Think out loud as you go and use the scratchpad for working. Here's the first.",
  nudge: "We're at the time I'd planned for this one. What's your best answer?",
  timeout: "That's time on this one. Let's move on.",
  timeoutLast:
    "That's time on this one, and that was the last question. Thanks for working through these with me; the written report has the full solutions.",
  roundTime:
    "We're out of time for the round, so let's stop there. Thanks for working through these with me; the written report has the full solutions and feedback.",
  moveOn: "Thanks. Let's move on.",
  wrapUp:
    'That was the last question. Thanks for working through these with me; the written report has the full solutions and feedback.',
  refused: "Let's keep our focus on the question. Where are you with it right now?",
} as const;

/**
 * What a close says when the model did not word it: the round's end, the last question, or
 * moving on. Also what the API says when it closes an unattended question for time (its sweeper).
 */
export function cannedCloseLine(
  by: 'interviewer' | 'timeout' | 'round_time',
  clock: QuantClock | null,
  total: number,
  now: number,
): string {
  if (by === 'round_time') return QUANT_MESSAGES.roundTime;
  const last = closingEndsRound(clock, total, now);
  if (by === 'timeout') return last ? QUANT_MESSAGES.timeoutLast : QUANT_MESSAGES.timeout;
  return last ? QUANT_MESSAGES.wrapUp : QUANT_MESSAGES.moveOn;
}

/** The round as this pad's runtime last saw it (refreshed by every context load and step). */
export interface QuantMirror {
  version: number;
  phase: QuantPhase;
  clock: QuantClock | null;
  total: number;
  /** The clock action last attempted, so a failed or refused one waits before it is tried again. */
  attempted: { key: string; at: number } | null;
}

/** The parts of the interviewer's per-pad runtime the round uses. */
export interface QuantPad {
  padId: string;
  policy: policy.PolicyState;
  replyQueue: { text: string; via: 'text' | 'voice'; at: number }[];
  epoch: number;
  inflight: AbortController | null;
  inflightKind: 'decision' | 'reply' | null;
  released: boolean;
  keyId: string | null;
  silentDecisions: { at: number; kind: string; reason: string }[];
  quant: QuantMirror | null;
}

export type QuantTraceEvent = {
  type: 'quant';
  /** reply, opening, nudge, timeout, round_time, stall, after_round, verdict, assessment */
  trigger: string;
  outcome: 'applied' | 'silent' | 'refused' | 'canned' | 'failed' | 'discarded' | 'dropped';
  /** The step asked for (`turn:hint`, `close:timeout`, …). */
  step?: string;
  why?: string;
  turn?: QuantTurn | null;
  latencyMs?: number;
  ttftMs?: number | null;
  usage?: ModelResponse['usage'];
  model?: string;
};

/** What the orchestrator lends the round (interviewer.ts). */
export interface QuantCore<R extends QuantPad> {
  deps: InterviewerDeps;
  now(): number;
  callModel(
    scope: AiScope,
    key: UsableKey,
    req: ModelRequest,
    model?: string,
  ): Promise<ModelResponse>;
  padKey(rt: R): Promise<UsableKey | null>;
  budgetOk(rt: R, kind: 'chat' | 'proactive'): Promise<boolean>;
  padModel(rt: R | undefined, ctx: { pad: Pad }, key: UsableKey): string;
  keyRejectedNotice(rt: R, key: UsableKey): Promise<void>;
  /** When the key's breaker opens again (after failures), or null. */
  backoffUntil(keyId: string | null): number | null;
  note(padId: string, text: string): Promise<void>;
  trace(padId: string, e: QuantTraceEvent): void;
  runtimeOf(padId: string): R | undefined;
  messages: { replyFailed: string; rateLimited(provider: AiProvider): string };
  /**
   * Voice: wait this long (real time) after a spoken message for more of it before replying,
   * and merge what arrives. 0 replies at once.
   */
  voiceSettleMs: number;
}

type CallResult =
  | { ok: true; turn: QuantTurn; res: ModelResponse }
  | {
      ok: false;
      why: 'aborted' | 'failed' | 'refused' | 'invalid' | 'key';
      error?: ModelError;
      res?: ModelResponse;
    };

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export function createQuantRuntime<R extends QuantPad>(core: QuantCore<R>) {
  const { deps } = core;

  // ------------------------------------------------------------ context and mirror

  function mirror(rt: R, ctx: QuantContext): void {
    const s = rt.policy;
    s.settings = { ...ctx.pad.interviewer };
    s.startedAt = Date.parse(ctx.pad.startedAt);
    // The round has its own clock: the policy raises no clock checkpoints and no code checks.
    s.durationMs = null;
    s.quant = true;
    if (ctx.pad.status !== 'active') s.ended = true;
    if (ctx.round.phase === 'finished') s.wrappedUp = true;
    const m = rt.quant;
    rt.quant = {
      version: ctx.round.version,
      phase: ctx.round.phase,
      clock: ctx.round.clock,
      total: ctx.round.total,
      attempted: m?.attempted ?? null,
    };
    // The round moved on without this runtime (the API closed the question for time while
    // nobody was connected): the question on the screen is a fresh start, as after a step.
    const c = ctx.round.clock;
    if (m && c && c.index !== (m.clock?.index ?? null)) freshQuestion(rt, c.posedAt);
  }

  /** A new question is on the screen (posed at `at`): stalls and the unanswered count start over. */
  function freshQuestion(rt: R, at: number): void {
    const s = rt.policy;
    s.lastInterviewerMsgAt = Math.max(s.lastInterviewerMsgAt ?? 0, at);
    s.unanswered = 0;
    s.stallLevel = 0;
    s.pending = s.pending.filter((p) => p.kind !== 'stall');
  }

  /** First work for a quant pad: rebuild the policy's view from the round and the transcript. */
  function hydrate(rt: R, ctx: QuantContext): void {
    mirror(rt, ctx);
    const s = rt.policy;
    const t = (m: { createdAt: string }) => Date.parse(m.createdAt);
    const said = ctx.transcript.filter((m) => m.role === 'interviewer' && m.intent !== 'question');
    const lastCandidate = [...ctx.transcript].reverse().find((m) => m.role === 'candidate');
    const lastInterviewer = ctx.transcript.filter((m) => m.role === 'interviewer').at(-1);
    // A restart never greets twice: the round has started, or something was already said.
    if (ctx.round.phase !== 'pending' || said.length) s.greeted = true;
    // Otherwise this runtime opens the round itself. The host raises `session_started` once per
    // pad, so a runtime that starts after it (the API restarted, or the last socket closed while
    // the opening was in flight) would otherwise leave the round unstarted, its clock running,
    // until the candidate wrote something.
    else policy.observe(s, { type: 'session_started' }, core.now());
    if (lastInterviewer)
      s.lastInterviewerMsgAt = Math.max(s.lastInterviewerMsgAt ?? 0, t(lastInterviewer));
    if (lastCandidate) s.lastCandidateMsgAt = Math.max(s.lastCandidateMsgAt ?? 0, t(lastCandidate));
    if (s.unanswered === 0) {
      let n = 0;
      for (let i = ctx.transcript.length - 1; i >= 0; i--) {
        const m = ctx.transcript[i];
        if (!m || m.role === 'candidate') break;
        if (m.kind === 'proactive' && m.intent !== 'greeting' && m.intent !== 'question') n++;
      }
      s.unanswered = n;
    }
    if (lastCandidate) s.lastActivityAt = Math.max(s.lastActivityAt ?? 0, t(lastCandidate));
    s.lastActivityAt ??= s.startedAt;
  }

  async function load(rt: R): Promise<QuantContext | null> {
    try {
      const ctx = (await deps.loadQuantContext?.(rt.padId, 'current')) ?? null;
      if (!ctx) return null;
      mirror(rt, ctx);
      if (ctx.pad.status !== 'active' || !ctx.pad.interviewer.enabled) return null;
      return ctx;
    } catch (err) {
      deps.log.warn({ padId: rt.padId, err: String(err) }, 'loadQuantContext failed');
      return null;
    }
  }

  const booksOf = (entry: QuantContext['questions'][number]): TurnBooks => ({
    hintRungs: entry.hintRungs,
    hintsAvailable: (entry.kind === 'game' ? entry.game.hints : (entry.question.hints ?? []))
      .length,
    followUpAsked: entry.followUpAsked,
  });

  function stateOf(rt: R, ctx: QuantContext): string {
    return quantStateText(ctx, {
      now: core.now(),
      lastScratchAt: rt.policy.lastCodeChangeAt,
      lastCandidateMsgAt: rt.policy.lastCandidateMsgAt,
      unanswered: rt.policy.unanswered,
      silentDecisions: rt.silentDecisions.slice(-4),
    });
  }

  // ------------------------------------------------------------ the model call

  async function call(
    rt: R,
    ctx: QuantContext,
    key: UsableKey,
    o: { task: string; inflight: 'reply' | 'decision'; extra?: QuantPad['replyQueue'] },
  ): Promise<CallResult> {
    const abort = new AbortController();
    rt.inflight = abort;
    rt.inflightKind = o.inflight;
    try {
      const res = await core.callModel(
        { padId: rt.padId },
        key,
        {
          purpose: 'turn',
          system: quantSystem(ctx),
          messages: quantMessages(ctx, { state: stateOf(rt, ctx), task: o.task, extra: o.extra }),
          ...QUANT_CALLS.turn,
          schema: QuantTurnSchema,
          signal: abort.signal,
        },
        core.padModel(rt, ctx, key),
      );
      if (res.refused) return { ok: false, why: 'refused', res };
      const turn = parseTurn(res.text);
      return turn ? { ok: true, turn, res } : { ok: false, why: 'invalid', res };
    } catch (err) {
      const e = err instanceof ModelError ? err : new ModelError('transient', String(err));
      if (e.kind === 'aborted') return { ok: false, why: 'aborted', error: e };
      if (e.keyFailure && e.keyFailure !== 'rate_limited') {
        await core.keyRejectedNotice(rt, key);
        return { ok: false, why: 'key', error: e };
      }
      return { ok: false, why: 'failed', error: e };
    } finally {
      rt.inflight = null;
      rt.inflightKind = null;
    }
  }

  const perf = (r: CallResult | null) => {
    const res = r?.res;
    return res
      ? { latencyMs: res.latencyMs, ttftMs: res.ttftMs, usage: res.usage, model: res.model }
      : {};
  };

  // ------------------------------------------------------------ steps

  const stepName = (step: QuantStep) =>
    step.type === 'turn'
      ? `turn:${step.action}${step.action === 'hint' ? `:${step.hintRung}` : ''}${step.nudge ? ':nudge' : ''}`
      : step.type === 'close'
        ? `close:${step.by}`
        : step.type;

  /** Asks the round to take one step; updates the mirror and the policy when it is taken. */
  async function apply(
    rt: R,
    step: QuantStep,
    trace: Omit<QuantTraceEvent, 'type' | 'outcome'>,
    canned = false,
  ): Promise<QuantStepResult | null> {
    if (!deps.applyQuantStep) {
      deps.log.warn({ padId: rt.padId }, 'quant pad without applyQuantStep');
      return null;
    }
    let res: QuantStepResult;
    try {
      res = await deps.applyQuantStep(rt.padId, step);
    } catch (err) {
      deps.log.warn({ padId: rt.padId, err: String(err) }, 'applyQuantStep failed');
      core.trace(rt.padId, {
        type: 'quant',
        ...trace,
        outcome: 'failed',
        step: stepName(step),
        why: String(err),
      });
      return null;
    }
    if (!res.ok) {
      // Nothing changed and nothing was posted: the message is dropped.
      core.trace(rt.padId, {
        type: 'quant',
        ...trace,
        outcome: 'refused',
        step: stepName(step),
        why: res.reason,
      });
      deps.log.info({ padId: rt.padId, step: step.type, reason: res.reason }, 'quant step refused');
      return res;
    }
    const s = rt.policy;
    const t = core.now();
    const m = rt.quant;
    const before = m?.clock?.index ?? null;
    rt.quant = {
      version: res.version,
      phase: res.phase,
      clock: res.clock,
      total: m?.total ?? 0,
      attempted: m?.attempted ?? null,
    };
    const said = 'say' in step && step.say !== null && step.say.trim() !== '';
    if (said) policy.onInterviewerMessage(s, t, step.type === 'turn' && step.kind === 'proactive');
    if (step.type === 'start') s.greeted = true;
    // A new question is on the screen: a fresh start for stalls and the unanswered count.
    if (res.clock && res.clock.index !== before) freshQuestion(rt, t);
    if (res.phase === 'finished') s.wrappedUp = true;
    core.trace(rt.padId, {
      type: 'quant',
      ...trace,
      outcome: canned ? 'canned' : 'applied',
      step: stepName(step),
    });
    return res;
  }

  /** The step a move asks for. A close without a closing line gets a canned one. */
  function stepOf(
    ctx: QuantContext,
    move: Exclude<QuantMove, { type: 'silent' } | { type: 'invalid' }>,
    o: { kind: 'chat' | 'proactive'; nudge: boolean; note: string },
  ): QuantStep {
    const entry = ctx.questions[0] as QuantContext['questions'][number];
    const note = o.note.trim() || undefined;
    if (move.type === 'close') {
      return {
        type: 'close',
        version: ctx.round.version,
        index: entry.index,
        kind: o.kind,
        by: move.by,
        say: move.say || cannedClose(ctx, move.by),
        verdict: move.verdict,
        note,
      };
    }
    return {
      type: 'turn',
      version: ctx.round.version,
      index: entry.index,
      kind: o.kind,
      say: move.say,
      action: move.action,
      ...(move.action === 'hint' ? { hintRung: move.hintRung ?? 0 } : {}),
      ...(o.nudge ? { nudge: true } : {}),
      note,
    };
  }

  const cannedClose = (ctx: QuantContext, by: 'interviewer' | 'timeout' | 'round_time') =>
    cannedCloseLine(by, ctx.round.clock, ctx.round.total, core.now());

  async function saveCanned(rt: R, text: string): Promise<void> {
    try {
      await deps.saveMessage(rt.padId, { kind: 'chat', intent: 'answer', text });
      policy.onInterviewerMessage(rt.policy, core.now(), false);
    } catch (err) {
      deps.log.warn({ padId: rt.padId, err: String(err) }, 'saveMessage failed');
    }
  }

  const thinking = (rt: R, active: boolean) =>
    deps.emit(rt.padId, { type: 'interviewer.thinking', active });

  // ------------------------------------------------------------ the pump

  async function pump(rt: R): Promise<void> {
    for (;;) {
      if (rt.released || rt.policy.ended) return;
      if (rt.replyQueue.length > 0) {
        await reply(rt);
        continue;
      }
      const t = core.now();
      const due = quantDue(rt.quant?.clock ?? null, t);
      if (due && mayAttempt(rt, due, t)) {
        await clockTurn(rt, due);
        continue;
      }
      rt.policy.backoffUntil = core.backoffUntil(rt.keyId);
      const m = policy.poll(rt.policy, t);
      if (!m) return;
      policy.take(rt.policy, m);
      if (m.kind === 'greeting') await greeting(rt, m);
      else if (m.kind === 'stall') await stall(rt, m);
      else
        core.trace(rt.padId, {
          type: 'quant',
          trigger: m.kind,
          outcome: 'dropped',
          why: 'not a quant moment',
        });
    }
  }

  function mayAttempt(rt: R, due: QuantDue, t: number): boolean {
    const m = rt.quant;
    const c = m?.clock;
    if (!m || !c) return false;
    // Someone just spoke: their reply (which carries the nudge) comes first.
    const s = rt.policy;
    if (
      due === 'nudge' &&
      s.lastCandidateMsgAt !== null &&
      t - s.lastCandidateMsgAt < policy.CONST.candidateTalkingMs
    )
      return false;
    const key = `${c.index}:${due}`;
    if (m.attempted && m.attempted.key === key && t - m.attempted.at < QUANT_RETRY_MS) return false;
    m.attempted = { key, at: t };
    return true;
  }

  // ------------------------------------------------------------ replies

  async function settle(rt: R): Promise<void> {
    if (core.voiceSettleMs <= 0 || rt.replyQueue.at(-1)?.via !== 'voice') return;
    // Speech arrives in pieces: give the next piece a moment, and merge whatever arrives.
    for (let i = 0; i < 4; i++) {
      const n = rt.replyQueue.length;
      await sleep(core.voiceSettleMs);
      if (rt.released || rt.replyQueue.length === n) return;
    }
  }

  async function reply(rt: R): Promise<void> {
    await settle(rt);
    const queued = rt.replyQueue.splice(0);
    const via = queued.at(-1)?.via ?? 'text';
    if (!queued.length) return;
    const key = await core.padKey(rt);
    if (!key) return;
    thinking(rt, true);
    try {
      if (!(await core.budgetOk(rt, 'chat'))) return;
      const ctx = await load(rt);
      if (!ctx) return;
      if (ctx.round.phase === 'pending') return await opening(rt, ctx, key, queued);
      if (ctx.round.phase === 'finished') return await afterRound(rt, ctx, key, queued, via);
      const entry = ctx.questions[0];
      const clock = ctx.round.clock;
      if (!entry || !clock) {
        deps.log.warn({ padId: rt.padId }, 'quant context without a current question');
        return;
      }
      const t = core.now();
      const due = quantDue(clock, t);
      const forced = due === 'timeout' || due === 'round_time' ? due : null;
      const nudge = !forced && !clock.nudged && budgetUp(clock, t);
      const voice = via === 'voice' || ctx.pad.interviewer.voice;
      const r = await call(rt, ctx, key, {
        task: replyTask({ via, voice, nudge, forced }),
        inflight: 'reply',
        extra: queued,
      });
      if (rt.released) return;
      const base = { trigger: 'reply', ...perf(r) };
      if (!r.ok) {
        if (r.why === 'aborted') return;
        core.trace(rt.padId, {
          type: 'quant',
          ...base,
          outcome: 'failed',
          why: r.why,
          turn: null,
        });
        if (forced) {
          // The clock does not wait for the model.
          await apply(
            rt,
            stepOf(
              ctx,
              { type: 'close', by: forced, say: '', verdict: null },
              { kind: 'chat', nudge: false, note: '' },
            ),
            base,
            true,
          );
          return;
        }
        if (r.why === 'key') return;
        await saveCanned(
          rt,
          r.why === 'refused'
            ? QUANT_MESSAGES.refused
            : r.error?.keyFailure === 'rate_limited'
              ? core.messages.rateLimited(key.provider)
              : core.messages.replyFailed,
        );
        return;
      }
      const move = normaliseTurn(r.turn, booksOf(entry), { forced, via, fallback: null });
      if (move.type === 'invalid') {
        core.trace(rt.padId, {
          type: 'quant',
          ...base,
          outcome: 'failed',
          why: move.why,
          turn: r.turn,
        });
        await saveCanned(rt, core.messages.replyFailed);
        return;
      }
      if (move.type === 'silent') {
        if (r.turn.note.trim()) await core.note(rt.padId, r.turn.note.trim());
        core.trace(rt.padId, { type: 'quant', ...base, outcome: 'silent', turn: r.turn });
        return;
      }
      const res = await apply(
        rt,
        stepOf(ctx, move, {
          kind: 'chat',
          nudge: nudge && move.type === 'turn',
          note: r.turn.note,
        }),
        { ...base, turn: r.turn },
      );
      // The round could not be written at all, or it refused the step for a reason of its own
      // (a hint the books do not allow, say): still answer them. When the round has simply moved
      // on (another write won, the question closed, the pad ended) someone has just spoken, and a
      // "say that again" under the next question would only confuse.
      if (res === null || (res.ok === false && !MOVED_ON.has(res.reason)))
        await saveCanned(rt, core.messages.replyFailed);
    } finally {
      thinking(rt, false);
    }
  }

  /** Before the first question: the opening, then `start` (which posts question 1). */
  async function opening(
    rt: R,
    ctx: QuantContext,
    key: UsableKey | null,
    queued: QuantPad['replyQueue'],
  ): Promise<void> {
    const voice = queued.at(-1)?.via === 'voice' || ctx.pad.interviewer.voice;
    let say: string = QUANT_MESSAGES.opening;
    let note: string | undefined;
    let r: CallResult | null = null;
    if (key && (queued.length > 0 || (await core.budgetOk(rt, 'proactive')))) {
      const epoch = rt.epoch;
      r = await call(rt, ctx, key, {
        task: openingTask({ voice, candidateSpoke: queued.length > 0 }),
        // The greeting moment gives way to a candidate message, whose reply opens instead.
        inflight: queued.length > 0 ? 'reply' : 'decision',
        extra: queued,
      });
      if (r.ok === false && r.why === 'aborted') return;
      if (queued.length === 0 && (rt.epoch !== epoch || rt.replyQueue.length > 0)) return;
      if (r.ok) {
        const text = sayOf(r.turn.message);
        if (text) say = text;
        note = r.turn.note.trim() || undefined;
      }
    }
    if (rt.released || rt.policy.ended) return;
    await apply(
      rt,
      { type: 'start', version: ctx.round.version, say, note },
      { trigger: 'opening', ...perf(r), turn: r?.ok ? r.turn : null },
      !r?.ok,
    );
  }

  /** After the round: a plain reply (no step: the round's books are closed). */
  async function afterRound(
    rt: R,
    ctx: QuantContext,
    key: UsableKey,
    queued: QuantPad['replyQueue'],
    via: 'text' | 'voice',
  ): Promise<void> {
    const voice = via === 'voice' || ctx.pad.interviewer.voice;
    const r = await call(rt, ctx, key, {
      task: afterRoundTask({ via, voice }),
      inflight: 'reply',
      extra: queued,
    });
    if (rt.released) return;
    if (!r.ok) {
      if (r.why === 'aborted' || r.why === 'key') return;
      await saveCanned(
        rt,
        r.why === 'refused' ? QUANT_MESSAGES.refused : core.messages.replyFailed,
      );
      return;
    }
    const text = sayOf(r.turn.message);
    if (!text || (r.turn.action === 'silent' && via === 'voice')) {
      core.trace(rt.padId, {
        type: 'quant',
        trigger: 'after_round',
        outcome: 'silent',
        ...perf(r),
      });
      if (!text && via === 'text') await saveCanned(rt, core.messages.replyFailed);
      return;
    }
    await saveCanned(rt, text);
    core.trace(rt.padId, {
      type: 'quant',
      trigger: 'after_round',
      outcome: 'applied',
      turn: r.turn,
      ...perf(r),
    });
  }

  // ------------------------------------------------------------ the clock

  async function clockTurn(rt: R, due: QuantDue): Promise<void> {
    const ctx = await load(rt);
    if (!ctx) return;
    const entry = ctx.questions[0];
    const clock = ctx.round.clock;
    const t = core.now();
    // The fresh context decides; a candidate message waiting is answered first (and does this).
    if (!entry || !clock || quantDue(clock, t) !== due || rt.replyQueue.length > 0) return;
    const forced = due === 'nudge' ? null : due;
    const voice = ctx.pad.interviewer.voice;
    const key = await core.padKey(rt);
    let r: CallResult | null = null;
    let move: QuantMove | null = null;
    const usable =
      key !== null &&
      (core.backoffUntil(key.keyId) ?? 0) <= t &&
      (await core.budgetOk(rt, 'proactive'));
    if (key && usable) {
      const epoch = rt.epoch;
      thinking(rt, true);
      try {
        r = await call(rt, ctx, key, {
          task: forced ? forcedCloseTask(forced, voice) : nudgeTask(voice),
          inflight: 'decision',
        });
      } finally {
        thinking(rt, false);
      }
      if (rt.released || rt.policy.ended) return;
      if ((r.ok === false && r.why === 'aborted') || rt.epoch !== epoch || rt.replyQueue.length) {
        // The candidate spoke: their reply does what the clock required.
        core.trace(rt.padId, {
          type: 'quant',
          trigger: due,
          outcome: 'discarded',
          why: 'candidate spoke meanwhile',
          ...perf(r),
        });
        return;
      }
      if (r.ok)
        move = normaliseTurn(r.turn, booksOf(entry), {
          forced,
          via: null,
          fallback: forced ? null : QUANT_MESSAGES.nudge,
        });
    }
    const canned = !move || move.type === 'silent' || move.type === 'invalid';
    const final: Exclude<QuantMove, { type: 'silent' } | { type: 'invalid' }> =
      move && move.type !== 'silent' && move.type !== 'invalid'
        ? move
        : forced
          ? { type: 'close', by: forced, say: '', verdict: null }
          : { type: 'turn', action: 'stay', say: QUANT_MESSAGES.nudge };
    await apply(
      rt,
      stepOf(ctx, final, {
        kind: 'proactive',
        nudge: !forced && final.type === 'turn',
        note: r?.ok ? r.turn.note : '',
      }),
      {
        trigger: due,
        ...perf(r),
        turn: r?.ok ? r.turn : null,
        ...(canned ? { why: r ? (r.ok ? 'nothing usable' : r.why) : 'no usable model' } : {}),
      },
      canned,
    );
  }

  // ------------------------------------------------------------ the policy's moments

  async function greeting(rt: R, m: policy.Moment): Promise<void> {
    policy.markConsidered(rt.policy, m, core.now());
    const ctx = await load(rt);
    if (ctx?.round.phase !== 'pending' || rt.replyQueue.length > 0) {
      core.trace(rt.padId, {
        type: 'quant',
        trigger: 'opening',
        outcome: 'dropped',
        why: !ctx ? 'no context' : rt.replyQueue.length ? 'candidate message' : 'already started',
      });
      return;
    }
    // Without a usable model the round still starts: the clock is already running.
    const key = await core.padKey(rt);
    thinking(rt, true);
    try {
      await opening(rt, ctx, key, []);
      // The opening is not an unanswered nudge.
      rt.policy.unanswered = 0;
    } finally {
      thinking(rt, false);
    }
  }

  async function stall(rt: R, m: policy.Moment): Promise<void> {
    const s = rt.policy;
    const key = await core.padKey(rt);
    if (!key) return;
    if (!(await core.budgetOk(rt, 'proactive'))) return;
    const ctx = await load(rt);
    const entry = ctx?.questions[0];
    if (
      ctx?.round.phase !== 'asking' ||
      !entry ||
      rt.replyQueue.length > 0 ||
      // The question changed since the stall was noticed (closed for time while nobody was
      // connected): the candidate has not been stuck on this one.
      (ctx.round.clock?.posedAt ?? 0) > m.createdAt
    ) {
      core.trace(rt.padId, { type: 'quant', trigger: 'stall', outcome: 'dropped' });
      return;
    }
    policy.markConsidered(s, m, core.now());
    const epoch = rt.epoch;
    const decidedFrom = core.now();
    const r = await call(rt, ctx, key, {
      task: stallTask(m.detail, ctx.pad.interviewer.voice),
      inflight: 'decision',
    });
    const base = { trigger: 'stall', ...perf(r) };
    if (!r.ok) {
      core.trace(rt.padId, { type: 'quant', ...base, outcome: 'failed', why: r.why });
      return;
    }
    const move = normaliseTurn(r.turn, booksOf(entry), { forced: null, via: null, fallback: null });
    if (move.type === 'silent' || move.type === 'invalid') {
      rt.silentDecisions.push({ at: core.now(), kind: 'stall', reason: r.turn.reason });
      if (rt.silentDecisions.length > 8) rt.silentDecisions.shift();
      if (r.turn.note.trim()) await core.note(rt.padId, r.turn.note.trim());
      core.trace(rt.padId, { type: 'quant', ...base, outcome: 'silent', turn: r.turn });
      return;
    }
    if (
      rt.epoch !== epoch ||
      rt.replyQueue.length > 0 ||
      !policy.stillAppropriate(s, m, core.now(), decidedFrom)
    ) {
      core.trace(rt.padId, {
        type: 'quant',
        ...base,
        outcome: 'discarded',
        why: 'candidate resumed',
        turn: r.turn,
      });
      return;
    }
    await apply(rt, stepOf(ctx, move, { kind: 'proactive', nudge: false, note: r.turn.note }), {
      ...base,
      turn: r.turn,
    });
  }

  // ------------------------------------------------------------ the assessment

  async function judge(
    padId: string,
    ctx: QuantContext,
    entry: QuantContext['questions'][number],
    key: UsableKey,
    model: string,
  ): Promise<QuantVerdict | null> {
    try {
      const closed = ctx.round.closed.find((c) => c.index === entry.index);
      const req = verdictRequest(ctx, entry, closed);
      const res = await core.callModel(
        { padId },
        key,
        { purpose: 'assessment', ...req, ...QUANT_CALLS.verdict, schema: QuantVerdictSchema },
        model,
      );
      if (res.refused) return null;
      const out = QuantVerdictSchema.safeParse(parseModelJson(res.text));
      return out.success ? verdictOf(out.data.score, out.data.summary) : null;
    } catch (err) {
      deps.log.warn(
        { padId, index: entry.index, err: err instanceof Error ? err.message : String(err) },
        'quant verdict failed',
      );
      return null;
    }
  }

  async function assess(padId: string): Promise<ReportAssessment | null> {
    try {
      if (!deps.loadQuantContext) return null;
      const key = await deps.resolveKey({ padId });
      if (!key.ok) {
        deps.log.info({ padId, key: key.state }, 'quant assessment skipped: no usable key');
        return null;
      }
      const budget = await deps.checkBudget(padId);
      if (!budget.ok) {
        deps.log.info({ padId, reason: budget.reason }, 'quant assessment skipped: budget');
        return null;
      }
      const ctx = await deps.loadQuantContext(padId, 'all');
      if (!ctx) return null;
      const model = core.padModel(core.runtimeOf(padId), ctx, key);
      const verdicts = new Map<number, QuantVerdict | null>(
        ctx.round.closed.map((c) => [c.index, c.verdict]),
      );
      let version = ctx.round.version;
      // Every question closed without a verdict is judged first, and the verdict is written back.
      for (const c of ctx.round.closed) {
        if (c.verdict) continue;
        const entry = ctx.questions.find((q) => q.index === c.index);
        if (!entry) continue;
        const v = await judge(padId, ctx, entry, key, model);
        if (!v) continue;
        verdicts.set(c.index, v);
        if (!deps.applyQuantStep) continue;
        try {
          let r = await deps.applyQuantStep(padId, {
            type: 'verdict',
            version,
            index: c.index,
            verdict: v,
          });
          if (!r.ok && r.reason === 'stale') {
            const fresh = await deps.loadQuantContext(padId, 'all');
            if (fresh) {
              version = fresh.round.version;
              r = await deps.applyQuantStep(padId, {
                type: 'verdict',
                version,
                index: c.index,
                verdict: v,
              });
            }
          }
          if (r.ok) version = r.version;
          else deps.log.info({ padId, index: c.index, reason: r.reason }, 'verdict step refused');
        } catch (err) {
          deps.log.warn({ padId, err: String(err) }, 'verdict step failed');
        }
      }
      const req = quantAssessmentRequest(ctx, verdicts);
      const res = await core.callModel(
        { padId },
        key,
        { purpose: 'assessment', ...req, ...QUANT_CALLS.assessment, schema: QuantAssessmentSchema },
        model,
      );
      if (res.refused) return null;
      const out = QuantAssessmentSchema.safeParse(parseModelJson(res.text));
      if (!out.success) throw new Error('unparseable quant assessment');
      return toQuantAssessment(out.data);
    } catch (err) {
      deps.log.error(
        { padId, err: err instanceof Error ? err.message : String(err) },
        'quant assessment failed',
      );
      return null;
    }
  }

  return { hydrate, pump, assess };
}
