/**
 * Orchestrator: per-pad serialized work queue, policy -> model -> emit/save.
 *
 * - `handle` updates policy state synchronously and returns; work runs on a per-pad pump.
 * - Candidate messages always get a streamed reply and take priority: an in-flight proactive
 *   decision is aborted and its result discarded (epoch check), so two replies never overlap.
 * - Proactive moments come from the policy; the model makes a structured speak/stay-silent call.
 * - A quant pad (the pad's format, learned in `hydrate` from `loadQuantContext`) runs the same
 *   pump, queue, keys and budget through the round runtime in ./quant/round.ts instead.
 */
import { randomUUID } from 'node:crypto';
import {
  AI_PROVIDERS,
  type AiModelChoice,
  type AiProvider,
  type DiscussionTurn,
  effectiveModel,
  type Message,
  MessageIntent,
  problemScaffold,
  QuantSecondOpinion,
  type QuizQuestion,
  REPORT_DIMENSIONS,
  ReportAssessment,
  SolutionReview,
} from '@ipp/contracts';
import { z } from 'zod';
import { type ModelClient, ModelError, type ModelRequest, type ModelResponse } from './model';
import * as policy from './policy';
import {
  assessmentMessages,
  buildMessages,
  DISCUSSION_SYSTEM,
  decisionTask,
  discussionPrompt,
  GRADING_SYSTEM,
  gradingPrompt,
  greetingTask,
  replyTask,
  runFact,
  type SessionEvent,
  stateText,
  systemBlocks,
} from './prompts';
import { createModelClient, defaultModelFor } from './providers';
import { QuantAssessmentSchema, toQuantAssessment } from './quant/assessment';
import { parseModelJson, repairLatexEscapes } from './quant/latex';
import { createQuantRuntime, type QuantMirror, type QuantTraceEvent } from './quant/round';
import {
  quantRoomAssessmentMessages,
  quantRoomReviewMessages,
  quantRoomSystem,
} from './quant-room-prompts';
import { reviewMessages, roomAssessmentMessages, roomSystem } from './room-prompts';
import type {
  AiScope,
  DiscussionStep,
  InterviewContext,
  Interviewer,
  InterviewerConfig,
  InterviewerDeps,
  ModelUsage,
  QuantReviewResult,
  ResolvedKey,
  ReviewResult,
  ShortAnswerGrade,
  Trigger,
} from './types';

type UsableKey = Extract<ResolvedKey, { ok: true }>;

// ---------------------------------------------------------------- schemas for structured output

export const DecisionSchema = z.object({
  reason: z.string(),
  speak: z.boolean(),
  /** `question` is posed by the server in a quant round, never chosen by a decision. */
  intent: MessageIntent.exclude(['question']),
  message: z.string(),
  note: z.string(),
});
export type Decision = z.infer<typeof DecisionSchema>;

const Dimension = z.object({ score: z.number().int(), evidence: z.string() });
export const AssessmentSchema = z.object({
  recommendation: ReportAssessment.shape.recommendation,
  summary: z.string(),
  scores: z.object({
    problem_solving: Dimension,
    coding: Dimension,
    communication: Dimension,
    testing: Dimension,
    complexity_analysis: Dimension,
  }),
  strengths: z.array(z.string()),
  improvements: z.array(z.string()),
});

export const GradeSchema = z.object({
  key_points: z.array(
    z.object({ point: z.number().int(), status: z.enum(['covered', 'partial', 'missed']) }),
  ),
  errors: z.array(z.string()),
  feedback: z.string(),
});

export const DiscussSchema = GradeSchema.extend({ follow_up: z.string() });

export const ReviewSchema = z.object({
  verdict: SolutionReview.shape.verdict,
  summary: z.string(),
  issues: z.array(z.string()),
  complexity: z.string(),
  follow_ups: z.array(z.string()),
  answer: z.string(),
});

/** A quant room's second opinion on one question (`QuantSecondOpinion`). */
export const QuantRoomReviewSchema = z.object({
  verdict: QuantSecondOpinion.shape.verdict,
  summary: z.string(),
  covered: z.array(z.string()),
  missing: z.array(z.string()),
  follow_ups: z.array(z.string()),
  /** 0..1, or -1 when there is nothing to score yet. */
  suggested_score: z.number(),
  answer: z.string(),
});

// ---------------------------------------------------------------- call settings per purpose (§7)

export const CALLS = {
  decision: { effort: 'low', maxTokens: 6_000, timeoutMs: 45_000 },
  reply: { effort: 'medium', maxTokens: 8_000, timeoutMs: 90_000 },
  assessment: { effort: 'high', maxTokens: 32_000, timeoutMs: 240_000 },
  grade: { effort: 'medium', maxTokens: 6_000, timeoutMs: 60_000 },
  review: { effort: 'medium', maxTokens: 8_000, timeoutMs: 90_000 },
} as const;

const MAX_EVENTS = 300;

const MESSAGES = {
  replyFailed:
    'Sorry, I lost my train of thought there for a second (connection hiccup). Could you say that again?',
  refused: "Let's keep our focus on the problem. Where are you with it right now?",
  budget: (reason: string) =>
    `I've hit the AI usage limit for now (${reason}), so I'll stay quiet from here on. The editor, runs and tests all keep working.`,
  keyRejected: (provider: AiProvider) =>
    `${AI_PROVIDERS[provider].label} rejected the API key this pad runs on (it may have been revoked, run out of credit or hit its spend limit), so I'll stay quiet for now. The pad owner can update it under **AI key** in the account menu, and I'll pick up again as soon as they do.`,
  rateLimited: (provider: AiProvider) =>
    `${AI_PROVIDERS[provider].label} is rate-limiting the API key this pad runs on, so I couldn't answer just now. Give it a minute and ask again.`,
  modelUnavailable: (provider: AiProvider, chosen: string, fallback: string) =>
    `The model chosen for this interview (\`${chosen}\`) isn't available with this ${AI_PROVIDERS[provider].label} key, so I'm switching to the default, \`${fallback}\`. The pad owner can pick another model in the interviewer options.`,
};

// ---------------------------------------------------------------- tracing (for the simulator / debugging)

export type TraceEvent =
  | { type: 'hydrated' }
  | { type: 'moment_dropped'; kind: string; why: string }
  | {
      type: 'decision';
      kind: string;
      decision: Decision | null;
      outcome: 'spoke' | 'silent' | 'discarded' | 'invalid';
      why?: string;
      latencyMs: number;
      ttftMs: number | null;
      usage: ModelResponse['usage'];
      model: string;
    }
  | {
      type: 'reply';
      intent: string;
      text: string;
      latencyMs: number;
      ttftMs: number | null;
      usage: ModelResponse['usage'];
      model: string;
    }
  | { type: 'error'; purpose: string; kind: string; message: string }
  | { type: 'budget'; reason: string }
  | { type: 'key'; state: 'active' | 'missing' | 'rejected' }
  | QuantTraceEvent;

export interface InterviewerOptions {
  /**
   * Build the model client for a key and model (tests inject a fake). Defaults to the client of
   * the key's provider (providers.ts).
   */
  clientFor?: (key: { provider: AiProvider; apiKey: string }, model: string) => ModelClient;
  /** Shorthand for tests: use this client whatever the key. */
  modelClient?: ModelClient;
  /** Bounds of the per-key client cache. */
  clientCache?: { max?: number; idleMs?: number };
  trace?: (padId: string, event: TraceEvent) => void;
  /**
   * Quant pads on voice: how long (real time) to wait after a spoken message for the next piece
   * of it before replying; the pieces are answered together. Default 1500 ms; 0 replies at once.
   */
  voiceSettleMs?: number;
}

/** The Interviewer plus test/simulation helpers. */
export interface InterviewerRuntime extends Interviewer {
  /** Resolves when the pad has no queued or running work. */
  idle(padId: string): Promise<void>;
  /** SDK clients currently cached (each holds one user's key in memory). */
  cachedClients(): number;
}

/**
 * Model clients per key id and model, least recently used first. A client holds a decrypted
 * key, so the cache is small, drops clients unused for `idleMs`, and drops every client of a key
 * as soon as that key is refused, replaced or removed.
 */
export class ClientCache {
  private readonly entries = new Map<string, { keyId: string; client: ModelClient; at: number }>();
  private readonly timer: ReturnType<typeof setInterval>;
  constructor(
    private readonly make: (key: UsableKey, model: string) => ModelClient,
    private readonly max = 32,
    private readonly idleMs = 10 * 60_000,
  ) {
    this.timer = setInterval(() => this.sweep(), Math.min(60_000, idleMs));
    this.timer.unref?.();
  }
  get(key: UsableKey, model: string): ModelClient {
    this.sweep();
    const id = `${key.keyId}\u0000${model}`;
    const hit = this.entries.get(id);
    if (hit) {
      this.entries.delete(id);
      hit.at = Date.now();
      this.entries.set(id, hit);
      return hit.client;
    }
    const client = this.make(key, model);
    this.entries.set(id, { keyId: key.keyId, client, at: Date.now() });
    while (this.entries.size > this.max) {
      const oldest = this.entries.keys().next().value as string;
      this.entries.delete(oldest);
    }
    return client;
  }
  /** Every client of this key (all models). */
  drop(keyId: string): void {
    for (const [id, e] of this.entries) if (e.keyId === keyId) this.entries.delete(id);
  }
  sweep(): void {
    const cutoff = Date.now() - this.idleMs;
    for (const [id, e] of this.entries) if (e.at < cutoff) this.entries.delete(id);
  }
  get size(): number {
    return this.entries.size;
  }
}

interface PadRuntime {
  padId: string;
  policy: policy.PolicyState;
  hydrated: boolean;
  events: SessionEvent[];
  replyQueue: { text: string; via: 'text' | 'voice'; at: number }[];
  /** Bumped on every candidate message; a proactive result from an older epoch is discarded. */
  epoch: number;
  inflight: AbortController | null;
  inflightKind: 'decision' | 'reply' | null;
  pump: Promise<void> | null;
  budgetNoticeSent: boolean;
  /** Key id of the last key resolved for this pad (for its backoff), null without a key. */
  keyId: string | null;
  keyState: 'active' | 'missing' | 'rejected' | null;
  /** Key id for which the "your key was rejected" notice was already posted here. */
  keyNoticeFor: string | null;
  /** A chosen model the provider would not serve: this pad uses the provider default instead. */
  unavailableModel: string | null;
  silentDecisions: { at: number; kind: string; reason: string }[];
  runs: number;
  released: boolean;
  /** Set for a quant pad (null for a coding pad): the round as last seen. */
  quant: QuantMirror | null;
}

export function createInterviewer(
  config: InterviewerConfig,
  deps: InterviewerDeps,
  options: InterviewerOptions = {},
): InterviewerRuntime {
  const fixed = options.modelClient;
  const clients = new ClientCache(
    options.clientFor ??
      (fixed ? () => fixed : (k, model) => createModelClient(k.provider, k.apiKey, model)),
    options.clientCache?.max,
    options.clientCache?.idleMs,
  );
  const defaultModel = (provider: AiProvider) => defaultModelFor(config, provider);

  /**
   * The model a pad call runs on: the pad's choice while it is for the key's provider (and the
   * provider has not refused it in this session), otherwise the provider default.
   */
  function padModel(
    rt: PadRuntime | undefined,
    ctx: Pick<InterviewContext, 'pad'>,
    key: UsableKey,
  ): string {
    const m = effectiveModel(ctx.pad.interviewer.model, key.provider, defaultModel(key.provider));
    return m.chosen && rt?.unavailableModel === m.id ? defaultModel(key.provider) : m.id;
  }

  const pads = new Map<string, PadRuntime>();
  /** Backoff after failures, per key: one user's broken or rate-limited key never slows others. */
  const breakers = new Map<string, { failures: number; openUntil: number | null }>();
  const now = () => deps.now().getTime();
  const trace = (padId: string, e: TraceEvent) => options.trace?.(padId, e);

  function runtime(padId: string): PadRuntime {
    let rt = pads.get(padId);
    if (!rt) {
      rt = {
        padId,
        policy: policy.initialPolicyState(),
        hydrated: false,
        events: [],
        replyQueue: [],
        epoch: 0,
        inflight: null,
        inflightKind: null,
        pump: null,
        budgetNoticeSent: false,
        keyId: null,
        keyState: null,
        keyNoticeFor: null,
        unavailableModel: null,
        silentDecisions: [],
        runs: 0,
        released: false,
        quant: null,
      };
      pads.set(padId, rt);
    }
    return rt;
  }

  // ------------------------------------------------------------ model call wrapper

  const scopeLog = (scope: AiScope) =>
    'padId' in scope ? { padId: scope.padId } : { userId: scope.userId };

  async function callModel(
    scope: AiScope,
    key: UsableKey,
    req: ModelRequest,
    model: string = defaultModel(key.provider),
  ): Promise<ModelResponse> {
    try {
      const res = await clients.get(key, model).call(req);
      breakers.delete(key.keyId);
      const usage: ModelUsage = {
        purpose: req.purpose,
        model: res.model,
        provider: key.provider,
        ...res.usage,
      };
      deps.recordUsage?.(scope, usage);
      deps.log.info(
        {
          ...scopeLog(scope),
          purpose: req.purpose,
          model: res.model,
          latencyMs: Math.round(res.latencyMs),
          stopReason: res.stopReason,
          fallback: res.fallback,
          ...res.usage,
        },
        'interviewer model call',
      );
      return res;
    } catch (err) {
      const e = err instanceof ModelError ? err : new ModelError('transient', String(err));
      if (e.kind === 'aborted') throw e;
      const fallback = defaultModel(key.provider);
      if (e.modelUnavailable && model !== fallback) {
        // The chosen model, not the key, is the problem: keep the key, switch this pad to the
        // provider default, say so once, and answer with the default right away.
        deps.log.warn(
          { ...scopeLog(scope), purpose: req.purpose, status: e.status, model, fallback },
          'chosen model unavailable; using the provider default',
        );
        if ('padId' in scope) await chosenModelUnavailable(scope.padId, key.provider, model);
        return callModel(scope, key, req, fallback);
      }
      if (e.keyFailure && e.keyFailure !== 'rate_limited') {
        // The key is no good: forget its client and let the host discard it. Every later call
        // resolves to "rejected" and stays silent until a new key is saved.
        clients.drop(key.keyId);
        breakers.delete(key.keyId);
        deps.log.warn(
          { ...scopeLog(scope), purpose: req.purpose, status: e.status, problem: e.keyFailure },
          'user API key refused by the provider',
        );
        try {
          await deps.keyRejected(scope, key.keyId, e.keyFailure);
        } catch (err2) {
          deps.log.warn({ ...scopeLog(scope), err: String(err2) }, 'keyRejected failed');
        }
        throw e;
      }
      const b = breakers.get(key.keyId) ?? { failures: 0, openUntil: null };
      b.failures += 1;
      b.openUntil = now() + Math.min(600_000, 30_000 * 2 ** (b.failures - 1));
      breakers.set(key.keyId, b);
      deps.log.warn(
        {
          ...scopeLog(scope),
          purpose: req.purpose,
          kind: e.kind,
          status: e.status,
          failures: b.failures,
        },
        `interviewer model call failed: ${e.message}`,
      );
      throw e;
    }
  }

  /** The pad owner's key, or null (silence) when there is none or the provider rejected it. */
  async function padKey(rt: PadRuntime): Promise<UsableKey | null> {
    let r: ResolvedKey;
    try {
      r = await deps.resolveKey({ padId: rt.padId });
    } catch (err) {
      deps.log.warn({ padId: rt.padId, err: String(err) }, 'resolveKey failed');
      return null;
    }
    const state = r.ok ? 'active' : r.state;
    if (state !== rt.keyState) trace(rt.padId, { type: 'key', state });
    rt.keyState = state;
    rt.keyId = r.ok ? r.keyId : null;
    return r.ok ? r : null;
  }

  /** The pad's chosen model was refused: remember, tell the host, post one notice. */
  async function chosenModelUnavailable(
    padId: string,
    provider: AiProvider,
    model: string,
  ): Promise<void> {
    const rt = pads.get(padId);
    if (rt?.unavailableModel === model) return;
    if (rt) rt.unavailableModel = model;
    try {
      await deps.modelUnavailable?.(padId, { provider, id: model } satisfies AiModelChoice);
    } catch (err) {
      deps.log.warn({ padId, err: String(err) }, 'modelUnavailable failed');
    }
    // No runtime: an assessment after the pad ended; nobody is there to read a notice.
    if (!rt || rt.released) return;
    try {
      await deps.saveMessage(padId, {
        kind: 'chat',
        intent: 'answer',
        text: MESSAGES.modelUnavailable(provider, model, defaultModel(provider)),
      });
    } catch (err) {
      deps.log.warn({ padId, err: String(err) }, 'saveMessage (model notice) failed');
    }
  }

  /** One notice per pad and key, then silence (the key now resolves as rejected). */
  async function keyRejectedNotice(rt: PadRuntime, key: UsableKey): Promise<void> {
    if (rt.keyNoticeFor === key.keyId || rt.released) return;
    rt.keyNoticeFor = key.keyId;
    try {
      await deps.saveMessage(rt.padId, {
        kind: 'chat',
        intent: 'answer',
        text: MESSAGES.keyRejected(key.provider),
      });
    } catch (err) {
      deps.log.warn({ padId: rt.padId, err: String(err) }, 'saveMessage (key notice) failed');
    }
  }

  // ------------------------------------------------------------ quant rounds

  const quant = createQuantRuntime<PadRuntime>({
    deps,
    now,
    callModel,
    padKey,
    budgetOk,
    padModel,
    keyRejectedNotice,
    backoffUntil: (keyId) => (keyId && breakers.get(keyId)?.openUntil) || null,
    note,
    trace: (padId, e) => trace(padId, e),
    runtimeOf: (padId) => pads.get(padId),
    messages: MESSAGES,
    voiceSettleMs: options.voiceSettleMs ?? 1500,
  });

  // ------------------------------------------------------------ hydration (first work for a pad)

  function applyContext(rt: PadRuntime, ctx: InterviewContext): void {
    const s = rt.policy;
    s.settings = { ...ctx.pad.interviewer };
    s.startedAt = Date.parse(ctx.pad.startedAt);
    // No time limit: the policy then raises no clock checkpoints and never calls time.
    s.durationMs = ctx.pad.durationMin === null ? null : ctx.pad.durationMin * 60_000;
    if (ctx.pad.status !== 'active') s.ended = true;
  }

  async function hydrate(rt: PadRuntime): Promise<void> {
    rt.hydrated = true;
    if (deps.loadQuantContext) {
      let q: Awaited<ReturnType<NonNullable<InterviewerDeps['loadQuantContext']>>>;
      try {
        q = await deps.loadQuantContext(rt.padId);
      } catch (err) {
        // The pad's format is unknown: try again on the next trigger.
        rt.hydrated = false;
        throw err;
      }
      if (q) {
        quant.hydrate(rt, q);
        trace(rt.padId, { type: 'hydrated' });
        return;
      }
    }
    const ctx = await deps.loadContext(rt.padId);
    applyContext(rt, ctx);
    const s = rt.policy;
    const t = (m: Message) => Date.parse(m.createdAt);
    const lastCandidate = [...ctx.transcript].reverse().find((m) => m.role === 'candidate');
    const interviewerMsgs = ctx.transcript.filter((m) => m.role === 'interviewer');
    const lastInterviewer = interviewerMsgs[interviewerMsgs.length - 1];
    if (interviewerMsgs.length) s.greeted = true;
    if (lastInterviewer)
      s.lastInterviewerMsgAt = Math.max(s.lastInterviewerMsgAt ?? 0, t(lastInterviewer));
    if (lastCandidate) s.lastCandidateMsgAt = Math.max(s.lastCandidateMsgAt ?? 0, t(lastCandidate));
    if (s.unanswered === 0) {
      let n = 0;
      for (let i = ctx.transcript.length - 1; i >= 0; i--) {
        const m = ctx.transcript[i] as Message;
        if (m.role === 'candidate') break;
        if (m.kind === 'proactive' && m.intent !== 'greeting') n++;
      }
      s.unanswered = n;
    }
    s.accepted ||= ctx.recentRuns.some((r) => r.mode === 'submit' && r.verdict === 'accepted');
    for (const r of ctx.recentRuns) {
      if (r.status !== 'finished' || rt.events.some((e) => e.runId === r.id)) continue;
      rt.events.push({
        at: Date.parse(r.finishedAt ?? r.createdAt),
        text: runFact(r, null),
        runId: r.id,
      });
    }
    rt.runs = Math.max(rt.runs, ctx.recentRuns.length);
    const latestRun = ctx.recentRuns[0];
    const lastActivity = Math.max(
      lastCandidate ? t(lastCandidate) : 0,
      latestRun ? Date.parse(latestRun.createdAt) : 0,
    );
    if (lastActivity > 0) s.lastActivityAt = Math.max(s.lastActivityAt ?? 0, lastActivity);
    s.lastActivityAt ??= s.startedAt;
    trace(rt.padId, { type: 'hydrated' });
  }

  // ------------------------------------------------------------ trigger intake

  function handle(padId: string, trigger: Trigger): void {
    const rt = runtime(padId);
    if (rt.released) return;
    const t = now();
    policy.observe(rt.policy, trigger, t);
    switch (trigger.type) {
      case 'candidate_message':
        rt.replyQueue.push({ text: trigger.text, via: trigger.via, at: t });
        rt.epoch += 1;
        if (rt.inflightKind === 'decision') rt.inflight?.abort();
        break;
      case 'run_finished': {
        const run = trigger.run;
        rt.runs += 1;
        if (!rt.events.some((e) => e.runId === run.id)) {
          rt.events.push({
            at: t,
            text: runFact(run, run.mode === 'submit' ? trigger.hiddenFailures : null),
            runId: run.id,
          });
        }
        break;
      }
      case 'telemetry': {
        if (trigger.kind === 'paste' && (trigger.chars ?? 0) >= 100) {
          rt.events.push({
            at: t,
            text: `The candidate pasted ${trigger.chars} characters into the editor.`,
          });
          if ((trigger.chars ?? 0) >= 200)
            void note(
              padId,
              `[platform ${clockOf(rt, t)}] Candidate pasted ${trigger.chars} characters into the editor.`,
            );
        } else if (trigger.kind === 'blur' && (trigger.ms ?? 0) >= 15_000) {
          rt.events.push({
            at: t,
            text: `The editor was out of focus for ${Math.round((trigger.ms ?? 0) / 1000)} s.`,
          });
          if ((trigger.ms ?? 0) >= 60_000)
            void note(
              padId,
              `[platform ${clockOf(rt, t)}] Editor out of focus for ${Math.round((trigger.ms ?? 0) / 1000)} s.`,
            );
        }
        break;
      }
      case 'language_changed':
        rt.events.push({
          at: t,
          text: `The candidate switched the editor language to ${trigger.language}.`,
        });
        break;
      case 'session_ended':
        rt.inflight?.abort();
        rt.replyQueue = [];
        break;
      default:
        break;
    }
    // Bound memory for very long sessions (history rendering only needs recent windows).
    if (rt.events.length > MAX_EVENTS) rt.events.splice(0, rt.events.length - MAX_EVENTS);
    kick(rt);
  }

  function clockOf(rt: PadRuntime, t: number): string {
    const start = rt.policy.startedAt;
    if (start === null) return '';
    const sec = Math.max(0, Math.floor((t - start) / 1000));
    return `${String(Math.floor(sec / 60)).padStart(2, '0')}:${String(sec % 60).padStart(2, '0')}`;
  }

  async function note(padId: string, text: string): Promise<void> {
    try {
      await deps.appendPrivateNote(padId, text);
    } catch (err) {
      deps.log.warn({ padId, err: String(err) }, 'appendPrivateNote failed');
    }
  }

  function kick(rt: PadRuntime): void {
    if (rt.pump) return;
    rt.pump = pumpLoop(rt)
      .catch((err) =>
        deps.log.error({ padId: rt.padId, err: String(err) }, 'interviewer pump crashed'),
      )
      .finally(() => {
        rt.pump = null;
      });
  }

  async function pumpLoop(rt: PadRuntime): Promise<void> {
    if (!rt.hydrated) {
      try {
        await hydrate(rt);
      } catch (err) {
        deps.log.warn({ padId: rt.padId, err: String(err) }, 'interviewer hydrate failed');
      }
      if (!rt.hydrated) return;
    }
    if (rt.quant) return quant.pump(rt);
    for (;;) {
      if (rt.released) return;
      if (rt.replyQueue.length > 0) {
        await doReply(rt);
        continue;
      }
      rt.policy.backoffUntil = (rt.keyId && breakers.get(rt.keyId)?.openUntil) || null;
      const m = policy.poll(rt.policy, now());
      if (!m) return;
      // Without a usable key the moment stays pending, so e.g. the greeting still happens if the
      // owner adds a key a few minutes in.
      const key = await padKey(rt);
      if (!key) return;
      policy.take(rt.policy, m);
      await doMoment(rt, m, key);
    }
  }

  // ------------------------------------------------------------ budget

  async function budgetOk(rt: PadRuntime, kind: 'chat' | 'proactive'): Promise<boolean> {
    let res: Awaited<ReturnType<InterviewerDeps['checkBudget']>>;
    try {
      res = await deps.checkBudget(rt.padId);
    } catch (err) {
      deps.log.warn({ padId: rt.padId, err: String(err) }, 'checkBudget failed; staying silent');
      return false;
    }
    if (res.ok) return true;
    trace(rt.padId, { type: 'budget', reason: res.reason });
    if (!rt.budgetNoticeSent) {
      rt.budgetNoticeSent = true;
      try {
        await deps.saveMessage(rt.padId, {
          kind,
          intent: 'answer',
          text: MESSAGES.budget(res.reason),
        });
        policy.onInterviewerMessage(rt.policy, now(), kind === 'proactive');
      } catch (err) {
        deps.log.warn({ padId: rt.padId, err: String(err) }, 'saveMessage (budget notice) failed');
      }
    }
    return false;
  }

  async function load(rt: PadRuntime): Promise<InterviewContext | null> {
    try {
      const ctx = await deps.loadContext(rt.padId);
      applyContext(rt, ctx);
      if (ctx.pad.status !== 'active' || !ctx.pad.interviewer.enabled) return null;
      return ctx;
    } catch (err) {
      deps.log.warn({ padId: rt.padId, err: String(err) }, 'loadContext failed');
      return null;
    }
  }

  function facts(rt: PadRuntime): Parameters<typeof stateText>[1] {
    return {
      now: now(),
      lastCodeChangeAt: rt.policy.lastCodeChangeAt,
      lastCandidateMsgAt: rt.policy.lastCandidateMsgAt,
      unanswered: rt.policy.unanswered,
      accepted: rt.policy.accepted,
      runs: rt.runs,
      silentDecisions: rt.silentDecisions.slice(-4),
    };
  }

  // ------------------------------------------------------------ streamed messages (replies, greeting)

  async function streamMessage(
    rt: PadRuntime,
    ctx: InterviewContext,
    key: UsableKey,
    opts: {
      task: string;
      kind: 'chat' | 'proactive';
      intent: Message['intent'] & string;
      extra?: PadRuntime['replyQueue'];
    },
  ): Promise<void> {
    const messageId = randomUUID();
    let streamed = '';
    const abort = new AbortController();
    rt.inflight = abort;
    rt.inflightKind = 'reply';
    let text: string;
    try {
      const res = await callModel(
        { padId: rt.padId },
        key,
        {
          purpose: 'reply',
          system: systemBlocks(ctx.problem),
          messages: buildMessages(ctx, rt.events, {
            state: stateText(ctx, facts(rt)),
            task: opts.task,
            includeRunOutput: true,
            extraCandidateTexts: opts.extra,
          }),
          ...CALLS.reply,
          signal: abort.signal,
          onText: (delta) => {
            // Skip leading whitespace-only deltas so the first visible delta starts the text.
            if (!streamed && /^\s*$/.test(delta)) return;
            streamed += delta;
            deps.emit(rt.padId, { type: 'message.delta', messageId, delta });
          },
        },
        padModel(rt, ctx, key),
      );
      text = res.refused ? MESSAGES.refused : clean(res.text);
      if (!text) text = MESSAGES.refused;
      trace(rt.padId, {
        type: 'reply',
        intent: opts.intent,
        text,
        latencyMs: res.latencyMs,
        ttftMs: res.ttftMs,
        usage: res.usage,
        model: res.model,
      });
    } catch (err) {
      const e = err as ModelError;
      trace(rt.padId, { type: 'error', purpose: 'reply', kind: e.kind, message: e.message });
      if (e.kind === 'aborted' || rt.released) return;
      if (e.keyFailure && e.keyFailure !== 'rate_limited') {
        await keyRejectedNotice(rt, key);
        return;
      }
      if (streamed.trim().length >= 40) text = `${streamed.trim()} …`;
      else if (opts.kind === 'proactive') return;
      else
        text =
          e.keyFailure === 'rate_limited'
            ? MESSAGES.rateLimited(key.provider)
            : MESSAGES.replyFailed;
    } finally {
      rt.inflight = null;
      rt.inflightKind = null;
    }
    try {
      await deps.saveMessage(rt.padId, {
        id: streamed ? messageId : undefined,
        kind: opts.kind,
        intent: opts.intent,
        text,
      });
      policy.onInterviewerMessage(rt.policy, now(), opts.kind === 'proactive');
    } catch (err) {
      deps.log.warn({ padId: rt.padId, err: String(err) }, 'saveMessage failed');
    }
  }

  async function doReply(rt: PadRuntime): Promise<void> {
    const queued = rt.replyQueue.splice(0);
    const voice = queued[queued.length - 1]?.via === 'voice';
    // No key: the chat panel already tells everyone why the interviewer is quiet.
    const key = await padKey(rt);
    if (!key) return;
    deps.emit(rt.padId, { type: 'interviewer.thinking', active: true });
    try {
      if (!(await budgetOk(rt, 'chat'))) return;
      const ctx = await load(rt);
      if (!ctx) return;
      const firstMessage = !ctx.transcript.some((m) => m.role === 'interviewer');
      await streamMessage(rt, ctx, key, {
        task: replyTask({ voice: voice || ctx.pad.interviewer.voice, firstMessage }),
        kind: 'chat',
        intent: 'answer',
        extra: queued,
      });
    } finally {
      deps.emit(rt.padId, { type: 'interviewer.thinking', active: false });
    }
  }

  // ------------------------------------------------------------ proactive moments

  async function doMoment(rt: PadRuntime, m: policy.Moment, key: UsableKey): Promise<void> {
    const s = rt.policy;
    if (!(await budgetOk(rt, 'proactive'))) return;
    const ctx = await load(rt);
    if (!ctx) {
      trace(rt.padId, {
        type: 'moment_dropped',
        kind: m.kind,
        why: 'no context / pad inactive / disabled',
      });
      return;
    }
    const scaffold = problemScaffold(ctx.problem, ctx.language);
    const facts0 = policy.codeFacts(
      ctx.code,
      scaffold,
      ctx.transcript.filter((x) => x.role === 'candidate').map((x) => x.text),
    );
    const hasInterviewer = ctx.transcript.some((x) => x.role === 'interviewer');
    const refined = policy.refine(s, m, facts0, hasInterviewer, now());
    if (!refined) {
      trace(rt.padId, {
        type: 'moment_dropped',
        kind: m.kind,
        why: `stage 2 (${facts0.newLines} new lines, ${facts0.candidateWords} candidate words)`,
      });
      return;
    }
    // A candidate message may have arrived while we loaded the context.
    if (rt.replyQueue.length > 0) {
      trace(rt.padId, { type: 'moment_dropped', kind: m.kind, why: 'candidate message arrived' });
      return;
    }

    if (refined.kind === 'greeting') {
      policy.markConsidered(s, refined, now());
      deps.emit(rt.padId, { type: 'interviewer.thinking', active: true });
      try {
        await streamMessage(rt, ctx, key, {
          task: greetingTask(ctx.pad.interviewer.voice),
          kind: 'proactive',
          intent: 'greeting',
        });
        // The greeting is an opening, not an unanswered nudge.
        s.unanswered = Math.max(0, s.unanswered - 1);
      } finally {
        deps.emit(rt.padId, { type: 'interviewer.thinking', active: false });
      }
      return;
    }

    policy.markConsidered(s, refined, now());
    const epoch = rt.epoch;
    const decidedFrom = now();
    const abort = new AbortController();
    rt.inflight = abort;
    rt.inflightKind = 'decision';
    let res: ModelResponse;
    try {
      res = await callModel(
        { padId: rt.padId },
        key,
        {
          purpose: 'decision',
          system: systemBlocks(ctx.problem),
          messages: buildMessages(ctx, rt.events, {
            state: stateText(ctx, facts(rt)),
            task: decisionTask(refined),
            includeRunOutput: refined.kind.startsWith('run_') || refined.kind === 'samples_passed',
          }),
          ...CALLS.decision,
          schema: DecisionSchema,
          signal: abort.signal,
        },
        padModel(rt, ctx, key),
      );
    } catch (err) {
      const e = err as ModelError;
      trace(rt.padId, { type: 'error', purpose: 'decision', kind: e.kind, message: e.message });
      if (e.keyFailure && e.keyFailure !== 'rate_limited') await keyRejectedNotice(rt, key);
      return;
    } finally {
      rt.inflight = null;
      rt.inflightKind = null;
    }

    let decision: Decision | null = null;
    if (!res.refused) {
      try {
        const parsed = DecisionSchema.safeParse(JSON.parse(res.text));
        if (parsed.success) decision = parsed.data;
      } catch {
        decision = null;
      }
    }
    const base = {
      kind: refined.kind,
      decision,
      latencyMs: res.latencyMs,
      ttftMs: res.ttftMs,
      usage: res.usage,
      model: res.model,
    };
    if (!decision) {
      trace(rt.padId, {
        type: 'decision',
        ...base,
        outcome: 'invalid',
        why: res.refused ? 'refused' : `unparseable (${res.stopReason})`,
      });
      return;
    }
    if (decision.note.trim()) await note(rt.padId, decision.note.trim());

    const message = clean(decision.message);
    if (!decision.speak || !message) {
      rt.silentDecisions.push({ at: now(), kind: refined.kind, reason: decision.reason });
      if (rt.silentDecisions.length > 8) rt.silentDecisions.shift();
      trace(rt.padId, { type: 'decision', ...base, outcome: 'silent' });
      return;
    }
    if (rt.epoch !== epoch || rt.replyQueue.length > 0) {
      trace(rt.padId, {
        type: 'decision',
        ...base,
        outcome: 'discarded',
        why: 'candidate spoke meanwhile',
      });
      return;
    }
    if (!policy.stillAppropriate(s, refined, now(), decidedFrom)) {
      trace(rt.padId, {
        type: 'decision',
        ...base,
        outcome: 'discarded',
        why: 'candidate resumed typing',
      });
      return;
    }
    const intent = decision.intent === 'answer' ? 'nudge' : decision.intent;
    try {
      await deps.saveMessage(rt.padId, { kind: 'proactive', intent, text: message });
      policy.onInterviewerMessage(s, now(), true);
      trace(rt.padId, { type: 'decision', ...base, outcome: 'spoke' });
    } catch (err) {
      deps.log.warn({ padId: rt.padId, err: String(err) }, 'saveMessage failed');
    }
  }

  // ------------------------------------------------------------ assessment and grading

  async function generateAssessment(padId: string): Promise<ReportAssessment | null> {
    const rt = pads.get(padId);
    try {
      const key = await deps.resolveKey({ padId });
      if (!key.ok) {
        deps.log.info({ padId, key: key.state }, 'assessment skipped: no usable key');
        return null;
      }
      const budget = await deps.checkBudget(padId);
      if (!budget.ok) {
        deps.log.info({ padId, reason: budget.reason }, 'assessment skipped: budget');
        return null;
      }
      const ctx = await deps.loadContext(padId);
      const res = await callModel(
        { padId },
        key,
        {
          purpose: 'assessment',
          system: systemBlocks(ctx.problem),
          messages: assessmentMessages(ctx, rt?.events ?? []),
          ...CALLS.assessment,
          schema: AssessmentSchema,
        },
        padModel(rt, ctx, key),
      );
      if (res.refused) return null;
      return toAssessment(AssessmentSchema.parse(JSON.parse(res.text)));
    } catch (err) {
      deps.log.error(
        { padId, err: err instanceof Error ? err.message : String(err) },
        'assessment failed',
      );
      return null;
    }
  }

  /** Shapes the model's assessment output into the report's (clamped scores, trimmed text). */
  function toAssessment(out: z.infer<typeof AssessmentSchema>): ReportAssessment {
    return ReportAssessment.parse({
      recommendation: out.recommendation,
      summary: out.summary.trim(),
      scores: REPORT_DIMENSIONS.map((d) => ({
        dimension: d,
        score: Math.min(4, Math.max(1, Math.round(out.scores[d].score))),
        evidence: out.scores[d].evidence.trim(),
      })),
      strengths: out.strengths.map((x) => x.trim()).filter(Boolean),
      improvements: out.improvements.map((x) => x.trim()).filter(Boolean),
    });
  }

  // ------------------------------------------------------------ quant rounds

  /** Verdicts for questions closed without one, then the assessment (./quant/round.ts). */
  async function generateQuantAssessment(padId: string): Promise<ReportAssessment | null> {
    return quant.assess(padId);
  }

  // ------------------------------------------------------------ rooms (the host interviews)

  async function generateRoomAssessment(padId: string): Promise<ReportAssessment | null> {
    try {
      if (!deps.loadRoomContext) return null;
      const key = await deps.resolveKey({ padId });
      if (!key.ok) {
        deps.log.info({ padId, key: key.state }, 'room assessment skipped: no usable key');
        return null;
      }
      const budget = await deps.checkBudget(padId);
      if (!budget.ok) {
        deps.log.info({ padId, reason: budget.reason }, 'room assessment skipped: budget');
        return null;
      }
      const ctx = await deps.loadRoomContext(padId);
      const res = await callModel(
        { padId },
        key,
        {
          purpose: 'assessment',
          system: roomSystem(ctx),
          messages: roomAssessmentMessages(ctx),
          ...CALLS.assessment,
          schema: AssessmentSchema,
        },
        effectiveModel(ctx.pad.interviewer.model, key.provider, defaultModel(key.provider)).id,
      );
      if (res.refused) return null;
      return toAssessment(AssessmentSchema.parse(JSON.parse(res.text)));
    } catch (err) {
      deps.log.error(
        { padId, err: err instanceof Error ? err.message : String(err) },
        'room assessment failed',
      );
      return null;
    }
  }

  async function reviewSolution(padId: string, question?: string): Promise<ReviewResult> {
    try {
      if (!deps.loadRoomContext) return { ok: false, reason: 'failed' };
      const key = await deps.resolveKey({ padId });
      if (!key.ok) return { ok: false, reason: 'no_key' };
      const budget = await deps.checkBudget(padId);
      if (!budget.ok) return { ok: false, reason: 'budget', message: budget.reason };
      const ctx = await deps.loadRoomContext(padId);
      const res = await callModel(
        { padId },
        key,
        {
          purpose: 'review',
          system: roomSystem(ctx),
          messages: reviewMessages(ctx, question),
          ...CALLS.review,
          schema: ReviewSchema,
        },
        effectiveModel(ctx.pad.interviewer.model, key.provider, defaultModel(key.provider)).id,
      );
      if (res.refused) return { ok: false, reason: 'failed' };
      const out = ReviewSchema.parse(JSON.parse(res.text));
      const list = (xs: string[], max: number) =>
        xs
          .map((x) => x.trim())
          .filter(Boolean)
          .slice(0, max);
      const review = SolutionReview.parse({
        verdict: out.verdict,
        summary: out.summary.trim(),
        issues: list(out.issues, 6),
        complexity: out.complexity.trim() || null,
        followUps: list(out.follow_ups, 3),
        answer: question ? out.answer.trim() || null : null,
        language: ctx.language,
        model: res.model,
        createdAt: deps.now().toISOString(),
      });
      return { ok: true, review };
    } catch (err) {
      const e = err instanceof ModelError ? err : null;
      deps.log.warn(
        { padId, err: err instanceof Error ? err.message : String(err) },
        'solution review failed',
      );
      // The key was refused mid-call: the host has to save one again.
      if (e?.keyFailure && e.keyFailure !== 'rate_limited') return { ok: false, reason: 'no_key' };
      return { ok: false, reason: 'failed' };
    }
  }

  // ------------------------------------------------------------ quant rooms (the host interviews)

  async function reviewQuantRoom(
    padId: string,
    opts: { index: number; question?: string },
  ): Promise<QuantReviewResult> {
    try {
      if (!deps.loadQuantRoomContext) return { ok: false, reason: 'failed' };
      const key = await deps.resolveKey({ padId });
      if (!key.ok) return { ok: false, reason: 'no_key' };
      const budget = await deps.checkBudget(padId);
      if (!budget.ok) return { ok: false, reason: 'budget', message: budget.reason };
      const ctx = await deps.loadQuantRoomContext(padId);
      const q = ctx?.questions.find((x) => x.index === opts.index);
      if (!ctx || !q) return { ok: false, reason: 'failed' };
      const res = await callModel(
        { padId },
        key,
        {
          purpose: 'review',
          system: quantRoomSystem([q], Date.parse(ctx.pad.startedAt)),
          messages: quantRoomReviewMessages(ctx, q, opts.question),
          ...CALLS.review,
          schema: QuantRoomReviewSchema,
        },
        effectiveModel(ctx.pad.interviewer.model, key.provider, defaultModel(key.provider)).id,
      );
      if (res.refused) return { ok: false, reason: 'failed' };
      const out = QuantRoomReviewSchema.parse(parseModelJson(res.text));
      const text = (s: string) => repairLatexEscapes(s).trim();
      const list = (xs: string[], max: number) => xs.map(text).filter(Boolean).slice(0, max);
      const score = out.suggested_score;
      const review = QuantSecondOpinion.parse({
        index: q.index,
        verdict: out.verdict,
        summary: text(out.summary),
        covered: list(out.covered, 8),
        missing: list(out.missing, 6),
        followUps: list(out.follow_ups, 3),
        suggestedScore:
          Number.isFinite(score) && score >= 0 ? Math.round(Math.min(1, score) * 100) / 100 : null,
        answer: opts.question ? text(out.answer) || null : null,
        model: res.model,
        createdAt: deps.now().toISOString(),
      });
      return { ok: true, review };
    } catch (err) {
      const e = err instanceof ModelError ? err : null;
      deps.log.warn(
        { padId, err: err instanceof Error ? err.message : String(err) },
        'quant room review failed',
      );
      if (e?.keyFailure && e.keyFailure !== 'rate_limited') return { ok: false, reason: 'no_key' };
      return { ok: false, reason: 'failed' };
    }
  }

  async function generateQuantRoomAssessment(padId: string): Promise<ReportAssessment | null> {
    try {
      if (!deps.loadQuantRoomContext) return null;
      const key = await deps.resolveKey({ padId });
      if (!key.ok) {
        deps.log.info({ padId, key: key.state }, 'quant room assessment skipped: no usable key');
        return null;
      }
      const budget = await deps.checkBudget(padId);
      if (!budget.ok) {
        deps.log.info({ padId, reason: budget.reason }, 'quant room assessment skipped: budget');
        return null;
      }
      const ctx = await deps.loadQuantRoomContext(padId);
      if (!ctx) return null;
      const res = await callModel(
        { padId },
        key,
        {
          purpose: 'assessment',
          system: quantRoomSystem(ctx.questions, Date.parse(ctx.pad.startedAt)),
          messages: quantRoomAssessmentMessages(ctx),
          ...CALLS.assessment,
          schema: QuantAssessmentSchema,
        },
        effectiveModel(ctx.pad.interviewer.model, key.provider, defaultModel(key.provider)).id,
      );
      if (res.refused) return null;
      const out = QuantAssessmentSchema.safeParse(parseModelJson(res.text));
      if (!out.success) throw new Error('unparseable quant room assessment');
      return toQuantAssessment(out.data);
    } catch (err) {
      deps.log.error(
        { padId, err: err instanceof Error ? err.message : String(err) },
        'quant room assessment failed',
      );
      return null;
    }
  }

  async function gradeShortAnswer(
    userId: string,
    question: Extract<QuizQuestion, { type: 'short' }>,
    answer: string,
  ): Promise<ShortAnswerGrade | null> {
    try {
      const key = await deps.resolveKey({ userId });
      if (!key.ok) return null;
      const res = await callModel({ userId }, key, {
        purpose: 'grade',
        system: [{ type: 'text', text: GRADING_SYSTEM, cache_control: { type: 'ephemeral' } }],
        messages: [{ role: 'user', content: gradingPrompt(question, answer) }],
        ...CALLS.grade,
        schema: GradeSchema,
      });
      if (res.refused) return null;
      const out = GradeSchema.parse(JSON.parse(res.text));
      return { score: scoreGrade(out, question.keyPoints.length), feedback: out.feedback.trim() };
    } catch (err) {
      deps.log.warn(
        { err: err instanceof Error ? err.message : String(err) },
        'short-answer grading failed',
      );
      return null;
    }
  }

  async function discussShortAnswer(
    userId: string,
    question: Extract<QuizQuestion, { type: 'short' }>,
    turns: DiscussionTurn[],
    final: boolean,
  ): Promise<DiscussionStep | null> {
    try {
      const key = await deps.resolveKey({ userId });
      if (!key.ok) return null;
      const res = await callModel({ userId }, key, {
        purpose: 'grade',
        system: [{ type: 'text', text: DISCUSSION_SYSTEM, cache_control: { type: 'ephemeral' } }],
        messages: [{ role: 'user', content: discussionPrompt(question, turns, final) }],
        ...CALLS.grade,
        schema: DiscussSchema,
      });
      if (res.refused) return null;
      const out = DiscussSchema.parse(JSON.parse(res.text));
      return {
        score: scoreGrade(out, question.keyPoints.length),
        feedback: out.feedback.trim(),
        followUp: final ? '' : clean(out.follow_up),
      };
    } catch (err) {
      deps.log.warn(
        { err: err instanceof Error ? err.message : String(err) },
        'quiz discussion step failed',
      );
      return null;
    }
  }

  return {
    handle,
    release(padId) {
      const rt = pads.get(padId);
      if (!rt) return;
      rt.released = true;
      rt.inflight?.abort();
      pads.delete(padId);
    },
    generateAssessment,
    generateRoomAssessment,
    generateQuantAssessment,
    reviewSolution,
    reviewQuantRoom,
    generateQuantRoomAssessment,
    gradeShortAnswer,
    discussShortAnswer,
    cachedClients: () => clients.size,
    async idle(padId) {
      for (;;) {
        const p = pads.get(padId)?.pump;
        if (!p) return;
        await p;
      }
    },
  };
}

/** Score from per-key-point judgements: covered 1, partial 0.5; each wrong claim costs 0.15 (max 0.3). */
export function scoreGrade(out: z.infer<typeof GradeSchema>, keyPointCount: number): number {
  const byPoint = new Map<number, number>();
  for (const k of out.key_points) {
    if (k.point >= 1 && k.point <= keyPointCount)
      byPoint.set(k.point, k.status === 'covered' ? 1 : k.status === 'partial' ? 0.5 : 0);
  }
  let sum = 0;
  for (let i = 1; i <= keyPointCount; i++) sum += byPoint.get(i) ?? 0;
  const base = keyPointCount > 0 ? sum / keyPointCount : 0;
  const penalty = Math.min(0.3, 0.15 * out.errors.filter((e) => e.trim()).length);
  return Math.round(Math.min(1, Math.max(0, base - penalty)) * 100) / 100;
}

/** Strip role labels and surrounding quotes the model occasionally adds. */
export function clean(text: string): string {
  let t = text.trim();
  t = t.replace(/^(interviewer|assistant)\s*:\s*/i, '');
  if (t.length > 1 && t.startsWith('"') && t.endsWith('"') && !t.slice(1, -1).includes('"'))
    t = t.slice(1, -1);
  return t.trim();
}
