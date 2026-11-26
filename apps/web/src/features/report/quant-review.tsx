'use client';
/**
 * A quant round's questions in its report, one by one: the prompt, how it ended, the
 * interviewer's verdict, and the solution with its key points and explanation. Loaded with
 * `next/dynamic` from the report page, so KaTeX loads only with a quant pad's report. Hints are
 * counts only; the hints actually given are in the transcript, in the interviewer's words.
 */
import type { QuantQuestionReview, QuantReport, QuizTopicStats } from '@ipp/contracts';
import { useQuery } from '@tanstack/react-query';
import { ChevronRightIcon, ClockIcon, LightbulbIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { DifficultyBadge, toneText } from '@/components/domain';
import { MathMarkdown } from '@/components/math-markdown';
import { Badge } from '@/components/ui/badge';
import { Card, CardHeader, CardTitle } from '@/components/ui/card';
import { api } from '@/lib/api';
import { humanize, plural } from '@/lib/format';
import { qk } from '@/lib/queries';
import { cn } from '@/lib/utils';
import { hintsLabel, STATUS_LABEL, STATUS_TONE, scoreView, timeLabel } from './quant-logic';

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div>
      <h4 className="mb-1 text-2xs font-medium tracking-wider text-fg-subtle uppercase">{title}</h4>
      {children}
    </div>
  );
}

function Solution({ q }: { q: QuantQuestionReview }) {
  return (
    <div className="space-y-4 rounded-md border border-border bg-surface-2/60 px-4 py-3.5">
      <Section title="Solution">
        <div data-testid="review-solution">
          <MathMarkdown className="text-sm leading-relaxed">
            {q.unit && q.type === 'numeric' ? `${q.solution} (${q.unit})` : q.solution}
          </MathMarkdown>
        </div>
      </Section>
      {q.keyPoints.length > 0 && (
        <Section title="Key points">
          <ul className="list-disc space-y-1 pl-5 text-sm leading-relaxed marker:text-fg-subtle">
            {q.keyPoints.map((k) => (
              <li key={k}>
                <MathMarkdown className="[&>p]:inline">{k}</MathMarkdown>
              </li>
            ))}
          </ul>
        </Section>
      )}
      {q.explanation && (
        <Section title="Explanation">
          <MathMarkdown className="text-sm leading-relaxed text-fg-muted">
            {q.explanation}
          </MathMarkdown>
        </Section>
      )}
    </div>
  );
}

function QuestionReview({ q, topic }: { q: QuantQuestionReview; topic: string }) {
  const time = timeLabel(q);
  const score = q.verdict && scoreView(q.verdict.score);
  const reached = q.status !== 'not_reached';
  const head = (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
      <h3 className="font-medium">Question {q.index + 1}</h3>
      <span className="text-sm text-fg-muted">· {topic}</span>
      <DifficultyBadge difficulty={q.difficulty} />
      <Badge tone={STATUS_TONE[q.status]} data-testid="review-status">
        {STATUS_LABEL[q.status]}
      </Badge>
      {score && (
        <span
          className={cn('ml-auto text-sm font-semibold tabular', toneText[score.tone])}
          data-testid="review-score"
        >
          {score.label}
        </span>
      )}
    </div>
  );
  if (!reached)
    return (
      <li data-testid="question-review" data-status={q.status}>
        <details className="group px-4 py-3.5 sm:px-5">
          <summary className="flex cursor-pointer list-none items-start gap-2 [&::-webkit-details-marker]:hidden">
            <ChevronRightIcon
              className="mt-1 size-4 shrink-0 text-fg-subtle transition-transform group-open:rotate-90"
              aria-hidden
            />
            <div className="min-w-0 flex-1">
              {head}
              <p className="mt-0.5 text-sm text-fg-muted">
                The round ended before this one. Open it to see the question and its solution.
              </p>
            </div>
          </summary>
          <div className="mt-3 space-y-3 pl-6">
            <MathMarkdown className="text-[14px] leading-relaxed">{q.prompt}</MathMarkdown>
            <Solution q={q} />
          </div>
        </details>
      </li>
    );
  return (
    <li
      className="space-y-3 px-4 py-4 sm:px-5"
      data-testid="question-review"
      data-status={q.status}
    >
      {head}
      <div data-testid="review-prompt">
        <MathMarkdown className="text-[14px] leading-relaxed">{q.prompt}</MathMarkdown>
      </div>
      <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-fg-muted">
        {time && (
          <span className="inline-flex items-center gap-1.5 tabular" data-testid="review-time">
            <ClockIcon className="size-3.5 text-fg-subtle" aria-hidden />
            {time.label}
            {time.over && <span className="text-fg-subtle">(over time)</span>}
          </span>
        )}
        <span className="inline-flex items-center gap-1.5" data-testid="review-hints">
          <LightbulbIcon className="size-3.5 text-fg-subtle" aria-hidden />
          {hintsLabel(q)}
        </span>
      </p>
      {q.verdict ? (
        <div className="rounded-md border border-border px-4 py-3" data-testid="review-verdict">
          <Section title="Interviewer’s verdict">
            <MathMarkdown className="text-sm leading-relaxed">{q.verdict.summary}</MathMarkdown>
          </Section>
        </div>
      ) : (
        <p className="text-sm text-fg-muted">No verdict was written for this answer.</p>
      )}
      <Solution q={q} />
    </li>
  );
}

export function QuantReview({ quant }: { quant: QuantReport }) {
  const topics = useQuery({
    queryKey: qk.quizTopics,
    queryFn: api.quizTopics,
    staleTime: Number.POSITIVE_INFINITY,
  });
  const title = (slug: string) =>
    topics.data?.find((t: QuizTopicStats) => t.slug === slug)?.title ?? humanize(slug);
  return (
    <Card aria-labelledby="quant-review-heading" data-testid="quant-review">
      <CardHeader>
        <CardTitle id="quant-review-heading">Questions</CardTitle>
        <span className="text-xs text-fg-subtle tabular">
          {plural(quant.questions.length, 'question')}
        </span>
      </CardHeader>
      <ol className="divide-y divide-border">
        {quant.questions.map((q) => (
          <QuestionReview key={q.index} q={q} topic={title(q.topic)} />
        ))}
      </ol>
    </Card>
  );
}
