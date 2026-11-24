/**
 * How coding problems are organised in the library.
 *
 *   category      what kind of interview the problem is (exactly one per problem)
 *   topic groups  generic topics (Graphs, Dynamic programming, ...) that each own a set of the
 *                 fine-grained problem tags; a problem is in a group when it has any of its tags,
 *                 and a group's subtopics narrow it to one tag
 *
 * packages/content checks that every tag a problem uses is in exactly one group or listed in
 * EXCLUDED_TAGS, so the library filters never silently miss a problem.
 */
import { z } from 'zod';

export const PROBLEM_CATEGORIES = ['dsa', 'implementation', 'data-structure'] as const;
export const ProblemCategory = z.enum(PROBLEM_CATEGORIES);
export type ProblemCategory = z.infer<typeof ProblemCategory>;

export const CATEGORY_INFO: Record<
  ProblemCategory,
  { label: string; short: string; description: string }
> = {
  dsa: {
    label: 'Data structures & algorithms',
    short: 'DSA',
    description: 'Classic algorithm questions where the key is finding the right approach.',
  },
  implementation: {
    label: 'Implementation',
    short: 'Implementation',
    description:
      'Practical code with no trick to spot: careful handling of every case, written cleanly and correctly.',
  },
  'data-structure': {
    label: 'Data structure implementation',
    short: 'Data structures',
    description:
      'Build a container yourself, like a hash map, ring buffer or cache, with the operations it promises.',
  },
};

export interface Subtopic {
  /** A problem tag. */
  tag: string;
  label: string;
}

export interface TopicGroup {
  slug: string;
  label: string;
  /** Tags that put a problem in this group without naming anything narrower (e.g. `graph`). */
  umbrella: readonly string[];
  /** Narrower subtopics, each one problem tag, in display order. */
  subtopics: readonly Subtopic[];
}

export const TOPIC_GROUPS: readonly TopicGroup[] = [
  {
    slug: 'arrays-hashing',
    label: 'Arrays & hashing',
    umbrella: ['array'],
    subtopics: [
      { tag: 'hash-table', label: 'Hash maps & sets' },
      { tag: 'counting', label: 'Counting' },
      { tag: 'prefix-sum', label: 'Prefix sums' },
      { tag: 'matrix', label: 'Matrices & grids' },
      { tag: 'cyclic-sort', label: 'Cyclic sort' },
    ],
  },
  {
    slug: 'two-pointers',
    label: 'Two pointers & sliding window',
    umbrella: [],
    subtopics: [
      { tag: 'two-pointers', label: 'Two pointers' },
      { tag: 'sliding-window', label: 'Sliding window' },
    ],
  },
  {
    slug: 'stacks-queues',
    label: 'Stacks & queues',
    umbrella: [],
    subtopics: [
      { tag: 'stack', label: 'Stacks' },
      { tag: 'monotonic-stack', label: 'Monotonic stack' },
      { tag: 'queue', label: 'Queues' },
      { tag: 'deque', label: 'Deques' },
      { tag: 'monotonic-queue', label: 'Monotonic queue' },
    ],
  },
  {
    slug: 'linked-lists',
    label: 'Linked lists & iterators',
    umbrella: [],
    subtopics: [
      { tag: 'linked-list', label: 'Linked lists' },
      { tag: 'iterator', label: 'Iterators' },
    ],
  },
  {
    slug: 'binary-search',
    label: 'Binary search',
    umbrella: ['binary-search'],
    subtopics: [],
  },
  {
    slug: 'sorting-heaps',
    label: 'Sorting & heaps',
    umbrella: [],
    subtopics: [
      { tag: 'sorting', label: 'Sorting' },
      { tag: 'heap', label: 'Heaps & priority queues' },
      { tag: 'merge', label: 'K-way merge' },
      { tag: 'merge-sort', label: 'Merge sort' },
      { tag: 'quickselect', label: 'Quickselect' },
    ],
  },
  {
    slug: 'trees-tries',
    label: 'Trees & tries',
    umbrella: [],
    subtopics: [
      { tag: 'trie', label: 'Tries' },
      { tag: 'ordered-map', label: 'Ordered maps' },
      { tag: 'ordered-set', label: 'Ordered sets' },
      { tag: 'binary-indexed-tree', label: 'Fenwick trees' },
    ],
  },
  {
    slug: 'graphs',
    label: 'Graphs',
    umbrella: ['graph'],
    subtopics: [
      { tag: 'bfs', label: 'Breadth-first search' },
      { tag: 'dfs', label: 'Depth-first search' },
      { tag: 'union-find', label: 'Union-find' },
      { tag: 'topological-sort', label: 'Topological sort' },
      { tag: 'shortest-path', label: 'Shortest paths' },
      { tag: 'dijkstra', label: 'Dijkstra' },
      { tag: 'bellman-ford', label: 'Bellman-Ford' },
      { tag: 'minimum-spanning-tree', label: 'Minimum spanning tree' },
      { tag: 'bridges', label: 'Bridges' },
      { tag: 'tarjan', label: 'Tarjan' },
    ],
  },
  {
    slug: 'dynamic-programming',
    label: 'Dynamic programming',
    umbrella: ['dynamic-programming'],
    subtopics: [
      { tag: 'knapsack', label: 'Knapsack' },
      { tag: 'interval-dp', label: 'Interval DP' },
      { tag: 'memoization', label: 'Memoization' },
    ],
  },
  {
    slug: 'backtracking',
    label: 'Backtracking & recursion',
    umbrella: [],
    subtopics: [
      { tag: 'backtracking', label: 'Backtracking' },
      { tag: 'recursion', label: 'Recursion' },
      { tag: 'divide-and-conquer', label: 'Divide and conquer' },
    ],
  },
  {
    slug: 'greedy',
    label: 'Greedy',
    umbrella: ['greedy'],
    subtopics: [],
  },
  {
    slug: 'intervals',
    label: 'Intervals',
    umbrella: ['intervals'],
    subtopics: [{ tag: 'sweep-line', label: 'Sweep line' }],
  },
  {
    slug: 'strings',
    label: 'Strings',
    umbrella: ['string'],
    subtopics: [{ tag: 'parsing', label: 'Parsing' }],
  },
  {
    slug: 'math-bits',
    label: 'Math & bits',
    umbrella: [],
    subtopics: [
      { tag: 'math', label: 'Math' },
      { tag: 'bit-manipulation', label: 'Bit manipulation' },
      { tag: 'geometry', label: 'Geometry' },
    ],
  },
  {
    slug: 'memory-ownership',
    label: 'Memory & ownership',
    umbrella: [],
    subtopics: [
      { tag: 'memory-management', label: 'Memory management' },
      { tag: 'move-semantics', label: 'Move semantics' },
    ],
  },
];

/** Tags deliberately outside every group, with the reason. */
export const EXCLUDED_TAGS: Readonly<Record<string, string>> = {
  design: 'duplicates the implementation and data-structure categories',
  simulation: 'describes the implementation category, not an algorithmic topic',
  trading: 'a domain, not a technique',
};

const GROUP_BY_SLUG = new Map(TOPIC_GROUPS.map((g) => [g.slug, g]));
const GROUP_BY_TAG = new Map(
  TOPIC_GROUPS.flatMap((g) => [...g.umbrella, ...g.subtopics.map((s) => s.tag)].map((t) => [t, g])),
);

export const topicGroup = (slug: string): TopicGroup | undefined => GROUP_BY_SLUG.get(slug);

/** The group a tag belongs to, if any. */
export const groupOfTag = (tag: string): TopicGroup | undefined => GROUP_BY_TAG.get(tag);

/** Every tag (umbrella and subtopic) that puts a problem in the group. */
export const groupTags = (g: TopicGroup): string[] => [
  ...g.umbrella,
  ...g.subtopics.map((s) => s.tag),
];

/** The groups a problem with these tags is in, in TOPIC_GROUPS order. */
export function groupsOfTags(tags: readonly string[]): TopicGroup[] {
  const hit = new Set(tags.map((t) => GROUP_BY_TAG.get(t)).filter(Boolean));
  return TOPIC_GROUPS.filter((g) => hit.has(g));
}

/** The subtopic label of a tag; undefined for umbrella, excluded and unknown tags. */
export const subtopicLabel = (tag: string): string | undefined =>
  GROUP_BY_TAG.get(tag)?.subtopics.find((s) => s.tag === tag)?.label;
