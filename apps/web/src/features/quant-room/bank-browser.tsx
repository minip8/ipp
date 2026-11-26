'use client';
/**
 * Browsing and searching the question bank for a quant room, by site track, topic, subtopic,
 * difficulty, type and text. The same browser serves the room's creation (the public bank,
 * prompts only, before the room exists) and the host mid-interview (the host's bank search, with
 * each question's solution and material, and what is queued or already asked). It only shows a
 * page and reports the filters; what a row can do (queue it, ask it now) is the caller's.
 *
 * The track filter (All | Quant | Software) is by site track, so a topic shared into both
 * (Python) is under both; only the public bank offers it (`trackFilter`), since the host's search
 * on the server filters by a topic's home.
 */
import {
  homeTrack,
  QuantQuestionType,
  type QuizDifficulty,
  TRACK_INFO,
  type Track,
  topicInTrack,
} from '@ipp/contracts';
import { ChevronLeftIcon, ChevronRightIcon, SearchIcon, XIcon } from 'lucide-react';
import { type ReactNode, useEffect, useId, useRef, useState } from 'react';
import { MathMarkdown } from '@/components/math-markdown';
import { EmptyState, ErrorState } from '@/components/states';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Segmented } from '@/components/ui/segmented';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import {
  type BankItem,
  type BankQuery,
  type BankTopic,
  type BankView,
  composedPrompt,
  filtersActive,
  NO_BANK_FILTERS,
  pageLabel,
  promptLine,
  STATUS_LABEL,
  TYPE_LABEL,
  topicsForTrack,
  withFilter,
} from './logic';
import { InlineMd, MaterialPreview, QuestionMeta } from './material';

const ANY = 'any';

/** The bank's order of the tracks: a quant room's own questions first. */
const TRACK_ORDER: readonly Track[] = ['quant', 'software'];

function TopicItem({ t }: { t: BankTopic }) {
  return (
    <SelectItem value={t.slug}>
      {t.title} <span className="text-fg-subtle tabular">{t.questionCount}</span>
    </SelectItem>
  );
}

function BankRow({
  item,
  actions,
  noMaterial,
}: {
  item: BankItem;
  actions: ReactNode;
  noMaterial?: ReactNode;
}) {
  const q = item.question;
  const prompt = composedPrompt(q);
  const status = STATUS_LABEL[item.status];
  return (
    <li
      className="px-3 py-2.5 sm:px-4"
      data-testid="bank-row"
      data-question={q.id}
      data-status={item.status}
    >
      <div className="flex items-start gap-3 max-sm:flex-col max-sm:gap-2">
        <details className="group min-w-0 flex-1">
          <summary className="flex cursor-pointer list-none items-start gap-2 select-none [&::-webkit-details-marker]:hidden">
            <ChevronRightIcon
              className="mt-0.5 size-4 shrink-0 text-fg-subtle transition-transform group-open:rotate-90"
              aria-hidden
            />
            <span className="min-w-0 flex-1">
              <QuestionMeta
                topicTitle={q.topicTitle}
                subtopic={q.subtopic}
                difficulty={q.difficulty}
                type={q.type}
              >
                {status && (
                  <Badge
                    tone={item.status === 'posed' ? 'neutral' : 'accent'}
                    data-testid="bank-status"
                  >
                    {status}
                  </Badge>
                )}
              </QuestionMeta>
              <InlineMd className="mt-1 block text-[13.5px] leading-snug text-fg line-clamp-2">
                {promptLine(q.prompt)}
              </InlineMd>
            </span>
          </summary>
          <div className="mt-2.5 ml-6 rounded-md border border-border bg-surface-2/50 px-3 py-3">
            {item.material ? (
              <MaterialPreview m={item.material} prompt={prompt} />
            ) : (
              <>
                <MathMarkdown className="text-[13.5px] leading-relaxed">{prompt}</MathMarkdown>
                {noMaterial}
              </>
            )}
          </div>
        </details>
        <div className="flex shrink-0 items-center gap-1.5 max-sm:ml-6">{actions}</div>
      </div>
    </li>
  );
}

export function BankBrowser({
  query,
  onQuery,
  view,
  loading,
  error,
  onRetry,
  actions,
  noMaterial,
  className,
  autoFocus,
  trackFilter = true,
}: {
  query: BankQuery;
  onQuery: (q: BankQuery) => void;
  view: BankView | undefined;
  loading: boolean;
  error: unknown;
  onRetry: () => void;
  /** What a row can do: queue it, ask it now. */
  actions: (item: BankItem) => ReactNode;
  /** Shown in an opened row whose material is not known (the public bank). */
  noMaterial?: ReactNode;
  className?: string;
  autoFocus?: boolean;
  /** Offer the site-track filter (the public bank, which filters itself). */
  trackFilter?: boolean;
}) {
  const ids = { search: useId() };
  // The text is sent a moment after typing stops, not on every key.
  const [text, setText] = useState(query.q ?? '');
  const latest = useRef(query);
  latest.current = query;
  useEffect(() => {
    if ((latest.current.q ?? '') === text.trim()) return;
    const t = setTimeout(() => onQuery(withFilter(latest.current, { q: text.trim() })), 250);
    return () => clearTimeout(t);
  }, [text, onQuery]);

  const topics = view?.topics ?? [];
  const shownTopics = topicsForTrack(topics, query.track);
  // Quant first, as the bank lists its topics; only tracks that have any.
  const tracks = TRACK_ORDER.filter((t) => topics.some((x) => topicInTrack(x, t)));
  const set = (patch: Partial<Omit<BankQuery, 'offset'>>) => onQuery(withFilter(query, patch));
  const page = (delta: number) =>
    view && onQuery({ ...query, offset: Math.max(0, query.offset + delta * view.limit) });

  return (
    <div className={cn('flex min-h-0 flex-col', className)} data-testid="bank-browser">
      <div className="shrink-0 space-y-2 border-b border-border p-3">
        <div className="relative">
          <SearchIcon
            className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-fg-subtle"
            aria-hidden
          />
          <label htmlFor={ids.search} className="sr-only">
            Search the bank
          </label>
          <Input
            id={ids.search}
            type="search"
            value={text}
            autoFocus={autoFocus}
            onChange={(e) => setText(e.target.value)}
            placeholder="Search questions, subtopics or ids"
            className="h-8 pl-8 max-lg:h-10 max-lg:text-md"
          />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {trackFilter && tracks.length > 1 && (
            <Segmented<Track | typeof ANY>
              aria-label="Track"
              size="sm"
              className="max-sm:[&>*]:h-9"
              value={query.track ?? ANY}
              onValueChange={(v) => set({ track: v === ANY ? undefined : v })}
              options={[
                { value: ANY, label: 'All' },
                ...tracks.map((t) => ({ value: t, label: TRACK_INFO[t].label })),
              ]}
            />
          )}
          <Select
            value={query.topic ?? ANY}
            onValueChange={(v) => set({ topic: v === ANY ? undefined : v })}
          >
            <SelectTrigger
              className="h-7 w-auto min-w-36 max-w-full text-xs max-sm:h-9"
              aria-label="Topic"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ANY}>All topics</SelectItem>
              {query.track
                ? // One track: its topics, one flat list.
                  shownTopics.map((t) => <TopicItem key={t.slug} t={t} />)
                : // Every topic, once each, under the track it belongs to.
                  TRACK_ORDER.map((track) => {
                    const of = shownTopics.filter((t) => homeTrack(t.track) === track);
                    if (of.length === 0) return null;
                    return (
                      <SelectGroup key={track}>
                        <SelectLabel>{TRACK_INFO[track].label}</SelectLabel>
                        {of.map((t) => (
                          <TopicItem key={t.slug} t={t} />
                        ))}
                      </SelectGroup>
                    );
                  })}
            </SelectContent>
          </Select>
          {query.topic && (view?.subtopics.length ?? 0) > 0 && (
            <Select
              value={query.subtopic ?? ANY}
              onValueChange={(v) => set({ subtopic: v === ANY ? undefined : v })}
            >
              <SelectTrigger
                className="h-7 w-auto min-w-36 max-w-full text-xs max-sm:h-9"
                aria-label="Subtopic"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ANY}>All subtopics</SelectItem>
                {view?.subtopics.map((s) => (
                  <SelectItem key={s} value={s}>
                    {s}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <Segmented<QuizDifficulty | typeof ANY>
            aria-label="Difficulty"
            size="sm"
            className="max-sm:[&>*]:h-9"
            value={query.difficulty ?? ANY}
            onValueChange={(v) => set({ difficulty: v === ANY ? undefined : v })}
            options={[
              { value: ANY, label: 'Any' },
              { value: 'easy', label: 'Easy' },
              { value: 'medium', label: 'Medium' },
              { value: 'hard', label: 'Hard' },
            ]}
          />
          <Select
            value={query.type ?? ANY}
            onValueChange={(v) => set({ type: v === ANY ? undefined : (v as QuantQuestionType) })}
          >
            <SelectTrigger className="h-7 w-auto min-w-32 text-xs max-sm:h-9" aria-label="Type">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ANY}>Every type</SelectItem>
              {QuantQuestionType.options.map((t) => (
                <SelectItem key={t} value={t}>
                  {TYPE_LABEL[t]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {filtersActive(query) && (
            <Button
              size="xs"
              variant="ghost"
              className="max-sm:h-9"
              onClick={() => {
                setText('');
                onQuery(NO_BANK_FILTERS);
              }}
            >
              <XIcon /> Clear
            </Button>
          )}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto" aria-busy={loading || undefined}>
        {error ? (
          <ErrorState error={error} onRetry={onRetry} compact />
        ) : !view ? (
          <ul className="divide-y divide-border" aria-label="Loading questions">
            {[0, 1, 2, 3, 4].map((i) => (
              <li key={i} className="space-y-1.5 px-4 py-3">
                <Skeleton className="h-3 w-1/3" />
                <Skeleton className="h-4 w-5/6" />
              </li>
            ))}
          </ul>
        ) : view.items.length === 0 ? (
          <EmptyState icon={SearchIcon} title="No questions match">
            Try another search, topic or type.
          </EmptyState>
        ) : (
          <ul
            className={cn('divide-y divide-border', loading && 'opacity-60')}
            aria-label="Questions"
          >
            {view.items.map((item) => (
              <BankRow
                key={item.question.id}
                item={item}
                actions={actions(item)}
                noMaterial={noMaterial}
              />
            ))}
          </ul>
        )}
      </div>

      {view && view.total > 0 && (
        <div className="flex shrink-0 items-center justify-between gap-2 border-t border-border px-3 py-1.5 text-xs text-fg-muted">
          <span className="tabular" data-testid="bank-page">
            {pageLabel(view)}
          </span>
          <span className="flex items-center gap-1">
            <Button
              size="icon-sm"
              variant="ghost"
              aria-label="Previous page"
              className="max-sm:size-9"
              disabled={view.offset === 0}
              onClick={() => page(-1)}
            >
              <ChevronLeftIcon />
            </Button>
            <Button
              size="icon-sm"
              variant="ghost"
              aria-label="Next page"
              className="max-sm:size-9"
              disabled={view.offset + view.items.length >= view.total}
              onClick={() => page(1)}
            >
              <ChevronRightIcon />
            </Button>
          </span>
        </div>
      )}
    </div>
  );
}
