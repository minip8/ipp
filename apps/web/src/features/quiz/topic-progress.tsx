/** A topic's progress as Practice and the study path show it: a line of text and a bar. */
import type { QuizTopicStats } from '@ipp/contracts';
import { formatPercent, plural } from '@/lib/format';
import { cn } from '@/lib/utils';

export function ProgressBar({ value, className }: { value: number; className?: string }) {
  return (
    <span
      className={cn('block h-1.5 w-full overflow-hidden rounded-full bg-surface-3', className)}
      aria-hidden
    >
      <span
        className="block h-full rounded-full bg-accent"
        style={{ width: `${Math.round(Math.min(1, value) * 100)}%` }}
      />
    </span>
  );
}

/** "12 of 84 questions answered" (with the accuracy once there is any, when asked) over a bar. */
export function TopicProgress({
  t,
  accuracy = false,
  className,
}: {
  t: Pick<QuizTopicStats, 'questionCount' | 'answered' | 'accuracy'>;
  /** Also say how many were right, once something is answered. */
  accuracy?: boolean;
  className?: string;
}) {
  const coverage = t.questionCount ? t.answered / t.questionCount : 0;
  return (
    <span className={cn('block', className)}>
      <span className="block text-xs text-fg-muted tabular">
        {t.answered} of {plural(t.questionCount, 'question')} answered
        {accuracy && t.answered > 0 && t.accuracy !== null && (
          <> · {formatPercent(t.accuracy)} accuracy</>
        )}
      </span>
      <span className="mt-2 block">
        <ProgressBar value={coverage} />
      </span>
    </span>
  );
}
