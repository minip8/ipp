import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { JudgeResult, QuizQuestion } from '@ipp/contracts';
import { describe, expect, it } from 'vitest';
import type { Ctx } from '../src/context';
import { drillBests, drillTotals, isNewBest, orderByCategory } from '../src/drill/bests';
import { clientIp, jsonDeeperThan } from '../src/http/app';
import { correctAnswer, gradeAuto, normalizeOutput, publicQuestion } from '../src/quiz/grade';
import {
  coarseMs,
  hiddenFailures,
  publicProgress,
  type StoredRun,
  toInterviewerRun,
  toPublicRun,
} from '../src/runs/redact';
import { QUIZ_FIXTURE } from './helpers/fixtures';

const require = createRequire(import.meta.url);
const failures = JudgeResult.parse(
  JSON.parse(
    readFileSync(require.resolve('@ipp/contracts/fixtures/judge-result-failures.json'), 'utf8'),
  ),
);

const stored = (result: JudgeResult | null, hiddenIds: string[]): StoredRun => ({
  id: result?.runId ?? '0b9d6c1e-6f0a-4c56-9d3e-0c1c9a1f4f10',
  padId: '11111111-1111-4111-8111-111111111111',
  userId: 'u1',
  problemSlug: 'two-sum',
  mode: 'submit',
  language: 'cpp',
  status: result ? 'finished' : 'queued',
  result,
  hiddenIds,
  testCount: result?.tests.length ?? 4,
  createdAt: new Date('2026-01-01T00:00:00Z'),
  finishedAt: result ? new Date('2026-01-01T00:00:01Z') : null,
});

describe('toPublicRun (the redaction point)', () => {
  const hidden = ['h1', 'h2', 'h3'];
  const withSecrets: JudgeResult = {
    ...failures,
    tests: failures.tests.map((t) =>
      hidden.includes(t.id)
        ? {
            ...t,
            actual: ['LEAK-actual'],
            stdout: 'LEAK-stdout',
            stderr: 'LEAK-stderr',
            message: 'LEAK-message',
          }
        : t,
    ),
  };
  const run = toPublicRun(stored(withSecrets, hidden));

  it('keeps visible tests intact', () => {
    expect(run.tests[0]).toEqual({ ...failures.tests[0], hidden: false });
  });
  it('reduces hidden tests to an opaque id, verdict and time', () => {
    expect(run.tests.slice(1)).toEqual([
      { hidden: true, id: 'hidden-1', verdict: 'time_limit', timeMs: 1000 },
      { hidden: true, id: 'hidden-2', verdict: 'runtime_error', timeMs: 2 },
      { hidden: true, id: 'hidden-3', verdict: 'skipped', timeMs: 0 },
    ]);
    const s = JSON.stringify(run);
    expect(s).not.toContain('LEAK');
    for (const id of hidden) expect(s).not.toContain(`"${id}"`);
  });
  it('counts and totals', () => {
    expect(run.passed).toBe(0);
    expect(run.total).toBe(4);
    expect(run.verdict).toBe('wrong_answer');
  });
  it('queued run has no results', () => {
    const q = toPublicRun(stored(null, hidden));
    expect(q).toMatchObject({ status: 'queued', verdict: null, tests: [], finishedAt: null });
  });
  it('interviewer view keeps detail and counts hidden failures', () => {
    const r = toInterviewerRun(stored(withSecrets, hidden));
    expect(JSON.stringify(r)).toContain('LEAK-message');
    expect(hiddenFailures(stored(withSecrets, hidden))).toBe(3);
  });
  it('hidden test times are coarse, so candidate code cannot encode hidden inputs in them', () => {
    // A submission that adds n*10 ms to the driver's clock for hidden input n (observed live:
    // 30.004, 50.004, 60.003, 170.02, ... read back every hidden input of climbing-stairs).
    const forged: JudgeResult = {
      ...failures,
      tests: failures.tests.map((t, i) =>
        hidden.includes(t.id)
          ? { ...t, verdict: 'fail', timeMs: [30.004, 50.004, 170.02][i - 1] ?? 0 }
          : t,
      ),
    };
    const r = toPublicRun(stored(forged, hidden));
    expect(r.tests.filter((t) => t.hidden).map((t) => t.timeMs)).toEqual([50, 100, 200]);
    expect([0, 0.2, 1, 1.01, 2.5, 99, 101, 1000, 1000.5].map(coarseMs)).toEqual([
      0, 1, 1, 2, 5, 100, 200, 1000, 2000,
    ]);
  });
  it('progress output is forwarded only for file runs', () => {
    const ev = { type: 'output', stream: 'stdout', chunk: 'x' } as const;
    expect(publicProgress('file', ev)).toEqual(ev);
    expect(publicProgress('submit', ev)).toBeNull();
    expect(publicProgress('samples', ev)).toBeNull();
    expect(publicProgress('submit', { type: 'running', done: 1, total: 2 })).not.toBeNull();
  });
});

describe('quiz grading', () => {
  const qs = Object.fromEntries(QUIZ_FIXTURE.map((q) => [q.id, QuizQuestion.parse(q)]));
  const question = (id: string) => {
    const found = qs[id];
    if (!found) throw new Error(id);
    return found;
  };
  it('normalizes output', () => {
    expect(normalizeOutput('  1 2\n\n3\t ')).toBe('1 2 3');
  });
  it('output questions compare normalized text and kinds', () => {
    const q = question('tq-output');
    expect(
      gradeAuto(q, { type: 'output', answer: { kind: 'output', output: '1  2 3\n' } })?.correct,
    ).toBe(true);
    expect(
      gradeAuto(q, { type: 'output', answer: { kind: 'output', output: '123' } })?.correct,
    ).toBe(false);
    expect(gradeAuto(q, { type: 'output', answer: { kind: 'undefined' } })?.correct).toBe(false);
  });
  it('multiple choice partial credit', () => {
    const q = question('tq-multiple');
    expect(gradeAuto(q, { type: 'multiple', choices: ['a', 'c'] })).toEqual({
      score: 1,
      correct: true,
    });
    expect(gradeAuto(q, { type: 'multiple', choices: ['a'] })).toEqual({
      score: 0.5,
      correct: false,
    });
    expect(gradeAuto(q, { type: 'multiple', choices: ['a', 'b'] })).toEqual({
      score: 0,
      correct: false,
    });
  });
  it('numeric questions are right or wrong, and reveal answerText or the number', () => {
    const q = QuizQuestion.parse({
      id: 'n',
      topic: 't',
      subtopic: 's',
      difficulty: 'easy',
      type: 'numeric',
      prompt: 'p',
      explanation: 'EXPLAIN',
      answer: '1/3',
      unit: 'm',
      hints: ['HINT'],
    });
    const grade = (value: string) => gradeAuto(q, { type: 'numeric', value });
    expect(grade('2/6')).toEqual({ score: 1, correct: true });
    expect(grade('0.333')).toEqual({ score: 1, correct: true });
    expect(grade('0.33')).toEqual({ score: 0, correct: false });
    expect(grade('33/100')).toEqual({ score: 0, correct: false });
    expect(gradeAuto(q, { type: 'single', choice: 'a' })).toBeNull();
    expect(correctAnswer(q)).toBe('1/3');
    if (q.type !== 'numeric') throw new Error('not numeric');
    expect(correctAnswer({ ...q, answerText: '$\\frac13$' })).toBe('$\\frac13$');
    expect(publicQuestion(q)).toMatchObject({ type: 'numeric', unit: 'm', choices: null });
    expect(JSON.stringify(publicQuestion(q))).not.toMatch(/HINT|EXPLAIN|"answer"/);
    expect(publicQuestion(question('tq-single')).unit).toBeNull();
  });
  it('public questions carry no answers', () => {
    for (const q of Object.values(qs)) {
      const s = JSON.stringify(publicQuestion(q));
      expect(s).not.toContain('EXPLAIN');
      expect(s).not.toContain('REFERENCE');
      expect(s).not.toContain('"answer"');
    }
  });
});

describe('clientIp', () => {
  const ctx = (trustProxy = true) =>
    ({
      config: { trustProxy, trustedProxies: ['127.0.0.1', '::1', '10.0.0.5'] },
    }) as unknown as Ctx;
  const h = (xff?: string) => new Headers(xff ? { 'x-forwarded-for': xff } : {});

  it('ignores X-Forwarded-For from peers that are not trusted proxies', () => {
    // Observed live: rotating X-Forwarded-For per request on a direct connection to :4000 made
    // every sign-in attempt land in a fresh per-IP bucket.
    expect(clientIp(ctx(), h('10.9.1.1'), '198.51.100.20')).toBe('198.51.100.20');
    expect(clientIp(ctx(), h('10.9.1.1'), '::ffff:198.51.100.20')).toBe('198.51.100.20');
  });
  it('takes the rightmost untrusted hop from a trusted proxy', () => {
    expect(clientIp(ctx(), h('1.2.3.4, 203.0.113.9'), '127.0.0.1')).toBe('203.0.113.9');
    expect(clientIp(ctx(), h('1.2.3.4, 203.0.113.9, 10.0.0.5'), '::ffff:127.0.0.1')).toBe(
      '203.0.113.9',
    );
    expect(clientIp(ctx(), h(), '127.0.0.1')).toBe('127.0.0.1');
  });
  it('uses the peer when proxies are not trusted', () => {
    expect(clientIp(ctx(false), h('1.2.3.4'), '127.0.0.1')).toBe('127.0.0.1');
  });
});

describe('jsonDeeperThan', () => {
  it('measures nesting without recursion', () => {
    const deep = JSON.parse(`${'['.repeat(200_000)}${']'.repeat(200_000)}`);
    expect(jsonDeeperThan(deep, 64)).toBe(true);
    expect(jsonDeeperThan({ a: [[1, { b: 2 }]] }, 4)).toBe(false);
    expect(jsonDeeperThan({ a: [[1, { b: [] }]] }, 4)).toBe(true);
    expect(jsonDeeperThan('x', 0)).toBe(false);
  });
});

describe('drill bests', () => {
  const at = (s: number) => new Date(Date.UTC(2026, 0, 1, 0, 0, s));

  it('totals the categories and scores correct minus wrong', () => {
    expect(
      drillTotals([
        { category: 'multiply', correct: 10, wrong: 3, skipped: 1 },
        { category: 'divide', correct: 4, wrong: 5, skipped: 2 },
      ]),
    ).toEqual({ correct: 14, wrong: 8, skipped: 3, score: 6 });
    expect(drillTotals([])).toEqual({ correct: 0, wrong: 0, skipped: 0, score: 0 });
    expect(
      orderByCategory([
        { category: 'estimation', correct: 1, wrong: 0, skipped: 0 },
        { category: 'add-subtract', correct: 1, wrong: 0, skipped: 0 },
      ]).map((c) => c.category),
    ).toEqual(['add-subtract', 'estimation']);
  });

  it('keeps the highest score per duration and level, the earliest on a tie, in contract order', () => {
    const bests = drillBests([
      { durationSec: 300, level: 'warmup', score: 4, finishedAt: at(1) },
      { durationSec: 60, level: 'hard', score: 7, finishedAt: at(2) },
      { durationSec: 60, level: 'hard', score: 9, finishedAt: at(5) },
      { durationSec: 60, level: 'hard', score: 9, finishedAt: at(3) },
      { durationSec: 60, level: 'hard', score: 9, finishedAt: at(4) },
      { durationSec: 60, level: 'warmup', score: -2, finishedAt: at(6) },
      { durationSec: 90, level: 'warmup', score: 50, finishedAt: at(7) },
    ]);
    expect(bests).toEqual([
      { durationSec: 60, level: 'warmup', score: -2, finishedAt: at(6).toISOString() },
      { durationSec: 60, level: 'hard', score: 9, finishedAt: at(3).toISOString() },
      { durationSec: 300, level: 'warmup', score: 4, finishedAt: at(1).toISOString() },
    ]);
    expect(drillBests([])).toEqual([]);
  });

  it('a new best is strictly higher than the earlier ones, and above 0 for the first', () => {
    expect(isNewBest(1, null)).toBe(true);
    expect(isNewBest(0, null)).toBe(false);
    expect(isNewBest(-1, null)).toBe(false);
    expect(isNewBest(10, 9)).toBe(true);
    expect(isNewBest(9, 9)).toBe(false);
    expect(isNewBest(8, 9)).toBe(false);
    expect(isNewBest(-1, -3)).toBe(true);
  });
});
