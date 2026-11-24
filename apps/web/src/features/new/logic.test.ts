import type { ProblemSummary } from '@ipp/contracts';
import { describe, expect, it } from 'vitest';
import {
  categoryCounts,
  filterProblems,
  groupOptions,
  type LibraryFilters,
  NO_FILTERS,
  parseCategory,
  parseDifficulty,
  pickRandom,
  subtopicOptions,
} from './logic';

const P = (
  slug: string,
  category: ProblemSummary['category'],
  difficulty: ProblemSummary['difficulty'],
  tags: string[],
): ProblemSummary => ({ slug, title: slug.replace(/-/g, ' '), category, difficulty, tags });

const LIB: ProblemSummary[] = [
  P('two-sum', 'dsa', 'easy', ['array', 'hash-table']),
  P('number-of-islands', 'dsa', 'medium', ['graph', 'bfs', 'dfs', 'matrix']),
  P('course-schedule', 'dsa', 'medium', ['graph', 'topological-sort']),
  P('word-ladder', 'dsa', 'hard', ['graph', 'bfs', 'string']),
  P('text-justification', 'implementation', 'hard', ['array', 'string', 'simulation']),
  P('lru-cache', 'data-structure', 'medium', ['design', 'hash-table', 'linked-list']),
];

const f = (over: Partial<LibraryFilters> = {}): LibraryFilters => ({
  ...NO_FILTERS,
  showTopics: false,
  ...over,
});
const slugs = (ps: ProblemSummary[]) => ps.map((p) => p.slug);

describe('filterProblems', () => {
  it('filters by category and difficulty', () => {
    expect(slugs(filterProblems(LIB, f({ category: 'implementation' })))).toEqual([
      'text-justification',
    ]);
    expect(slugs(filterProblems(LIB, f({ category: 'dsa', difficulty: 'medium' })))).toEqual([
      'number-of-islands',
      'course-schedule',
    ]);
  });

  it('a group matches any of its tags; a subtopic narrows to one', () => {
    expect(slugs(filterProblems(LIB, f({ group: 'graphs' })))).toEqual([
      'number-of-islands',
      'course-schedule',
      'word-ladder',
    ]);
    expect(slugs(filterProblems(LIB, f({ group: 'graphs', subtopic: 'bfs' })))).toEqual([
      'number-of-islands',
      'word-ladder',
    ]);
    // Arrays & hashing owns both `array` and `hash-table`.
    expect(slugs(filterProblems(LIB, f({ group: 'arrays-hashing' })))).toEqual([
      'two-sum',
      'number-of-islands',
      'text-justification',
      'lru-cache',
    ]);
    // A subtopic without a group is ignored; an unknown group filters nothing out.
    expect(filterProblems(LIB, f({ subtopic: 'bfs' }))).toHaveLength(LIB.length);
    expect(filterProblems(LIB, f({ group: 'nope' }))).toHaveLength(LIB.length);
  });

  it('search matches titles only while topics are hidden', () => {
    expect(slugs(filterProblems(LIB, f({ query: '  Word ' })))).toEqual(['word-ladder']);
    expect(filterProblems(LIB, f({ query: 'hash' }))).toEqual([]);
    expect(filterProblems(LIB, f({ query: 'breadth' }))).toEqual([]);
    expect(slugs(filterProblems(LIB, f({ query: 'hash', showTopics: true })))).toEqual([
      'two-sum',
      'lru-cache',
    ]);
    expect(slugs(filterProblems(LIB, f({ query: 'topological sort', showTopics: true })))).toEqual([
      'course-schedule',
    ]);
    expect(slugs(filterProblems(LIB, f({ query: 'breadth', showTopics: true })))).toEqual([
      'number-of-islands',
      'word-ladder',
    ]);
  });
});

describe('categoryCounts', () => {
  it('counts each category under the other filters', () => {
    expect(categoryCounts(LIB, f({ category: 'implementation' }))).toEqual({
      all: 6,
      dsa: 4,
      implementation: 1,
      'data-structure': 1,
    });
    expect(categoryCounts(LIB, f({ difficulty: 'hard' }))).toEqual({
      all: 2,
      dsa: 1,
      implementation: 1,
      'data-structure': 0,
    });
  });
});

describe('topic options', () => {
  it('lists only groups and subtopics that occur', () => {
    expect(groupOptions(LIB).map((g) => g.slug)).toEqual([
      'arrays-hashing',
      'linked-lists',
      'graphs',
      'strings',
    ]);
    expect(subtopicOptions(LIB, 'graphs').map((s) => s.tag)).toEqual([
      'bfs',
      'dfs',
      'topological-sort',
    ]);
    expect(subtopicOptions(LIB, 'strings')).toEqual([]);
    expect(subtopicOptions(LIB, 'all')).toEqual([]);
  });
});

describe('pickRandom', () => {
  it('picks from the candidates and never repeats the current one when it can avoid it', () => {
    const graphs = filterProblems(LIB, f({ group: 'graphs' }));
    expect(pickRandom(graphs, null, () => 0)?.slug).toBe('number-of-islands');
    expect(pickRandom(graphs, null, () => 0.999)?.slug).toBe('word-ladder');
    for (const r of [0, 0.3, 0.6, 0.999])
      expect(pickRandom(graphs, 'number-of-islands', () => r)?.slug).not.toBe('number-of-islands');
    expect(pickRandom([LIB[0] as ProblemSummary], 'two-sum')?.slug).toBe('two-sum');
    expect(pickRandom([], null)).toBeUndefined();
  });
});

describe('url params', () => {
  it('parses known values and falls back to all', () => {
    expect(parseCategory('data-structure')).toBe('data-structure');
    expect(parseCategory('puzzles')).toBe('all');
    expect(parseCategory(null)).toBe('all');
    expect(parseDifficulty('hard')).toBe('hard');
    expect(parseDifficulty('impossible')).toBe('all');
  });
});
