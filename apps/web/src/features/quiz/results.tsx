'use client';
import type { AnswerFeedback, PublicQuizQuestion, QuizAttempt } from '@ipp/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeftIcon,
  ChevronDownIcon,
  CircleMinusIcon,
  PlusIcon,
  RotateCcwIcon,
} from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useMemo, useState } from 'react';
import { MathMarkdown, MathText } from '@/components/math-markdown';
import { InlineError } from '@/components/states';
import { OUTCOME_ICON, OUTCOME_TEXT } from '@/components/status-icon';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle } from '@/components/ui/card';
import { Spinner } from '@/components/ui/spinner';
import { api } from '@/lib/api';
import { formatDuration, formatPercent, humanize, plural } from '@/lib/format';
import { qk } from '@/lib/queries';
import { cn } from '@/lib/utils';
import {
  formatCorrect,
  formatResponse,
  GRADED_BY_LABEL,
  MODE_LABEL,
  OUTCOME_LABEL,
  type Outcome,
  outcomeOf,
  promptSummary,
  summarySegments,
  TYPE_LABEL,
} from './logic';
import { PHONE_FIT, QuestionCode } from './question';

type RowOutcome = Outcome | 'unanswered';

function useTitles() {
  const topics = useQuery({
    queryKey: qk.quizTopics,
    queryFn: api.quizTopics,
    staleTime: 5 * 60_000,
  });
  return useCallback(
    (slug: string) => topics.data?.find((t) => t.slug === slug)?.title ?? humanize(slug),
    [topics.data],
  );
}

function rowOutcome(
  q: PublicQuizQuestion,
  a: QuizAttempt,
  f: AnswerFeedback | undefined,
): RowOutcome {
  if (!a.responses[q.id]) return 'unanswered';
  return outcomeOf(f) ?? 'incorrect';
}

const ROW_LABEL: Record<RowOutcome, string> = { ...OUTCOME_LABEL, unanswered: 'Not answered' };

function OutcomeMark({ outcome, withLabel }: { outcome: RowOutcome; withLabel?: boolean }) {
  const Icon = outcome === 'unanswered' ? CircleMinusIcon : OUTCOME_ICON[outcome];
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 text-sm font-medium',
        outcome === 'unanswered' ? 'text-fg-subtle' : OUTCOME_TEXT[outcome],
      )}
    >
      <Icon className="size-4 shrink-0" aria-hidden />
      <span className={withLabel ? 'sr-only sm:not-sr-only' : 'sr-only'}>{ROW_LABEL[outcome]}</span>
    </span>
  );
}

function AnswerBlock({
  label,
  text,
  as = 'text',
  tone,
}: {
  label: string;
  text: string | null;
  /**
   * text: as written with any `$…$` typeset (a choice); plain: exactly as typed (the user's own
   * words); mono: program output; markdown: a reference or numeric answer
   */
  as?: 'text' | 'plain' | 'mono' | 'markdown';
  tone?: 'ok' | 'bad';
}) {
  const box = cn(
    'rounded-md border-l-2 bg-surface-2 px-3 py-2 text-sm break-words',
    tone === 'ok' ? 'border-ok' : tone === 'bad' ? 'border-bad' : 'border-border-strong',
  );
  return (
    <div className="min-w-0">
      <p className="mb-1 text-2xs font-medium tracking-wider text-fg-subtle uppercase">{label}</p>
      {text === null ? (
        <p className="text-sm text-fg-subtle italic">No answer</p>
      ) : as === 'markdown' ? (
        <div className={box}>
          <MathMarkdown className="text-sm">{text}</MathMarkdown>
        </div>
      ) : (
        <p className={cn(box, 'whitespace-pre-wrap', as === 'mono' && 'font-mono')}>
          {as === 'text' ? <MathText>{text}</MathText> : text}
        </p>
      )}
    </div>
  );
}

function ReviewItem({
  q,
  i,
  attempt,
  f,
}: {
  q: PublicQuizQuestion;
  i: number;
  attempt: QuizAttempt;
  f: AnswerFeedback | undefined;
}) {
  const outcome = rowOutcome(q, attempt, f);
  const [open, setOpen] = useState(outcome !== 'correct');
  const yours = formatResponse(q, attempt.responses[q.id]);
  const mono = q.type === 'output';
  // What the user typed in an open question stays text; a choice may hold math.
  const yoursAs = mono ? 'mono' : q.type === 'short' ? 'plain' : 'text';
  // The row already shows the prompt as one line; repeat it in full only when it has more to it.
  const showFullPrompt =
    /```|\n\s*\n/.test(q.prompt) || promptSummary(q.prompt, 10_000).length > 140;
  return (
    <li className="border-b border-border last:border-0">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-surface-2 focus-visible:outline-offset-[-2px] max-sm:gap-2.5 max-sm:px-3"
      >
        <span className="mt-0.5 w-6 shrink-0 text-xs text-fg-subtle tabular max-sm:w-5">
          {i + 1}
        </span>
        <span className="min-w-0 flex-1">
          <MathText className="block text-base">{summarySegments(q.prompt)}</MathText>
          <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-fg-muted">
            <span>{TYPE_LABEL[q.type]}</span>
            <span aria-hidden>·</span>
            <span>{q.subtopic || humanize(q.topic)}</span>
          </span>
        </span>
        <OutcomeMark outcome={outcome} withLabel />
        <ChevronDownIcon
          className={cn(
            'mt-0.5 size-4 shrink-0 text-fg-subtle transition-transform',
            open && 'rotate-180',
          )}
          aria-hidden
        />
      </button>
      {open && (
        <div className="space-y-4 px-4 pb-5 sm:pl-13 max-sm:px-3">
          {showFullPrompt && <MathMarkdown className="text-base">{q.prompt}</MathMarkdown>}
          {q.code && <QuestionCode q={q} />}
          <div className="grid gap-3 sm:grid-cols-2">
            <AnswerBlock
              label="Your answer"
              text={yours}
              as={yoursAs}
              tone={outcome === 'correct' ? 'ok' : outcome === 'unanswered' ? undefined : 'bad'}
            />
            {f && (
              <AnswerBlock
                label={q.type === 'short' ? 'Reference answer' : 'Correct answer'}
                text={formatCorrect(q, f)}
                as={
                  mono ? 'mono' : q.type === 'short' || q.type === 'numeric' ? 'markdown' : 'text'
                }
                tone="ok"
              />
            )}
          </div>
          {f?.feedback && (
            <div>
              <p className="mb-1 text-2xs font-medium tracking-wider text-fg-subtle uppercase">
                Feedback
              </p>
              <MathMarkdown className="text-sm">{f.feedback}</MathMarkdown>
            </div>
          )}
          {f?.explanation && (
            <div>
              <p className="mb-1 text-2xs font-medium tracking-wider text-fg-subtle uppercase">
                Why
              </p>
              <MathMarkdown className="text-sm">{f.explanation}</MathMarkdown>
            </div>
          )}
          {f && <p className="text-xs text-fg-subtle">{GRADED_BY_LABEL[f.gradedBy]}</p>}
        </div>
      )}
    </li>
  );
}

export function QuizResults({ attempt }: { attempt: QuizAttempt }) {
  const router = useRouter();
  const qc = useQueryClient();
  const titleOf = useTitles();
  const fbOf = useMemo(
    () => new Map(attempt.feedback.map((f) => [f.questionId, f])),
    [attempt.feedback],
  );
  const rows = attempt.questions.map((q) => ({
    q,
    f: fbOf.get(q.id),
    outcome: rowOutcome(q, attempt, fbOf.get(q.id)),
  }));
  const tally = { correct: 0, partial: 0, incorrect: 0, unanswered: 0, pending: 0 } as Record<
    RowOutcome,
    number
  >;
  for (const r of rows) tally[r.outcome]++;
  const score =
    attempt.score ??
    (rows.length ? rows.reduce((s, r) => s + (r.f?.score ?? 0), 0) / rows.length : 0);
  const missed = rows.filter((r) => r.outcome !== 'correct');
  const duration = attempt.finishedAt
    ? (Date.parse(attempt.finishedAt) - Date.parse(attempt.startedAt)) / 1000
    : null;

  const byTopic = useMemo(() => {
    const m = new Map<string, { total: number; score: number; correct: number }>();
    for (const r of rows) {
      const t = m.get(r.q.topic) ?? { total: 0, score: 0, correct: 0 };
      t.total++;
      t.score += r.f?.score ?? 0;
      if (r.outcome === 'correct') t.correct++;
      m.set(r.q.topic, t);
    }
    return [...m.entries()];
  }, [rows]);

  const retry = useMutation({
    mutationFn: () =>
      api.createAttempt({
        topics: [...new Set(missed.map((r) => r.q.topic))],
        // Missed open questions go back to a discussion; the rest to practice.
        mode: attempt.mode === 'discussion' ? 'discussion' : 'practice',
        count: Math.max(missed.length, 3),
        focusWeak: true,
      }),
    onSuccess: (a) => {
      qc.setQueryData(qk.attempt(a.id), a);
      qc.invalidateQueries({ queryKey: qk.attempts });
      router.push(`/quiz/${a.id}`);
    },
  });

  const segments: { key: RowOutcome; cls: string }[] = [
    { key: 'correct', cls: 'bg-ok' },
    { key: 'partial', cls: 'bg-warn' },
    { key: 'incorrect', cls: 'bg-bad' },
    { key: 'unanswered', cls: 'bg-border-strong' },
  ];

  return (
    <div className={cn('mx-auto max-w-3xl px-4 py-6 sm:px-6 max-sm:pt-3', PHONE_FIT)}>
      <Link
        href="/quiz"
        className="inline-flex items-center gap-1 text-sm text-fg-muted hover:text-fg max-sm:min-h-10"
      >
        <ArrowLeftIcon className="size-3.5" /> Quizzes
      </Link>

      <section
        aria-labelledby="results-heading"
        className="mt-4 rounded-lg border border-border bg-surface p-5 sm:p-6 max-sm:mt-2 max-sm:p-4"
      >
        <div className="flex flex-wrap items-center gap-2 text-xs text-fg-muted">
          <Badge tone={attempt.mode === 'exam' ? 'warn' : 'accent'}>
            {MODE_LABEL[attempt.mode]}
          </Badge>
          <span>{attempt.topics.map(titleOf).join(', ')}</span>
          {duration !== null && (
            <>
              <span aria-hidden>·</span>
              <span>{formatDuration(duration)}</span>
            </>
          )}
        </div>
        <div className="mt-4 flex flex-wrap items-end gap-x-8 gap-y-4">
          <div>
            <h1 id="results-heading" className="sr-only">
              Quiz results
            </h1>
            <p className="text-4xl font-semibold tracking-tight tabular" data-testid="quiz-score">
              {formatPercent(score)}
            </p>
            <p className="mt-1 text-sm text-fg-muted">
              {tally.correct} of {plural(rows.length, 'question')} correct
            </p>
          </div>
          <div className="min-w-56 flex-1 max-sm:min-w-full">
            <div
              className="flex h-2.5 w-full overflow-hidden rounded-full bg-surface-3"
              aria-hidden
            >
              {segments.map((s) =>
                tally[s.key] ? (
                  <div
                    key={s.key}
                    className={s.cls}
                    style={{ width: `${(tally[s.key] / rows.length) * 100}%` }}
                  />
                ) : null,
              )}
            </div>
            <ul className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1">
              {segments.map((s) =>
                tally[s.key] ? (
                  <li key={s.key} className="text-xs text-fg-muted tabular">
                    <OutcomeMark outcome={s.key} />{' '}
                    <span className="font-medium text-fg">{tally[s.key]}</span>{' '}
                    {ROW_LABEL[s.key].toLowerCase()}
                  </li>
                ) : null,
              )}
            </ul>
          </div>
        </div>
        <div className="mt-6 flex flex-wrap gap-2">
          {missed.length > 0 && (
            <Button
              variant="primary"
              className="max-sm:h-10 max-sm:flex-auto"
              onClick={() => retry.mutate()}
              disabled={retry.isPending}
            >
              {retry.isPending ? <Spinner /> : <RotateCcwIcon />}
              {attempt.mode === 'discussion'
                ? 'Discuss missed questions'
                : 'Practice missed questions'}
            </Button>
          )}
          <Button
            asChild
            variant={missed.length > 0 ? 'secondary' : 'primary'}
            className="max-sm:h-10 max-sm:flex-auto"
          >
            <Link href="/quiz">
              <PlusIcon /> New quiz
            </Link>
          </Button>
        </div>
        <InlineError error={retry.error} className="mt-3" />
      </section>

      {byTopic.length > 1 && (
        <Card className="mt-6" aria-labelledby="by-topic-heading">
          <CardHeader>
            <CardTitle id="by-topic-heading">By topic</CardTitle>
          </CardHeader>
          <ul className="divide-y divide-border">
            {byTopic.map(([slug, t]) => (
              <li
                key={slug}
                className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1.5 px-4 py-3 sm:grid-cols-[180px_minmax(0,1fr)_auto]"
              >
                <span className="truncate text-sm font-medium">{titleOf(slug)}</span>
                <div
                  className="col-span-2 row-start-2 h-1.5 overflow-hidden rounded-full bg-surface-3 sm:col-span-1 sm:row-start-auto"
                  aria-hidden
                >
                  <div
                    className="h-full rounded-full bg-accent"
                    style={{ width: `${(t.score / t.total) * 100}%` }}
                  />
                </div>
                <span className="text-right text-sm text-fg-muted tabular">
                  {t.correct}/{t.total} · {formatPercent(t.score / t.total)}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card className="mt-6" aria-labelledby="review-heading">
        <CardHeader className="max-sm:h-auto max-sm:flex-wrap max-sm:gap-y-0.5 max-sm:py-2.5">
          <CardTitle id="review-heading">Review</CardTitle>
          <span className="text-xs text-fg-subtle">Questions you missed are expanded</span>
        </CardHeader>
        <ol>
          {rows.map((r, i) => (
            <ReviewItem key={r.q.id} q={r.q} i={i} attempt={attempt} f={r.f} />
          ))}
        </ol>
      </Card>
    </div>
  );
}
