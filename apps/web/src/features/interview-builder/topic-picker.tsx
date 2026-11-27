'use client';
/**
 * The topics of a questions stage: every quiz topic as a checkbox, the track's own first and the
 * others after a plain divider (a page never heads anything by track: the header's switch does
 * that). At least one stays chosen and at most `STAGE_TOPICS_MAX`.
 */
import { type QuizTopicStats, STAGE_TOPICS_MAX, type Track } from '@ipp/contracts';
import { useQuery } from '@tanstack/react-query';
import { useId } from 'react';
import { ErrorState } from '@/components/states';
import { Checkbox } from '@/components/ui/checkbox';
import { Skeleton } from '@/components/ui/skeleton';
import { api } from '@/lib/api';
import { qk } from '@/lib/queries';
import { topicChoices } from './logic';

function TopicRow({
  topic,
  checked,
  disabled,
  onToggle,
}: {
  topic: QuizTopicStats;
  checked: boolean;
  disabled: boolean;
  onToggle: () => void;
}) {
  const id = useId();
  return (
    <li className="flex items-center gap-2.5 py-1.5 max-sm:py-2">
      <Checkbox id={id} checked={checked} disabled={disabled} onCheckedChange={onToggle} />
      <label htmlFor={id} className="min-w-0 flex-1 truncate text-sm select-none">
        {topic.title}
      </label>
    </li>
  );
}

export function TopicPicker({
  track,
  value,
  onToggle,
  labelledBy,
}: {
  track: Track;
  value: string[];
  onToggle: (slug: string) => void;
  labelledBy: string;
}) {
  const topics = useQuery({ queryKey: qk.quizTopics, queryFn: api.quizTopics });
  if (topics.isPending)
    return (
      <div className="space-y-2" role="status" aria-label="Loading topics">
        <Skeleton className="h-5 w-2/3" />
        <Skeleton className="h-5 w-1/2" />
        <Skeleton className="h-5 w-3/5" />
      </div>
    );
  if (topics.isError)
    return <ErrorState error={topics.error} onRetry={() => topics.refetch()} compact />;
  const { mine, more } = topicChoices(topics.data, track);
  const full = value.length >= STAGE_TOPICS_MAX;
  const row = (t: QuizTopicStats) => {
    const checked = value.includes(t.slug);
    return (
      <TopicRow
        key={t.slug}
        topic={t}
        checked={checked}
        // The last topic stays (a stage needs one); a full stage takes no more.
        disabled={checked ? value.length === 1 : full}
        onToggle={() => onToggle(t.slug)}
      />
    );
  };
  return (
    // biome-ignore lint/a11y/useSemanticElements: a group of checkboxes named by the editor's label
    <div role="group" aria-labelledby={labelledBy} data-testid="topic-picker">
      <ul className="grid gap-x-4 sm:grid-cols-2">{mine.map(row)}</ul>
      {more.length > 0 && (
        <>
          <div className="my-2 flex items-center gap-3" aria-hidden>
            <span className="h-px flex-1 bg-border" />
            <span className="text-2xs font-medium tracking-wider text-fg-subtle uppercase">
              More topics
            </span>
            <span className="h-px flex-1 bg-border" />
          </div>
          <ul className="grid gap-x-4 sm:grid-cols-2" aria-label="More topics">
            {more.map(row)}
          </ul>
        </>
      )}
      <p className="mt-2 text-xs text-fg-muted" aria-live="polite">
        {full
          ? `${value.length} topics chosen, the most one stage takes.`
          : value.length === 1
            ? '1 topic chosen. The questions are spread over the topics you choose.'
            : `${value.length} topics chosen. The questions are spread over them.`}
      </p>
    </div>
  );
}
