'use client';
/**
 * A topic's roadmap drawn as a layered graph: nodes are buttons laid over an SVG of the
 * prerequisite edges (decorative; the panel lists the same relationships as text). The layout is
 * computed in roadmap-logic.ts for the width of the container.
 */
import type { QuizRoadmapNodeProgress } from '@ipp/contracts';
import { CircleCheckIcon, CircleDashedIcon } from 'lucide-react';
import { type KeyboardEvent, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { cn } from '@/lib/utils';
import {
  fitLayout,
  type NodeState,
  type NodeStatus,
  nodeLabel,
  readingOrder,
  relations,
  type Step,
  stepFrom,
} from './roadmap-logic';

/** A ring filled to `value` (0..1, the share answered correctly): the in-progress icon. */
function ProgressRing({ value, className }: { value: number; className?: string }) {
  const r = 5;
  const c = 2 * Math.PI * r;
  return (
    <svg viewBox="0 0 14 14" className={className} aria-hidden>
      <circle cx="7" cy="7" r={r} fill="none" strokeWidth="2" className="stroke-surface-3" />
      <circle
        cx="7"
        cy="7"
        r={r}
        fill="none"
        strokeWidth="2"
        strokeLinecap="round"
        strokeDasharray={`${Math.max(0.6, value * c)} ${c}`}
        transform="rotate(-90 7 7)"
        className="stroke-accent"
      />
    </svg>
  );
}

export function StateIcon({
  state,
  value,
  className,
}: {
  state: NodeState;
  value: number;
  className?: string;
}) {
  if (state === 'complete')
    return <CircleCheckIcon aria-hidden className={cn('text-ok-text', className)} />;
  if (state === 'in_progress') return <ProgressRing value={value} className={className} />;
  return <CircleDashedIcon aria-hidden className={cn('text-fg-subtle', className)} />;
}

/** Answered (soft) and correct (solid) as one thin bar. */
export function NodeBar({
  questionCount,
  answered,
  correct,
  complete,
  className,
}: {
  questionCount: number;
  answered: number;
  correct: number;
  complete: boolean;
  className?: string;
}) {
  const pct = (n: number) => `${questionCount ? Math.min(100, (n / questionCount) * 100) : 0}%`;
  return (
    <span
      aria-hidden
      className={cn('relative block h-1 overflow-hidden rounded-full bg-surface-3', className)}
    >
      <span
        className={cn(
          'absolute inset-y-0 left-0 rounded-full',
          complete ? 'bg-ok/35' : 'bg-accent/30',
        )}
        style={{ width: pct(answered) }}
      />
      <span
        className={cn('absolute inset-y-0 left-0 rounded-full', complete ? 'bg-ok' : 'bg-accent')}
        style={{ width: pct(correct) }}
      />
    </span>
  );
}

/** The scroller's horizontal padding (px-1.5). */
const GUTTER = 6;

const KEY_STEP: Record<string, Step> = {
  ArrowLeft: 'left',
  ArrowRight: 'right',
  ArrowUp: 'up',
  ArrowDown: 'down',
};

export function RoadmapGraph({
  title,
  nodes,
  statuses,
  selected,
  onSelect,
}: {
  /** the topic's title, for the graph's accessible name */
  title: string;
  nodes: QuizRoadmapNodeProgress[];
  statuses: Map<string, NodeStatus>;
  selected: string | null;
  onSelect: (id: string) => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    // Inside the scroller's padding, which leaves room for the selection ring and the badges.
    const measure = () => setWidth(Math.max(0, el.clientWidth - 2 * GUTTER));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const fitted = useMemo(() => (width > 0 ? fitLayout(nodes, width) : null), [nodes, width]);
  const { requires, leadsTo } = useMemo(() => relations(nodes), [nodes]);
  const [hovered, setHovered] = useState<string | null>(null);
  const focus = hovered ?? selected;
  const related = useMemo(
    () =>
      focus
        ? new Set([focus, ...(requires.get(focus) ?? []), ...(leadsTo.get(focus) ?? [])])
        : null,
    [focus, requires, leadsTo],
  );
  const byId = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);
  const buttons = useRef(new Map<string, HTMLButtonElement>());

  const onKeyDown = (e: KeyboardEvent, id: string) => {
    const step = KEY_STEP[e.key];
    if (!step || !fitted) return;
    const to = stepFrom(fitted.layout, id, step);
    e.preventDefault();
    if (to) buttons.current.get(to)?.focus();
  };

  const layout = fitted?.layout;
  const compact = fitted?.compact ?? false;
  const o = fitted?.options;
  const placed = new Map(layout?.nodes.map((n) => [n.id, n]));
  const order = layout ? readingOrder(layout) : [];
  // Edges touching the focused node are drawn last, on top.
  const edges = [...(layout?.edges ?? [])].sort(
    (a, b) =>
      Number(focus !== null && (a.from === focus || a.to === focus)) -
      Number(focus !== null && (b.from === focus || b.to === focus)),
  );

  return (
    <div
      ref={box}
      className={cn(
        // The graph's own scroll, never the page's, if even the narrowest nodes do not fit.
        'overflow-x-auto overscroll-x-contain px-1.5 pt-3 pb-1.5',
        fitted && !fitted.fits && 'pb-2',
      )}
      data-testid="roadmap-graph"
      data-fits={fitted ? String(fitted.fits) : undefined}
    >
      {layout && o && (
        // biome-ignore lint/a11y/useSemanticElements: a group of buttons laid out as a graph, not a form fieldset
        <div
          role="group"
          aria-label={`${title} study areas`}
          aria-describedby="roadmap-keys"
          className="relative mx-auto"
          style={{ width: layout.width, height: layout.height }}
          onPointerLeave={() => setHovered(null)}
        >
          <p id="roadmap-keys" className="sr-only">
            Arrow keys move between areas: up to what an area builds on, down to what builds on it.
          </p>
          <svg
            // A new layout redraws from scratch: Chromium can leave a stale mark where a wider one
            // was painted outside this box.
            key={`${o.nodeWidth}:${o.maxLayerWidth}:${o.gravity}:${layout.width}:${layout.height}`}
            aria-hidden
            className="pointer-events-none absolute inset-0 overflow-visible"
            width={layout.width}
            height={layout.height}
          >
            {edges.map((e) => {
              const on = focus !== null && (e.from === focus || e.to === focus);
              const dim = focus !== null && !on;
              const done = statuses.get(e.from)?.state === 'complete';
              const tone = on
                ? 'stroke-accent fill-accent'
                : done
                  ? 'stroke-ok/60 fill-ok/60'
                  : 'stroke-border-strong fill-border-strong';
              return (
                <g
                  key={`${e.from}>${e.to}`}
                  data-edge={`${e.from}>${e.to}`}
                  className={cn('transition-opacity duration-150', tone, dim && 'opacity-35')}
                >
                  <path d={e.d} fill="none" strokeWidth={on ? 2 : 1.5} strokeLinecap="round" />
                  <path
                    d={`M${e.end.x - 3.5} ${e.end.y - 6} L${e.end.x + 3.5} ${e.end.y - 6} L${e.end.x} ${e.end.y - 0.5} Z`}
                    stroke="none"
                  />
                </g>
              );
            })}
          </svg>
          {order.map((id) => {
            const n = byId.get(id);
            const p = placed.get(id);
            const s = statuses.get(id) ?? { state: 'not_started' as const, next: false };
            if (!n || !p) return null;
            const isSelected = id === selected;
            const dim = related !== null && !related.has(id);
            const complete = s.state === 'complete';
            return (
              <button
                key={id}
                ref={(el) => {
                  if (el) buttons.current.set(id, el);
                  else buttons.current.delete(id);
                }}
                type="button"
                data-testid="roadmap-node"
                data-node={id}
                data-state={s.state}
                data-next={s.next || undefined}
                aria-pressed={isSelected}
                aria-label={nodeLabel(n, s)}
                title={n.title}
                onClick={() => onSelect(id)}
                onKeyDown={(e) => onKeyDown(e, id)}
                onPointerEnter={(e) => {
                  if (e.pointerType === 'mouse') setHovered(id);
                }}
                className={cn(
                  'absolute flex flex-col justify-between rounded-lg border text-left shadow-[0_1px_0_oklch(0_0_0/0.03)] transition-[opacity,border-color,box-shadow,background-color] duration-150',
                  compact ? 'px-2 pt-1.5 pb-2' : 'px-3 pt-2 pb-2.5',
                  complete
                    ? 'border-ok/45 bg-[color-mix(in_oklch,var(--ok-soft)_60%,var(--surface))]'
                    : s.next
                      ? 'border-accent/70 bg-surface'
                      : 'border-border-strong bg-surface',
                  'hover:border-fg-subtle hover:shadow-pop',
                  isSelected && 'ring-2 ring-accent ring-offset-2 ring-offset-surface',
                  dim && 'opacity-50',
                )}
                style={{ left: p.x, top: p.y, width: o.nodeWidth, height: o.nodeHeight }}
              >
                {s.next && (
                  <span
                    aria-hidden
                    className="absolute -top-2 left-2 inline-flex h-4 items-center rounded-full bg-accent px-1.5 text-2xs leading-none font-medium text-accent-fg"
                  >
                    Next up
                  </span>
                )}
                <span
                  className={cn(
                    'font-medium break-words text-fg',
                    compact
                      ? 'line-clamp-3 text-xs leading-[0.95rem]'
                      : 'line-clamp-2 text-sm leading-[1.1rem]',
                    s.next && 'mt-0.5',
                  )}
                >
                  {n.title}
                </span>
                <span className="flex items-center gap-1.5">
                  <StateIcon
                    state={s.state}
                    value={n.questionCount ? n.correct / n.questionCount : 0}
                    className="size-3.5 shrink-0"
                  />
                  <NodeBar
                    className="min-w-0 flex-1"
                    questionCount={n.questionCount}
                    answered={n.answered}
                    correct={n.correct}
                    complete={complete}
                  />
                  <span
                    aria-hidden
                    className="shrink-0 text-2xs leading-none text-fg-muted tabular"
                  >
                    {n.answered}/{n.questionCount}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
