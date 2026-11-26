'use client';
/**
 * A run in progress: a 3-2-1 countdown, then one question at a time with the answer field
 * focused throughout. Enter sends, and the next question is there at once; Shift+Enter (or Skip)
 * passes. Time comes from `performance.now()` through the pure `runReducer`, never from counting
 * ticks: the interval below only asks the reducer to look at the clock.
 *
 * Nothing on the screen moves when a question changes: the question, field and mark line have
 * fixed heights. Every pointer press outside the field is cancelled, so a tap on the page (or a
 * button) never takes focus from the field and the phone keyboard stays up.
 */
import type { DrillConfig } from '@ipp/contracts';
import { AlertCircleIcon, CheckIcon, SkipForwardIcon, TimerIcon, XIcon } from 'lucide-react';
import { useEffect, useLayoutEffect, useReducer, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { fieldClass } from '@/components/ui/input';
import { Kbd } from '@/components/ui/kbd';
import { formatClock } from '@/lib/format';
import { cn } from '@/lib/utils';
import {
  type Answered,
  clockSeconds,
  countdownDigit,
  currentQuestion,
  DrillDeck,
  initRun,
  type RunState,
  remainingMs,
  runReducer,
  runScore,
  spokenQuestion,
  worked,
} from './logic';

/** How often the clock is looked at; the reducer re-renders only when what it shows changes. */
const TICK_MS = 100;
/** The clock turns to a warning colour for the last seconds. */
const LOW_TIME_SEC = 10;

const SHAKE: Keyframe[] = [
  { transform: 'translateX(0)' },
  { transform: 'translateX(-6px)' },
  { transform: 'translateX(5px)' },
  { transform: 'translateX(-3px)' },
  { transform: 'translateX(0)' },
];

function LastMark({ a }: { a: Answered }) {
  if (a.outcome === 'right')
    return (
      <span className="inline-flex items-center gap-1.5 text-fg-muted" data-outcome="right">
        <CheckIcon className="size-4 shrink-0 text-ok" strokeWidth={2.5} aria-hidden />
        Right
      </span>
    );
  return (
    <span
      className="flex min-w-0 items-center gap-1.5 text-fg-muted"
      data-outcome={a.outcome}
      title={worked(a.question)}
    >
      {a.outcome === 'wrong' ? (
        <XIcon className="size-4 shrink-0 text-bad" strokeWidth={2.5} aria-hidden />
      ) : (
        <SkipForwardIcon className="size-3.5 shrink-0 text-fg-subtle" aria-hidden />
      )}
      <span className="shrink-0">{a.outcome === 'wrong' ? 'Wrong' : 'Skipped'}</span>
      <span aria-hidden className="text-fg-subtle">
        ·
      </span>
      <span className="truncate tabular">{worked(a.question)}</span>
    </span>
  );
}

const spokenMark = (a: Answered | undefined) =>
  !a
    ? ''
    : a.outcome === 'right'
      ? 'Right. '
      : `${a.outcome === 'wrong' ? 'Wrong' : 'Skipped'}: ${worked(a.question)}. `;

export function DrillRunScreen({
  config,
  seed,
  onOver,
}: {
  config: DrillConfig;
  seed: number;
  /** Called once, when the clock runs out or the run is stopped. */
  onOver: (s: RunState) => void;
}) {
  const [state, dispatch] = useReducer(runReducer, null, () =>
    initRun(
      new DrillDeck(seed, config.level, config.categories),
      config.durationSec,
      performance.now(),
    ),
  );
  const input = useRef<HTMLInputElement>(null);
  const field = useRef<HTMLDivElement>(null);

  // Focus before paint: the page moved focus to a stand-in field on Start (inside the tap), so
  // a phone keeps its keyboard up as focus moves here.
  useLayoutEffect(() => {
    input.current?.focus({ preventScroll: true });
  }, []);

  useEffect(() => {
    const tick = () => dispatch({ type: 'tick', now: performance.now() });
    const id = window.setInterval(tick, TICK_MS);
    document.addEventListener('visibilitychange', tick);
    return () => {
      window.clearInterval(id);
      document.removeEventListener('visibilitychange', tick);
    };
  }, []);

  const reported = useRef(false);
  useEffect(() => {
    if (state.phase !== 'over' || reported.current) return;
    reported.current = true;
    onOver(state);
  }, [state, onOver]);

  // Text that is not an answer: the field shakes (unless motion is reduced) and keeps it.
  const shakes = state.invalid?.count ?? 0;
  useEffect(() => {
    if (shakes === 0 || !field.current?.animate) return;
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    field.current.animate(SHAKE, { duration: 260, easing: 'ease-out' });
  }, [shakes]);

  const running = state.phase === 'running';
  const q = running ? currentQuestion(state) : null;
  const last = state.answers.at(-1);
  const seconds = clockSeconds(state);
  const percent = q?.form === 'percent';
  const now = () => performance.now();
  const keepFocus = (e: React.PointerEvent | React.MouseEvent) => {
    if (e.target !== input.current) e.preventDefault();
  };

  const announcement = state.invalid
    ? state.invalid.note
    : q
      ? `${spokenMark(last)}${spokenQuestion(q)}`
      : `Starting in ${countdownDigit(state)}`;

  return (
    <section
      aria-label="Mental math run"
      className="mx-auto max-w-2xl px-4 pt-4 select-none sm:px-6 sm:pt-12"
      onPointerDown={keepFocus}
      onMouseDown={keepFocus}
    >
      <h1 className="sr-only">Mental math</h1>
      <div className="flex items-center gap-4">
        <div
          role="timer"
          aria-label="Time left"
          data-testid="drill-clock"
          className={cn(
            'flex items-center gap-1.5 text-lg font-semibold tabular',
            running && seconds <= LOW_TIME_SEC && 'text-warn-text',
          )}
        >
          <TimerIcon className="size-4 text-fg-subtle" aria-hidden />
          {formatClock(seconds)}
        </div>
        <div className="flex items-baseline gap-1.5 text-sm text-fg-muted">
          Score
          <span data-testid="drill-score" className="text-lg font-semibold text-fg tabular">
            {runScore(state.answers)}
          </span>
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="ml-auto"
          onClick={() => dispatch({ type: 'stop', now: now() })}
        >
          Stop
        </Button>
      </div>
      <div className="mt-2 h-1 overflow-hidden rounded-full bg-surface-3" aria-hidden>
        <div
          className="h-full rounded-full bg-accent/70"
          style={{ width: `${(remainingMs(state) / state.durationMs) * 100}%` }}
        />
      </div>

      <div className="mt-6 flex h-28 flex-col items-center justify-end text-center sm:mt-14 sm:h-36">
        <p className="flex h-5 items-center gap-1.5 text-sm text-fg-muted" data-testid="drill-ask">
          {q?.tolerance != null && (
            <span aria-hidden className="text-base font-semibold text-accent-text">
              ≈
            </span>
          )}
          {q ? q.ask : 'Get ready'}
        </p>
        <p
          data-testid="drill-question"
          className={cn(
            'mt-2 max-w-full text-[2rem] leading-tight font-semibold tracking-tight break-words tabular sm:text-[3.25rem]',
            !q && 'text-accent-text',
          )}
        >
          {q ? q.text : countdownDigit(state)}
        </p>
      </div>

      <div ref={field} className="relative mx-auto mt-5 w-full max-w-sm">
        <input
          ref={input}
          aria-label="Your answer"
          aria-describedby="drill-note"
          aria-invalid={state.invalid ? true : undefined}
          data-testid="drill-answer"
          inputMode={q?.inputMode ?? 'decimal'}
          enterKeyHint="enter"
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
          value={state.draft}
          onChange={(e) => dispatch({ type: 'edit', text: e.target.value })}
          onKeyDown={(e) => {
            if (e.key !== 'Enter' || e.nativeEvent.isComposing) return;
            e.preventDefault();
            dispatch({ type: e.shiftKey ? 'skip' : 'submit', now: now() });
          }}
          className={cn(
            fieldClass,
            'h-14 text-center text-2xl! font-medium tabular sm:h-16 sm:text-3xl!',
            percent && 'px-10',
          )}
        />
        {percent && (
          <span
            aria-hidden
            className="pointer-events-none absolute inset-y-0 right-4 flex items-center text-xl text-fg-subtle"
          >
            %
          </span>
        )}
      </div>

      <div className="mx-auto mt-2 flex h-8 w-full max-w-sm items-center gap-2 text-sm">
        <div id="drill-note" className="min-w-0 flex-1" data-testid="drill-mark">
          {state.invalid ? (
            <span className="inline-flex items-center gap-1.5 font-medium text-bad-text">
              <AlertCircleIcon className="size-4 shrink-0" aria-hidden />
              {state.invalid.note}
            </span>
          ) : (
            last && <LastMark a={last} />
          )}
        </div>
        <Button
          variant="ghost"
          size="xs"
          disabled={!running}
          onClick={() => dispatch({ type: 'skip', now: now() })}
          aria-keyshortcuts="Shift+Enter"
        >
          Skip
          <Kbd keys="Shift+Enter" className="max-sm:hidden" aria-hidden />
        </Button>
      </div>

      <p className="sr-only" aria-live="polite" data-testid="drill-live">
        {announcement}
      </p>
    </section>
  );
}
