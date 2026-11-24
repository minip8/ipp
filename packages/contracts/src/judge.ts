/**
 * Wire contract between the API (TypeScript) and the judge worker (Rust), carried over Redis.
 * The Rust side mirrors these with serde; fixtures/judge-*.json are parsed by both test suites
 * so the two definitions cannot drift silently.
 *
 *   jobs      stream  judge:jobs      field "payload" = JSON JudgeJob      consumer group "judge"
 *   results   stream  judge:results   field "payload" = JSON JudgeResult   consumer group "api"
 *   progress  pubsub  judge:progress  message = JSON JudgeProgress (best effort, may be dropped)
 */
import { z } from 'zod';
import { Id, IsoDate, Json, Language } from './common';
import { Call, ProblemSignature } from './problem';

export const JUDGE_KEYS = {
  jobsStream: 'judge:jobs',
  jobsGroup: 'judge',
  resultsStream: 'judge:results',
  resultsGroup: 'api',
  progressChannel: 'judge:progress',
} as const;

export const JudgeLimits = z.object({
  /** Wall time for compilation. */
  compileMs: z.int(),
  /** Wall time per test (tests mode) or for the whole program (file mode). */
  runMs: z.int(),
  /** Wall time for the whole job; remaining tests are reported as skipped. */
  totalMs: z.int(),
  memoryMb: z.int(),
  /** Cap per captured stream (stdout / stderr), per test or per file run. */
  outputBytes: z.int(),
});
export type JudgeLimits = z.infer<typeof JudgeLimits>;

export const JudgeTest = z.object({
  id: z.string(),
  ctorArgs: z.array(Json),
  calls: z.array(Call),
  /** null = custom test from the candidate: run it and report the output, no pass/fail. */
  expected: z.array(Json).nullable(),
});
export type JudgeTest = z.infer<typeof JudgeTest>;

export const JudgeJob = z.object({
  v: z.literal(1),
  runId: Id,
  language: Language,
  source: z.string(),
  /**
   * file   compile and run the source exactly as written, feeding `stdin`
   * tests  extract the candidate's class, attach a generated driver, run `tests`
   */
  mode: z.enum(['file', 'tests']),
  stdin: z.string().default(''),
  /** Required for mode "tests". */
  signature: ProblemSignature.nullable(),
  tests: z.array(JudgeTest),
  limits: JudgeLimits,
  enqueuedAt: IsoDate,
});
export type JudgeJob = z.infer<typeof JudgeJob>;

export const TestVerdict = z.enum([
  'pass',
  'fail',
  /** custom test executed (no expected value) */
  'ran',
  'runtime_error',
  'time_limit',
  'memory_limit',
  'output_limit',
  /** not executed: total time budget exhausted */
  'skipped',
]);
export type TestVerdict = z.infer<typeof TestVerdict>;

export const JudgeTestResult = z.object({
  id: z.string(),
  verdict: TestVerdict,
  timeMs: z.number(),
  /** One entry per completed call; null when the test did not finish. */
  actual: z.array(Json).nullable(),
  /** What the candidate's code printed during this test (truncated to limits.outputBytes). */
  stdout: z.string(),
  stderr: z.string(),
  /** Human-readable detail: exception text, signal name, first mismatching call, ... */
  message: z.string().nullable(),
});
export type JudgeTestResult = z.infer<typeof JudgeTestResult>;

export const RunVerdict = z.enum([
  /** tests mode: every test passed */
  'accepted',
  'wrong_answer',
  'compile_error',
  'runtime_error',
  'time_limit',
  'memory_limit',
  'output_limit',
  /** tests mode: the required class or a required method could not be found in the source */
  'invalid_submission',
  /** file mode exited 0, or custom tests all ran */
  'ok',
  'internal_error',
]);
export type RunVerdict = z.infer<typeof RunVerdict>;

export const CompileOutcome = z.object({
  ok: z.boolean(),
  /** Compiler diagnostics, with internal paths and driver line numbers mapped back where possible. */
  output: z.string(),
  timeMs: z.number(),
});
export type CompileOutcome = z.infer<typeof CompileOutcome>;

export const FileOutcome = z.object({
  exitCode: z.int().nullable(),
  signal: z.string().nullable(),
  stdout: z.string(),
  stderr: z.string(),
  truncated: z.boolean(),
  timeMs: z.number(),
});
export type FileOutcome = z.infer<typeof FileOutcome>;

export const JudgeResult = z.object({
  v: z.literal(1),
  runId: Id,
  verdict: RunVerdict,
  /**
   * null for Python and when the job failed before compiling. Exception: a Python file with a syntax
   * error in a judged mode is reported as verdict compile_error with { ok: false, output }.
   */
  compile: CompileOutcome.nullable(),
  /** file mode only */
  file: FileOutcome.nullable(),
  /** tests mode only; same order as the job's tests */
  tests: z.array(JudgeTestResult),
  /** Explanation for invalid_submission / internal_error, safe to show to the candidate. */
  message: z.string().nullable(),
  timing: z.object({ queueMs: z.number(), totalMs: z.number() }),
  sandbox: z.object({ runtime: z.string(), image: z.string() }),
});
export type JudgeResult = z.infer<typeof JudgeResult>;

export const JudgeProgress = z.object({
  runId: Id,
  event: z.discriminatedUnion('type', [
    z.object({ type: z.literal('started') }),
    z.object({ type: z.literal('compiling') }),
    z.object({ type: z.literal('running'), done: z.int(), total: z.int() }),
    /** file mode: live output as it is produced */
    z.object({
      type: z.literal('output'),
      stream: z.enum(['stdout', 'stderr']),
      chunk: z.string(),
    }),
  ]),
});
export type JudgeProgress = z.infer<typeof JudgeProgress>;
