/**
 * Quant rooms (ARCHITECTURE §8.4): a hosted round, moved by its host's steps through the same
 * `advanceRound` as an AI round, and the helpers that compose what a candidate is shown.
 */
import { describe, expect, it } from 'vitest';
import {
  advanceRound,
  CloseQuantQuestionRequest,
  CreatePadRequest,
  createHostedRound,
  createQuantRound,
  HostView,
  hostedPick,
  hostedPrompt,
  isHostStep,
  PadDetail,
  publicRound,
  QUANT_HOSTED_HINTS_MAX,
  QUANT_HOSTED_QUESTIONS_MAX,
  QUANT_QUEUE_MAX,
  type QuantAdvance,
  type QuantEffects,
  type QuantPick,
  type QuantRefusal,
  QuantReport,
  type QuantRoundState,
  QuantRoundState as QuantRoundStateSchema,
  type QuantRoundStep,
  QuantRoundView,
  QuizQuestion,
  quantClock,
  quantMode,
  quantPhase,
  quantQuestionStatus,
  quantRoundEndsAt,
  quizSolution,
  SetQuantVerdictRequest,
  TimelineEvent,
} from '../src';

const T0 = Date.parse('2026-11-27T10:00:00.000Z');
const at = (sec: number) => new Date(T0 + sec * 1000);

/** A pick whose id, prompt and topic are easy to find in a serialised view. */
const pick = (k: number, over: Partial<QuantPick> = {}): QuantPick => ({
  questionId: `secret-qid-${k}`,
  topic: k % 2 ? 'probability' : 'cpp',
  topicTitle: k % 2 ? 'Probability' : 'C++',
  difficulty: 'medium',
  type: k % 2 ? 'short' : 'single',
  prompt: `PROMPT-${k}`,
  unit: null,
  hintsAvailable: k % 2 ? 2 : 0,
  ...over,
});

/** A hosted round driven step by step; `refuse` checks nothing changed. */
function hosted(queue: string[] = []) {
  let ids = 0;
  const r = {
    state: createHostedRound(queue),
    version: 0,
    try(step: QuantRoundStep, sec: number): QuantAdvance {
      return advanceRound(r.state, step, {
        version: r.version,
        now: at(sec),
        // A hosted round has no clock: whatever this says is never read.
        roundEndsAt: at(-1),
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
  };
  return r;
}

const pose = (k: number, over: Partial<QuantPick> = {}) => ({
  type: 'pose' as const,
  pick: pick(k, over),
});
const hint = (index: number, rung: number) => ({ type: 'host_hint' as const, index, rung });
const followUp = (index: number) => ({ type: 'host_follow_up' as const, index });
const closeQ = (index: number, verdict: { score: number; summary: string } | null = null) => ({
  type: 'host_close' as const,
  index,
  verdict,
});
const give = (index: number, score = 0.6, summary = 'VERDICT-SECRET') => ({
  type: 'host_verdict' as const,
  index,
  verdict: { score, summary },
});
const queue = (...questionIds: string[]) => ({ type: 'queue' as const, questionIds });
const end = { type: 'end' as const };

describe('a hosted round', () => {
  it('starts empty, has no clock and reads as hosted; stored rounds without a mode are AI-run', () => {
    const s = createHostedRound(['secret-qid-1', 'secret-qid-2']);
    expect(s).toEqual({
      mode: 'hosted',
      path: null,
      durationMin: 0,
      current: -1,
      questions: [],
      queue: ['secret-qid-1', 'secret-qid-2'],
    });
    expect(quantMode(s)).toBe('hosted');
    expect(quantPhase(s)).toBe('pending');
    expect(() => QuantRoundStateSchema.parse(s)).not.toThrow();
    // An AI round is byte for byte what it was: no mode, queue or ended field at all.
    const ai = createQuantRound('trader', 30, [pick(1)]);
    expect(Object.keys(ai).sort()).toEqual(['current', 'durationMin', 'path', 'questions']);
    expect(Object.keys(ai.questions[0] ?? {})).not.toContain('type');
    expect(quantMode(ai)).toBe('ai');
    // Even posed, a hosted question has no clock.
    const r = hosted();
    r.apply(pose(1), 10);
    expect(quantClock(r.state, quantRoundEndsAt(new Date(T0), 30))).toBeNull();
  });

  it('poses a question: appended, current, posted with no total, no budget, out of the queue', () => {
    const r = hosted(['secret-qid-3', 'secret-qid-1']);
    const fx = r.apply(pose(1), 5);
    expect(fx).toEqual({
      say: null,
      reveal: {
        index: 0,
        total: null,
        messageId: '00000000-0000-4000-8000-000000000001',
        text: 'PROMPT-1',
      },
      note: null,
      finished: false,
      quote: null,
      game: null,
    });
    expect(r.state.current).toBe(0);
    expect(quantPhase(r.state)).toBe('asking');
    expect(r.state.queue).toEqual(['secret-qid-3']);
    expect(r.state.questions[0]).toEqual({
      questionId: 'secret-qid-1',
      topic: 'probability',
      difficulty: 'medium',
      type: 'short',
      topicTitle: 'Probability',
      prompt: 'PROMPT-1',
      unit: null,
      hintsAvailable: 2,
      posedAt: at(5).toISOString(),
      posedMessageId: '00000000-0000-4000-8000-000000000001',
      budgetSec: null,
      nudgedAt: null,
      hintRungs: [],
      followUpAsked: false,
      closedAt: null,
      closedBy: null,
      verdict: null,
    });
  });

  it('posing while a question is open closes it first, without a verdict, in the same step', () => {
    const r = hosted();
    r.apply(pose(1), 0);
    const fx = r.apply(pose(2), 90);
    expect(fx.reveal?.index).toBe(1);
    expect(r.state.questions[0]).toMatchObject({
      closedAt: at(90).toISOString(),
      closedBy: 'interviewer',
      verdict: null,
    });
    expect(r.state.current).toBe(1);
    expect(quantQuestionStatus(r.state.questions[0] ?? { posedAt: null, closedBy: null })).toBe(
      'answered',
    );
  });

  it('the same question cannot be posed twice; a malformed or a game pick is refused', () => {
    const r = hosted();
    r.apply(pose(1), 0);
    r.apply(closeQ(0), 10);
    expect(r.refuse(pose(1), 20)).toBe('already_posed');
    expect(r.refuse(pose(4, { questionId: 'Not A Slug' }), 20)).toBe('invalid');
    expect(r.refuse(pose(4, { prompt: '  ' }), 20)).toBe('invalid');
    expect(r.refuse(pose(4, { hintsAvailable: -1 }), 20)).toBe('invalid');
    expect(r.refuse(pose(4, { difficulty: 'extreme' as never }), 20)).toBe('invalid');
    expect(r.refuse(pose(4, { type: 'essay' as never }), 20)).toBe('invalid');
    expect(r.refuse(pose(4, { game: {} as never }), 20)).toBe('invalid');
  });

  it(`poses at most ${QUANT_HOSTED_QUESTIONS_MAX} questions`, () => {
    const r = hosted();
    for (let k = 0; k < QUANT_HOSTED_QUESTIONS_MAX; k++) r.apply(pose(k), k);
    expect(r.refuse(pose(999), 1000)).toBe('question_limit');
  });

  it('records hints: authored rungs in order and up to the ladder, own hints any time', () => {
    const r = hosted();
    r.apply(pose(1), 0);
    expect(r.refuse(hint(0, 2), 1)).toBe('hint_rung');
    r.apply(hint(0, 0), 2);
    r.apply(hint(0, 1), 3);
    expect(r.refuse(hint(0, 1), 4)).toBe('hint_rung');
    r.apply(hint(0, 2), 5);
    expect(r.refuse(hint(0, 3), 6)).toBe('hint_rung');
    r.apply(hint(0, 0), 7);
    expect(r.state.questions[0]?.hintRungs).toEqual([0, 1, 2, 0]);
    expect(r.refuse(hint(0, -1), 8)).toBe('invalid');
    expect(r.refuse(hint(0, 1.5), 8)).toBe('invalid');
    expect(r.refuse(hint(1, 0), 8)).toBe('wrong_index');
    // A choice question has no authored ladder: only the host's own words.
    r.apply(pose(2), 9);
    expect(r.refuse(hint(1, 1), 10)).toBe('hint_rung');
    for (let i = 0; i < QUANT_HOSTED_HINTS_MAX; i++) r.apply(hint(1, 0), 11);
    expect(r.refuse(hint(1, 0), 12)).toBe('hint_limit');
  });

  it('records the follow-up once', () => {
    const r = hosted();
    r.apply(pose(1), 0);
    r.apply(followUp(0), 1);
    expect(r.state.questions[0]?.followUpAsked).toBe(true);
    expect(r.refuse(followUp(0), 2)).toBe('follow_up_used');
    expect(r.refuse(followUp(3), 2)).toBe('wrong_index');
  });

  it('closes the open question with the host verdict or none; then none is open until the next pose', () => {
    const r = hosted();
    expect(r.refuse(closeQ(0), 0)).toBe('not_open');
    expect(r.refuse(hint(0, 0), 0)).toBe('not_open');
    expect(r.refuse(followUp(0), 0)).toBe('not_open');
    r.apply(pose(1), 0);
    expect(r.refuse(closeQ(0, { score: 1.5, summary: '' }), 1)).toBe('invalid');
    expect(r.refuse(closeQ(1), 1)).toBe('wrong_index');
    const fx = r.apply(closeQ(0, { score: 0.8, summary: 'Good.' }), 60);
    expect(fx).toMatchObject({ say: null, reveal: null, finished: false });
    expect(r.state.questions[0]).toMatchObject({
      closedBy: 'interviewer',
      closedAt: at(60).toISOString(),
      verdict: { score: 0.8, summary: 'Good.' },
    });
    expect(quantPhase(r.state)).toBe('finished');
    expect(r.refuse(closeQ(0), 61)).toBe('not_open');
    expect(r.refuse(hint(0, 0), 61)).toBe('not_open');
    // Idle is not over: the host poses the next one.
    r.apply(pose(2), 70);
    expect(quantPhase(r.state)).toBe('asking');
    r.apply(closeQ(1), 80);
    expect(r.state.questions[1]?.verdict).toBeNull();
  });

  it('a verdict may be given or changed until the pad ends, and after it only where there is none', () => {
    const r = hosted();
    r.apply(pose(1), 0);
    expect(r.refuse(give(0), 1)).toBe('not_closed');
    expect(r.refuse(give(5), 1)).toBe('wrong_index');
    expect(r.refuse(give(0.5 as never), 1)).toBe('wrong_index');
    r.apply(closeQ(0, { score: 0.2, summary: 'first' }), 10);
    r.apply(give(0, 0.9, 'changed my mind'), 11);
    expect(r.state.questions[0]?.verdict).toEqual({ score: 0.9, summary: 'changed my mind' });
    expect(r.refuse(give(0, -0.1), 12)).toBe('invalid');
    r.apply(pose(2), 20);
    r.apply(end, 30);
    expect(r.state.questions[1]).toMatchObject({ closedBy: 'ended', verdict: null });
    expect(r.refuse(give(0, 0.1), 40)).toBe('has_verdict');
    r.apply(give(1, 0.4, 'late'), 41);
    expect(r.state.questions[1]?.verdict).toEqual({ score: 0.4, summary: 'late' });
    expect(r.refuse(give(1, 0.5), 42)).toBe('has_verdict');
  });

  it('replaces the queue: in order, no repeats, none posed, at most the maximum', () => {
    const r = hosted(['a-1']);
    r.apply(queue('b-2', 'a-1', 'c-3'), 0);
    expect(r.state.queue).toEqual(['b-2', 'a-1', 'c-3']);
    expect(r.refuse(queue('b-2', 'b-2'), 1)).toBe('invalid');
    expect(r.refuse(queue('Not Slug'), 1)).toBe('invalid');
    r.apply(pose(1), 2);
    expect(r.refuse(queue('secret-qid-1'), 3)).toBe('already_posed');
    const many = Array.from({ length: QUANT_QUEUE_MAX + 1 }, (_, i) => `q-${i}`);
    expect(r.refuse(queue(...many), 4)).toBe('queue_limit');
    r.apply(queue(...many.slice(0, QUANT_QUEUE_MAX)), 5);
    r.apply(queue(), 6);
    expect(r.state.queue).toEqual([]);
    // The queue is never a question: posing from it and editing it change the questions only by the pose.
    expect(r.state.questions).toHaveLength(1);
  });

  it('ends: the open question closes as ended, and nothing but a missing verdict is taken after', () => {
    const r = hosted(['z-9']);
    r.apply(pose(1), 0);
    r.apply(hint(0, 1), 5);
    const fx = r.apply(end, 30);
    expect(fx.finished).toBe(true);
    expect(fx.reveal).toBeNull();
    expect(r.state.ended).toBe(true);
    expect(r.state.questions[0]).toMatchObject({
      closedBy: 'ended',
      closedAt: at(30).toISOString(),
    });
    expect(quantQuestionStatus(r.state.questions[0] ?? { posedAt: null, closedBy: null })).toBe(
      'unfinished',
    );
    for (const step of [end, pose(3), hint(0, 0), followUp(0), closeQ(0), queue()])
      expect(r.refuse(step, 40)).toBe('ended');
    // An empty room ends too.
    const empty = hosted();
    empty.apply(end, 1);
    expect(empty.state).toMatchObject({ ended: true, questions: [], current: 0 });
    expect(empty.refuse(end, 2)).toBe('ended');
  });

  it('refuses every AI step on a hosted round, and every host step on an AI round', () => {
    const r = hosted();
    r.apply(pose(1), 0);
    const aiSteps: QuantRoundStep[] = [
      { type: 'start', version: r.version, say: 'Hi' },
      { type: 'turn', version: r.version, index: 0, kind: 'chat', say: 'x', action: 'stay' },
      {
        type: 'close',
        version: r.version,
        index: 0,
        kind: 'chat',
        say: 'x',
        by: 'interviewer',
        verdict: null,
      },
      { type: 'verdict', version: r.version, index: 0, verdict: { score: 1, summary: '' } },
      { type: 'quote', index: 0, bid: 1, ask: 2, size: 1 },
    ];
    for (const step of aiSteps) expect(r.refuse(step, 1)).toBe('wrong_mode');

    const ai = createQuantRound('trader', 30, [pick(1), pick(3)]);
    const env = {
      version: 0,
      now: at(0),
      roundEndsAt: quantRoundEndsAt(new Date(T0), 30),
      newId: () => '00000000-0000-4000-8000-000000000009',
    };
    const before = JSON.stringify(ai);
    for (const step of [pose(5), hint(0, 0), followUp(0), closeQ(0), give(0), queue('x-1')]) {
      expect(isHostStep(step)).toBe(true);
      expect(advanceRound(ai, step, env)).toEqual({ ok: false, reason: 'wrong_mode' });
    }
    expect(JSON.stringify(ai)).toBe(before);
    // And the AI round still plays as before.
    const started = advanceRound(ai, { type: 'start', version: 0, say: 'Hi' }, env);
    expect(started.ok && started.state.current).toBe(0);
    expect(started.ok && Object.keys(started.state)).not.toContain('mode');
  });

  it('shows a candidate the posed questions only: no total, no budget, no queue, ids or verdicts', () => {
    const r = hosted(['secret-queued-1', 'secret-queued-2']);
    expect(publicRound(r.state, 0)).toEqual({
      mode: 'hosted',
      path: null,
      subject: 'quant',
      total: null,
      phase: 'pending',
      questions: [],
      version: 0,
    });
    r.apply(pose(1), 0);
    r.apply(hint(0, 1), 10);
    r.apply(followUp(0), 11);
    r.apply(closeQ(0, { score: 0.7, summary: 'VERDICT-SECRET' }), 60);
    r.apply(pose(2), 61);
    const view = publicRound(r.state, r.version);
    expect(view).toMatchObject({ mode: 'hosted', total: null, phase: 'asking' });
    expect(view.questions.map((q) => [q.index, q.prompt, q.budgetSec, q.hintsGiven])).toEqual([
      [0, 'PROMPT-1', null, 1],
      [1, 'PROMPT-2', null, 0],
    ]);
    const json = JSON.stringify(view);
    expect(json).not.toMatch(
      /secret|VERDICT|"(questionId|verdict|hintRungs|followUpAsked|queue|subtopic|hintsAvailable|type)"/,
    );
    expect(QuantRoundView.parse(view)).toEqual(view);
  });

  it('never throws, and keeps its invariants, for any sequence of host steps', () => {
    const accepted = new Set<string>();
    const refusals = new Set<string>();
    for (let seed = 1; seed <= 60; seed++) {
      let a = seed;
      const rand = () => {
        a = (a * 1103515245 + 12345) % 2147483648;
        return a / 2147483648;
      };
      const r = hosted(['secret-qid-7']);
      for (let i = 0; i < 60; i++) {
        const k = Math.floor(rand() * 8);
        const idx = Math.floor(rand() * 4) - 1;
        const roll = rand();
        const step: QuantRoundStep =
          roll < 0.25
            ? pose(k)
            : roll < 0.45
              ? hint(idx, Math.floor(rand() * 4) - 1)
              : roll < 0.55
                ? followUp(idx)
                : roll < 0.7
                  ? closeQ(idx, rand() < 0.5 ? null : { score: rand() * 1.2, summary: 's' })
                  : roll < 0.82
                    ? give(idx, rand() * 1.2)
                    : roll < 0.95
                      ? queue(...(rand() < 0.5 ? ['secret-qid-5', 'secret-qid-6'] : ['x-1', 'x-1']))
                      : end;
        let res: QuantAdvance;
        try {
          res = r.try(step, i);
        } catch (err) {
          throw new Error(`seed ${seed}: threw on ${JSON.stringify(step)}: ${String(err)}`);
        }
        if (res.ok) {
          accepted.add(step.type);
          r.state = res.state;
          r.version = res.version;
        } else refusals.add(res.reason);
        const s: QuantRoundState = r.state;
        expect(() => QuantRoundStateSchema.parse(s)).not.toThrow();
        // At most one question open, and it is the current one; every question was posed.
        const open = s.questions.flatMap((q, j) => (q.closedAt === null ? [j] : []));
        expect(open.length).toBeLessThanOrEqual(1);
        if (open.length) expect(s.current).toBe(open[0]);
        expect(s.questions.every((q) => q.posedAt !== null && q.budgetSec === null)).toBe(true);
        // Ids are unique; the queue never holds a posed one.
        const ids = s.questions.map((q) => q.questionId);
        expect(new Set(ids).size).toBe(ids.length);
        expect((s.queue ?? []).some((id) => ids.includes(id))).toBe(false);
        if (s.ended) expect(open).toHaveLength(0);
        expect(JSON.stringify(publicRound(s, r.version))).not.toMatch(
          /VERDICT|"queue"|secret-qid-7/,
        );
      }
    }
    expect([...accepted].sort()).toEqual(
      ['end', 'host_close', 'host_follow_up', 'host_hint', 'host_verdict', 'pose', 'queue'].sort(),
    );
    for (const reason of ['already_posed', 'not_open', 'wrong_index', 'ended', 'invalid'])
      expect(refusals).toContain(reason);
    // 3,600 steps: seconds on a slow CI runner, where the default 5 s once ran out.
  }, 30_000);
});

// ---------------------------------------------------------------- what is posed

const base = {
  topic: 'cpp',
  subtopic: 'Moves',
  difficulty: 'easy',
  tags: [],
  explanation: 'EXPLANATION-SECRET',
};

describe('the posed text', () => {
  it('composes a choice question’s options into the prompt, never its answer', () => {
    const single = QuizQuestion.parse({
      ...base,
      id: 'cpp-1',
      type: 'single',
      prompt: 'Which is right?\n',
      choices: [
        { id: 'a', text: 'First' },
        { id: 'b', text: 'Second $x$' },
      ],
      answer: 'b',
    });
    expect(hostedPrompt(single)).toBe(
      'Which is right?\n\n- **(a)** First\n- **(b)** Second $x$\n\n*Choose one.*',
    );
    const multiple = QuizQuestion.parse({ ...single, type: 'multiple', answer: ['a', 'b'] });
    expect(hostedPrompt(multiple)).toContain('*Choose every option that applies.*');
    expect(quizSolution(single)).toBe('**(b)** Second $x$');
    expect(quizSolution(multiple)).toBe('- **(a)** First\n- **(b)** Second $x$');
    const p = hostedPick(single, 'C++');
    expect(p).toEqual({
      questionId: 'cpp-1',
      topic: 'cpp',
      topicTitle: 'C++',
      difficulty: 'easy',
      type: 'single',
      prompt: hostedPrompt(single),
      unit: null,
      hintsAvailable: 0,
    });
    expect(JSON.stringify(p)).not.toMatch(/SECRET|"answer"/);
  });

  it('puts an output question’s program in a fence it cannot close', () => {
    const q = QuizQuestion.parse({
      ...base,
      id: 'cpp-2',
      type: 'output',
      language: 'cpp',
      standard: 'C++20',
      prompt: 'What does this program print?',
      code: 'int main() { /* ``` and ```` */ }\n\n',
      answer: { kind: 'output', output: 'OUTPUT-SECRET' },
    });
    const text = hostedPrompt(q);
    expect(text).toContain('`````cpp\nint main() { /* ``` and ```` */ }\n`````');
    expect(text).toContain('*C++, C++20.* Say what it prints');
    expect(text).not.toMatch(/SECRET/);
    expect(quizSolution(q)).toBe('It prints:\n\n```\nOUTPUT-SECRET\n```');
    for (const [kind, words] of [
      ['compile_error', 'does not compile'],
      ['undefined', 'Undefined behaviour'],
      ['unspecified', 'unspecified'],
      ['runtime_error', 'fails at runtime'],
    ] as const)
      expect(quizSolution({ ...q, answer: { kind } } as QuizQuestion)).toContain(words);
  });

  it('a short or numeric question is its prompt; the pick counts its authored hints', () => {
    const numeric = QuizQuestion.parse({
      ...base,
      topic: 'probability',
      id: 'p-1',
      type: 'numeric',
      prompt: '  Expected rolls?  ',
      answer: '7/2',
      answerText: '$3.5$',
      unit: 'rolls',
      hints: ['HINT-SECRET-1', 'HINT-SECRET-2'],
    });
    expect(hostedPrompt(numeric)).toBe('Expected rolls?');
    expect(hostedPick(numeric)).toMatchObject({
      unit: 'rolls',
      hintsAvailable: 2,
      type: 'numeric',
    });
    expect(quizSolution(numeric)).toBe('$3.5$ rolls');
    const short = QuizQuestion.parse({
      ...base,
      id: 's-1',
      type: 'short',
      prompt: 'Why?',
      reference: 'REFERENCE',
      keyPoints: ['k'],
    });
    expect(hostedPick(short)).toMatchObject({ prompt: 'Why?', hintsAvailable: 0 });
    expect(quizSolution(short)).toBe('REFERENCE');
  });
});

// ---------------------------------------------------------------- the schemas

describe('contracts for quant rooms', () => {
  it('a coding pad needs a language, a quant room none', () => {
    expect(CreatePadRequest.safeParse({ kind: 'room' }).success).toBe(false);
    expect(CreatePadRequest.parse({ kind: 'room', language: 'cpp' }).format).toBe('coding');
    const room = CreatePadRequest.parse({ kind: 'room', format: 'quant', queue: ['p-1'] });
    expect(room).toMatchObject({ format: 'quant', queue: ['p-1'], durationMin: 45 });
    expect(
      CreatePadRequest.safeParse({
        kind: 'room',
        format: 'quant',
        queue: Array.from({ length: QUANT_QUEUE_MAX + 1 }, (_, i) => `q-${i}`),
      }).success,
    ).toBe(false);
  });

  it('payloads from before quant rooms still parse', () => {
    const view = QuantRoundView.parse({
      path: 'trader',
      total: 3,
      phase: 'pending',
      questions: [],
      version: 0,
    });
    expect(view.mode).toBe('ai');
    expect(HostView.parse({ problem: null, notes: '' }).round).toBeNull();
    expect(QuantReport.parse({ path: 'researcher', questions: [] })).toEqual({
      mode: 'ai',
      path: 'researcher',
      subject: 'quant',
      questions: [],
    });
    expect(
      TimelineEvent.parse({
        id: '00000000-0000-4000-8000-000000000001',
        padId: '00000000-0000-4000-8000-000000000002',
        at: new Date(T0).toISOString(),
        event: { type: 'question', index: 0, total: null },
      }).event,
    ).toEqual({ type: 'question', index: 0, total: null });
    // A stored AI state (no mode, a path, a length) parses unchanged.
    const stored = createQuantRound('trader', 20, [pick(1)]);
    expect(QuantRoundStateSchema.parse(stored)).toEqual(stored);
    expect(PadDetail.shape.round.parse(undefined)).toBeNull();
  });

  it('the host’s verdict is a score in 0..1 and a note; closing takes none by default', () => {
    expect(CloseQuantQuestionRequest.parse({ index: 0 }).verdict).toBeNull();
    expect(
      SetQuantVerdictRequest.safeParse({ index: 0, verdict: { score: 2, summary: '' } }).success,
    ).toBe(false);
    expect(
      SetQuantVerdictRequest.parse({ index: 1, verdict: { score: 1, summary: '  ok  ' } }).verdict,
    ).toEqual({ score: 1, summary: 'ok' });
  });
});
