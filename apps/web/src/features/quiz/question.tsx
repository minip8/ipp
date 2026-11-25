'use client';
import type { AnswerFeedback, PublicQuizQuestion } from '@ipp/contracts';
import {
  CheckIcon,
  CircleCheckIcon,
  CircleDotIcon,
  CircleHelpIcon,
  CircleXIcon,
  XIcon,
} from 'lucide-react';
import type * as React from 'react';
import { CodeBlock } from '@/components/code-block';
import { DifficultyBadge, LANG_LABEL } from '@/components/domain';
import { Markdown } from '@/components/markdown';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/input';
import { RadioCard, RadioRoot } from '@/components/ui/radio-cards';
import { Spinner } from '@/components/ui/spinner';
import { humanize } from '@/lib/format';
import { cn } from '@/lib/utils';
import {
  choiceLetter,
  correctChoiceIds,
  type Draft,
  formatCorrect,
  GRADED_BY_LABEL,
  OUTCOME_LABEL,
  type Outcome,
  type OutputKind,
  outcomeOf,
  outputKindsFor,
  SHORT_MAX,
  TYPE_LABEL,
} from './logic';

/**
 * For a screen's root: on a phone, long words and identifiers wrap instead of widening the page.
 * Code blocks keep scrolling sideways (`white-space: pre` does not wrap). Nothing changes from
 * `sm` up.
 */
export const PHONE_FIT = 'max-sm:[overflow-wrap:anywhere]';

/** A text field on a phone: 16px text, so iOS does not zoom the page when it is focused. */
export const PHONE_FIELD = 'max-sm:text-md';

/**
 * The answer/next bar under a question: in the flow on a wide screen; below `lg`, where the page
 * itself scrolls, it sticks to the bottom of the viewport so the primary action stays under the
 * thumb, full bleed across the page gutter and clear of the home indicator.
 */
export const ACTION_BAR =
  'max-lg:sticky max-lg:bottom-0 max-lg:z-10 max-lg:-mx-4 max-lg:bg-bg max-lg:px-4 max-lg:pt-3 max-lg:pb-[calc(0.75rem+env(safe-area-inset-bottom))] sm:max-lg:-mx-6 sm:max-lg:px-6';

/** Where the page scrolls as a whole (below `lg`), bring new feedback into view. */
export function revealOnNarrow(el: HTMLElement | null) {
  if (!el || !window.matchMedia('(max-width: 1023.98px)').matches) return;
  el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

export const OUTCOME_ICON: Record<Outcome, typeof CheckIcon> = {
  correct: CircleCheckIcon,
  partial: CircleDotIcon,
  incorrect: CircleXIcon,
  pending: CircleHelpIcon,
};
export const OUTCOME_TEXT: Record<Outcome, string> = {
  correct: 'text-ok-text',
  partial: 'text-warn-text',
  incorrect: 'text-bad-text',
  pending: 'text-accent-text',
};
export const OUTCOME_SOFT: Record<Outcome, string> = {
  correct: 'bg-ok-soft text-ok-text border-ok/40',
  partial: 'bg-warn-soft text-warn-text border-warn/50',
  incorrect: 'bg-bad-soft text-bad-text border-bad/40',
  pending: 'bg-accent-soft text-accent-text border-accent/40',
};

export function QuestionHeader({ q }: { q: PublicQuizQuestion }) {
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-fg-muted">
      <span className="font-medium text-fg">{TYPE_LABEL[q.type]}</span>
      <span aria-hidden>·</span>
      <span>{humanize(q.topic)}</span>
      {q.subtopic && (
        <>
          <span aria-hidden>·</span>
          <span>{q.subtopic}</span>
        </>
      )}
      <DifficultyBadge difficulty={q.difficulty} className="ml-1" />
    </div>
  );
}

export function QuestionCode({ q }: { q: PublicQuizQuestion }) {
  if (!q.code) return null;
  return (
    <figure className="overflow-hidden rounded-lg border border-border">
      <figcaption className="flex h-8 items-center justify-between border-b border-border bg-surface-2 px-3 text-xs text-fg-muted">
        <span className="font-medium text-fg">{LANG_LABEL[q.code.language]}</span>
        <span className="font-mono">{q.code.standard}</span>
      </figcaption>
      <CodeBlock
        code={q.code.source}
        language={q.code.language}
        lineNumbers
        className="rounded-none border-0 bg-surface text-[13px]"
      />
    </figure>
  );
}

function ChoiceList({
  q,
  draft,
  setDraft,
  feedback,
  locked,
}: {
  q: PublicQuizQuestion;
  draft: Extract<Draft, { type: 'single' | 'multiple' }>;
  setDraft: (d: Draft) => void;
  feedback: AnswerFeedback | undefined;
  locked: boolean;
}) {
  const multi = draft.type === 'multiple';
  const correct = feedback && !feedback.needsSelfGrade ? correctChoiceIds(feedback) : null;
  const chosen = (id: string) =>
    draft.type === 'single' ? draft.choice === id : draft.choices.includes(id);
  const toggle = (id: string) => {
    if (locked) return;
    if (draft.type === 'single') setDraft({ type: 'single', choice: id });
    else
      setDraft({
        type: 'multiple',
        choices: draft.choices.includes(id)
          ? draft.choices.filter((c) => c !== id)
          : [...draft.choices, id],
      });
  };
  return (
    <div
      {...{ role: multi ? 'group' : 'radiogroup', 'aria-label': 'Answer choices' }}
      className="space-y-2"
    >
      {q.choices?.map((c, i) => {
        const isChosen = chosen(c.id);
        const isCorrect = correct?.includes(c.id) ?? false;
        const state = !correct
          ? isChosen
            ? 'chosen'
            : 'idle'
          : isCorrect
            ? isChosen
              ? 'right'
              : 'missed'
            : isChosen
              ? 'wrong'
              : 'dim';
        return (
          <button
            key={c.id}
            type="button"
            {...{ role: multi ? 'checkbox' : 'radio', 'aria-checked': isChosen }}
            aria-disabled={locked || undefined}
            data-state={state}
            onClick={() => toggle(c.id)}
            className={cn(
              'group flex w-full items-start gap-3 rounded-lg border px-3.5 py-3 text-left transition-[border-color,background-color,box-shadow]',
              state === 'idle' &&
                'border-border-strong bg-surface hover:border-fg-subtle hover:bg-surface-2',
              state === 'chosen' && 'border-accent bg-accent-soft/40 ring-1 ring-accent',
              state === 'right' && 'border-ok bg-ok-soft/60 ring-1 ring-ok',
              state === 'missed' && 'border-ok border-dashed bg-surface',
              state === 'wrong' && 'border-bad bg-bad-soft/60 ring-1 ring-bad',
              state === 'dim' && 'border-border bg-surface opacity-60',
              locked && 'cursor-default',
            )}
          >
            <span
              aria-hidden
              className={cn(
                'mt-px flex size-6 shrink-0 items-center justify-center border font-mono text-xs font-semibold',
                multi ? 'rounded-[5px]' : 'rounded-full',
                state === 'idle' && 'border-border-strong text-fg-muted group-hover:text-fg',
                state === 'chosen' && 'border-accent bg-accent text-accent-fg',
                state === 'right' && 'border-ok bg-ok text-white dark:text-[oklch(0.17_0.03_152)]',
                state === 'missed' && 'border-ok text-ok-text',
                state === 'wrong' && 'border-bad bg-bad text-white',
                state === 'dim' && 'border-border text-fg-subtle',
              )}
            >
              {state === 'right' || state === 'missed' ? (
                <CheckIcon className="size-3.5" strokeWidth={3} />
              ) : state === 'wrong' ? (
                <XIcon className="size-3.5" strokeWidth={3} />
              ) : (
                choiceLetter(i)
              )}
            </span>
            <span className="min-w-0 flex-1">
              <Markdown className="text-base [&_p]:m-0">{c.text}</Markdown>
              {(state === 'right' || state === 'missed' || state === 'wrong') && (
                <span
                  className={cn(
                    'mt-1 block text-xs font-medium',
                    state === 'wrong' ? 'text-bad-text' : 'text-ok-text',
                  )}
                >
                  {state === 'right'
                    ? 'Your answer · correct'
                    : state === 'missed'
                      ? 'Correct answer'
                      : 'Your answer · incorrect'}
                </span>
              )}
            </span>
          </button>
        );
      })}
    </div>
  );
}

function OutputAnswerInput({
  q,
  draft,
  setDraft,
  locked,
}: {
  q: PublicQuizQuestion;
  draft: Extract<Draft, { type: 'output' }>;
  setDraft: (d: Draft) => void;
  locked: boolean;
}) {
  const kinds = outputKindsFor(q.code?.language ?? 'cpp');
  return (
    <div className="space-y-3">
      <RadioRoot
        aria-label="What the program does"
        value={draft.kind ?? ''}
        onValueChange={(v) => setDraft({ ...draft, kind: v as OutputKind })}
        disabled={locked}
        className="grid gap-2 sm:grid-cols-2"
      >
        {kinds.map((k, i) => (
          <RadioCard key={k.kind} value={k.kind} className="py-2">
            <span className="flex items-center gap-2">
              <span className="text-sm font-medium">{k.label}</span>
              <span
                className="ml-auto hidden font-mono text-2xs text-fg-subtle sm:inline pointer-coarse:hidden!"
                aria-hidden
              >
                {i + 1}
              </span>
            </span>
            <span className="mt-0.5 block text-xs text-fg-muted">{k.hint}</span>
          </RadioCard>
        ))}
      </RadioRoot>
      {draft.kind === 'output' && (
        <div className="space-y-1.5">
          <label htmlFor={`out-${q.id}`} className="text-sm font-medium">
            Output
          </label>
          <Textarea
            id={`out-${q.id}`}
            value={draft.output}
            readOnly={locked}
            autoFocus={!locked}
            spellCheck={false}
            placeholder="Exactly what the program prints"
            onChange={(e) => setDraft({ ...draft, output: e.target.value })}
            className={cn(
              'min-h-16 font-mono text-sm read-only:bg-surface-2 read-only:text-fg-muted max-lg:scroll-mb-28',
              PHONE_FIELD,
            )}
          />
        </div>
      )}
    </div>
  );
}

function ShortAnswerInput({
  q,
  draft,
  setDraft,
  locked,
}: {
  q: PublicQuizQuestion;
  draft: Extract<Draft, { type: 'short' }>;
  setDraft: (d: Draft) => void;
  locked: boolean;
}) {
  const len = draft.text.length;
  return (
    <div className="space-y-1.5">
      <label htmlFor={`short-${q.id}`} className="sr-only">
        Your answer
      </label>
      <Textarea
        id={`short-${q.id}`}
        value={draft.text}
        readOnly={locked}
        maxLength={SHORT_MAX}
        placeholder="Write your answer in a few sentences"
        onChange={(e) => setDraft({ type: 'short', text: e.target.value })}
        className={cn(
          'min-h-36 text-base read-only:bg-surface-2 read-only:text-fg-muted max-lg:scroll-mb-28',
          PHONE_FIELD,
        )}
        aria-describedby={`short-count-${q.id}`}
      />
      <p
        id={`short-count-${q.id}`}
        className={cn(
          'text-right text-xs tabular',
          len > SHORT_MAX * 0.9 ? 'text-warn-text' : 'text-fg-subtle',
        )}
      >
        {len.toLocaleString()} / {SHORT_MAX.toLocaleString()}
      </p>
    </div>
  );
}

export function AnswerInput(props: {
  q: PublicQuizQuestion;
  draft: Draft;
  setDraft: (d: Draft) => void;
  feedback: AnswerFeedback | undefined;
  locked: boolean;
}) {
  const { draft } = props;
  if (draft.type === 'single' || draft.type === 'multiple')
    return <ChoiceList {...props} draft={draft} />;
  if (draft.type === 'output') return <OutputAnswerInput {...props} draft={draft} />;
  return <ShortAnswerInput {...props} draft={draft} />;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="mb-1.5 text-2xs font-medium tracking-wider text-fg-subtle uppercase">
        {title}
      </h3>
      {children}
    </div>
  );
}

export function FeedbackPanel({
  q,
  feedback,
  onSelfGrade,
  grading,
}: {
  q: PublicQuizQuestion;
  feedback: AnswerFeedback;
  onSelfGrade?: (grade: number) => void;
  grading?: number | null;
}) {
  const outcome = outcomeOf(feedback) ?? 'incorrect';
  const Icon = OUTCOME_ICON[outcome];
  const showCorrect = q.type === 'output' || q.type === 'short';
  return (
    <section
      aria-live="polite"
      aria-label="Feedback"
      className="animate-fade-in overflow-hidden rounded-lg border border-border bg-surface"
    >
      <header
        className={cn(
          'flex flex-wrap items-center gap-x-3 gap-y-1 border-b px-4 py-2.5',
          OUTCOME_SOFT[outcome],
        )}
      >
        <Icon className="size-4.5" aria-hidden />
        <span className="font-semibold">{OUTCOME_LABEL[outcome]}</span>
        {outcome === 'partial' && (
          <span className="text-sm tabular">{Math.round(feedback.score * 100)}% credit</span>
        )}
        {outcome !== 'pending' && (
          <span className="ml-auto text-xs opacity-80">{GRADED_BY_LABEL[feedback.gradedBy]}</span>
        )}
      </header>
      <div className="space-y-4 px-4 py-4">
        {feedback.needsSelfGrade ? (
          <>
            <p className="text-sm text-fg-muted">
              This one is not graded automatically. Compare your answer with the reference and grade
              yourself.
            </p>
            <Section title="Reference answer">
              <p className="rounded-md border-l-2 border-accent bg-surface-2 px-3 py-2 text-base whitespace-pre-wrap">
                {formatCorrect(q, feedback)}
              </p>
            </Section>
            <div>
              <p className="mb-2 text-sm font-medium">How did you do?</p>
              <div className="flex flex-wrap gap-2">
                {[
                  { v: 0, label: 'Missed it' },
                  { v: 0.5, label: 'Partly' },
                  { v: 1, label: 'Got it' },
                ].map((g) => (
                  <Button
                    key={g.v}
                    className="max-sm:h-10 max-sm:flex-1"
                    disabled={grading !== null && grading !== undefined}
                    onClick={() => onSelfGrade?.(g.v)}
                  >
                    {grading === g.v && <Spinner />}
                    {g.label}
                  </Button>
                ))}
              </div>
            </div>
          </>
        ) : (
          <>
            {feedback.feedback && (
              <Section title="Feedback">
                <p className="text-base">{feedback.feedback}</p>
              </Section>
            )}
            {showCorrect && (
              <Section title={q.type === 'short' ? 'Reference answer' : 'Correct answer'}>
                {q.type === 'output' &&
                typeof feedback.correctAnswer === 'object' &&
                !Array.isArray(feedback.correctAnswer) &&
                feedback.correctAnswer.kind === 'output' ? (
                  <pre className="rounded-md border border-border bg-surface-2 px-3 py-2 font-mono text-sm whitespace-pre-wrap">
                    {feedback.correctAnswer.output}
                  </pre>
                ) : (
                  <p className="rounded-md border-l-2 border-ok bg-surface-2 px-3 py-2 text-base whitespace-pre-wrap">
                    {formatCorrect(q, feedback)}
                  </p>
                )}
              </Section>
            )}
            {feedback.explanation && (
              <Section title="Why">
                <Markdown className="text-base">{feedback.explanation}</Markdown>
              </Section>
            )}
          </>
        )}
      </div>
    </section>
  );
}
