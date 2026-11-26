'use client';
/**
 * The mental math drill (/quant/practice/drill): setup with the user's history beside it, the run, then
 * the results. Questions are generated and marked here in the browser (`logic.ts`); the server
 * only records each finished run, for the history and bests.
 *
 * Each run has its own seed: a random one, or `?seed=<n>` (then n, n+1, … for each run on the
 * page), so a run can be reproduced exactly (the browser tests do).
 */
import type { DrillConfig } from '@ipp/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronLeftIcon } from 'lucide-react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useRef, useState } from 'react';
import { api } from '@/lib/api';
import { qk } from '@/lib/queries';
import { tabHref } from '@/lib/track';
import { DrillHistoryPanel } from './history';
import { bestFor, parseSeed, type RunState, recordRequest, worthRecording } from './logic';
import { DrillResults, type FinishedRun, type SaveState } from './results';
import { DrillRunScreen } from './run';
import { DrillSetup } from './setup';
import { loadDrillSetup, saveDrillSetup } from './storage';

type Phase =
  | { name: 'setup' }
  | { name: 'run'; id: number; config: DrillConfig; seed: number }
  | { name: 'results'; id: number; run: FinishedRun };

function randomSeed(): number {
  const a = new Uint32Array(1);
  crypto.getRandomValues(a);
  return a[0] ?? 0;
}

const PAGE = 'mx-auto max-w-6xl px-4 pt-8 pb-[calc(2rem_+_env(safe-area-inset-bottom))] sm:px-6';

/** Back to the Quant track's Practice, where the drill is. */
function BackToPractice() {
  return (
    <Link
      href={tabHref('quant', 'practice')}
      className="-ml-1 inline-flex items-center gap-0.5 rounded-sm text-sm text-fg-muted transition-colors hover:text-fg"
    >
      <ChevronLeftIcon className="size-4" aria-hidden />
      Practice
    </Link>
  );
}

export function DrillPage() {
  const urlSeed = parseSeed(useSearchParams().get('seed'));
  // The page renders only in the browser (behind the auth gate), so storage can be read here.
  const [config, setConfig] = useState<DrillConfig>(loadDrillSetup);
  const [phase, setPhase] = useState<Phase>({ name: 'setup' });
  const runCount = useRef(0);
  /** A stand-in field focused inside the Start tap, so a phone raises its keyboard for the run. */
  const keyboard = useRef<HTMLInputElement>(null);
  const qc = useQueryClient();
  const history = useQuery({ queryKey: qk.drillRuns, queryFn: api.drillRuns });
  const record = useMutation({
    mutationFn: api.recordDrillRun,
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.drillRuns }),
  });

  const update = (c: DrillConfig) => {
    setConfig(c);
    saveDrillSetup(c);
  };

  const start = (c: DrillConfig) => {
    keyboard.current?.focus({ preventScroll: true });
    const id = runCount.current++;
    const seed = urlSeed !== null ? (urlSeed + id) >>> 0 : randomSeed();
    record.reset();
    window.scrollTo(0, 0);
    setPhase({ name: 'run', id, config: c, seed });
  };

  const finish = (p: Extract<Phase, { name: 'run' }>, s: RunState) => {
    // Stopped before anything was asked: back to the setup, nothing to show or keep.
    if (s.endedBy === 'stop' && s.answers.length === 0 && s.startedAt === null) {
      setPhase({ name: 'setup' });
      return;
    }
    const run: FinishedRun = {
      config: p.config,
      answers: s.answers,
      elapsedMs: s.elapsedMs,
      endedBy: s.endedBy ?? 'time',
    };
    setPhase({ name: 'results', id: p.id, run });
    if (worthRecording(run.answers))
      record.mutate(recordRequest(run.config, run.answers, run.elapsedMs));
  };

  const save: SaveState | null =
    phase.name !== 'results'
      ? null
      : !worthRecording(phase.run.answers)
        ? { status: 'skipped' }
        : record.isError
          ? { status: 'failed', error: record.error }
          : record.isSuccess
            ? { status: 'saved', newBest: record.data.newBest }
            : { status: 'pending' };

  return (
    <>
      <input
        ref={keyboard}
        tabIndex={-1}
        aria-hidden
        inputMode="decimal"
        className="pointer-events-none fixed top-0 left-0 size-px opacity-0"
      />
      {phase.name === 'run' ? (
        <DrillRunScreen
          key={phase.id}
          config={phase.config}
          seed={phase.seed}
          onOver={(s) => finish(phase, s)}
        />
      ) : phase.name === 'results' && save ? (
        <div className={PAGE}>
          <BackToPractice />
          <h1 className="mt-2 text-xl font-semibold tracking-tight">Mental math</h1>
          <div className="mt-5">
            <DrillResults
              key={phase.id}
              run={phase.run}
              save={save}
              bestScore={
                history.data
                  ? (bestFor(
                      history.data.bests,
                      phase.run.config.durationSec,
                      phase.run.config.level,
                    )?.score ?? null)
                  : null
              }
              onRetry={() => record.variables && record.mutate(record.variables)}
              onPlayAgain={() => start(phase.run.config)}
              onChangeSetup={() => {
                setConfig(phase.run.config);
                setPhase({ name: 'setup' });
              }}
            />
          </div>
        </div>
      ) : (
        <div className={PAGE}>
          <BackToPractice />
          <h1 className="mt-2 text-xl font-semibold tracking-tight">Mental math</h1>
          <p className="mt-1 max-w-2xl text-sm text-fg-muted">
            Arithmetic against the clock, answered from the keyboard: the speed test trading
            interviews often begin with. A right answer scores a point and a wrong one loses a
            point.
          </p>
          <div className="mt-6 grid items-start gap-x-6 gap-y-4 lg:grid-cols-[minmax(0,1fr)_360px]">
            <DrillSetup
              config={config}
              onChange={update}
              onStart={() => start(config)}
              history={history}
            />
            <DrillHistoryPanel history={history} config={config} />
          </div>
        </div>
      )}
    </>
  );
}
