import type { Run, RunVerdict, TestVerdict } from '@ipp/contracts';

export type Tone = 'ok' | 'bad' | 'warn' | 'neutral';

export const RUN_VERDICT: Record<RunVerdict, { label: string; tone: Tone }> = {
  accepted: { label: 'Accepted', tone: 'ok' },
  wrong_answer: { label: 'Wrong answer', tone: 'bad' },
  compile_error: { label: 'Compile error', tone: 'bad' },
  runtime_error: { label: 'Runtime error', tone: 'bad' },
  time_limit: { label: 'Time limit exceeded', tone: 'warn' },
  memory_limit: { label: 'Memory limit exceeded', tone: 'warn' },
  output_limit: { label: 'Output limit exceeded', tone: 'warn' },
  invalid_submission: { label: 'Invalid submission', tone: 'bad' },
  ok: { label: 'Finished', tone: 'ok' },
  internal_error: { label: 'Judge error', tone: 'neutral' },
};

export const TEST_VERDICT: Record<TestVerdict, { label: string; tone: Tone }> = {
  pass: { label: 'Passed', tone: 'ok' },
  fail: { label: 'Failed', tone: 'bad' },
  ran: { label: 'Ran', tone: 'neutral' },
  runtime_error: { label: 'Crashed', tone: 'bad' },
  time_limit: { label: 'Timed out', tone: 'warn' },
  memory_limit: { label: 'Out of memory', tone: 'warn' },
  output_limit: { label: 'Too much output', tone: 'warn' },
  skipped: { label: 'Skipped', tone: 'neutral' },
};

export const MODE_LABEL: Record<Run['mode'], string> = {
  file: 'Run',
  samples: 'Sample tests',
  custom: 'Custom tests',
  submit: 'Submission',
};

/** Headline for a finished run, specialised by mode. */
export function runHeadline(run: Run): { label: string; tone: Tone } {
  if (!run.verdict)
    return { label: run.status === 'queued' ? 'Queued' : 'Running', tone: 'neutral' };
  if (run.mode === 'file' && run.verdict === 'ok') return { label: 'Exited normally', tone: 'ok' };
  if (run.mode === 'custom' && run.verdict === 'ok')
    return { label: 'Ran custom tests', tone: 'neutral' };
  if (run.mode === 'file' && run.verdict === 'runtime_error') {
    const f = run.file;
    if (f?.signal) return { label: `Crashed (${f.signal})`, tone: 'bad' };
    if (f && f.exitCode !== null && f.exitCode !== 0)
      return { label: `Exited with code ${f.exitCode}`, tone: 'bad' };
  }
  return RUN_VERDICT[run.verdict];
}

export function summarizeTests(run: Run) {
  const counts = { pass: 0, fail: 0, error: 0, limit: 0, skipped: 0, ran: 0 };
  for (const t of run.tests) {
    if (t.verdict === 'pass') counts.pass++;
    else if (t.verdict === 'fail') counts.fail++;
    else if (t.verdict === 'runtime_error') counts.error++;
    else if (t.verdict === 'skipped') counts.skipped++;
    else if (t.verdict === 'ran') counts.ran++;
    else counts.limit++;
  }
  return counts;
}
