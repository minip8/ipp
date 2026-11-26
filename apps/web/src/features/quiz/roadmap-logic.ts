/**
 * Pure helpers for the quiz roadmap: a layered top-to-bottom layout of a topic's study areas
 * (no graph library), node states, and the text the page shows for them.
 *
 * Layout, in the usual Sugiyama steps:
 *   1. layers: the longest path from the roots; a root moves down to just above its first
 *      dependant, and a layer wider than `maxLayerWidth` hands nodes with room below (sinks first)
 *      down to the next layer;
 *   2. edges that span several layers get a dummy point in each layer between, so they are routed
 *      through gaps instead of under nodes;
 *   3. order within layers: barycentre sweeps up and down, keeping the order with fewest crossings;
 *   4. x: each layer placed as close as possible to its neighbours' mean, with nodes kept apart
 *      (a least-squares fit solved exactly by pool-adjacent-violators), alternating down and up.
 */
import type { QuizProgress } from '@ipp/contracts';

// ---------------------------------------------------------------- layout

export interface LayoutNodeInput {
  id: string;
  requires: readonly string[];
}

export interface LayoutOptions {
  nodeWidth: number;
  nodeHeight: number;
  /** horizontal gap between two nodes of a layer */
  columnGap: number;
  /** vertical gap between layers, where the edges curve */
  rowGap: number;
  /** the width an edge passing through a layer takes up */
  laneWidth?: number;
  maxLayerWidth?: number;
  sweeps?: number;
  /**
   * 0..1: how strongly each layer is pulled towards the centre line instead of lining up with its
   * neighbours. 1 packs every layer around the middle (the narrowest drawing).
   */
  gravity?: number;
}

export interface PlacedNode {
  id: string;
  layer: number;
  /** left and top edge */
  x: number;
  y: number;
}

export interface PlacedEdge {
  /** the prerequisite */
  from: string;
  /** the node that builds on it */
  to: string;
  /** SVG path data, from the bottom of `from` to the top of `to` */
  d: string;
  /** where the path starts and ends */
  start: { x: number; y: number };
  end: { x: number; y: number };
}

export interface RoadmapLayout {
  width: number;
  height: number;
  nodes: PlacedNode[];
  edges: PlacedEdge[];
  layers: number;
  /** edge crossings between adjacent layers (for tests and tuning) */
  crossings: number;
}

/** One position in a layer: a node, or a lane for an edge passing through. */
interface Slot {
  key: string;
  node: string | null;
  layer: number;
  width: number;
  up: Slot[];
  down: Slot[];
  x: number;
}

/** Layer per node; see the module comment. `requires` entries that are not nodes are ignored. */
export function assignLayers(nodes: readonly LayoutNodeInput[], maxLayerWidth = 3) {
  const ids = new Set(nodes.map((n) => n.id));
  const parents = new Map(nodes.map((n) => [n.id, n.requires.filter((r) => ids.has(r))]));
  const children = new Map(nodes.map((n) => [n.id, [] as string[]]));
  for (const n of nodes) for (const p of parents.get(n.id) ?? []) children.get(p)?.push(n.id);

  const layer = new Map<string, number>();
  const visiting = new Set<string>();
  const depth = (id: string): number => {
    const known = layer.get(id);
    if (known !== undefined) return known;
    // A cycle (content validation rejects them) is cut rather than recursing forever.
    if (visiting.has(id)) return 0;
    visiting.add(id);
    const ps = parents.get(id) ?? [];
    const d = ps.length ? Math.max(...ps.map(depth)) + 1 : 0;
    visiting.delete(id);
    layer.set(id, d);
    return d;
  };
  for (const n of nodes) depth(n.id);

  // A root sits just above the first node that builds on it, not at the top of a long chain.
  for (const n of nodes) {
    const cs = children.get(n.id) ?? [];
    if ((parents.get(n.id) ?? []).length === 0 && cs.length)
      layer.set(n.id, Math.max(0, Math.min(...cs.map((c) => layer.get(c) ?? 0)) - 1));
  }

  // Too many nodes in a layer: move one with room below (all dependants at least two layers
  // further down, or none) one layer down; sinks first, the last authored first.
  const order = new Map(nodes.map((n, i) => [n.id, i]));
  for (let l = 0; l <= Math.max(0, ...layer.values()); l++) {
    for (;;) {
      const here = nodes.filter((n) => layer.get(n.id) === l);
      if (here.length <= maxLayerWidth) break;
      const movable = here
        .filter((n) => (children.get(n.id) ?? []).every((c) => (layer.get(c) ?? 0) > l + 1))
        .sort(
          (a, b) =>
            (children.get(a.id)?.length ? 1 : 0) - (children.get(b.id)?.length ? 1 : 0) ||
            (order.get(b.id) ?? 0) - (order.get(a.id) ?? 0),
        );
      const pick = movable[0];
      if (!pick) break;
      layer.set(pick.id, l + 1);
    }
  }
  return { layer, parents, children };
}

/** Pool-adjacent-violators: the non-decreasing sequence closest to `target` (weighted). */
function isotonic(target: number[], weight: number[]): number[] {
  const blocks: { sum: number; w: number; n: number }[] = [];
  for (let i = 0; i < target.length; i++) {
    const w = weight[i] ?? 1;
    blocks.push({ sum: (target[i] ?? 0) * w, w, n: 1 });
    for (;;) {
      const b = blocks.at(-1);
      const a = blocks.at(-2);
      if (!a || !b || a.sum / a.w <= b.sum / b.w) break;
      blocks.splice(-2, 2, { sum: a.sum + b.sum, w: a.w + b.w, n: a.n + b.n });
    }
  }
  return blocks.flatMap((b) => Array.from({ length: b.n }, () => b.sum / b.w));
}

const mean = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;

function countCrossings(upper: Slot[], lower: Slot[]): number {
  const pos = new Map(lower.map((s, i) => [s, i]));
  const ends: [number, number][] = [];
  upper.forEach((s, i) => {
    for (const d of s.down) ends.push([i, pos.get(d) ?? 0]);
  });
  let n = 0;
  for (let a = 0; a < ends.length; a++)
    for (let b = a + 1; b < ends.length; b++) {
      const [a1, a2] = ends[a] as [number, number];
      const [b1, b2] = ends[b] as [number, number];
      if ((a1 - b1) * (a2 - b2) < 0) n++;
    }
  return n;
}

export function layoutRoadmap(
  input: readonly LayoutNodeInput[],
  opts: LayoutOptions,
): RoadmapLayout {
  const W = opts.nodeWidth;
  const H = opts.nodeHeight;
  const lane = opts.laneWidth ?? 12;
  const { layer, parents } = assignLayers(input, opts.maxLayerWidth ?? 3);
  if (input.length === 0)
    return { width: 0, height: 0, nodes: [], edges: [], layers: 0, crossings: 0 };

  // Slots: one per node, plus a lane per layer that an edge passes through.
  const depth = Math.max(...layer.values()) + 1;
  const layers: Slot[][] = Array.from({ length: depth }, () => []);
  const slotOf = new Map<string, Slot>();
  for (const n of input) {
    const s: Slot = {
      key: n.id,
      node: n.id,
      layer: layer.get(n.id) ?? 0,
      width: W,
      up: [],
      down: [],
      x: 0,
    };
    slotOf.set(n.id, s);
    layers[s.layer]?.push(s);
  }
  /** Per edge, its slots from the prerequisite down to the dependant. */
  const chains: { from: string; to: string; slots: Slot[] }[] = [];
  for (const n of input) {
    for (const p of parents.get(n.id) ?? []) {
      const top = slotOf.get(p);
      const bottom = slotOf.get(n.id);
      if (!top || !bottom) continue;
      const slots = [top];
      for (let l = top.layer + 1; l < bottom.layer; l++) {
        const d: Slot = {
          key: `${p}>${n.id}@${l}`,
          node: null,
          layer: l,
          width: lane,
          up: [],
          down: [],
          x: 0,
        };
        layers[l]?.push(d);
        slots.push(d);
      }
      slots.push(bottom);
      for (let i = 0; i + 1 < slots.length; i++) {
        (slots[i] as Slot).down.push(slots[i + 1] as Slot);
        (slots[i + 1] as Slot).up.push(slots[i] as Slot);
      }
      chains.push({ from: p, to: n.id, slots });
    }
  }

  // Order: barycentre sweeps. Positions are indices; a slot with no neighbours on the side being
  // looked at keeps its place.
  const total = () =>
    layers.reduce(
      (s, l, i) => s + (i + 1 < layers.length ? countCrossings(l, layers[i + 1] ?? []) : 0),
      0,
    );
  const sortBy = (l: Slot[], side: 'up' | 'down', ref: Slot[]) => {
    const pos = new Map(ref.map((s, i) => [s, i]));
    const keyed = l.map((s, i) => {
      const ns = s[side].map((t) => pos.get(t) ?? 0);
      return { s, k: ns.length ? mean(ns) : i, i };
    });
    keyed.sort((a, b) => a.k - b.k || a.i - b.i);
    l.splice(0, l.length, ...keyed.map((x) => x.s));
  };
  for (let l = 1; l < depth; l++) sortBy(layers[l] as Slot[], 'up', layers[l - 1] as Slot[]);
  let best = layers.map((l) => [...l]);
  let bestCrossings = total();
  for (let sweep = 0; sweep < (opts.sweeps ?? 8) && bestCrossings > 0; sweep++) {
    if (sweep % 2 === 0)
      for (let l = depth - 2; l >= 0; l--)
        sortBy(layers[l] as Slot[], 'down', layers[l + 1] as Slot[]);
    else for (let l = 1; l < depth; l++) sortBy(layers[l] as Slot[], 'up', layers[l - 1] as Slot[]);
    const c = total();
    if (c < bestCrossings) {
      bestCrossings = c;
      best = layers.map((l) => [...l]);
    }
  }
  best.forEach((l, i) => {
    layers[i] = l;
  });

  // x: centres, kept apart by half of each neighbour's width plus a gap.
  const gapBetween = (a: Slot, b: Slot) =>
    a.width / 2 + b.width / 2 + (a.node && b.node ? opts.columnGap : Math.min(12, opts.columnGap));
  const g = Math.min(1, Math.max(0, opts.gravity ?? 0));
  const place = (l: Slot[], wanted: number[]) => {
    const offsets = [0];
    for (let i = 1; i < l.length; i++)
      offsets.push((offsets[i - 1] ?? 0) + gapBetween(l[i - 1] as Slot, l[i] as Slot));
    // Gravity pulls towards the layer packed tight and centred on 0 (always a feasible answer).
    const first = l[0];
    const last = l.at(-1);
    const shift = -((offsets.at(-1) ?? 0) + ((last?.width ?? 0) - (first?.width ?? 0)) / 2) / 2;
    const desired = wanted.map((d, i) => (1 - g) * d + g * ((offsets[i] ?? 0) + shift));
    // Lanes weigh more: a long edge should run straight.
    const fit = isotonic(
      desired.map((d, i) => d - (offsets[i] ?? 0)),
      l.map((s) => (s.node ? 1 : 2)),
    );
    l.forEach((s, i) => {
      s.x = (fit[i] ?? 0) + (offsets[i] ?? 0);
    });
  };
  for (const l of layers) {
    // Start packed and centred on 0.
    place(
      l,
      l.map(() => 0),
    );
  }
  const pass = (side: 'up' | 'down', from: number, to: number, step: number) => {
    for (let i = from; i !== to; i += step) {
      const l = layers[i] as Slot[];
      place(
        l,
        l.map((s) => (s[side].length ? mean(s[side].map((t) => t.x)) : s.x)),
      );
    }
  };
  for (let k = 0; k < 4; k++) {
    pass('up', 1, depth, 1);
    pass('down', depth - 2, -1, -1);
  }
  pass('up', 1, depth, 1);

  const left = Math.min(...layers.flat().map((s) => s.x - s.width / 2));
  const right = Math.max(...layers.flat().map((s) => s.x + s.width / 2));
  for (const s of layers.flat()) s.x -= left;
  const rowY = (l: number) => l * (H + opts.rowGap);

  // Ports: a node's edges leave its bottom (and enter its top) spread out in the order of where
  // they go, so they do not cross at the node.
  const portSpread = (n: number) => Math.min(14, (W - 32) / Math.max(1, n - 1));
  const portsOut = new Map<string, number>();
  const portsIn = new Map<string, number>();
  for (const s of layers.flat()) {
    if (!s.node) continue;
    const outs = chains
      .filter((c) => c.from === s.node)
      .sort((a, b) => (a.slots[1]?.x ?? 0) - (b.slots[1]?.x ?? 0));
    outs.forEach((c, i) => {
      portsOut.set(
        `${c.from}>${c.to}`,
        s.x + (i - (outs.length - 1) / 2) * portSpread(outs.length),
      );
    });
    const ins = chains
      .filter((c) => c.to === s.node)
      .sort((a, b) => (a.slots.at(-2)?.x ?? 0) - (b.slots.at(-2)?.x ?? 0));
    ins.forEach((c, i) => {
      portsIn.set(`${c.from}>${c.to}`, s.x + (i - (ins.length - 1) / 2) * portSpread(ins.length));
    });
  }

  const r = (v: number) => Math.round(v * 10) / 10;
  const edges: PlacedEdge[] = chains.map((c) => {
    const key = `${c.from}>${c.to}`;
    // Points where the path enters and leaves each layer band.
    const pts: { x: number; y: number }[] = [];
    c.slots.forEach((s, i) => {
      const top = rowY(s.layer);
      if (i === 0) pts.push({ x: portsOut.get(key) ?? s.x, y: top + H });
      else if (i === c.slots.length - 1) pts.push({ x: portsIn.get(key) ?? s.x, y: top });
      else pts.push({ x: s.x, y: top }, { x: s.x, y: top + H });
    });
    let d = `M${r(pts[0]?.x ?? 0)} ${r(pts[0]?.y ?? 0)}`;
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1] as { x: number; y: number };
      const b = pts[i] as { x: number; y: number };
      if (i % 2 === 0) {
        // Through a layer band: straight down.
        d += ` L${r(b.x)} ${r(b.y)}`;
      } else {
        const my = (b.y - a.y) / 2;
        d += ` C${r(a.x)} ${r(a.y + my)} ${r(b.x)} ${r(b.y - my)} ${r(b.x)} ${r(b.y)}`;
      }
    }
    const start = pts[0] ?? { x: 0, y: 0 };
    const end = pts.at(-1) ?? { x: 0, y: 0 };
    return { from: c.from, to: c.to, d, start, end };
  });

  const nodes: PlacedNode[] = layers
    .flat()
    .filter((s) => s.node)
    .map((s) => ({ id: s.node as string, layer: s.layer, x: s.x - W / 2, y: rowY(s.layer) }));
  return {
    width: right - left,
    height: rowY(depth - 1) + H,
    nodes,
    edges,
    layers: depth,
    crossings: bestCrossings,
  };
}

/** Below this container width the graph uses compact nodes (phones). */
export const COMPACT_BELOW = 640;

export interface FittedLayout {
  layout: RoadmapLayout;
  options: LayoutOptions;
  compact: boolean;
  /** false: even the narrowest nodes are wider than the container, which then scrolls */
  fits: boolean;
}

/**
 * A layout that fits `width`, trying the most readable first. Wide containers: up to four nodes in
 * a layer (fewer long edges) with the widest nodes that fit, then three, then the narrowest nodes
 * pulled towards the middle. Narrow ones (compact nodes, three in a layer): at each node width
 * from the widest down, edges lined up first and then pulled in, because a title that fits
 * matters more than a straight edge.
 */
export function fitLayout(nodes: readonly LayoutNodeInput[], width: number): FittedLayout {
  const compact = width < COMPACT_BELOW;
  const base = compact
    ? { nodeHeight: 84, columnGap: 8, rowGap: 34, laneWidth: 6 }
    : { nodeHeight: 72, columnGap: 20, rowGap: 44, laneWidth: 12 };
  const range = (from: number, to: number) => {
    const out: number[] = [];
    for (let w = from; w >= to; w -= 4) out.push(w);
    return out;
  };
  const tries: { w: number; gravity: number; maxLayerWidth: number }[] = compact
    ? range(124, 92).flatMap((w) =>
        [0, 0.4, 0.7, 1].map((gravity) => ({ w, gravity, maxLayerWidth: 3 })),
      )
    : [
        ...range(176, 140).map((w) => ({ w, gravity: 0, maxLayerWidth: 4 })),
        ...range(176, 136).map((w) => ({ w, gravity: 0, maxLayerWidth: 3 })),
        ...[0.4, 0.7, 1].map((gravity) => ({ w: 136, gravity, maxLayerWidth: 3 })),
      ];
  let last: FittedLayout | null = null;
  for (const t of tries) {
    const options = { ...base, nodeWidth: t.w, gravity: t.gravity, maxLayerWidth: t.maxLayerWidth };
    const layout = layoutRoadmap(nodes, options);
    last = { layout, options, compact, fits: layout.width <= width };
    if (last.fits) return last;
  }
  return last as FittedLayout;
}

/** Node ids in reading order: layer by layer, left to right (the keyboard order). */
export function readingOrder(layout: Pick<RoadmapLayout, 'nodes'>): string[] {
  return [...layout.nodes].sort((a, b) => a.layer - b.layer || a.x - b.x).map((n) => n.id);
}

export type Step = 'left' | 'right' | 'up' | 'down';

/**
 * The node an arrow key moves to from `id`: the neighbour in the same layer, or the nearest node
 * (by centre) in the closest layer above or below that has one. Null at an edge of the graph.
 */
export function stepFrom(
  layout: Pick<RoadmapLayout, 'nodes'>,
  id: string,
  step: Step,
): string | null {
  const here = layout.nodes.find((n) => n.id === id);
  if (!here) return null;
  if (step === 'left' || step === 'right') {
    const row = layout.nodes
      .filter((n) => n.layer === here.layer)
      .sort((a, b) => a.x - b.x)
      .map((n) => n.id);
    return row[row.indexOf(id) + (step === 'left' ? -1 : 1)] ?? null;
  }
  const layers = [...new Set(layout.nodes.map((n) => n.layer))].sort((a, b) => a - b);
  const target =
    step === 'up'
      ? layers.filter((l) => l < here.layer).at(-1)
      : layers.find((l) => l > here.layer);
  if (target === undefined) return null;
  const candidates = layout.nodes
    .filter((n) => n.layer === target)
    .sort((a, b) => Math.abs(a.x - here.x) - Math.abs(b.x - here.x) || a.x - b.x);
  return candidates[0]?.id ?? null;
}

/** The widest layer of a layout, in nodes. */
export function widestLayer(layout: Pick<RoadmapLayout, 'nodes'>): number {
  const per = new Map<number, number>();
  for (const n of layout.nodes) per.set(n.layer, (per.get(n.layer) ?? 0) + 1);
  return Math.max(0, ...per.values());
}

// ---------------------------------------------------------------- progress and states

/** Accuracy at or above which a fully answered area counts as complete (the API's threshold). */
export const COMPLETE_ACCURACY = 0.7;

export type NodeState = 'not_started' | 'in_progress' | 'complete';

export function nodeState(
  p: Pick<QuizProgress, 'questionCount' | 'answered' | 'accuracy'>,
): NodeState {
  if (
    p.questionCount > 0 &&
    p.answered >= p.questionCount &&
    (p.accuracy ?? 0) >= COMPLETE_ACCURACY
  )
    return 'complete';
  return p.answered > 0 ? 'in_progress' : 'not_started';
}

export interface NodeStatus {
  state: NodeState;
  /** not complete, and everything it builds on is: a good thing to study next */
  next: boolean;
}

type ProgressNode = Pick<QuizProgress, 'questionCount' | 'answered' | 'accuracy'> & {
  id: string;
  requires: readonly string[];
};

export function roadmapStatuses(nodes: readonly ProgressNode[]): Map<string, NodeStatus> {
  const state = new Map(nodes.map((n) => [n.id, nodeState(n)]));
  return new Map(
    nodes.map((n): [string, NodeStatus] => {
      const s = state.get(n.id) ?? 'not_started';
      const ready = n.requires.every((r) => !state.has(r) || state.get(r) === 'complete');
      return [n.id, { state: s, next: s !== 'complete' && ready && n.questionCount > 0 }];
    }),
  );
}

/** What builds on what, both ways. */
export function relations(nodes: readonly { id: string; requires: readonly string[] }[]) {
  const ids = new Set(nodes.map((n) => n.id));
  const requires = new Map(nodes.map((n) => [n.id, n.requires.filter((r) => ids.has(r))]));
  const leadsTo = new Map(nodes.map((n) => [n.id, [] as string[]]));
  for (const n of nodes) for (const r of requires.get(n.id) ?? []) leadsTo.get(r)?.push(n.id);
  return { requires, leadsTo };
}

type RelatedNode = { id: string; related: readonly string[] };

/**
 * The areas of other topics linked with `id` through `related`, whichever side the link is
 * written on, in topic order and then roadmap order. Unknown ids and same-topic links are left out.
 */
export function relatedAreas<T extends { slug: string; nodes: readonly RelatedNode[] }>(
  topics: readonly T[],
  id: string,
): { topic: T; node: T['nodes'][number] }[] {
  const home = topics.find((t) => t.nodes.some((n) => n.id === id));
  const own = new Set(home?.nodes.find((n) => n.id === id)?.related ?? []);
  const out: { topic: T; node: T['nodes'][number] }[] = [];
  for (const topic of topics) {
    if (topic === home) continue;
    for (const node of topic.nodes)
      if (own.has(node.id) || node.related.includes(id)) out.push({ topic, node });
  }
  return out;
}

export interface RoadmapSummary {
  total: number;
  complete: number;
  inProgress: number;
  /** ids of the next-up nodes, in reading order when one is given */
  next: string[];
}

export function summarise(
  nodes: readonly ProgressNode[],
  order: readonly string[] = nodes.map((n) => n.id),
): RoadmapSummary {
  const st = roadmapStatuses(nodes);
  const rank = new Map(order.map((id, i) => [id, i]));
  const values = [...st.values()];
  return {
    total: nodes.length,
    complete: values.filter((s) => s.state === 'complete').length,
    inProgress: values.filter((s) => s.state === 'in_progress').length,
    next: nodes
      .filter((n) => st.get(n.id)?.next)
      .map((n) => n.id)
      .sort((a, b) => (rank.get(a) ?? 0) - (rank.get(b) ?? 0)),
  };
}

export const STATE_LABEL: Record<NodeState, string> = {
  not_started: 'Not started',
  in_progress: 'In progress',
  complete: 'Complete',
};

/** What a node says about itself, for its accessible name. */
export function nodeLabel(
  n: { title: string } & Pick<QuizProgress, 'questionCount' | 'answered' | 'correct'>,
  s: NodeStatus,
): string {
  const parts = [
    n.title,
    STATE_LABEL[s.state],
    `${n.answered} of ${n.questionCount} answered, ${n.correct} correct`,
  ];
  if (s.next) parts.push('next up');
  return `${parts.join('. ')}.`;
}

/** Where the selected node and topic live in the URL (with `?view=roadmap`). */
export const ROADMAP_TOPIC_PARAM = 'roadmap';
export const ROADMAP_NODE_PARAM = 'node';
export const ROADMAP_STORAGE_KEY = 'ipp.quiz.roadmap';

/** The topic to show: the URL's when it is one, else the remembered one, else the first. */
export function pickTopic(
  slugs: readonly string[],
  fromUrl: string | null,
  remembered: string | null,
): string | null {
  if (fromUrl && slugs.includes(fromUrl)) return fromUrl;
  if (remembered && slugs.includes(remembered)) return remembered;
  return slugs[0] ?? null;
}

/**
 * The subtopic to open the question bank on from a node: the first with a question still to get
 * right, else the first.
 */
export function browseSubtopic(
  subtopics: readonly (Pick<QuizProgress, 'questionCount' | 'correct'> & { subtopic: string })[],
): string | null {
  return (
    subtopics.find((s) => s.correct < s.questionCount)?.subtopic ?? subtopics[0]?.subtopic ?? null
  );
}
