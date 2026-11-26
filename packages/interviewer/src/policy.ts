/**
 * When is a moment worth asking the model about? Plain deterministic code: no timers, no I/O.
 * The orchestrator feeds every trigger to `observe`, then asks `poll` for the next ready moment
 * (ticks arrive every ~5 s, so deferred moments are re-evaluated without timers of our own).
 *
 * Stage 1 (`poll`) works from timing alone. Stage 2 (`refine`) runs after the context is
 * loaded and can still drop a moment on content (e.g. too little code for an approach check).
 * Only then is the model asked for a speak / stay-silent decision.
 */
import type { InterviewerSettings, Run } from '@ipp/contracts';
import type { Trigger } from './types';

export type Proactivity = InterviewerSettings['proactivity'];
export type Style = InterviewerSettings['style'];

export interface Tuning {
  /** Minimum gap after any interviewer message before an unprompted one. */
  minGapMs: number;
  /** Minimum gap between two model consultations for ordinary moments. */
  considerGapMs: number;
  /** Idle time (no edits, no chat, no runs) before a stall is considered. */
  stallMs: number;
  /** Proactive messages in a row without a candidate reply before going quiet. */
  maxUnanswered: number;
  /** Failed judged runs in a row that count as "going in circles". */
  repeatFailures: number;
  /** React to a single failed submission (hidden tests the candidate cannot see). */
  reactToSubmitFailure: boolean;
  /** React to a single failed sample run. */
  reactToSampleFailure: boolean;
  /** Ask about edge cases when samples pass but nothing is submitted yet. */
  reactToSamplesPass: boolean;
  /** Periodic silent-by-default code reviews (mostly to take notes). */
  checkpointReviews: boolean;
  /** Paste size that is worth a question. */
  pasteMinChars: number;
  /** Which time checkpoints to consider. */
  timeChecks: ReadonlyArray<'half' | 'ten' | 'five'>;
}

export const TUNING: Record<Proactivity, Tuning> = {
  low: {
    minGapMs: 180_000,
    considerGapMs: 120_000,
    stallMs: 180_000,
    maxUnanswered: 1,
    repeatFailures: 4,
    reactToSubmitFailure: false,
    reactToSampleFailure: false,
    reactToSamplesPass: false,
    checkpointReviews: false,
    pasteMinChars: 600,
    timeChecks: ['five'],
  },
  normal: {
    minGapMs: 90_000,
    considerGapMs: 60_000,
    stallMs: 100_000,
    maxUnanswered: 2,
    repeatFailures: 3,
    reactToSubmitFailure: true,
    reactToSampleFailure: false,
    reactToSamplesPass: false,
    checkpointReviews: false,
    pasteMinChars: 300,
    timeChecks: ['half', 'ten', 'five'],
  },
  high: {
    minGapMs: 45_000,
    considerGapMs: 30_000,
    stallMs: 60_000,
    maxUnanswered: 3,
    repeatFailures: 2,
    reactToSubmitFailure: true,
    reactToSampleFailure: true,
    reactToSamplesPass: true,
    checkpointReviews: true,
    pasteMinChars: 150,
    timeChecks: ['half', 'ten', 'five'],
  },
};

/** Supportive interviewers check in on a stall sooner, tough ones let the candidate sweat. */
export const STYLE_STALL_FACTOR: Record<Style, number> = {
  supportive: 0.8,
  neutral: 1,
  tough: 1.3,
};

export const CONST = {
  /** No edit for this long = the candidate paused typing. code_changed arrives at most 1/s. */
  typingQuietMs: 8_000,
  /** A just-sent candidate message may be followed by another; don't jump in. */
  candidateTalkingMs: 10_000,
  /** Floor gap for moments that bypass the normal gap (run results, time). */
  floorGapMs: 20_000,
  floorConsiderGapMs: 10_000,
  /** Second (escalated) stall consideration at this multiple of the stall threshold. */
  stallEscalation: 2.5,
  checkpointIntervalMs: 45_000,
  /** A moment that waited this long for a typing pause is considered anyway (time checks only). */
  maxDeferMs: 60_000,
  /** If the candidate typed this recently when a speak decision returns, drop it (unless forced). */
  staleTypingMs: 4_000,
  /** Hard per-pad caps. */
  maxConsiderations: 80,
  maxProactiveMessages: 30,
  /** Lines beyond the scaffold before asking for the approach. */
  approachMinLines: 3,
  /** Candidate words in chat that probably mean the approach has been talked through. */
  approachExplainedWords: 30,
  /** New lines since the last review before another checkpoint review (high proactivity). */
  checkpointMinNewLines: 8,
} as const;

export type MomentKind =
  | 'greeting'
  | 'time_up'
  | 'run_accepted'
  | 'run_failed_repeat'
  | 'paste'
  | 'run_failed'
  | 'samples_passed'
  | 'time_check'
  | 'stall'
  | 'checkpoint'
  | 'approach_check';

/** Higher wins when several moments are ready at once. */
const PRIORITY: Record<MomentKind, number> = {
  greeting: 100,
  time_up: 90,
  run_accepted: 80,
  run_failed_repeat: 70,
  paste: 60,
  run_failed: 55,
  samples_passed: 50,
  time_check: 45,
  stall: 40,
  approach_check: 35,
  checkpoint: 30,
};

export interface Moment {
  kind: MomentKind;
  createdAt: number;
  expiresAt: number;
  /** Earliest time to consider it (e.g. let the candidate read a run result first). */
  notBefore?: number;
  /** Required time since the last edit. */
  quietMs: number;
  /** Use the floor gaps instead of the proactivity gaps. */
  bypassGap?: boolean;
  /** Ignore the consecutive-unanswered cap. */
  bypassCap?: boolean;
  /** The model is told it must speak (greeting, time up). */
  mustSpeak?: boolean;
  /** Typing cancels it: the candidate is acting on the thing we would comment on. */
  cancelOnEdit?: boolean;
  /** Operator-facing description for the prompt. */
  detail: string;
  /** Free-form data for stage 2 / prompts. */
  data?: Record<string, number | string | boolean>;
}

export interface PolicyState {
  settings: InterviewerSettings;
  startedAt: number | null;
  durationMs: number | null;
  ended: boolean;
  wrappedUp: boolean;
  greeted: boolean;
  lastCodeChangeAt: number | null;
  codeChangesSinceCheckpoint: number;
  lastCheckpointAt: number | null;
  lastCandidateMsgAt: number | null;
  lastInterviewerMsgAt: number | null;
  lastConsideredAt: number | null;
  lastActivityAt: number | null;
  /** 0 = not considered for the current idle stretch, 1 = once, 2 = escalated. */
  stallLevel: number;
  unanswered: number;
  consecutiveFailures: number;
  accepted: boolean;
  approachAsked: boolean;
  linesAtLastReview: number;
  firedTimeChecks: string[];
  considerations: number;
  proactiveMessages: number;
  /** Set by the orchestrator after model errors (circuit breaker). */
  backoffUntil: number | null;
  pending: Moment[];
  /**
   * A quant pad: the round keeps its own clock and there is no code, so no clock checkpoints,
   * no checkpoint reviews and no approach checks; stalls and the greeting work as usual.
   */
  quant: boolean;
}

export const DEFAULT_SETTINGS: InterviewerSettings = {
  enabled: true,
  style: 'neutral',
  proactivity: 'normal',
  voice: false,
};

export function initialPolicyState(): PolicyState {
  return {
    settings: { ...DEFAULT_SETTINGS },
    startedAt: null,
    durationMs: null,
    ended: false,
    wrappedUp: false,
    greeted: false,
    lastCodeChangeAt: null,
    codeChangesSinceCheckpoint: 0,
    lastCheckpointAt: null,
    lastCandidateMsgAt: null,
    lastInterviewerMsgAt: null,
    lastConsideredAt: null,
    lastActivityAt: null,
    stallLevel: 0,
    unanswered: 0,
    consecutiveFailures: 0,
    accepted: false,
    approachAsked: false,
    linesAtLastReview: 0,
    firedTimeChecks: [],
    considerations: 0,
    proactiveMessages: 0,
    backoffUntil: null,
    pending: [],
    quant: false,
  };
}

export function tuningFor(s: PolicyState): Tuning {
  return TUNING[s.settings.proactivity];
}

const FAILURE_VERDICTS = new Set([
  'wrong_answer',
  'runtime_error',
  'time_limit',
  'memory_limit',
  'output_limit',
  'compile_error',
  'invalid_submission',
]);

function push(s: PolicyState, m: Moment): void {
  // One pending moment per kind; the newer one replaces the older.
  s.pending = s.pending.filter((p) => p.kind !== m.kind);
  s.pending.push(m);
}

const mmss = (ms: number) => {
  const total = Math.max(0, Math.round(ms / 1000));
  const m = Math.floor(total / 60);
  const sec = total % 60;
  return sec === 0 ? `${m} min` : `${m} min ${sec} s`;
};

/** Update state for a trigger. Never decides to speak by itself. */
export function observe(s: PolicyState, trigger: Trigger, now: number): void {
  const t = tuningFor(s);
  switch (trigger.type) {
    case 'session_started':
      if (!s.greeted && !s.ended) {
        push(s, {
          kind: 'greeting',
          createdAt: now,
          expiresAt: now + 10 * 60_000,
          quietMs: 0,
          bypassGap: true,
          bypassCap: true,
          mustSpeak: true,
          detail: 'The session has just started.',
        });
      }
      s.lastActivityAt ??= now;
      return;

    case 'candidate_message':
      s.lastCandidateMsgAt = now;
      s.lastActivityAt = now;
      s.unanswered = 0;
      s.stallLevel = 0;
      // The reply covers whatever we were about to bring up; keep only clock-driven moments.
      s.pending = s.pending.filter((p) => p.kind === 'time_check' || p.kind === 'time_up');
      return;

    case 'code_changed':
      s.lastCodeChangeAt = now;
      s.lastActivityAt = now;
      s.stallLevel = 0;
      s.codeChangesSinceCheckpoint += 1;
      s.pending = s.pending.filter((p) => !(p.cancelOnEdit || p.kind === 'stall'));
      return;

    case 'scratch_changed':
      // Typing activity on a quant pad's scratchpad: like code_changed, but nothing to review.
      s.lastCodeChangeAt = now;
      s.lastActivityAt = now;
      s.stallLevel = 0;
      s.pending = s.pending.filter((p) => !(p.cancelOnEdit || p.kind === 'stall'));
      return;

    case 'run_finished': {
      const run = trigger.run;
      s.lastActivityAt = now;
      s.stallLevel = 0;
      onRun(s, t, run, trigger.hiddenFailures, now);
      return;
    }

    case 'telemetry':
      if (trigger.kind === 'paste' && (trigger.chars ?? 0) >= t.pasteMinChars) {
        push(s, {
          kind: 'paste',
          createdAt: now,
          expiresAt: now + 120_000,
          notBefore: now + 4_000,
          quietMs: 4_000,
          bypassGap: true,
          detail: `The candidate just pasted ${trigger.chars} characters into the editor.`,
          data: { chars: trigger.chars ?? 0 },
        });
      }
      return;

    case 'language_changed':
    case 'tick':
      return;

    case 'session_ended':
      s.ended = true;
      s.pending = [];
      return;
  }
}

function onRun(s: PolicyState, t: Tuning, run: Run, hiddenFailures: number, now: number): void {
  const judged = run.mode === 'samples' || run.mode === 'submit';
  if (!judged || run.verdict === null || run.verdict === 'internal_error') return;
  const where = run.mode === 'submit' ? 'Submission' : 'Sample run';
  if (run.verdict === 'accepted') {
    s.consecutiveFailures = 0;
    s.pending = s.pending.filter((p) => p.kind !== 'run_failed' && p.kind !== 'run_failed_repeat');
    if (run.mode === 'submit') {
      s.accepted = true;
      push(s, {
        kind: 'run_accepted',
        createdAt: now,
        expiresAt: now + 180_000,
        notBefore: now + 3_000,
        quietMs: 3_000,
        bypassGap: true,
        bypassCap: true,
        detail: `The submission passed all ${run.total} tests (samples and hidden).`,
      });
    } else if (t.reactToSamplesPass && !s.accepted) {
      push(s, {
        kind: 'samples_passed',
        createdAt: now,
        expiresAt: now + 120_000,
        notBefore: now + 10_000,
        quietMs: CONST.typingQuietMs,
        cancelOnEdit: true,
        detail: `All ${run.total} sample tests pass; nothing has been submitted yet.`,
      });
    }
    return;
  }
  if (!FAILURE_VERDICTS.has(run.verdict)) return;
  s.consecutiveFailures += 1;
  const summary = `${where} finished: ${run.verdict}, ${run.passed}/${run.total} passed${hiddenFailures > 0 ? ` (${hiddenFailures} hidden test${hiddenFailures === 1 ? '' : 's'} failing)` : ''}.`;
  if (s.consecutiveFailures >= t.repeatFailures) {
    push(s, {
      kind: 'run_failed_repeat',
      createdAt: now,
      expiresAt: now + 180_000,
      quietMs: CONST.typingQuietMs,
      bypassGap: true,
      detail: `${summary} That is ${s.consecutiveFailures} failed runs in a row.`,
      data: { failures: s.consecutiveFailures },
    });
    return;
  }
  const react =
    run.verdict !== 'compile_error' &&
    ((run.mode === 'submit' && t.reactToSubmitFailure) ||
      (run.mode === 'samples' && t.reactToSampleFailure));
  if (react) {
    push(s, {
      kind: 'run_failed',
      createdAt: now,
      expiresAt: now + 120_000,
      // Give them time to read the result; if they start fixing it, the moment is cancelled.
      notBefore: now + 15_000,
      quietMs: CONST.typingQuietMs,
      bypassGap: true,
      cancelOnEdit: true,
      detail: summary,
    });
  }
}

/** Time-derived moments (stall, clock); appended to `pending` once each. */
function derive(s: PolicyState, now: number): void {
  const t = tuningFor(s);
  if (!s.quant && s.startedAt !== null && s.durationMs !== null) {
    const elapsed = now - s.startedAt;
    const remaining = s.durationMs - elapsed;
    const fire = (id: string, ok: boolean, m: () => Moment) => {
      if (ok && !s.firedTimeChecks.includes(id)) {
        s.firedTimeChecks.push(id);
        push(s, m());
      }
    };
    // A check is only relevant close to its threshold (e.g. not after a restart much later).
    const near = (thresholdRemaining: number) =>
      remaining <= thresholdRemaining && remaining > thresholdRemaining - 120_000;
    const clock = (label: string, mustSpeak = false, kind: MomentKind = 'time_check'): Moment => ({
      kind,
      createdAt: now,
      expiresAt: now + (kind === 'time_up' ? 5 * 60_000 : 150_000),
      quietMs: CONST.typingQuietMs,
      bypassGap: true,
      bypassCap: kind === 'time_up',
      mustSpeak,
      detail: label,
      data: { remainingMin: Math.max(0, Math.round(remaining / 60_000)) },
    });
    const half = s.durationMs / 2;
    if (t.timeChecks.includes('half')) {
      fire('half', !s.accepted && near(half) && remaining >= 12 * 60_000, () =>
        clock(`Halfway point: ${mmss(remaining)} of ${mmss(s.durationMs ?? 0)} remain.`),
      );
    }
    if (t.timeChecks.includes('ten') && s.durationMs >= 25 * 60_000) {
      fire('ten', near(10 * 60_000), () => clock(`${mmss(remaining)} remain in the session.`));
    }
    if (t.timeChecks.includes('five')) {
      fire('five', near(5 * 60_000), () => clock(`${mmss(remaining)} remain in the session.`));
    }
    fire('up', remaining <= 0, () => clock('Time is up for this session.', true, 'time_up'));
  }

  // Stall: nothing from the candidate (edits, chat, runs) since the last thing anyone did.
  if (s.greeted) {
    const base = Math.max(s.lastActivityAt ?? 0, s.lastInterviewerMsgAt ?? 0, s.startedAt ?? 0);
    const idle = now - base;
    const threshold = t.stallMs * STYLE_STALL_FACTOR[s.settings.style];
    const next =
      s.stallLevel === 0
        ? threshold
        : s.stallLevel === 1
          ? threshold * CONST.stallEscalation
          : Infinity;
    if (base > 0 && idle >= next) {
      s.stallLevel += 1;
      push(s, {
        kind: 'stall',
        createdAt: now,
        expiresAt: now + 60_000,
        quietMs: 0,
        // Idle time is already measured from the last interviewer message, so the stall
        // threshold (which style scales) governs rather than the generic gap.
        bypassGap: true,
        cancelOnEdit: true,
        detail: `No edits, runs or messages from the candidate for ${mmss(idle)}.`,
        data: { idleMs: idle, level: s.stallLevel },
      });
    }
  }

  // Checkpoint: the candidate wrote something and has paused typing.
  if (
    !s.quant &&
    s.codeChangesSinceCheckpoint > 0 &&
    s.lastCodeChangeAt !== null &&
    now - s.lastCodeChangeAt >= CONST.typingQuietMs &&
    (s.lastCheckpointAt === null || now - s.lastCheckpointAt >= CONST.checkpointIntervalMs)
  ) {
    s.codeChangesSinceCheckpoint = 0;
    s.lastCheckpointAt = now;
    push(s, {
      kind: 'checkpoint',
      createdAt: now,
      expiresAt: now + 60_000,
      quietMs: CONST.typingQuietMs,
      // Cheap in stage 1 (no model call unless stage 2 finds something), so only the floor gap
      // applies here; stage 2 applies the normal gap to plain reviews.
      bypassGap: true,
      cancelOnEdit: true,
      detail: 'The candidate paused typing.',
    });
  }
}

export type BlockReason =
  | 'waiting'
  | 'ended'
  | 'disabled'
  | 'typing'
  | 'candidate_talking'
  | 'gap'
  | 'consider_gap'
  | 'unanswered_cap'
  | 'backoff'
  | 'session_cap';

/** Why a moment is not ready now (null = ready). Exposed for tests and traces. */
export function blocked(s: PolicyState, m: Moment, now: number): BlockReason | null {
  const t = tuningFor(s);
  if (s.ended) return 'ended';
  if (!s.settings.enabled) return 'disabled';
  if (m.kind === 'greeting') return null;
  if (s.wrappedUp) return 'ended';
  if (s.backoffUntil !== null && now < s.backoffUntil && !m.mustSpeak) return 'backoff';
  if (m.notBefore !== undefined && now < m.notBefore) return 'waiting';
  const waited = now - m.createdAt;
  const typingFor = s.lastCodeChangeAt === null ? Infinity : now - s.lastCodeChangeAt;
  if (typingFor < m.quietMs && !(m.mustSpeak && waited >= CONST.maxDeferMs)) return 'typing';
  if (s.lastCandidateMsgAt !== null && now - s.lastCandidateMsgAt < CONST.candidateTalkingMs)
    return 'candidate_talking';
  if (m.mustSpeak) return null;
  if (
    s.considerations >= CONST.maxConsiderations ||
    s.proactiveMessages >= CONST.maxProactiveMessages
  )
    return 'session_cap';
  if (!m.bypassCap && s.unanswered >= t.maxUnanswered) return 'unanswered_cap';
  const gap = m.bypassGap ? CONST.floorGapMs : t.minGapMs;
  if (s.lastInterviewerMsgAt !== null && now - s.lastInterviewerMsgAt < gap) return 'gap';
  const cgap = m.bypassGap ? CONST.floorConsiderGapMs : t.considerGapMs;
  if (s.lastConsideredAt !== null && now - s.lastConsideredAt < cgap) return 'consider_gap';
  return null;
}

/**
 * Derive time-based moments, drop expired ones and return the highest-priority ready moment
 * (still pending; call `take` before working on it).
 */
export function poll(s: PolicyState, now: number): Moment | null {
  if (s.ended) return null;
  derive(s, now);
  s.pending = s.pending.filter((m) => m.expiresAt > now);
  let best: Moment | null = null;
  for (const m of s.pending) {
    if (blocked(s, m, now) !== null) continue;
    if (!best || PRIORITY[m.kind] > PRIORITY[best.kind]) best = m;
  }
  return best;
}

export function take(s: PolicyState, m: Moment): void {
  s.pending = s.pending.filter((p) => p !== m);
}

/** The model is being consulted for this moment. */
export function markConsidered(s: PolicyState, m: Moment, now: number): void {
  s.lastConsideredAt = now;
  s.considerations += 1;
  if (m.kind === 'approach_check') s.approachAsked = true;
  if (m.kind === 'greeting') s.greeted = true;
  if (m.kind === 'time_up') s.wrappedUp = true;
}

export function onInterviewerMessage(s: PolicyState, now: number, proactive: boolean): void {
  s.lastInterviewerMsgAt = now;
  s.greeted = true;
  if (proactive) {
    s.unanswered += 1;
    s.proactiveMessages += 1;
  }
}

/** A speak decision came back; is it still a good moment (the model call took a while)? */
export function stillAppropriate(
  s: PolicyState,
  m: Moment,
  now: number,
  decidedFrom: number,
): boolean {
  if (s.ended) return false;
  if (m.mustSpeak || m.kind === 'run_accepted') return true;
  if (s.lastCandidateMsgAt !== null && s.lastCandidateMsgAt >= decidedFrom) return false;
  if (s.lastCodeChangeAt !== null && now - s.lastCodeChangeAt < CONST.staleTypingMs) return false;
  return true;
}

// ---------------------------------------------------------------- stage 2 (content-based)

export interface CodeFacts {
  /** Non-empty, non-comment lines that are not part of the scaffold. */
  newLines: number;
  /** Total words the candidate has written in chat. */
  candidateWords: number;
}

export function codeFacts(code: string, scaffold: string, candidateTexts: string[]): CodeFacts {
  const norm = (l: string) => l.trim();
  const scaffoldLines = new Set(scaffold.split('\n').map(norm).filter(Boolean));
  const meaningful = code
    .split('\n')
    .map(norm)
    .filter(
      (l) => l && !scaffoldLines.has(l) && !/^(\/\/|#|\/\*|\*)/.test(l) && !/^[{}();]+$/.test(l),
    );
  const candidateWords = candidateTexts.reduce(
    (n, t) => n + t.split(/\s+/).filter(Boolean).length,
    0,
  );
  return { newLines: meaningful.length, candidateWords };
}

/**
 * Decide on content whether a moment goes to the model. Returns the (possibly re-labelled)
 * moment, or null to drop it without a model call.
 */
export function refine(
  s: PolicyState,
  m: Moment,
  facts: CodeFacts,
  hasInterviewerMessage: boolean,
  now: number,
): Moment | null {
  const t = tuningFor(s);
  switch (m.kind) {
    case 'greeting':
      return hasInterviewerMessage ? null : m;
    case 'checkpoint': {
      if (
        !s.approachAsked &&
        facts.newLines >= CONST.approachMinLines &&
        facts.candidateWords < CONST.approachExplainedWords
      ) {
        return {
          ...m,
          kind: 'approach_check',
          detail: `The candidate has started coding (${facts.newLines} lines beyond the scaffold) and has written only ${facts.candidateWords} words in chat so far.`,
          data: { newLines: facts.newLines },
        };
      }
      const gapOk = s.lastInterviewerMsgAt === null || now - s.lastInterviewerMsgAt >= t.minGapMs;
      const considerOk = s.lastConsideredAt === null || now - s.lastConsideredAt >= t.considerGapMs;
      if (
        t.checkpointReviews &&
        gapOk &&
        considerOk &&
        facts.newLines - s.linesAtLastReview >= CONST.checkpointMinNewLines
      ) {
        s.linesAtLastReview = facts.newLines;
        return {
          ...m,
          detail: `Periodic look at the code: ${facts.newLines} lines written beyond the scaffold.`,
        };
      }
      return null;
    }
    case 'time_check':
      return m;
    default:
      return m;
  }
}
