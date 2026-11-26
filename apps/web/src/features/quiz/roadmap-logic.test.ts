import { describe, expect, it } from 'vitest';
import {
  assignLayers,
  browseSubtopic,
  COMPACT_BELOW,
  fitLayout,
  type LayoutNodeInput,
  layoutRoadmap,
  nodeLabel,
  nodeState,
  pickTopic,
  readingOrder,
  relations,
  roadmapStatuses,
  stepFrom,
  summarise,
  widestLayer,
} from './roadmap-logic';

const node = (id: string, ...requires: string[]): LayoutNodeInput => ({ id, requires });
const OPTS = { nodeWidth: 100, nodeHeight: 60, columnGap: 20, rowGap: 40 };

/** A C++-like roadmap: two roots, a long edge (b -> h) and a diamond. */
const GRAPH = [
  node('a'),
  node('b'),
  node('c', 'a'),
  node('d', 'a', 'b'),
  node('e', 'b'),
  node('f', 'c'),
  node('g', 'c', 'e'),
  node('h', 'b', 'f', 'g'),
];

const layerOf = (nodes: LayoutNodeInput[], max = 3) => {
  const { layer } = assignLayers(nodes, max);
  return Object.fromEntries(nodes.map((n) => [n.id, layer.get(n.id)]));
};

describe('assignLayers', () => {
  it('puts each node one layer below its deepest prerequisite', () => {
    expect(layerOf(GRAPH)).toEqual({ a: 0, b: 0, c: 1, d: 1, e: 1, f: 2, g: 2, h: 3 });
  });
  it('moves a root down to just above the first node that builds on it', () => {
    // x only leads to z, two layers down: it sits right above z.
    expect(layerOf([node('a'), node('b', 'a'), node('x'), node('z', 'b', 'x')])).toEqual({
      a: 0,
      b: 1,
      x: 1,
      z: 2,
    });
  });
  it('hands nodes with room below (sinks first, last authored first) down from a full layer', () => {
    const wide = [node('r'), node('p', 'r'), node('q', 'r'), node('s', 'r'), node('t', 'r')];
    expect(layerOf(wide)).toEqual({ r: 0, p: 1, q: 1, s: 1, t: 2 });
    expect(layerOf(wide, 4)).toEqual({ r: 0, p: 1, q: 1, s: 1, t: 1 });
    // A node whose dependant is right below cannot move without passing it.
    const pinned = [node('r'), node('p', 'r'), node('q', 'r'), node('s', 'r'), node('t', 'r')];
    pinned.push(node('u', 'p'), node('v', 'q'), node('w', 's'), node('y', 't'));
    expect(layerOf(pinned).t).toBe(1);
  });
  it('ignores unknown prerequisites and survives a cycle', () => {
    expect(layerOf([node('a', 'nope'), node('b', 'a')])).toEqual({ a: 0, b: 1 });
    const cyclic = layerOf([node('a', 'b'), node('b', 'a')]);
    expect(Object.keys(cyclic).sort()).toEqual(['a', 'b']);
  });
});

describe('layoutRoadmap', () => {
  const layout = layoutRoadmap(GRAPH, OPTS);
  const at = (id: string) => {
    const n = layout.nodes.find((x) => x.id === id);
    if (!n) throw new Error(id);
    return n;
  };

  it('places every node once, layer by layer from the top', () => {
    expect(layout.nodes.map((n) => n.id).sort()).toEqual([...'abcdefgh']);
    expect(layout.layers).toBe(4);
    for (const n of layout.nodes) expect(n.y).toBe(n.layer * (OPTS.nodeHeight + OPTS.rowGap));
    expect(layout.height).toBe(3 * 100 + 60);
  });
  it('keeps nodes of a layer apart and inside the drawing', () => {
    for (let l = 0; l < layout.layers; l++) {
      const row = layout.nodes.filter((n) => n.layer === l).sort((a, b) => a.x - b.x);
      for (let i = 1; i < row.length; i++)
        expect((row[i]?.x ?? 0) - (row[i - 1]?.x ?? 0)).toBeGreaterThanOrEqual(
          OPTS.nodeWidth + OPTS.columnGap - 1e-6,
        );
    }
    for (const n of layout.nodes) {
      expect(n.x).toBeGreaterThanOrEqual(-1e-6);
      expect(n.x + OPTS.nodeWidth).toBeLessThanOrEqual(layout.width + 1e-6);
    }
  });
  it('draws an edge per prerequisite from the bottom of one node to the top of the other', () => {
    expect(layout.edges).toHaveLength(GRAPH.reduce((s, n) => s + n.requires.length, 0));
    for (const e of layout.edges) {
      const from = at(e.from);
      const to = at(e.to);
      expect(e.start.y).toBe(from.y + OPTS.nodeHeight);
      expect(e.end.y).toBe(to.y);
      expect(e.start.x).toBeGreaterThanOrEqual(from.x);
      expect(e.start.x).toBeLessThanOrEqual(from.x + OPTS.nodeWidth);
      expect(e.end.x).toBeGreaterThanOrEqual(to.x);
      expect(e.end.x).toBeLessThanOrEqual(to.x + OPTS.nodeWidth);
      expect(e.d.startsWith('M')).toBe(true);
    }
  });
  it('routes an edge that skips layers through the gaps, never under a node', () => {
    const long = layout.edges.find((e) => e.from === 'b' && e.to === 'h');
    // One straight run through each layer it passes (layers 1 and 2).
    expect(long?.d.match(/ L/g)).toHaveLength(2);
    const xs = [...(long?.d.matchAll(/ L(-?[\d.]+) (-?[\d.]+)/g) ?? [])].map((m) => ({
      x: Number(m[1]),
      y: Number(m[2]),
    }));
    for (const p of xs) {
      const layer = Math.round((p.y - OPTS.nodeHeight) / (OPTS.nodeHeight + OPTS.rowGap));
      for (const n of layout.nodes.filter((x) => x.layer === layer))
        expect(p.x < n.x || p.x > n.x + OPTS.nodeWidth, `${n.id}`).toBe(true);
    }
  });
  it('orders layers to avoid crossings', () => {
    // Two chains whose roots are authored in the "wrong" order still come out uncrossed.
    const twisted = [node('a'), node('b'), node('x', 'b'), node('y', 'a'), node('z', 'x', 'y')];
    expect(layoutRoadmap(twisted, OPTS).crossings).toBe(0);
    expect(layout.crossings).toBe(0);
  });
  it('lines a single dependant up under its prerequisite', () => {
    const chain = layoutRoadmap([node('a'), node('b', 'a'), node('c', 'b')], OPTS);
    expect(new Set(chain.nodes.map((n) => n.x)).size).toBe(1);
    expect(chain.width).toBe(OPTS.nodeWidth);
  });
  it('gravity packs layers around the middle', () => {
    const loose = layoutRoadmap(GRAPH, OPTS);
    const packed = layoutRoadmap(GRAPH, { ...OPTS, gravity: 1 });
    expect(packed.width).toBeLessThanOrEqual(loose.width);
    // Packed: the widest layer, three nodes plus a lane for the long edge, sets the width.
    expect(packed.width).toBeLessThanOrEqual(3 * 100 + 2 * 20 + 12 + 2 * 12 + 1e-6);
  });
  it('handles an empty roadmap', () => {
    expect(layoutRoadmap([], OPTS)).toMatchObject({ width: 0, height: 0, nodes: [], edges: [] });
  });
});

describe('fitLayout', () => {
  const many = [
    node('r'),
    ...['a', 'b', 'c', 'd'].map((id) => node(id, 'r')),
    ...['e', 'f', 'g'].map((id) => node(id, 'a')),
  ];
  it('uses the widest nodes that fit a wide container', () => {
    const f = fitLayout(many, 1200);
    expect(f).toMatchObject({ compact: false, fits: true });
    expect(f.options.nodeWidth).toBe(176);
    expect(f.layout.width).toBeLessThanOrEqual(1200);
  });
  it('shrinks nodes, then pulls layers in, to fit a phone', () => {
    const f = fitLayout(many, 344);
    expect(f.compact).toBe(true);
    expect(f.fits).toBe(true);
    expect(f.layout.width).toBeLessThanOrEqual(344);
    expect(widestLayer(f.layout)).toBeLessThanOrEqual(3);
    expect(344).toBeLessThan(COMPACT_BELOW);
  });
  it('says when nothing fits, so the graph scrolls in its own box', () => {
    const f = fitLayout(many, 200);
    expect(f.fits).toBe(false);
    expect(f.options.nodeWidth).toBe(92);
  });
});

describe('reading order and arrow keys', () => {
  const layout = layoutRoadmap(GRAPH, OPTS);
  it('reads layer by layer, left to right', () => {
    const order = readingOrder(layout);
    expect(order.slice(0, 2).sort()).toEqual(['a', 'b']);
    expect(order.at(-1)).toBe('h');
    const layerOfId = new Map(layout.nodes.map((n) => [n.id, n.layer]));
    const layers = order.map((id) => layerOfId.get(id) ?? 0);
    expect(layers).toEqual([...layers].sort((a, b) => a - b));
  });
  it('moves within a layer and to the nearest node above or below', () => {
    const order = readingOrder(layout);
    const [first = '', second = ''] = order;
    expect(stepFrom(layout, first, 'right')).toBe(second);
    expect(stepFrom(layout, second, 'left')).toBe(first);
    expect(stepFrom(layout, first, 'left')).toBeNull();
    expect(stepFrom(layout, first, 'up')).toBeNull();
    expect(stepFrom(layout, 'h', 'down')).toBeNull();
    const below = stepFrom(layout, first, 'down');
    expect(layout.nodes.find((n) => n.id === below)?.layer).toBe(1);
    expect(stepFrom(layout, 'h', 'up')).toMatch(/^[fg]$/);
    expect(stepFrom(layout, 'nope', 'up')).toBeNull();
  });
});

// ---------------------------------------------------------------- states

const p = (questionCount: number, answered: number, accuracy: number | null, correct = 0) => ({
  questionCount,
  answered,
  accuracy,
  correct,
});

describe('nodeState', () => {
  it('not started, in progress, complete', () => {
    expect(nodeState(p(10, 0, null))).toBe('not_started');
    expect(nodeState(p(10, 3, 1))).toBe('in_progress');
    // Everything answered is not enough without the accuracy.
    expect(nodeState(p(10, 10, 0.69))).toBe('in_progress');
    expect(nodeState(p(10, 10, 0.7))).toBe('complete');
    expect(nodeState(p(0, 0, null))).toBe('not_started');
  });
});

describe('roadmapStatuses and summarise', () => {
  const nodes = [
    { id: 'a', requires: [], ...p(4, 4, 0.9, 4) },
    { id: 'b', requires: [], ...p(4, 2, 0.5, 1) },
    { id: 'c', requires: ['a'], ...p(4, 0, null) },
    { id: 'd', requires: ['a', 'b'], ...p(4, 1, 1, 1) },
    { id: 'e', requires: ['d', 'gone'], ...p(4, 0, null) },
    { id: 'empty', requires: [], ...p(0, 0, null) },
  ];
  const st = roadmapStatuses(nodes);
  it('marks as next up what is not complete and builds only on complete areas', () => {
    expect(Object.fromEntries([...st].map(([id, s]) => [id, [s.state, s.next]]))).toEqual({
      a: ['complete', false],
      b: ['in_progress', true],
      c: ['not_started', true],
      d: ['in_progress', false],
      e: ['not_started', false],
      // Nothing to practise in an area without questions.
      empty: ['not_started', false],
    });
  });
  it('on a first visit, the roots are next up', () => {
    const fresh = roadmapStatuses(nodes.map((n) => ({ ...n, answered: 0, accuracy: null })));
    expect([...fresh].filter(([, s]) => s.next).map(([id]) => id)).toEqual(['a', 'b']);
  });
  it('summarises a topic, next-up areas in the given order', () => {
    expect(summarise(nodes, ['c', 'b', 'a'])).toEqual({
      total: 6,
      complete: 1,
      inProgress: 2,
      next: ['c', 'b'],
    });
  });
});

describe('relations', () => {
  it('lists what a node builds on and leads to', () => {
    const { requires, leadsTo } = relations([
      { id: 'a', requires: [] },
      { id: 'b', requires: ['a', 'missing'] },
      { id: 'c', requires: ['a'] },
    ]);
    expect(requires.get('b')).toEqual(['a']);
    expect(leadsTo.get('a')).toEqual(['b', 'c']);
    expect(leadsTo.get('c')).toEqual([]);
  });
});

describe('labels and choices', () => {
  it('names a node with its state and progress, not by colour', () => {
    expect(
      nodeLabel(
        { title: 'Move semantics', questionCount: 20, answered: 6, correct: 5 },
        { state: 'in_progress', next: true },
      ),
    ).toBe('Move semantics. In progress. 6 of 20 answered, 5 correct. next up.');
    expect(
      nodeLabel(
        { title: 'Initialization', questionCount: 16, answered: 16, correct: 15 },
        { state: 'complete', next: false },
      ),
    ).toBe('Initialization. Complete. 16 of 16 answered, 15 correct.');
  });
  it('picks the topic from the URL, then memory, then the first', () => {
    const slugs = ['cpp', 'python'];
    expect(pickTopic(slugs, 'python', 'cpp')).toBe('python');
    expect(pickTopic(slugs, 'nope', 'python')).toBe('python');
    expect(pickTopic(slugs, null, 'gone')).toBe('cpp');
    expect(pickTopic([], 'cpp', null)).toBeNull();
  });
  it('opens the bank on the first subtopic with something left to get right', () => {
    const s = (subtopic: string, questionCount: number, correct: number) => ({
      subtopic,
      questionCount,
      correct,
    });
    expect(browseSubtopic([s('one', 3, 3), s('two', 4, 1)])).toBe('two');
    expect(browseSubtopic([s('one', 3, 3), s('two', 4, 4)])).toBe('one');
    expect(browseSubtopic([])).toBeNull();
  });
});
