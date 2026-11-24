/**
 * The one place hidden-test detail is removed. Every client-visible run (REST, WebSocket,
 * pad detail) goes through `toPublicRun`; live judge progress goes through `publicProgress`.
 *
 * Hidden tests reveal only an opaque id ("hidden-<n>"), the verdict and a coarse time: no actual
 * values, captured output, messages (which can quote expected values) or authored test ids
 * (which can hint at the case, e.g. "h-negatives").
 *
 * The time is coarse on purpose. It is measured by the driver, which shares a process with the
 * candidate's code (Python can replace `time.perf_counter_ns`; any language can forge a frame
 * or sleep), so an exact value is a ~20-bit channel per hidden test per submission: enough to
 * read the hidden inputs out one by one. Rounded up to 1-2-5 steps it carries ~3 bits.
 */
import type { JudgeProgress, JudgeResult, PublicTestResult, Run, RunMode } from '@ipp/contracts';

/** The persisted run as the redactor needs it (a subset of the `runs` row). */
export interface StoredRun {
  id: string;
  padId: string;
  userId: string;
  problemSlug: string | null;
  mode: RunMode;
  language: Run['language'];
  status: Run['status'];
  result: JudgeResult | null;
  hiddenIds: string[];
  testCount: number;
  createdAt: Date;
  finishedAt: Date | null;
}

function base(row: StoredRun): Omit<Run, 'tests' | 'passed'> {
  const r = row.result;
  return {
    id: row.id,
    padId: row.padId,
    userId: row.userId,
    problemSlug: row.problemSlug,
    mode: row.mode,
    language: row.language,
    status: row.status,
    verdict: r?.verdict ?? null,
    compile: r?.compile ?? null,
    file: r?.file ?? null,
    total: row.testCount,
    message: r?.message ?? null,
    createdAt: row.createdAt.toISOString(),
    finishedAt: row.finishedAt?.toISOString() ?? null,
  };
}

export function toPublicRun(row: StoredRun): Run {
  const hidden = new Set(row.hiddenIds);
  let n = 0;
  const tests: PublicTestResult[] = (row.result?.tests ?? []).map((t) =>
    hidden.has(t.id)
      ? { hidden: true, id: `hidden-${++n}`, verdict: t.verdict, timeMs: coarseMs(t.timeMs) }
      : { ...t, hidden: false },
  );
  return { ...base(row), tests, passed: countPassed(row.result) };
}

/**
 * Server-side view for the interviewer (never sent to a client): hidden tests keep their
 * verdict detail (message, output) so the interviewer can reason about them, still flagged hidden.
 */
export function toInterviewerRun(row: StoredRun): Run {
  const hidden = new Set(row.hiddenIds);
  const tests = (row.result?.tests ?? []).map((t) => ({
    ...t,
    hidden: hidden.has(t.id),
  })) as PublicTestResult[];
  return { ...base(row), tests, passed: countPassed(row.result) };
}

/** Rounds up to the next 1-2-5 step (1, 2, 5, 10, 20, 50, ... ms); 0 stays 0. */
export function coarseMs(ms: number): number {
  if (!Number.isFinite(ms) || ms <= 0) return 0;
  let step = 1;
  for (;;) {
    for (const m of [1, 2, 5]) if (ms <= step * m) return step * m;
    step *= 10;
  }
}

export function hiddenFailures(row: StoredRun): number {
  const hidden = new Set(row.hiddenIds);
  return (row.result?.tests ?? []).filter((t) => hidden.has(t.id) && t.verdict !== 'pass').length;
}

function countPassed(result: JudgeResult | null): number {
  return (result?.tests ?? []).filter((t) => t.verdict === 'pass').length;
}

/**
 * Live progress. Output chunks are forwarded only for file-mode runs: in judged modes a chunk
 * could be printed by the candidate's code during a hidden test and echo its input.
 */
export function publicProgress(
  mode: RunMode,
  event: JudgeProgress['event'],
): JudgeProgress['event'] | null {
  if (event.type === 'output' && mode !== 'file') return null;
  return event;
}
