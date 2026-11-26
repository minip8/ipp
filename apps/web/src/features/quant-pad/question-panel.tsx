'use client';
/**
 * The round's questions as the candidate sees them: the current one in full, with its own clock,
 * and the earlier ones collapsed. Read only from the round view in the pad's state, so a missed
 * chat message never leaves it behind.
 */
import type { QuantQuestionView, QuantRoundView } from '@ipp/contracts';
import {
  ChevronRightIcon,
  ClockIcon,
  FileBarChartIcon,
  FlagIcon,
  LightbulbIcon,
  SparklesIcon,
} from 'lucide-react';
import Link from 'next/link';
import { DifficultyBadge } from '@/components/domain';
import { MathMarkdown } from '@/components/math-markdown';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { usePad } from '@/features/pad/session';
import { useNow } from '@/features/pad/top-bar';
import {
  GamePanel,
  GameStripLine,
  GameSummary,
  SettledGame,
} from '@/features/quant-game/game-panel';
import { formatClock, plural } from '@/lib/format';
import { cn } from '@/lib/utils';
import {
  closedLabel,
  currentQuestion,
  earlierQuestions,
  lastSettledGame,
  minutesPerQuestion,
  questionClock,
  roundHeading,
} from './logic';

/** The current question's clock: time left of its budget, then a quiet "over". */
export function QuestionTimer({ q, className }: { q: QuantQuestionView; className?: string }) {
  const now = useNow();
  const c = questionClock(q, now);
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 font-mono text-sm tabular',
        c.over ? 'text-fg-subtle' : 'text-fg-muted',
        className,
      )}
      data-testid="question-timer"
      data-over={c.over || undefined}
      role="timer"
      aria-label={
        c.over
          ? `Over this question's time by ${formatClock(-c.leftSec)}`
          : `${formatClock(c.leftSec)} left for this question`
      }
    >
      <ClockIcon className="size-3.5" aria-hidden />
      {c.over ? (
        <>
          <span>{formatClock(-c.leftSec)}</span>
          <span className="font-sans text-2xs font-medium">over time</span>
        </>
      ) : (
        <span>{formatClock(c.leftSec)}</span>
      )}
    </span>
  );
}

function ClockBar({ q }: { q: QuantQuestionView }) {
  const now = useNow();
  const c = questionClock(q, now);
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-3 text-xs text-fg-muted">
        <span>
          {c.over
            ? 'Past the time for this question. Finish your thought; the interviewer moves on soon.'
            : `About ${plural(Math.max(1, Math.round((q.budgetSec ?? 0) / 60)), 'minute')} for this question`}
        </span>
        <span className="shrink-0 tabular">{formatClock(q.budgetSec ?? 0)}</span>
      </div>
      <div className="h-1 overflow-hidden rounded-full bg-surface-3" aria-hidden>
        <div
          className={cn(
            'h-full rounded-full transition-[width] duration-1000 ease-linear',
            c.over ? 'bg-fg-subtle/50' : 'bg-accent/70',
          )}
          style={{ width: `${(c.fraction * 100).toFixed(2)}%` }}
        />
      </div>
    </div>
  );
}

function Current({ q }: { q: QuantQuestionView }) {
  const { readOnly } = usePad();
  return (
    <article
      className="space-y-4 px-5 py-5 max-lg:px-4"
      aria-labelledby="current-question-heading"
      data-testid="current-question"
    >
      <h2 id="current-question-heading" className="sr-only">
        Question {q.index + 1}
      </h2>
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-xs font-medium text-fg-muted" data-testid="question-topic">
          {q.topicTitle}
        </span>
        <DifficultyBadge difficulty={q.difficulty} />
      </div>
      <div data-testid="question-prompt">
        <MathMarkdown className="text-[15px] leading-relaxed">{q.prompt}</MathMarkdown>
      </div>
      {q.unit && (
        <p className="text-sm text-fg-muted" data-testid="question-unit">
          <span className="text-fg-subtle">Answer in </span>
          <span className="font-medium text-fg">{q.unit}</span>
        </p>
      )}
      <ClockBar q={q} />
      {q.hintsGiven > 0 && (
        <p className="flex items-center gap-1.5 text-xs text-fg-muted" data-testid="hints-given">
          <LightbulbIcon className="size-3.5 text-fg-subtle" aria-hidden />
          {plural(q.hintsGiven, 'hint')} so far
        </p>
      )}
      {q.game && <GamePanel index={q.index} game={q.game} canQuote={!readOnly} />}
    </article>
  );
}

function Pending({ round }: { round: QuantRoundView }) {
  const { state } = usePad();
  const each = state.pad.durationMin
    ? minutesPerQuestion(state.pad.durationMin, round.total ?? 1)
    : null;
  return (
    <div className="flex flex-col items-center px-6 py-12 text-center" data-testid="round-pending">
      <span className="mb-3 flex size-10 items-center justify-center rounded-lg border border-border bg-surface-2 text-fg-subtle">
        <SparklesIcon className="size-5" aria-hidden />
      </span>
      <p className="font-medium">The interviewer is about to start</p>
      <p className="mt-1 max-w-72 text-sm text-fg-muted">
        It says hello first. Then the first of {plural(round.total ?? 0, 'question')} appears here
        {each ? `, with about ${plural(each, 'minute')} for each` : ''}.
      </p>
    </div>
  );
}

function Finished({ onEnd, ending }: { onEnd: () => void; ending: boolean }) {
  const { state, readOnly } = usePad();
  const owner = state.role === 'owner';
  return (
    <div
      className="mx-5 my-5 rounded-lg border border-border bg-surface-2 px-4 py-4 max-lg:mx-4"
      data-testid="round-finished"
    >
      <p className="flex items-center gap-2 font-medium">
        <FlagIcon className="size-4 text-accent-text" aria-hidden /> Round finished
      </p>
      <p className="mt-1 text-sm text-fg-muted">
        {readOnly
          ? 'The report has a score for each answer, with the solutions.'
          : owner
            ? 'That was the last question. End the pad for the report: a score for each answer, with the solutions.'
            : 'That was the last question. The pad’s owner ends it to get the report.'}
      </p>
      {readOnly ? (
        <Button asChild variant="primary" size="sm" className="mt-3 max-lg:h-10">
          <Link href={`/pads/${state.pad.id}/report`}>
            <FileBarChartIcon /> See the report
          </Link>
        </Button>
      ) : (
        owner && (
          <Button
            variant="primary"
            size="sm"
            className="mt-3 max-lg:h-10"
            onClick={onEnd}
            disabled={ending}
          >
            {ending ? <Spinner /> : <FlagIcon />} End and see the report
          </Button>
        )
      )}
    </div>
  );
}

function Earlier({ questions }: { questions: QuantQuestionView[] }) {
  if (questions.length === 0) return null;
  return (
    <section
      aria-labelledby="earlier-questions-heading"
      className="border-t border-border px-5 py-4 max-lg:px-4"
    >
      <h2
        id="earlier-questions-heading"
        className="mb-2 text-2xs font-medium tracking-wider text-fg-subtle uppercase"
      >
        Earlier questions
      </h2>
      <ul className="space-y-1" data-testid="earlier-questions">
        {[...questions].reverse().map((q) => {
          const closed = closedLabel(q);
          return (
            <li key={q.index}>
              <details className="group rounded-md border border-border bg-surface open:bg-surface-2/50">
                <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2 text-sm select-none max-lg:py-2.5 [&::-webkit-details-marker]:hidden">
                  <ChevronRightIcon
                    className="size-3.5 shrink-0 text-fg-subtle transition-transform group-open:rotate-90"
                    aria-hidden
                  />
                  <span className="font-medium">Question {q.index + 1}</span>
                  <span className="min-w-0 truncate text-fg-muted">· {q.topicTitle}</span>
                  {closed && (
                    <Badge
                      tone="warn"
                      className="ml-auto shrink-0"
                      data-testid="question-closed-by"
                    >
                      {closed}
                    </Badge>
                  )}
                </summary>
                <MathMarkdown className="px-3 pt-0.5 pb-3 text-[13.5px] text-fg-muted">
                  {q.prompt}
                </MathMarkdown>
                {q.game && (
                  <div className="px-3 pb-3">
                    <GameSummary game={q.game} />
                  </div>
                )}
              </details>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

export function QuestionPanel({
  onEnd,
  ending,
  className,
}: {
  /** The round is over and the owner ends the pad from here. */
  onEnd: () => void;
  ending: boolean;
  className?: string;
}) {
  const { state } = usePad();
  const round = state.round;
  if (!round) return null;
  const current = currentQuestion(round);
  const settled = lastSettledGame(round);
  return (
    <section
      aria-label="Question"
      className={cn('flex h-full flex-col bg-surface', className)}
      data-testid="question-panel"
    >
      <header className="flex h-9 shrink-0 items-center gap-2 border-b border-border px-4 max-lg:h-10">
        <h2 className="text-sm font-medium" data-testid="round-heading">
          {roundHeading(round)}
        </h2>
        {current && <QuestionTimer q={current} className="ml-auto" />}
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {round.phase === 'pending' && <Pending round={round} />}
        {current && <Current q={current} />}
        {round.phase === 'finished' && <Finished onEnd={onEnd} ending={ending} />}
        {settled?.game && <SettledGame index={settled.index} game={settled.game} />}
        <Earlier questions={earlierQuestions(round)} />
      </div>
    </section>
  );
}

/**
 * The phone layout's chat pane: the current question kept in view above the conversation, two
 * lines of it, opening the question pane when tapped.
 */
export function QuestionStrip({ onOpen }: { onOpen: () => void }) {
  const { state } = usePad();
  const round = state.round;
  const current = round && currentQuestion(round);
  if (!round || !current) return null;
  return (
    <button
      type="button"
      onClick={onOpen}
      className="block w-full shrink-0 border-b border-border bg-surface-2/60 px-3 py-2 text-left active:bg-surface-3"
      data-testid="question-strip"
      aria-label={
        current.game
          ? `${roundHeading(round)}: show the game and quote`
          : `${roundHeading(round)}: show the question`
      }
    >
      <span className="flex items-center gap-2 text-xs">
        <span className="font-medium text-fg">{roundHeading(round)}</span>
        <QuestionTimer q={current} className="ml-auto text-xs" />
      </span>
      {current.game ? (
        <GameStripLine game={current.game} />
      ) : (
        <MathMarkdown className="mt-0.5 line-clamp-2 text-[13px] leading-snug text-fg-muted [&>*+*]:mt-0">
          {current.prompt}
        </MathMarkdown>
      )}
    </button>
  );
}
