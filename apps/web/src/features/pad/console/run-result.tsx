'use client';
import {
  CPP_HARNESS_FILE,
  type CustomTest,
  type Json,
  type PublicTestResult,
  type Run,
} from '@ipp/contracts';
import { AlertTriangleIcon, EyeOffIcon, TerminalIcon } from 'lucide-react';
import { Fragment, useEffect, useMemo, useState } from 'react';
import {
  RunVerdictIcon,
  TEST_ICON,
  TestVerdictChip,
  toneIcon,
  toneSoft,
  toneText,
} from '@/components/domain';
import { Tooltip } from '@/components/ui/tooltip';
import { formatMs, plural } from '@/lib/format';
import { cn } from '@/lib/utils';
import { MODE_LABEL, runHeadline, TEST_VERDICT } from '@/lib/verdict';
import { linkifyLocations, mentionsTestHarness } from '../editor/diagnostics';
import { usePad } from '../session';
import { describeTest } from '../tests-format';

export function OutputBlock({
  label,
  text,
  tone,
  onJump,
  empty = 'No output',
  className,
}: {
  label: string;
  text: string;
  tone?: 'bad' | 'warn';
  onJump?: (line: number, col: number | null) => void;
  empty?: string;
  className?: string;
}) {
  return (
    <section className={cn('min-w-0', className)}>
      <h4 className="mb-1 text-2xs font-medium tracking-wider text-fg-subtle uppercase">{label}</h4>
      {text ? (
        <pre
          className={cn(
            'max-h-72 overflow-auto rounded-md border px-3 py-2 font-mono text-xs leading-relaxed whitespace-pre-wrap break-words',
            tone === 'bad'
              ? 'border-bad/30 bg-bad-soft/40 text-fg'
              : tone === 'warn'
                ? 'border-warn/30 bg-warn-soft/40'
                : 'border-border bg-surface-2',
          )}
        >
          {onJump
            ? linkifyLocations(text).map((p, i) =>
                'line' in p ? (
                  <button
                    // biome-ignore lint/suspicious/noArrayIndexKey: positional segments
                    key={i}
                    type="button"
                    onClick={() => onJump(p.line, p.column)}
                    className="rounded-sm text-accent-text underline decoration-accent/40 underline-offset-2 hover:decoration-accent"
                    title={`Go to line ${p.line}`}
                  >
                    {p.text}
                  </button>
                ) : (
                  // biome-ignore lint/suspicious/noArrayIndexKey: positional segments
                  <span key={i}>{p.text}</span>
                ),
              )
            : text}
        </pre>
      ) : (
        <p className="rounded-md border border-dashed border-border px-3 py-2 text-xs text-fg-subtle">
          {empty}
        </p>
      )}
    </section>
  );
}

/** Highlights which top-level array elements differ, so long outputs are readable at a glance. */
function DiffValue({
  value,
  other,
  tone,
}: {
  value: string;
  other: string | null;
  tone: 'ok' | 'bad';
}) {
  const parts = useMemo(() => {
    let a: Json;
    let b: Json;
    try {
      a = JSON.parse(value) as Json;
      b = other === null ? null : (JSON.parse(other) as Json);
    } catch {
      return null;
    }
    if (!Array.isArray(a) || !Array.isArray(b)) return null;
    return a.map((x, i) => ({
      text: JSON.stringify(x),
      diff: JSON.stringify(x) !== JSON.stringify(b[i]),
    }));
  }, [value, other]);
  if (!parts || other === null) return <span>{value}</span>;
  return (
    <span>
      [
      {parts.map((p, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: positional
        <span key={i}>
          {i > 0 && ','}
          <span
            className={cn(
              p.diff &&
                (tone === 'bad'
                  ? 'rounded-sm bg-bad/20 text-bad-text'
                  : 'rounded-sm bg-ok/20 text-ok-text'),
            )}
          >
            {p.text}
          </span>
        </span>
      ))}
      ]
    </span>
  );
}

function TestDetail({
  test,
  run,
  custom,
}: {
  test: Extract<PublicTestResult, { hidden: false }>;
  run: Run;
  custom: CustomTest | null;
}) {
  const { problem } = usePad().state;
  const sample = problem?.sampleTests.find((t) => t.id === test.id);
  const input = sample ?? custom;
  const expected = sample?.expected ?? null;
  const view =
    input && problem ? describeTest(problem.signature, input, expected, test.actual) : null;
  const v = TEST_VERDICT[test.verdict];
  const showOutputs = test.verdict !== 'skipped';

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <TestVerdictChip verdict={test.verdict} />
        <span className="text-xs text-fg-muted tabular">{formatMs(test.timeMs)}</span>
        {test.message && <span className={cn('text-xs', toneText[v.tone])}>{test.message}</span>}
      </div>

      {view?.kind === 'function' && (
        <div className="overflow-hidden rounded-md border border-border font-mono text-xs">
          <Row label="Input">
            {view.params.map((p) => (
              <span key={p.name} className="mr-4 inline-block break-all">
                <span className="text-fg-subtle">{p.name} = </span>
                {p.value}
              </span>
            ))}
          </Row>
          {view.call?.expected !== null && (
            <Row label="Expected" tone={view.call?.ok === false ? 'ok' : undefined}>
              <DiffValue
                value={view.call?.expected ?? ''}
                other={view.call?.actual ?? null}
                tone="ok"
              />
            </Row>
          )}
          {showOutputs && (
            <Row
              label="Actual"
              tone={view.call?.ok === false ? 'bad' : view.call?.ok ? undefined : undefined}
            >
              {view.call?.actual !== null && view.call?.actual !== undefined ? (
                <DiffValue
                  value={view.call.actual}
                  other={view.call.ok === false ? (view.call.expected ?? null) : null}
                  tone="bad"
                />
              ) : (
                <span className="font-sans text-fg-subtle">
                  No return value ({v.label.toLowerCase()})
                </span>
              )}
            </Row>
          )}
        </div>
      )}

      {view?.kind === 'design' && (
        <div className="overflow-x-auto rounded-md border border-border">
          <table className="w-full font-mono text-xs">
            <thead>
              <tr className="border-b border-border bg-surface-2 text-left font-sans text-2xs text-fg-subtle">
                <th className="w-8 px-2 py-1.5 font-medium">#</th>
                <th className="px-2 py-1.5 font-medium">Call</th>
                <th className="px-2 py-1.5 font-medium">Expected</th>
                <th className="px-2 py-1.5 font-medium">Actual</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-b border-border text-fg-muted">
                <td className="px-2 py-1 text-fg-subtle">0</td>
                <td className="px-2 py-1" colSpan={3}>
                  {view.ctor}
                </td>
              </tr>
              {view.calls.map((c, i) => (
                <tr
                  // biome-ignore lint/suspicious/noArrayIndexKey: calls are positional
                  key={i}
                  className={cn(
                    'border-b border-border last:border-0',
                    c.ok === false && 'bg-bad-soft/50',
                  )}
                >
                  <td className="px-2 py-1 text-fg-subtle tabular">{i + 1}</td>
                  <td className="px-2 py-1 break-all">{c.label}</td>
                  <td className="px-2 py-1 text-fg-muted">{c.expected ?? '—'}</td>
                  <td className={cn('px-2 py-1', c.ok === false && 'font-semibold text-bad-text')}>
                    {c.ok === false && <span className="sr-only">Mismatch: </span>}
                    {c.actual ??
                      (test.actual && i < test.actual.length ? (
                        '—'
                      ) : (
                        <span className="font-sans text-fg-subtle">not reached</span>
                      ))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {!view && test.actual && (
        <div className="overflow-hidden rounded-md border border-border font-mono text-xs">
          <Row label="Returned">{test.actual.map((a) => JSON.stringify(a)).join(', ')}</Row>
        </div>
      )}

      {(test.stdout || test.stderr) && (
        <div className="grid gap-3 md:grid-cols-2">
          {test.stdout && <OutputBlock label="Stdout" text={test.stdout} />}
          {test.stderr && <OutputBlock label="Stderr" text={test.stderr} tone="bad" />}
        </div>
      )}
      {run.mode === 'custom' && (
        <p className="text-xs text-fg-muted">
          Custom tests have no expected output; compare the result with what you expect.
        </p>
      )}
    </div>
  );
}

function Row({
  label,
  children,
  tone,
}: {
  label: string;
  children: React.ReactNode;
  tone?: 'ok' | 'bad';
}) {
  return (
    <div
      className={cn(
        'flex gap-3 border-b border-border px-3 py-1.5 last:border-0',
        tone === 'bad' && 'bg-bad-soft/40',
        tone === 'ok' && 'bg-ok-soft/30',
      )}
    >
      <span className="w-16 shrink-0 font-sans text-2xs leading-5 font-medium text-fg-subtle uppercase">
        {label}
      </span>
      <span className="min-w-0 flex-1 leading-5 break-all">{children}</span>
    </div>
  );
}

function HiddenSummary({ tests }: { tests: Extract<PublicTestResult, { hidden: true }>[] }) {
  if (tests.length === 0) return null;
  const counts = new Map<string, number>();
  for (const t of tests) counts.set(t.verdict, (counts.get(t.verdict) ?? 0) + 1);
  const passed = counts.get('pass') ?? 0;
  const slowest = Math.max(...tests.map((t) => t.timeMs));
  return (
    <section aria-label="Hidden tests" className="rounded-md border border-border p-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <EyeOffIcon className="size-4 text-fg-subtle" aria-hidden />
        <span className="text-sm font-medium">
          Hidden tests: {passed} / {tests.length} passed
        </span>
        <span className="text-xs text-fg-muted">
          {[...counts.entries()]
            .filter(([k]) => k !== 'pass')
            .map(
              ([k, n]) =>
                `${n} ${TEST_VERDICT[k as keyof typeof TEST_VERDICT].label.toLowerCase()}`,
            )
            .join(' · ')}
        </span>
        <span className="ml-auto text-xs text-fg-subtle tabular">slowest {formatMs(slowest)}</span>
      </div>
      <ul className="mt-2.5 flex flex-wrap gap-1" aria-label="Hidden test verdicts">
        {tests.map((t, i) => {
          const v = TEST_VERDICT[t.verdict];
          const Icon = TEST_ICON[t.verdict];
          return (
            <li key={t.id}>
              <Tooltip
                label={`Hidden test ${i + 1}: ${v.label} · ${formatMs(t.timeMs)}`}
                side="top"
              >
                <span
                  // biome-ignore lint/a11y/noNoninteractiveTabindex: focusable so keyboard users get the tooltip
                  tabIndex={0}
                  role="img"
                  className={cn(
                    'flex size-4 items-center justify-center rounded-[3px]',
                    toneSoft[v.tone],
                  )}
                  aria-label={`Hidden test ${i + 1}: ${v.label}`}
                >
                  <Icon className={cn('size-2.5', toneIcon[v.tone])} strokeWidth={3} aria-hidden />
                </span>
              </Tooltip>
            </li>
          );
        })}
      </ul>
      <p className="mt-2 text-xs text-fg-muted">
        Hidden test inputs are not shown, as in a real interview. Use the failing verdicts as a hint
        about which edge cases to think about.
      </p>
    </section>
  );
}

export function RunResult({
  run,
  onJump,
  customInputs,
}: {
  run: Run;
  onJump: (line: number, col: number | null) => void;
  customInputs?: CustomTest[];
}) {
  const head = runHeadline(run);
  const visible = run.tests.filter(
    (t): t is Extract<PublicTestResult, { hidden: false }> => !t.hidden,
  );
  const hidden = run.tests.filter(
    (t): t is Extract<PublicTestResult, { hidden: true }> => t.hidden,
  );
  const firstBad =
    visible.find((t) => t.verdict !== 'pass' && t.verdict !== 'ran' && t.verdict !== 'skipped') ??
    visible[0];
  const [selected, setSelected] = useState(firstBad?.id ?? null);
  useEffect(() => setSelected(firstBad?.id ?? null), [firstBad?.id]);
  const current = visible.find((t) => t.id === selected) ?? visible[0];
  const sampleIndex = (id: string) =>
    `${run.mode === 'custom' ? 'Custom' : 'Sample'} ${visible.findIndex((t) => t.id === id) + 1}`;
  const totalMs = run.tests.reduce((s, t) => s + t.timeMs, 0) || run.file?.timeMs || 0;

  return (
    <div className="space-y-4" data-testid="run-result">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h3 className={cn('flex items-center gap-2 text-md font-semibold', toneText[head.tone])}>
          {run.verdict && <RunVerdictIcon verdict={run.verdict} className="size-5 self-center" />}
          {head.label}
        </h3>
        {run.total > 0 && run.mode !== 'custom' && (
          <span className="text-sm text-fg-muted tabular">
            {run.passed} / {run.total} tests passed
          </span>
        )}
        <span className="text-xs text-fg-subtle">
          {MODE_LABEL[run.mode]}
          {totalMs > 0 && ` · ${formatMs(totalMs)}`}
          {run.compile?.ok &&
            run.compile.timeMs > 0 &&
            ` · compiled in ${formatMs(run.compile.timeMs)}`}
        </span>
      </div>

      {run.message &&
        (run.verdict === 'invalid_submission' ||
          run.verdict === 'internal_error' ||
          !run.tests.length) && (
          <p
            className={cn(
              'flex items-start gap-2 rounded-md px-3 py-2 text-sm',
              run.verdict === 'internal_error'
                ? 'bg-surface-3 text-fg'
                : 'bg-bad-soft text-bad-text',
            )}
          >
            <AlertTriangleIcon className="mt-0.5 size-4 shrink-0" aria-hidden />
            <span>
              {run.message}
              {run.verdict === 'internal_error' &&
                ' This is a problem on our side, not in your code. Try again.'}
              {run.verdict === 'invalid_submission' && (
                <span className="block text-xs text-fg-muted">
                  Run tests and Submit call your class directly, so its name and methods must match
                  the signature in the problem.
                </span>
              )}
            </span>
          </p>
        )}

      {run.compile && !run.compile.ok && (
        <>
          <OutputBlock
            label="Compiler output"
            text={run.compile.output}
            tone="bad"
            onJump={onJump}
          />
          {mentionsTestHarness(run.compile.output) && (
            <p className="text-xs text-fg-muted" data-testid="harness-error-note">
              Errors in <code className="font-mono">{CPP_HARNESS_FILE}</code> are in the
              problem&apos;s tests, not your file: they use your code as the statement describes, so
              a missing or differently named member, or a different signature, shows up there.
            </p>
          )}
        </>
      )}
      {run.compile?.ok && run.compile.output && (
        <OutputBlock
          label="Compiler warnings"
          text={run.compile.output}
          tone="warn"
          onJump={onJump}
        />
      )}

      {run.file && (
        <div className="space-y-3">
          <dl className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-fg-muted">
            <div className="flex gap-1.5">
              <dt>Exit code</dt>
              <dd className={cn('font-mono tabular', run.file.exitCode !== 0 && 'text-bad-text')}>
                {run.file.exitCode ?? '—'}
              </dd>
            </div>
            {run.file.signal && (
              <div className="flex gap-1.5">
                <dt>Signal</dt>
                <dd className="font-mono text-bad-text">{run.file.signal}</dd>
              </div>
            )}
            <div className="flex gap-1.5">
              <dt>Time</dt>
              <dd className="tabular">{formatMs(run.file.timeMs)}</dd>
            </div>
          </dl>
          <OutputBlock label="Stdout" text={run.file.stdout} empty="The program printed nothing." />
          {run.file.stderr && (
            <OutputBlock label="Stderr" text={run.file.stderr} tone="bad" onJump={onJump} />
          )}
          {run.file.truncated && (
            <p className="text-xs text-warn-text">Output was cut off at 64 KB.</p>
          )}
        </div>
      )}

      {visible.length > 0 && current && (
        <div className="grid gap-4 md:grid-cols-[160px_minmax(0,1fr)]">
          <div className="flex gap-1 overflow-x-auto md:flex-col" aria-label="Tests" role="tablist">
            {visible.map((t) => {
              const v = TEST_VERDICT[t.verdict];
              const Icon = TEST_ICON[t.verdict];
              const active = t.id === current.id;
              return (
                <Fragment key={t.id}>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={active}
                    onClick={() => setSelected(t.id)}
                    className={cn(
                      'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm whitespace-nowrap transition-colors',
                      active
                        ? 'bg-surface-3 text-fg'
                        : 'text-fg-muted hover:bg-surface-2 hover:text-fg',
                    )}
                  >
                    <span
                      className={cn(
                        'flex size-4 shrink-0 items-center justify-center rounded-full',
                        toneSoft[v.tone],
                      )}
                    >
                      <Icon
                        className={cn('size-2.5', toneIcon[v.tone])}
                        strokeWidth={3}
                        aria-hidden
                      />
                    </span>
                    {sampleIndex(t.id)}
                    <span className="sr-only">: {v.label}</span>
                  </button>
                </Fragment>
              );
            })}
          </div>
          <div className="min-w-0" role="tabpanel">
            <TestDetail
              test={current}
              run={run}
              custom={
                run.mode === 'custom' ? (customInputs?.[visible.indexOf(current)] ?? null) : null
              }
            />
          </div>
        </div>
      )}

      <HiddenSummary tests={hidden} />

      {run.verdict === 'accepted' && run.mode === 'submit' && (
        <p className="text-sm text-fg-muted">
          All {plural(run.total, 'test')} passed. Talk through the complexity of your solution, or
          end the interview to see your report.
        </p>
      )}
    </div>
  );
}

export function RunProgressView({ run }: { run: Run }) {
  const { state } = usePad();
  const p = state.progress[run.id];
  const phase = p?.phase ?? (run.status === 'queued' ? 'queued' : 'started');
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    const start = Date.now();
    const t = setInterval(() => setElapsed(Date.now() - start), 100);
    return () => clearInterval(t);
  }, []);
  const steps = [
    { id: 'queued', label: 'Queued' },
    ...(run.language === 'python' ? [] : [{ id: 'compiling', label: 'Compiling' }]),
    { id: 'running', label: p?.total ? `Running ${p.done ?? 0} / ${p.total}` : 'Running' },
  ];
  const order = ['queued', 'started', 'compiling', 'running'];
  const at = order.indexOf(phase);
  const pct = p?.total ? Math.round(((p.done ?? 0) / p.total) * 100) : null;

  return (
    <div className="space-y-4" aria-live="polite" data-testid="run-progress">
      <div className="flex items-center gap-3">
        <span className="relative flex size-2.5" aria-hidden>
          <span className="absolute inline-flex size-full animate-ping rounded-full bg-accent opacity-50" />
          <span className="relative inline-flex size-2.5 rounded-full bg-accent" />
        </span>
        <h3 className="text-md font-semibold">{MODE_LABEL[run.mode]}…</h3>
        <span className="text-xs text-fg-subtle tabular">{(elapsed / 1000).toFixed(1)} s</span>
      </div>
      <ol className="flex flex-wrap items-center gap-2 text-xs">
        {steps.map((s, i) => {
          const idx = order.indexOf(s.id);
          const done = at > idx || (s.id === 'queued' && at >= 1);
          const current =
            !done &&
            (at === idx ||
              (s.id === 'compiling' && phase === 'started' && run.language !== 'python'));
          return (
            <li key={s.id} className="flex items-center gap-2">
              {i > 0 && <span className="h-px w-5 bg-border-strong" aria-hidden />}
              <span
                className={cn(
                  'inline-flex h-6 items-center gap-1.5 rounded-full border px-2.5 font-medium',
                  done
                    ? 'border-transparent bg-surface-3 text-fg-muted'
                    : current
                      ? 'border-accent/50 bg-accent-soft text-accent-text'
                      : 'border-border text-fg-subtle',
                )}
              >
                {s.label}
                {done && <span className="sr-only"> (done)</span>}
              </span>
            </li>
          );
        })}
      </ol>
      {pct !== null && (
        <div
          className="h-1 w-full max-w-md overflow-hidden rounded-full bg-surface-3"
          role="progressbar"
          aria-valuenow={pct}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label="Tests run"
        >
          <div
            className="h-full rounded-full bg-accent transition-[width] duration-200"
            style={{ width: `${pct}%` }}
          />
        </div>
      )}
      {run.mode === 'file' && (
        <div className="space-y-3">
          <OutputBlock label="Stdout (live)" text={p?.stdout ?? ''} empty="Waiting for output…" />
          {p?.stderr && <OutputBlock label="Stderr (live)" text={p.stderr} tone="bad" />}
        </div>
      )}
    </div>
  );
}

export function NoRunsYet({ blank }: { blank?: boolean }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center text-sm text-fg-muted">
      <TerminalIcon className="size-5 text-fg-subtle" aria-hidden />
      <p className="font-medium text-fg">Nothing has run yet</p>
      {blank ? (
        <p className="max-w-md">
          <strong className="font-medium text-fg">Run</strong> executes the file as written and
          shows what it prints. This room has no problem, so there are no tests.
        </p>
      ) : (
        <p className="max-w-md">
          <strong className="font-medium text-fg">Run</strong> executes your file as written,
          including your own main. <strong className="font-medium text-fg">Run tests</strong> checks
          your class against the samples, and{' '}
          <strong className="font-medium text-fg">Submit</strong> runs the hidden tests too.
        </p>
      )}
    </div>
  );
}
