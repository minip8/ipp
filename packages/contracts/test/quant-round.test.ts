import { describe, expect, it } from 'vitest';
import {
  advanceRound,
  CreateQuantPadRequest,
  createQuantRound,
  MessageIntent,
  Pad,
  PadDetail,
  PadSummary,
  publicRound,
  QUANT_BUDGET_MIN_SEC,
  QUANT_REPORT_DIMENSIONS,
  type QuantAdvance,
  type QuantEffects,
  type QuantPick,
  QuantQuestionView,
  type QuantRefusal,
  type QuantRoundState,
  QuantRoundState as QuantRoundStateSchema,
  type QuantRoundStep,
  QuantRoundView,
  quantBudgetSec,
  quantClock,
  quantGraceSec,
  quantPhase,
  quantQuestionCount,
  quantQuestionStatus,
  quantRoundEndsAt,
  quantTimeSec,
  REPORT_DIMENSIONS,
  Report,
  ReportAssessment,
  ServerEvent,
  TimelineEvent,
} from '../src';

const T0 = Date.parse('2026-11-26T10:00:00.000Z');
const at = (sec: number) => new Date(T0 + sec * 1000);
const PAD_ID = '11111111-1111-4111-8111-111111111111';

/** Picks whose ids, prompts and units are easy to find in a serialised view. */
const picks = (n: number, hints = 2): QuantPick[] =>
  Array.from({ length: n }, (_, i) => ({
    questionId: `secret-qid-${i}`,
    topic: i % 2 ? 'probability' : 'brainteasers',
    topicTitle: i % 2 ? 'Probability' : 'Brainteasers',
    difficulty: i === 0 ? 'easy' : i === 1 ? 'medium' : 'hard',
    prompt: `PROMPT-${i}: what is $\\frac{1}{${i + 2}}$?`,
    unit: i % 2 ? 'dollars' : null,
    hintsAvailable: hints,
  }));

/** A round driven step by step, failing the test on any refusal. */
function round(durationMin = 30, n = quantQuestionCount(durationMin), hints = 2) {
  let ids = 0;
  const r = {
    state: createQuantRound('trader', durationMin, picks(n, hints)),
    version: 0,
    endsAt: quantRoundEndsAt(new Date(T0), durationMin),
    try(step: QuantRoundStep, sec: number): QuantAdvance {
      return advanceRound(r.state, step, {
        version: r.version,
        now: at(sec),
        roundEndsAt: r.endsAt,
        newId: () => `00000000-0000-4000-8000-${String(++ids).padStart(12, '0')}`,
      });
    },
    apply(step: QuantRoundStep, sec: number): QuantEffects {
      const out = r.try(step, sec);
      if (!out.ok) throw new Error(`refused: ${out.reason} for ${JSON.stringify(step)}`);
      expect(out.version).toBe(r.version + 1);
      expect(() => QuantRoundStateSchema.parse(out.state)).not.toThrow();
      r.state = out.state;
      r.version = out.version;
      return out.effects;
    },
    refuse(step: QuantRoundStep, sec: number): QuantRefusal {
      const before = JSON.stringify(r.state);
      const out = r.try(step, sec);
      expect(JSON.stringify(r.state)).toBe(before);
      if (out.ok) throw new Error(`accepted: ${JSON.stringify(step)}`);
      return out.reason;
    },
    get v() {
      return r.version;
    },
    get cur() {
      return r.state.current;
    },
  };
  return r;
}

const verdict = (score = 0.75) => ({ score, summary: `VERDICT-SECRET ${score}` });
const start = (version: number) => ({ type: 'start' as const, version, say: 'Hello.' });
const turn = (
  version: number,
  index: number,
  extra: Partial<Extract<QuantRoundStep, { type: 'turn' }>> = {},
) => ({
  type: 'turn' as const,
  version,
  index,
  kind: 'chat' as const,
  say: 'Go on.',
  action: 'stay' as const,
  ...extra,
});
const close = (
  version: number,
  index: number,
  by: 'interviewer' | 'timeout' | 'round_time' = 'interviewer',
  v: { score: number; summary: string } | null = verdict(),
) => ({
  type: 'close' as const,
  version,
  index,
  kind: 'chat' as const,
  say: 'Right, moving on.',
  by,
  verdict: v,
});

// ---------------------------------------------------------------- schemas

describe('contracts: old payloads still parse', () => {
  const pad = {
    id: PAD_ID,
    ownerId: 'u1',
    title: 'Two Sum',
    kind: 'practice',
    problemSlug: 'two-sum',
    language: 'python',
    status: 'active',
    durationMin: 45,
    interviewer: { enabled: true, style: 'neutral', proactivity: 'normal', voice: false },
    shareToken: null,
    startedAt: '2026-11-26T10:00:00.000Z',
    endedAt: null,
  };

  it('a pad without a format is a coding pad', () => {
    expect(Pad.parse(pad).format).toBe('coding');
    expect(Pad.parse({ ...pad, format: 'quant', problemSlug: null }).format).toBe('quant');
    expect(Pad.safeParse({ ...pad, format: 'essay' }).success).toBe(false);
  });

  it('a summary and a detail without the new fields', () => {
    const summary = {
      id: PAD_ID,
      title: 't',
      kind: 'practice',
      problemSlug: null,
      language: 'python',
      status: 'ended',
      startedAt: pad.startedAt,
      endedAt: pad.startedAt,
      problemTitle: null,
      difficulty: null,
      accepted: false,
      role: 'owner',
    };
    expect(PadSummary.parse(summary).format).toBe('coding');
    expect(PadSummary.parse(summary).quantPath).toBeNull();
    expect(
      PadSummary.parse({ ...summary, format: 'quant', quantPath: 'researcher' }).quantPath,
    ).toBe('researcher');
    const detail = PadDetail.parse({
      pad,
      role: 'owner',
      problem: null,
      messages: [],
      runs: [],
      interviewerAvailable: false,
      interviewerKey: 'missing',
    });
    expect(detail.round).toBeNull();
    expect(detail.pad.format).toBe('coding');
  });

  it('a report without `quant`, and assessments over either set of dimensions', () => {
    const report = Report.parse({
      padId: PAD_ID,
      status: 'ready',
      generatedAt: null,
      stats: {
        durationSec: 1,
        runs: 0,
        submissions: 0,
        accepted: false,
        candidateMessages: 0,
        interviewerMessages: 0,
      },
      assessment: null,
      assessmentUnavailable: 'failed',
    });
    expect(report.quant).toBeNull();
    // A quant pad's report has no run figures; one stored before that still parses (above).
    const quantStats = Report.shape.stats.parse({
      durationSec: 1,
      runs: null,
      submissions: null,
      accepted: null,
      candidateMessages: 0,
      interviewerMessages: 0,
    });
    expect(quantStats.runs).toBeNull();
    const assessment = (dims: readonly string[]) => ({
      recommendation: 'hire',
      summary: 's',
      scores: dims.map((dimension) => ({ dimension, score: 3, evidence: 'e' })),
      strengths: [],
      improvements: [],
    });
    expect(ReportAssessment.safeParse(assessment(REPORT_DIMENSIONS)).success).toBe(true);
    expect(ReportAssessment.safeParse(assessment(QUANT_REPORT_DIMENSIONS)).success).toBe(true);
    expect(ReportAssessment.safeParse(assessment(['charisma'])).success).toBe(false);
  });

  it('the question intent, the question event and round.updated', () => {
    expect(MessageIntent.parse('question')).toBe('question');
    expect(
      TimelineEvent.parse({
        id: PAD_ID,
        padId: PAD_ID,
        at: pad.startedAt,
        event: { type: 'question', index: 0, total: 4 },
      }).event,
    ).toEqual({ type: 'question', index: 0, total: 4 });
    const r = round();
    r.apply(start(0), 0);
    const ev = ServerEvent.parse({ type: 'round.updated', round: publicRound(r.state, r.v) });
    expect(ev.type === 'round.updated' && ev.round.questions).toHaveLength(1);
  });

  it('CreateQuantPadRequest: defaults, lengths offered, no `enabled`', () => {
    const req = CreateQuantPadRequest.parse({ path: 'trader' });
    expect(req).toEqual({
      path: 'trader',
      durationMin: 30,
      interviewer: { style: 'neutral', proactivity: 'normal', voice: false },
    });
    expect(CreateQuantPadRequest.safeParse({ path: 'trader', durationMin: 25 }).success).toBe(
      false,
    );
    expect(CreateQuantPadRequest.safeParse({ path: 'quant-dev' }).success).toBe(false);
    const off = CreateQuantPadRequest.parse({
      path: 'researcher',
      durationMin: 45,
      interviewer: { enabled: false, style: 'tough' },
    });
    expect(off.interviewer).not.toHaveProperty('enabled');
    expect(off.interviewer.style).toBe('tough');
  });

  it('the view schema strips every server-only field', () => {
    const r = round();
    r.apply(start(0), 0);
    const q = r.state.questions[0];
    const parsed = QuantQuestionView.parse({ ...q, index: 0, hintsGiven: 0 });
    for (const k of ['questionId', 'verdict', 'hintRungs', 'nudgedAt', 'subtopic']) {
      expect(parsed).not.toHaveProperty(k);
    }
  });
});

// ---------------------------------------------------------------- budget

describe('quantBudgetSec', () => {
  const ends = quantRoundEndsAt(new Date(T0), 30);
  const budget = (sec: number, remaining: number, durationMin = 30, total = 4) =>
    quantBudgetSec({
      durationMin,
      total,
      remaining,
      now: at(sec),
      roundEndsAt: quantRoundEndsAt(new Date(T0), durationMin),
    });

  it('question counts and the round clock', () => {
    expect(quantQuestionCount(20)).toBe(3);
    expect(quantQuestionCount(30)).toBe(4);
    expect(quantQuestionCount(45)).toBe(6);
    expect(ends.toISOString()).toBe('2026-11-26T10:30:00.000Z');
    expect(quantRoundEndsAt('2026-11-26T10:00:00.000Z', 45).toISOString()).toBe(
      '2026-11-26T10:45:00.000Z',
    );
  });

  it('shares the time left, less the wrap-up, between the questions to come', () => {
    expect(budget(0, 4)).toEqual({ budgetSec: 435, graceSec: 90 }); // (1800 - 60) / 4
    expect(budget(525, 3)).toEqual({ budgetSec: 405, graceSec: 90 });
    expect(budget(1470, 1)).toEqual({ budgetSec: 270, graceSec: 67 });
  });

  it('rolls unused time forward, up to 1.5 times the even share', () => {
    // 30 min / 4 = 450 s; the cap is 675 s.
    expect(budget(60, 3).budgetSec).toBe(560); // (1800 - 60 - 60) / 3
    expect(budget(10, 1).budgetSec).toBe(675);
    // 20 min / 3 = 400 s; the cap is 600 s.
    expect(budget(10, 1, 20, 3).budgetSec).toBe(600);
  });

  it('never gives less than the floor, and the grace is a quarter, at most 90 s', () => {
    expect(budget(1700, 1).budgetSec).toBe(QUANT_BUDGET_MIN_SEC);
    expect(budget(1700, 4).budgetSec).toBe(QUANT_BUDGET_MIN_SEC);
    expect(budget(5000, 2).budgetSec).toBe(QUANT_BUDGET_MIN_SEC);
    expect(quantGraceSec(120)).toBe(30);
    expect(quantGraceSec(359)).toBe(89);
    expect(quantGraceSec(1000)).toBe(90);
  });
});

// ---------------------------------------------------------------- advanceRound

describe('advanceRound: refusals', () => {
  it('start only while pending', () => {
    const r = round();
    expect(r.refuse(start(1), 0)).toBe('stale');
    const fx = r.apply(start(0), 0);
    expect(fx.reveal?.index).toBe(0);
    // The duplicate session_started (after a key change), on the old or the new version.
    expect(r.refuse(start(0), 1)).toBe('stale');
    expect(r.refuse(start(r.v), 1)).toBe('wrong_phase');
  });

  it('turn and close while pending', () => {
    const r = round();
    expect(r.refuse(turn(0, 0), 0)).toBe('wrong_phase');
    expect(r.refuse(close(0, 0), 0)).toBe('wrong_phase');
    expect(r.refuse({ type: 'verdict', version: 0, index: 0, verdict: verdict() }, 0)).toBe(
      'not_closed',
    );
  });

  it('every step on an older version is stale', () => {
    const r = round();
    r.apply(start(0), 0);
    r.apply(turn(r.v, 0), 5);
    const old = r.v - 1;
    expect(r.refuse(turn(old, 0), 6)).toBe('stale');
    expect(r.refuse(close(old, 0), 6)).toBe('stale');
    r.apply(close(r.v, 0), 10);
    expect(r.refuse({ type: 'verdict', version: old, index: 0, verdict: verdict() }, 11)).toBe(
      'stale',
    );
  });

  it('turn and close only for the current question', () => {
    const r = round();
    r.apply(start(0), 0);
    expect(r.refuse(turn(r.v, 1), 1)).toBe('wrong_index');
    expect(r.refuse(turn(r.v, -1), 1)).toBe('wrong_index');
    r.apply(close(r.v, 0), 10);
    expect(r.refuse(turn(r.v, 0), 11)).toBe('wrong_index');
    expect(r.refuse(close(r.v, 0), 11)).toBe('wrong_index');
    expect(r.refuse(close(r.v, 2), 11)).toBe('wrong_index');
  });

  it('hint rungs in order, none skipped, none twice, none beyond the authored ones', () => {
    const r = round(30, 4, 2);
    r.apply(start(0), 0);
    const hint = (hintRung?: number) => turn(r.v, 0, { action: 'hint', hintRung });
    expect(r.refuse(hint(), 1)).toBe('hint_rung');
    expect(r.refuse(hint(2), 1)).toBe('hint_rung');
    expect(r.refuse(hint(1.5), 1)).toBe('invalid');
    expect(r.refuse(hint(-1), 1)).toBe('invalid');
    expect(r.apply(hint(1), 2).say?.intent).toBe('hint');
    expect(r.refuse(hint(1), 3)).toBe('hint_rung');
    r.apply(hint(0), 4); // the interviewer's own words: any number of times
    r.apply(hint(0), 5);
    r.apply(hint(2), 6);
    expect(r.refuse(hint(3), 7)).toBe('hint_rung');
    expect(r.state.questions[0]?.hintRungs).toEqual([1, 0, 0, 2]);
    expect(publicRound(r.state, r.v).questions[0]?.hintsGiven).toBe(4);
    // A rung on a non-hint action is ignored, not booked.
    r.apply(turn(r.v, 0, { action: 'stay', hintRung: 3 }), 8);
    expect(r.state.questions[0]?.hintRungs).toEqual([1, 0, 0, 2]);
  });

  it('a question without authored hints takes only the interviewer’s own', () => {
    const r = round(30, 4, 0);
    r.apply(start(0), 0);
    expect(r.refuse(turn(r.v, 0, { action: 'hint', hintRung: 1 }), 1)).toBe('hint_rung');
    r.apply(turn(r.v, 0, { action: 'hint', hintRung: 0 }), 1);
  });

  it('one follow-up per question, one nudge per question', () => {
    const r = round();
    r.apply(start(0), 0);
    expect(r.apply(turn(r.v, 0, { action: 'follow_up' }), 1).say?.intent).toBe('probe');
    expect(r.refuse(turn(r.v, 0, { action: 'follow_up' }), 2)).toBe('follow_up_used');
    const nudge = turn(r.v, 0, { kind: 'proactive', nudge: true });
    expect(r.apply(nudge, 435).say).toEqual({
      text: 'Go on.',
      kind: 'proactive',
      intent: 'time_check',
    });
    expect(r.state.questions[0]?.nudgedAt).toBe(at(435).toISOString());
    expect(r.refuse({ ...nudge, version: r.v }, 440)).toBe('nudged');
    // A nudge that also gives a hint books both, and is refused whole when either is.
    expect(r.refuse(turn(r.v, 0, { action: 'hint', hintRung: 1, nudge: true }), 441)).toBe(
      'nudged',
    );
    expect(r.state.questions[0]?.hintRungs).toEqual([]);
    // The next question has its own follow-up and nudge.
    r.apply(close(r.v, 0), 450);
    r.apply(turn(r.v, 1, { action: 'follow_up' }), 451);
  });

  it('closing for time needs the time to be up; a verdict must be in 0..1', () => {
    const r = round();
    r.apply(start(0), 0);
    expect(r.refuse(close(r.v, 0, 'timeout'), 434)).toBe('too_early');
    expect(r.refuse(close(r.v, 0, 'round_time'), 1799)).toBe('too_early');
    expect(r.refuse(close(r.v, 0, 'interviewer', { score: 1.5, summary: 's' }), 10)).toBe(
      'invalid',
    );
    expect(r.refuse(close(r.v, 0, 'interviewer', { score: Number.NaN, summary: 's' }), 10)).toBe(
      'invalid',
    );
    r.apply(close(r.v, 0, 'timeout', null), 435);
    expect(r.state.questions[0]?.closedBy).toBe('timeout');
  });

  it('a verdict only for a closed question without one', () => {
    const r = round();
    r.apply(start(0), 0);
    const v = (index: number, score = 0.5) => ({
      type: 'verdict' as const,
      version: r.v,
      index,
      verdict: verdict(score),
    });
    expect(r.refuse(v(0), 1)).toBe('not_closed'); // open
    expect(r.refuse(v(1), 1)).toBe('not_closed'); // never posed
    expect(r.refuse(v(9), 1)).toBe('wrong_index');
    expect(r.refuse(v(-1), 1)).toBe('wrong_index');
    expect(r.refuse(v(0.5), 1)).toBe('wrong_index');
    r.apply(close(r.v, 0, 'interviewer', null), 100);
    expect(r.refuse(v(0, 2), 101)).toBe('invalid');
    const fx = r.apply(v(0), 101);
    expect(fx).toEqual({ say: null, reveal: null, note: null, finished: false });
    expect(r.state.questions[0]?.verdict).toEqual(verdict(0.5));
    expect(r.refuse(v(0), 102)).toBe('has_verdict');
    // A question closed with a verdict already has one.
    r.apply(close(r.v, 1), 200);
    expect(r.refuse(v(1), 201)).toBe('has_verdict');
  });

  it('nothing but a verdict once the round has finished', () => {
    const r = round();
    r.apply(start(0), 0);
    r.apply({ type: 'end' }, 60);
    expect(quantPhase(r.state)).toBe('finished');
    expect(r.refuse(start(r.v), 61)).toBe('ended');
    expect(r.refuse(turn(r.v, 0), 61)).toBe('ended');
    expect(r.refuse(turn(r.v, 4), 61)).toBe('ended');
    expect(r.refuse(close(r.v, 0), 61)).toBe('ended');
    expect(r.refuse({ type: 'end' }, 61)).toBe('ended');
    // Even on a stale version, `ended` says why.
    expect(r.refuse(turn(0, 0), 61)).toBe('ended');
    r.apply({ type: 'verdict', version: r.v, index: 0, verdict: verdict(0.2) }, 62);
    expect(r.state.questions[0]?.verdict?.score).toBe(0.2);
  });

  it('never modifies its input', () => {
    const r = round();
    r.apply(start(0), 0);
    const frozen = structuredClone(r.state);
    const deepFreeze = (o: object) => {
      Object.freeze(o);
      for (const v of Object.values(o)) if (v && typeof v === 'object') deepFreeze(v);
    };
    deepFreeze(r.state);
    r.apply(turn(r.v, 0, { action: 'hint', hintRung: 1, nudge: true }), 500);
    r.apply(close(r.v, 0), 501);
    expect(frozen.questions[0]?.hintRungs).toEqual([]);
    expect(frozen.questions[0]?.closedAt).toBeNull();
  });
});

describe('advanceRound: a round played through', () => {
  it('by timeouts: nudge at the budget, close after the grace, the clock closes the last', () => {
    const r = round(30); // 4 questions, ends at 1800 s
    const fx = r.apply(start(0), 0);
    expect(fx.say).toEqual({ text: 'Hello.', kind: 'proactive', intent: 'greeting' });
    expect(fx.reveal).toEqual({
      index: 0,
      total: 4,
      messageId: '00000000-0000-4000-8000-000000000001',
      text: r.state.questions[0]?.prompt,
    });
    expect(r.state.questions[0]?.posedMessageId).toBe(fx.reveal?.messageId);

    const budgets: number[] = [];
    let t = 0;
    while (quantPhase(r.state) === 'asking') {
      const clock = quantClock(r.state, r.endsAt);
      if (!clock) throw new Error('no clock');
      expect(clock.index).toBe(r.cur);
      expect(clock.posedAt).toBe(T0 + t * 1000);
      budgets.push(clock.budgetMs / 1000);
      const nudgeAt = t + clock.budgetMs / 1000;
      const closeAt = nudgeAt + clock.graceMs / 1000;
      if (closeAt * 1000 + T0 >= clock.roundEndsAt) {
        // The round's clock runs out first.
        const end = (clock.roundEndsAt - T0) / 1000;
        const last = r.apply(
          { ...close(r.v, r.cur, 'round_time', null), kind: 'proactive', say: 'Time.' },
          end,
        );
        expect(last).toMatchObject({ reveal: null, finished: true });
        expect(last.say?.intent).toBe('wrap_up');
        break;
      }
      r.apply(turn(r.v, r.cur, { kind: 'proactive', nudge: true }), nudgeAt);
      expect(quantClock(r.state, r.endsAt)?.nudged).toBe(true);
      const fxc = r.apply({ ...close(r.v, r.cur, 'timeout', null), kind: 'proactive' }, closeAt);
      expect(fxc.say?.intent).toBe(fxc.finished ? 'wrap_up' : 'feedback');
      t = closeAt;
    }
    expect(budgets).toEqual([435, 405, 360, 270]);
    expect(quantPhase(r.state)).toBe('finished');
    expect(r.state.current).toBe(4);
    expect(quantClock(r.state, r.endsAt)).toBeNull();
    expect(r.state.questions.map((q) => q.closedBy)).toEqual([
      'timeout',
      'timeout',
      'timeout',
      'round_time',
    ]);
    expect(r.state.questions.map(quantQuestionStatus)).toEqual([
      'timed_out',
      'timed_out',
      'timed_out',
      'unfinished',
    ]);
    expect(r.state.questions.map(quantTimeSec)).toEqual([525, 495, 450, 330]);
    const view = publicRound(r.state, r.v);
    expect(view.phase).toBe('finished');
    expect(view.questions.map((q) => q.budgetSec)).toEqual([435, 405, 360, 270]);
  });

  it('by interviewer closes: fast answers roll their time forward', () => {
    const r = round(20); // 3 questions, ends at 1200 s, even share 400 s, cap 600 s
    r.apply(start(0), 0);
    const reveals: (QuantEffects['reveal'] | null)[] = [];
    reveals.push(r.apply(close(r.v, 0, 'interviewer', verdict(1)), 60).reveal);
    reveals.push(r.apply(close(r.v, 1, 'interviewer', verdict(0.5)), 90).reveal);
    const last = r.apply(close(r.v, 2, 'interviewer', verdict(0)), 300);
    expect(last).toMatchObject({ reveal: null, finished: true });
    expect(last.say?.intent).toBe('wrap_up');
    expect(reveals.map((x) => x?.index)).toEqual([1, 2]);
    expect(reveals.map((x) => x?.text)).toEqual(r.state.questions.slice(1).map((q) => q.prompt));
    expect(r.state.questions.map((q) => q.budgetSec)).toEqual([380, 540, 600]);
    expect(r.state.questions.map((q) => q.verdict?.score)).toEqual([1, 0.5, 0]);
    expect(r.state.questions.map(quantQuestionStatus)).toEqual([
      'answered',
      'answered',
      'answered',
    ]);
    expect(r.refuse(close(r.v, 3), 301)).toBe('ended');
  });

  it('the pad ending closes the open question and poses no other', () => {
    const r = round(45); // 6 questions
    r.apply(start(0), 0);
    r.apply(close(r.v, 0), 100);
    const fx = r.apply({ type: 'end' }, 200);
    expect(fx).toEqual({ say: null, reveal: null, note: null, finished: true });
    expect(r.state.questions.map(quantQuestionStatus)).toEqual([
      'answered',
      'unfinished',
      'not_reached',
      'not_reached',
      'not_reached',
      'not_reached',
    ]);
    expect(r.state.questions[1]).toMatchObject({ closedBy: 'ended', verdict: null });
    expect(publicRound(r.state, r.v).questions).toHaveLength(2);
    // The assessment then judges the open one.
    r.apply({ type: 'verdict', version: r.v, index: 1, verdict: verdict(0.3) }, 300);
  });

  it('the pad ending before the round started', () => {
    const r = round();
    const fx = r.apply({ type: 'end' }, 10);
    expect(fx.finished).toBe(true);
    expect(r.state.questions.every((q) => q.posedAt === null)).toBe(true);
    expect(publicRound(r.state, r.v)).toMatchObject({ phase: 'finished', questions: [] });
  });

  it('too little of the round left for another question finishes it', () => {
    const r = round(30);
    r.apply(start(0), 0);
    const fx = r.apply(close(r.v, 0), 1800 - QUANT_BUDGET_MIN_SEC + 1);
    expect(fx).toMatchObject({ reveal: null, finished: true });
    expect(fx.say?.intent).toBe('wrap_up');
    // With exactly the floor left, the question is posed with the floor as its budget.
    const s = round(30);
    s.apply(start(0), 0);
    expect(s.apply(close(s.v, 0), 1800 - QUANT_BUDGET_MIN_SEC).reveal?.index).toBe(1);
    expect(s.state.questions[1]?.budgetSec).toBe(QUANT_BUDGET_MIN_SEC);
  });

  it('a round started after its clock ran out finishes with nothing posed', () => {
    const r = round(20);
    const fx = r.apply(start(0), 1200);
    expect(fx).toMatchObject({ reveal: null, finished: true });
    expect(r.state.questions.every((q) => q.posedAt === null)).toBe(true);
  });

  it('the round clock closes the round whatever is left', () => {
    const r = round(45);
    r.apply(start(0), 0);
    r.apply(close(r.v, 0), 2000);
    const fx = r.apply(close(r.v, 1, 'round_time', null), 2700);
    expect(fx.finished).toBe(true);
    expect(r.state.questions.map(quantQuestionStatus).slice(0, 3)).toEqual([
      'answered',
      'unfinished',
      'not_reached',
    ]);
  });

  it('message intents, silence and notes', () => {
    const r = round();
    expect(r.apply({ ...start(0), say: null }, 0).say).toBeNull();
    expect(r.apply(turn(r.v, 0), 1).say).toEqual({
      text: 'Go on.',
      kind: 'chat',
      intent: 'answer',
    });
    expect(r.apply(turn(r.v, 0, { kind: 'proactive' }), 2).say?.intent).toBe('nudge');
    expect(r.apply(turn(r.v, 0, { say: '  ' }), 3).say).toBeNull();
    expect(r.apply(turn(r.v, 0, { say: null, note: 'slow on Bayes' }), 4)).toEqual({
      say: null,
      reveal: null,
      note: 'slow on Bayes',
      finished: false,
    });
    const fx = r.apply(close(r.v, 0), 5);
    expect(fx.say?.intent).toBe('feedback');
    expect(fx.reveal?.index).toBe(1);
  });
});

// ---------------------------------------------------------------- publicRound

/** Small deterministic PRNG (mulberry32), so a failure reproduces. */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Structural invariants every reachable state keeps. */
function checkInvariants(s: QuantRoundState) {
  const phase = quantPhase(s);
  const posed = s.questions.map((q) => q.posedAt !== null);
  const k = posed.indexOf(false) === -1 ? posed.length : posed.indexOf(false);
  // Posed questions are a prefix.
  expect(posed.slice(k).every((p) => !p)).toBe(true);
  s.questions.forEach((q, i) => {
    if (q.posedAt === null) {
      expect(q).toMatchObject({ closedAt: null, verdict: null, hintRungs: [], budgetSec: null });
      return;
    }
    expect(q.budgetSec).toBeGreaterThanOrEqual(QUANT_BUDGET_MIN_SEC);
    const authored = q.hintRungs.filter((x) => x > 0);
    expect(authored).toEqual(authored.map((_, j) => j + 1));
    expect(authored.length).toBeLessThanOrEqual(q.hintsAvailable);
    const open = phase === 'asking' && i === s.current;
    expect(q.closedAt === null).toBe(open);
    if (q.verdict) expect(q.closedAt).not.toBeNull();
  });
  if (phase === 'asking') expect(k).toBe(s.current + 1);
}

describe('publicRound', () => {
  it('shows the posed questions only, with exactly the fields of the view', () => {
    const r = round();
    expect(publicRound(r.state, 0)).toEqual({
      path: 'trader',
      total: 4,
      phase: 'pending',
      questions: [],
      version: 0,
    });
    r.apply(start(0), 0);
    r.apply(turn(r.v, 0, { action: 'hint', hintRung: 1, nudge: true }), 10);
    r.apply(close(r.v, 0), 20);
    const view = publicRound(r.state, r.v);
    expect(view).toMatchObject({ phase: 'asking', total: 4, version: 3 });
    expect(view.questions).toEqual([
      {
        index: 0,
        topic: 'brainteasers',
        topicTitle: 'Brainteasers',
        difficulty: 'easy',
        prompt: r.state.questions[0]?.prompt,
        unit: null,
        posedAt: at(0).toISOString(),
        budgetSec: 435,
        closedAt: at(20).toISOString(),
        closedBy: 'interviewer',
        hintsGiven: 1,
        posedMessageId: r.state.questions[0]?.posedMessageId,
      },
      {
        index: 1,
        topic: 'probability',
        topicTitle: 'Probability',
        difficulty: 'medium',
        prompt: r.state.questions[1]?.prompt,
        unit: 'dollars',
        posedAt: at(20).toISOString(),
        budgetSec: r.state.questions[1]?.budgetSec,
        closedAt: null,
        closedBy: null,
        hintsGiven: 0,
        posedMessageId: r.state.questions[1]?.posedMessageId,
      },
    ]);
    // Each question carries the id of the message that posed it, so the chat numbers by identity.
    expect(view.questions.map((q) => q.posedMessageId)).toEqual([
      '00000000-0000-4000-8000-000000000001',
      '00000000-0000-4000-8000-000000000002',
    ]);
    expect(QuantRoundView.parse(view)).toEqual(view);
  });

  it('a question closed for time says so', () => {
    const r = round();
    r.apply(start(0), 0);
    const budget = r.state.questions[0]?.budgetSec ?? 0;
    r.apply(close(r.v, 0, 'timeout'), budget + 1);
    expect(publicRound(r.state, r.v).questions[0]?.closedBy).toBe('timeout');
  });

  it('a round stored before topic titles were snapshotted shows the slug', () => {
    const r = round();
    r.apply(start(0), 0);
    // `quant_rounds.state` is read as typed JSON without parsing: an old row has no `topicTitle`.
    const old = JSON.parse(JSON.stringify(r.state)) as QuantRoundState;
    for (const q of old.questions) delete q.topicTitle;
    expect(QuantRoundStateSchema.safeParse(old).success).toBe(true);
    expect(publicRound(old, r.v).questions[0]?.topicTitle).toBe('brainteasers');
  });

  it('never leaks an id, a verdict or an unposed prompt, for any reachable state', () => {
    const accepted = new Set<string>();
    const finishedWith = new Set<number>();
    for (let seed = 1; seed <= 120; seed++) {
      const rand = rng(seed);
      const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)] as T;
      const durationMin = pick([20, 30, 45] as const);
      const r = round(durationMin, quantQuestionCount(durationMin), Math.floor(rand() * 3));
      let t = 0;
      for (let i = 0; i < 60; i++) {
        t += Math.floor(rand() * 200);
        const idx = rand() < 0.85 ? Math.max(0, r.cur) : Math.floor(rand() * 8) - 1;
        const version = rand() < 0.9 ? r.v : r.v - 1;
        const roll = rand();
        const kind = roll < 0.1 ? 0 : roll < 0.5 ? 1 : roll < 0.85 ? 2 : roll < 0.97 ? 3 : 4;
        const step: QuantRoundStep = [
          () => start(version),
          () =>
            turn(version, idx, {
              action: pick(['stay', 'hint', 'follow_up'] as const),
              hintRung: Math.floor(rand() * 4),
              nudge: rand() < 0.3,
              kind: pick(['chat', 'proactive'] as const),
            }),
          () =>
            close(
              version,
              idx,
              pick(['interviewer', 'timeout', 'round_time'] as const),
              rand() < 0.7 ? verdict(Math.round(rand() * 100) / 100) : null,
            ),
          (): QuantRoundStep => ({ type: 'verdict', version, index: idx, verdict: verdict(0.5) }),
          (): QuantRoundStep => ({ type: 'end' }),
        ][kind]?.() as QuantRoundStep;
        let res: QuantAdvance;
        try {
          res = r.try(step, t);
        } catch (err) {
          throw new Error(`seed ${seed}: threw on ${JSON.stringify(step)}: ${String(err)}`);
        }
        if (res.ok) {
          accepted.add(step.type);
          r.state = res.state;
          r.version = res.version;
        }
        checkInvariants(r.state);

        const view = publicRound(r.state, r.version);
        expect(QuantRoundView.parse(view)).toEqual(view);
        const json = JSON.stringify(view);
        expect(json).not.toContain('secret-qid');
        expect(json).not.toContain('VERDICT-SECRET');
        expect(json).not.toMatch(/"(verdict|questionId|hintRungs|nudgedAt|subtopic|score)"/);
        r.state.questions.forEach((q, qi) => {
          if (q.posedAt === null) expect(json).not.toContain(`PROMPT-${qi}:`);
          else expect(json).toContain(`PROMPT-${qi}:`);
        });
        for (const q of view.questions) {
          expect(Object.keys(q).sort()).toEqual(Object.keys(QuantQuestionView.shape).sort());
        }
      }
      if (quantPhase(r.state) === 'finished') {
        finishedWith.add(r.state.questions.filter((q) => q.posedAt !== null).length);
      }
    }
    // The walk reached every kind of step and rounds that finished at every stage.
    expect([...accepted].sort()).toEqual(['close', 'end', 'start', 'turn', 'verdict']);
    expect(finishedWith.size).toBeGreaterThanOrEqual(5);
  }, 30_000);
});
