'use client';
/**
 * The Roadmap tab's topic maps: one graph of study areas per topic of the track, with what to
 * learn before what, the user's progress on each, and a way to practise any area. Nothing is
 * locked; the arrows are advice.
 *
 * URL: /{track}/roadmap?view=maps&roadmap=<topic>&node=<id> (both kept with replaceState, so a
 * reload or a link lands on the same graph and area). A topic of the other track only (a link,
 * or a related area in it) sends the user to that track's maps, query and all.
 */
import type { QuizRoadmapNodeProgress, QuizRoadmapTopic, Track } from '@ipp/contracts';
import { useQuery } from '@tanstack/react-query';
import {
  ArrowRightIcon,
  ChevronRightIcon,
  LibraryIcon,
  MapIcon,
  MessagesSquareIcon,
  PlayIcon,
} from 'lucide-react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { ToggleGroup } from 'radix-ui';
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { EmptyState, ErrorState, InlineError, useRetryCountdown } from '@/components/states';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { Spinner } from '@/components/ui/spinner';
import { api } from '@/lib/api';
import { formatPercent, plural } from '@/lib/format';
import { qk } from '@/lib/queries';
import { storage } from '@/lib/storage';
import { misplacedTopic, tabHref, topicsOf } from '@/lib/track';
import { cn } from '@/lib/utils';
import { bankHref, DEFAULT_FILTERS } from './bank-logic';
import { DISCUSSION_ROUND, PRACTICE_ROUND } from './logic';
import { NodeBar, RoadmapGraph, StateIcon } from './roadmap-graph';
import {
  browseSubtopic,
  COMPLETE_ACCURACY,
  LEGACY_ROADMAP_STORAGE_KEY,
  type NodeStatus,
  pickTopic,
  ROADMAP_NODE_PARAM,
  ROADMAP_TOPIC_PARAM,
  relatedAreas,
  relations,
  roadmapStatuses,
  roadmapStorageKey,
  STATE_LABEL,
  summarise,
} from './roadmap-logic';
import { DiscussionKeyPrompt, useDiscussionKey, useStartAttempt } from './start';

/** A faint dot grid behind the graph. */
const CANVAS = {
  backgroundImage: 'radial-gradient(var(--border) 1px, transparent 1.2px)',
  backgroundSize: '16px 16px',
  backgroundPosition: 'center',
} as const;

const WIDE = '(min-width: 1024px)';
function subscribeWide(cb: () => void) {
  const m = window.matchMedia(WIDE);
  m.addEventListener('change', cb);
  return () => m.removeEventListener('change', cb);
}
/** The two-column layout, where the details sit beside the graph instead of in a sheet. */
function useWide() {
  return useSyncExternalStore(
    subscribeWide,
    () => window.matchMedia(WIDE).matches,
    () => true,
  );
}

/** The topic and selected node, in the URL alongside `?view=maps`. */
function useRoadmapParams() {
  const params = useSearchParams();
  const set = useCallback((patch: Record<string, string | null>) => {
    const q = new URLSearchParams(window.location.search);
    for (const [k, v] of Object.entries(patch)) {
      if (v === null) q.delete(k);
      else q.set(k, v);
    }
    const search = q.toString();
    window.history.replaceState(
      null,
      '',
      `${window.location.pathname}${search ? `?${search}` : ''}${window.location.hash}`,
    );
  }, []);
  return {
    topic: params.get(ROADMAP_TOPIC_PARAM),
    node: params.get(ROADMAP_NODE_PARAM),
    set,
  };
}

// ---------------------------------------------------------------- topic switcher

function TopicSwitcher({
  topics,
  value,
  onChange,
}: {
  topics: QuizRoadmapTopic[];
  value: string;
  onChange: (slug: string) => void;
}) {
  // Phones: a row scrolls, so bring the chosen topic into it (the row only, never the page).
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const on = root.current?.querySelector<HTMLElement>(`[data-topic="${CSS.escape(value)}"]`);
    const el = on?.closest<HTMLElement>('[data-topic-row]');
    if (!el || !on || el.scrollWidth <= el.clientWidth) return;
    const left = on.offsetLeft - el.offsetLeft;
    const right = left + on.offsetWidth;
    // 16px: the row's own padding, so the chip does not touch the screen edge.
    if (left < el.scrollLeft) el.scrollLeft = Math.max(0, left - 16);
    else if (right > el.scrollLeft + el.clientWidth) el.scrollLeft = right + 16 - el.clientWidth;
  }, [value]);
  // Phones: one row that scrolls on its own; wider: a grid.
  return (
    <ToggleGroup.Root
      ref={root}
      type="single"
      value={value}
      onValueChange={(v) => v && onChange(v)}
      aria-label="Roadmap topic"
      data-topic-row=""
      className="-mx-4 -my-1 flex gap-2 overflow-x-auto overscroll-x-contain px-4 py-1 sm:m-0 sm:flex-wrap sm:overflow-visible sm:p-0"
    >
      {topics.map((t) => (
        <TopicChip key={t.slug} t={t} />
      ))}
    </ToggleGroup.Root>
  );
}

function TopicChip({ t }: { t: QuizRoadmapTopic }) {
  const sum = summarise(t.nodes);
  const answered = t.questionCount ? t.answered / t.questionCount : 0;
  return (
    <ToggleGroup.Item
      value={t.slug}
      data-topic={t.slug}
      aria-label={`${t.title}: ${sum.complete} of ${plural(sum.total, 'area')} complete, ${formatPercent(answered)} answered`}
      className={cn(
        'group flex min-w-36 shrink-0 flex-col gap-2 rounded-lg border bg-surface px-3 py-2.5 text-left transition-[border-color,box-shadow,background-color] focus-visible:outline-offset-[-2px] sm:max-w-64 sm:min-w-40 sm:flex-[1_1_auto]',
        'data-[state=off]:border-border data-[state=off]:hover:border-border-strong data-[state=off]:hover:shadow-pop',
        'data-[state=on]:border-accent data-[state=on]:bg-accent-soft/30 data-[state=on]:ring-1 data-[state=on]:ring-accent',
      )}
    >
      <span className="flex items-baseline justify-between gap-2">
        <span className="truncate text-sm font-medium whitespace-nowrap text-fg">{t.title}</span>
        <span className="shrink-0 text-2xs text-fg-muted tabular">
          {sum.complete}/{sum.total}
        </span>
      </span>
      <NodeBar
        questionCount={t.questionCount}
        answered={t.answered}
        correct={t.correct}
        complete={sum.total > 0 && sum.complete === sum.total}
      />
    </ToggleGroup.Item>
  );
}

// ---------------------------------------------------------------- legend and skeleton

function Legend() {
  const item = 'inline-flex items-center gap-1.5';
  return (
    <ul
      aria-label="Legend"
      className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-fg-muted"
    >
      <li className={item}>
        <StateIcon state="not_started" value={0} className="size-3.5" />
        {STATE_LABEL.not_started}
      </li>
      <li className={item}>
        <StateIcon state="in_progress" value={0.4} className="size-3.5" />
        {STATE_LABEL.in_progress}
      </li>
      <li className={item}>
        <StateIcon state="complete" value={1} className="size-3.5" />
        {STATE_LABEL.complete}
      </li>
      <li className={item}>
        <span className="inline-flex h-4 items-center rounded-full bg-accent px-1.5 text-2xs leading-none font-medium text-accent-fg">
          Next up
        </span>
        <span>Ready to learn</span>
      </li>
    </ul>
  );
}

export function RoadmapSkeleton() {
  return (
    <div role="status" aria-busy="true" aria-label="Loading roadmap" className="space-y-5">
      <div className="flex gap-2 overflow-hidden sm:grid sm:grid-cols-3 xl:grid-cols-6">
        {Array.from({ length: 6 }, (_, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: placeholders
          <div key={i} className="min-w-36 rounded-lg border border-border bg-surface px-3 py-3">
            <Skeleton className="h-3.5 w-2/3" />
            <Skeleton className="mt-3 h-1 w-full" />
          </div>
        ))}
      </div>
      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0 rounded-lg border border-border bg-surface px-4 py-6 sm:px-6">
          {[2, 3, 3, 2].map((n, row) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: placeholders
            <div key={row} className="mb-10 flex justify-center gap-2 last:mb-0 sm:gap-5">
              {Array.from({ length: n }, (_, i) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: placeholders
                <Skeleton key={i} className="h-16 w-[30%] max-w-40 rounded-lg" />
              ))}
            </div>
          ))}
        </div>
        <Skeleton className="hidden h-80 w-full rounded-lg lg:block" />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- details

const NOT_STARTED: NodeStatus = { state: 'not_started', next: false };

function NodeLink({
  node,
  status,
  caption,
  onSelect,
}: {
  node: QuizRoadmapNodeProgress;
  status: NodeStatus;
  /** a second line under the title (the topic, for an area of another topic) */
  caption?: string;
  onSelect: (id: string) => void;
}) {
  return (
    <li>
      <button
        type="button"
        onClick={() => onSelect(node.id)}
        className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors hover:bg-surface-2 focus-visible:outline-offset-[-2px] max-sm:py-2"
      >
        <StateIcon
          state={status.state}
          value={node.questionCount ? node.correct / node.questionCount : 0}
          className="size-3.5 shrink-0"
        />
        <span className="min-w-0 flex-1">
          <span className="block truncate">{node.title}</span>
          {caption && (
            <span className="block truncate text-2xs text-fg-subtle">
              <span className="sr-only">, in </span>
              {caption}
            </span>
          )}
        </span>
        <span className="sr-only">
          , {STATE_LABEL[status.state]}
          {status.next ? ', next up' : ''}
        </span>
        <span aria-hidden className="shrink-0 text-2xs text-fg-subtle tabular">
          {node.answered}/{node.questionCount}
        </span>
        <ChevronRightIcon aria-hidden className="size-3.5 shrink-0 text-fg-subtle" />
      </button>
    </li>
  );
}

function completionHint(n: QuizRoadmapNodeProgress, s: NodeStatus): string {
  if (s.state === 'complete') return 'Complete. Practise again whenever you like.';
  if (n.questionCount > 0 && n.answered >= n.questionCount)
    return `Every question answered. Get to ${formatPercent(COMPLETE_ACCURACY)} accuracy to complete it; a practice round starts with the ones you missed.`;
  return `Answer all ${n.questionCount} with ${formatPercent(COMPLETE_ACCURACY)} accuracy to complete it.`;
}

function NodeDetails({
  topics,
  topic,
  node,
  statuses,
  onSelect,
  onSelectIn,
  headingAs = 'h2',
}: {
  /** every topic, of both tracks: related areas are in the other ones */
  topics: QuizRoadmapTopic[];
  topic: QuizRoadmapTopic;
  node: QuizRoadmapNodeProgress;
  statuses: Map<string, NodeStatus>;
  onSelect: (id: string) => void;
  /** select an area of another topic, switching to that topic's roadmap */
  onSelectIn: (topic: string, id: string) => void;
  /** in the phone sheet the title is the dialog's own */
  headingAs?: 'h2' | 'dialog';
}) {
  const { missing } = useDiscussionKey();
  const [askKey, setAskKey] = useState(false);
  const status = statuses.get(node.id) ?? { state: 'not_started', next: false };
  const { requires, leadsTo } = useMemo(() => relations(topic.nodes), [topic.nodes]);
  const byId = new Map(topic.nodes.map((n) => [n.id, n]));
  const auto = node.questionCount - node.shortCount;

  const start = useStartAttempt();
  const begin = (mode: 'practice' | 'discussion') =>
    start.mutate({
      topics: [topic.slug],
      nodes: [node.id],
      mode,
      count: mode === 'discussion' ? DISCUSSION_ROUND : PRACTICE_ROUND,
      focusWeak: true,
    });
  const wait = useRetryCountdown(start.error);
  const busy = start.isPending ? start.variables.mode : null;
  const browse = browseSubtopic(node.subtopics);
  const Title = headingAs === 'dialog' ? DialogTitle : 'h2';
  const Description = headingAs === 'dialog' ? DialogDescription : 'p';

  const list = (ids: string[]) =>
    ids
      .map((id) => byId.get(id))
      .filter((n): n is QuizRoadmapNodeProgress => n !== undefined)
      .map((n) => (
        <NodeLink
          key={n.id}
          node={n}
          status={statuses.get(n.id) ?? { state: 'not_started', next: false }}
          onSelect={onSelect}
        />
      ));
  const before = list(requires.get(node.id) ?? []);
  const after = list(leadsTo.get(node.id) ?? []);
  // Each related area's state comes from its own topic's roadmap.
  const related = useMemo(
    () =>
      relatedAreas(topics, node.id).map((r) => ({
        ...r,
        status: roadmapStatuses(r.topic.nodes).get(r.node.id) ?? NOT_STARTED,
      })),
    [topics, node.id],
  );

  return (
    <div className="space-y-5" data-testid="roadmap-details">
      <div className="space-y-1.5 pr-8 lg:pr-0">
        <p className="flex items-center gap-1.5 text-xs font-medium text-fg-muted">
          <StateIcon
            state={status.state}
            value={node.questionCount ? node.correct / node.questionCount : 0}
            className="size-3.5"
          />
          {STATE_LABEL[status.state]}
          {status.next && (
            <span className="ml-1 inline-flex h-4 items-center rounded-full bg-accent px-1.5 text-2xs leading-none font-medium text-accent-fg">
              Next up
            </span>
          )}
        </p>
        <Title className="text-md font-semibold text-fg">{node.title}</Title>
        <Description className="text-sm text-fg-muted">{node.description}</Description>
      </div>

      <div className="space-y-2">
        <dl className="grid grid-cols-3 gap-3">
          <div>
            <dt className="text-xs text-fg-muted">Answered</dt>
            <dd className="text-base font-semibold tabular" data-testid="roadmap-answered">
              {node.answered}
              <span className="font-normal text-fg-subtle">/{node.questionCount}</span>
            </dd>
          </div>
          <div>
            <dt className="text-xs text-fg-muted">Correct</dt>
            <dd className="text-base font-semibold tabular">{node.correct}</dd>
          </div>
          <div>
            <dt className="text-xs text-fg-muted">Accuracy</dt>
            <dd className="text-base font-semibold tabular">{formatPercent(node.accuracy)}</dd>
          </div>
        </dl>
        <NodeBar
          questionCount={node.questionCount}
          answered={node.answered}
          correct={node.correct}
          complete={status.state === 'complete'}
          className="h-1.5"
        />
        <p className="text-xs text-fg-muted">{completionHint(node, status)}</p>
      </div>

      <div className="space-y-2">
        <Button
          variant="primary"
          size="lg"
          className="w-full"
          disabled={auto === 0 || start.isPending || wait > 0}
          onClick={() => begin('practice')}
        >
          {busy === 'practice' ? <Spinner /> : <PlayIcon />}
          {wait > 0 ? `Try again in ${wait}s` : 'Practise'}
        </Button>
        <p className="text-center text-xs text-fg-muted">
          {auto === 0
            ? 'Only open questions here: discuss them instead.'
            : `${plural(Math.min(PRACTICE_ROUND, auto), 'question')}, the ones you have not got right first.`}
        </p>
        <div className="grid grid-cols-2 gap-2">
          {node.shortCount > 0 ? (
            <Button
              className="w-full max-sm:h-10"
              disabled={start.isPending || wait > 0}
              onClick={() => {
                if (missing) setAskKey(true);
                else begin('discussion');
              }}
            >
              {busy === 'discussion' ? <Spinner /> : <MessagesSquareIcon />}
              Discuss
            </Button>
          ) : (
            <span />
          )}
          {browse && (
            <Button asChild className="w-full max-sm:h-10">
              <Link
                href={bankHref(topic.slug, DEFAULT_FILTERS, null, browse)}
                aria-label={`Browse questions in ${node.title}`}
              >
                <LibraryIcon />
                Browse
              </Link>
            </Button>
          )}
        </div>
        {askKey && missing && (
          <DiscussionKeyPrompt
            state={missing}
            testId="roadmap-key-prompt"
            onSaved={() => setAskKey(false)}
          />
        )}
        <InlineError error={start.error} />
      </div>

      <section aria-labelledby="roadmap-before" className="space-y-1">
        <h3 id="roadmap-before" className="text-xs font-medium text-fg-muted">
          Builds on
        </h3>
        {before.length ? (
          <ul className="-mx-2">{before}</ul>
        ) : (
          <p className="text-sm text-fg-subtle">Nothing: a place to start.</p>
        )}
      </section>
      <section aria-labelledby="roadmap-after" className="space-y-1">
        <h3 id="roadmap-after" className="text-xs font-medium text-fg-muted">
          Leads to
        </h3>
        {after.length ? (
          <ul className="-mx-2">{after}</ul>
        ) : (
          <p className="text-sm text-fg-subtle">Nothing further on this roadmap.</p>
        )}
      </section>
      {related.length > 0 && (
        <section aria-labelledby="roadmap-related" className="space-y-1">
          <h3 id="roadmap-related" className="text-xs font-medium text-fg-muted">
            Related in other topics
          </h3>
          <ul className="-mx-2">
            {related.map((r) => (
              <NodeLink
                key={r.node.id}
                node={r.node}
                status={r.status}
                caption={r.topic.title}
                onSelect={(id) => onSelectIn(r.topic.slug, id)}
              />
            ))}
          </ul>
        </section>
      )}
      <section aria-labelledby="roadmap-covers" className="space-y-1">
        <h3 id="roadmap-covers" className="text-xs font-medium text-fg-muted">
          Covers
        </h3>
        <ul className="-mx-2">
          {node.subtopics.map((s) => (
            <li key={s.subtopic}>
              <Link
                href={bankHref(topic.slug, DEFAULT_FILTERS, null, s.subtopic)}
                className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors hover:bg-surface-2 focus-visible:outline-offset-[-2px] max-sm:py-2"
              >
                <span className="min-w-0 flex-1 truncate">{s.subtopic}</span>
                <span className="sr-only">
                  , {s.answered} of {plural(s.questionCount, 'question')} answered
                </span>
                <span aria-hidden className="shrink-0 text-2xs text-fg-subtle tabular">
                  {s.answered}/{s.questionCount}
                </span>
                <ArrowRightIcon aria-hidden className="size-3.5 shrink-0 text-fg-subtle" />
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

/** The side column with nothing selected: where the topic stands and what to do next. */
function TopicOverview({
  topic,
  statuses,
  order,
  onSelect,
}: {
  topic: QuizRoadmapTopic;
  statuses: Map<string, NodeStatus>;
  order: string[];
  onSelect: (id: string) => void;
}) {
  const sum = summarise(topic.nodes, order);
  const byId = new Map(topic.nodes.map((n) => [n.id, n]));
  return (
    <div className="space-y-5" data-testid="roadmap-overview">
      <div className="space-y-1.5">
        <h2 className="text-md font-semibold text-fg">{topic.title}</h2>
        <p className="text-sm text-fg-muted">{topic.description}</p>
      </div>
      <dl className="grid grid-cols-3 gap-3">
        <div>
          <dt className="text-xs text-fg-muted">Areas done</dt>
          <dd className="text-base font-semibold tabular">
            {sum.complete}
            <span className="font-normal text-fg-subtle">/{sum.total}</span>
          </dd>
        </div>
        <div>
          <dt className="text-xs text-fg-muted">Answered</dt>
          <dd className="text-base font-semibold tabular">
            {topic.answered}
            <span className="font-normal text-fg-subtle">/{topic.questionCount}</span>
          </dd>
        </div>
        <div>
          <dt className="text-xs text-fg-muted">Accuracy</dt>
          <dd className="text-base font-semibold tabular">{formatPercent(topic.accuracy)}</dd>
        </div>
      </dl>
      <section aria-labelledby="roadmap-next" className="space-y-1">
        <h3 id="roadmap-next" className="text-xs font-medium text-fg-muted">
          Next up
        </h3>
        {sum.next.length ? (
          <ul className="-mx-2">
            {sum.next.map((id) => {
              const n = byId.get(id);
              const s = statuses.get(id);
              return n && s ? <NodeLink key={id} node={n} status={s} onSelect={onSelect} /> : null;
            })}
          </ul>
        ) : (
          <p className="text-sm text-fg-subtle">Every area is complete.</p>
        )}
      </section>
      <p className="text-xs text-fg-muted">
        Select an area to see what it covers and practise it. The arrows suggest an order; every
        area is open.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------- the view

export function QuizRoadmap({ track }: { track: Track }) {
  const roadmap = useQuery({ queryKey: qk.quizRoadmap, queryFn: api.quizRoadmap });
  const params = useRoadmapParams();
  const router = useRouter();
  const wide = useWide();
  const [remembered] = useState(
    () =>
      storage.get<string | null>(roadmapStorageKey(track), null) ??
      storage.get<string | null>(LEGACY_ROADMAP_STORAGE_KEY, null),
  );
  /** Every topic (related areas may be in the other track); the chips are this track's. */
  const all = roadmap.data ?? [];
  const topics = useMemo(() => topicsOf(all, track), [all, track]);
  const elsewhere = misplacedTopic(params.topic, all, track);
  useEffect(() => {
    if (elsewhere)
      router.replace(`${tabHref(elsewhere, 'roadmap')}${window.location.search}`, {
        scroll: false,
      });
  }, [elsewhere, router]);
  const slug = pickTopic(
    topics.map((t) => t.slug),
    params.topic,
    remembered,
  );
  const topic = elsewhere ? null : (topics.find((t) => t.slug === slug) ?? null);
  useEffect(() => {
    if (topic) storage.set(roadmapStorageKey(track), topic.slug);
  }, [topic, track]);

  const statuses = useMemo(() => roadmapStatuses(topic?.nodes ?? []), [topic]);
  const selected = topic?.nodes.find((n) => n.id === params.node) ?? null;
  // Reading order for lists (layer by layer); the graph computes the same from its layout.
  const order = useMemo(() => {
    const depth = new Map<string, number>();
    const nodes = topic?.nodes ?? [];
    const of = (id: string, seen = new Set<string>()): number => {
      const known = depth.get(id);
      if (known !== undefined) return known;
      if (seen.has(id)) return 0;
      seen.add(id);
      const n = nodes.find((x) => x.id === id);
      const d = n?.requires.length ? Math.max(...n.requires.map((r) => of(r, seen))) + 1 : 0;
      depth.set(id, d);
      return d;
    };
    return nodes.map((n) => n.id).sort((a, b) => of(a) - of(b));
  }, [topic]);

  const select = (id: string | null) => params.set({ [ROADMAP_NODE_PARAM]: id });
  const chooseTopic = (next: string) =>
    params.set({ [ROADMAP_TOPIC_PARAM]: next, [ROADMAP_NODE_PARAM]: null });

  if (roadmap.isPending || elsewhere) return <RoadmapSkeleton />;
  if (roadmap.isError)
    return (
      <Card>
        <ErrorState error={roadmap.error} onRetry={() => roadmap.refetch()} />
      </Card>
    );
  if (!topic)
    return (
      <Card>
        <EmptyState icon={MapIcon} title="No roadmap yet">
          The question bank has not been loaded on this server.
        </EmptyState>
      </Card>
    );

  const sum = summarise(topic.nodes, order);
  const details = selected ? (
    <NodeDetails
      key={selected.id}
      topics={all}
      topic={topic}
      node={selected}
      statuses={statuses}
      onSelect={select}
      onSelectIn={(t, id) => params.set({ [ROADMAP_TOPIC_PARAM]: t, [ROADMAP_NODE_PARAM]: id })}
      headingAs={wide ? 'h2' : 'dialog'}
    />
  ) : null;

  return (
    <div className="space-y-5">
      {/* Its own box: the switcher's negative margins must not cancel the spacing. */}
      <div>
        <TopicSwitcher topics={topics} value={topic.slug} onChange={chooseTopic} />
      </div>
      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <section
          aria-labelledby="roadmap-heading"
          className="min-w-0 rounded-lg border border-border bg-surface"
        >
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-border px-4 py-3">
            <div className="min-w-0">
              <h2 id="roadmap-heading" className="text-sm font-semibold text-fg">
                {topic.title} roadmap
              </h2>
              <p className="text-xs text-fg-muted tabular" data-testid="roadmap-summary">
                {sum.complete} of {plural(sum.total, 'area')} complete
                {sum.inProgress > 0 && ` · ${sum.inProgress} in progress`}
              </p>
            </div>
            <Legend />
          </div>
          {topic.nodes.length === 0 ? (
            <EmptyState icon={MapIcon} title="No roadmap for this topic yet">
              Its questions are all in the question bank.
            </EmptyState>
          ) : (
            <div className="rounded-b-lg py-5 sm:px-5 sm:py-6" style={CANVAS}>
              <RoadmapGraph
                key={topic.slug}
                title={topic.title}
                nodes={topic.nodes}
                statuses={statuses}
                selected={selected?.id ?? null}
                onSelect={(id) => select(id === selected?.id ? null : id)}
              />
            </div>
          )}
        </section>
        {wide && (
          <aside
            aria-label={selected ? 'Area details' : `${topic.title} overview`}
            className="min-w-0 rounded-lg border border-border bg-surface p-4 lg:sticky lg:top-20"
          >
            {details ?? (
              <TopicOverview topic={topic} statuses={statuses} order={order} onSelect={select} />
            )}
          </aside>
        )}
      </div>
      {!wide && (
        <Dialog open={selected !== null} onOpenChange={(open) => !open && select(null)}>
          <DialogContent
            className={cn(
              'max-w-lg overflow-y-auto p-5',
              // Phones: a sheet from the bottom edge.
              'max-sm:top-auto max-sm:bottom-0 max-sm:max-h-[85dvh] max-sm:w-full max-sm:max-w-none max-sm:translate-y-0 max-sm:rounded-b-none max-sm:border-x-0 max-sm:border-b-0 max-sm:pb-[calc(1.25rem_+_env(safe-area-inset-bottom))]',
            )}
          >
            {details}
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
