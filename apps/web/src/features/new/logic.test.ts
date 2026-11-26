import type { ProblemSummary } from '@ipp/contracts';
import { describe, expect, it } from 'vitest';
import {
  categoryCounts,
  effectiveLanguage,
  filterProblems,
  groupOptions,
  isLanguageRestricted,
  type LibraryFilters,
  languageNote,
  NO_FILTERS,
  parseCategory,
  parseDifficulty,
  pickRandom,
  progressMap,
  randomPool,
  restrictionLabel,
  statusCounts,
  statusOf,
  subtopicOptions,
} from './logic';

const P = (
  slug: string,
  category: ProblemSummary['category'],
  difficulty: ProblemSummary['difficulty'],
  tags: string[],
  languages: ProblemSummary['languages'] = ['cpp', 'python', 'java'],
): ProblemSummary => ({
  slug,
  title: slug.replace(/-/g, ' '),
  category,
  difficulty,
  tags,
  languages,
});

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

const PROGRESS = progressMap([
  { slug: 'two-sum', status: 'solved', lastActivityAt: '2026-11-01T10:00:00.000Z' },
  { slug: 'word-ladder', status: 'attempted', lastActivityAt: '2026-11-02T10:00:00.000Z' },
  { slug: 'lru-cache', status: 'solved', lastActivityAt: '2026-11-03T10:00:00.000Z' },
]);

describe('problem progress', () => {
  it('a problem missing from the progress is new', () => {
    expect(statusOf(PROGRESS, 'two-sum')).toBe('solved');
    expect(statusOf(PROGRESS, 'word-ladder')).toBe('attempted');
    expect(statusOf(PROGRESS, 'course-schedule')).toBe('new');
    expect(statusOf(progressMap(undefined), 'two-sum')).toBe('new');
  });

  it('filters by status alongside the other filters', () => {
    expect(slugs(filterProblems(LIB, f({ status: 'solved' }), PROGRESS))).toEqual([
      'two-sum',
      'lru-cache',
    ]);
    expect(slugs(filterProblems(LIB, f({ status: 'attempted' }), PROGRESS))).toEqual([
      'word-ladder',
    ]);
    expect(slugs(filterProblems(LIB, f({ status: 'new', category: 'dsa' }), PROGRESS))).toEqual([
      'number-of-islands',
      'course-schedule',
    ]);
    // Without progress (not loaded, or it failed) everything is new.
    expect(filterProblems(LIB, f({ status: 'solved' }))).toEqual([]);
    expect(filterProblems(LIB, f({ status: 'all' }), PROGRESS)).toHaveLength(LIB.length);
  });

  it('counts each status with the other filters applied, and the tabs follow the status', () => {
    expect(statusCounts(LIB, f(), PROGRESS)).toEqual({
      all: 6,
      new: 3,
      attempted: 1,
      solved: 2,
    });
    // The status filter itself does not narrow its own counts.
    expect(statusCounts(LIB, f({ status: 'solved', difficulty: 'medium' }), PROGRESS)).toEqual({
      all: 3,
      new: 2,
      attempted: 0,
      solved: 1,
    });
    expect(categoryCounts(LIB, f({ status: 'solved' }), PROGRESS)).toEqual({
      all: 2,
      dsa: 1,
      implementation: 0,
      'data-structure': 1,
    });
  });
});

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

describe('language-restricted problems', () => {
  const uptr = P('unique-ptr', 'data-structure', 'medium', ['design'], ['cpp']);
  const two = P('two-langs', 'dsa', 'easy', [], ['cpp', 'python']);
  const any = LIB[0] as ProblemSummary;

  it('labels only restricted problems', () => {
    expect(isLanguageRestricted(any)).toBe(false);
    expect(restrictionLabel(any)).toBeNull();
    expect(restrictionLabel(uptr)).toBe('C++ only');
    expect(restrictionLabel(two)).toBe('C++ or Python only');
  });

  it('switches to an offered language without touching the preference', () => {
    expect(effectiveLanguage('python', undefined)).toBe('python');
    expect(effectiveLanguage('python', any)).toBe('python');
    expect(effectiveLanguage('python', uptr)).toBe('cpp');
    expect(effectiveLanguage('python', two)).toBe('python');
    expect(effectiveLanguage('java', two)).toBe('cpp');
  });

  it('says why the picker offers fewer languages', () => {
    expect(languageNote('python', any)).toBeNull();
    expect(languageNote('python', undefined)).toBeNull();
    expect(languageNote('cpp', uptr)).toBe('unique ptr can only be solved in C++.');
    expect(languageNote('python', uptr)).toBe(
      'unique ptr can only be solved in C++, so this interview uses C++ (your usual Python is kept for other problems).',
    );
  });

  it('random picks only choose problems in the selected language', () => {
    const lib = [...LIB, uptr];
    expect(slugs(randomPool(lib, 'cpp'))).toContain('unique-ptr');
    expect(slugs(randomPool(lib, 'python'))).not.toContain('unique-ptr');
    expect(randomPool(lib, 'python')).toHaveLength(LIB.length);
    for (const r of [0, 0.5, 0.999])
      expect(pickRandom(randomPool([uptr, any], 'java'), null, () => r)?.slug).toBe('two-sum');
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
