import { groupTags, PROBLEM_CATEGORIES, TOPIC_GROUPS } from '@ipp/contracts';
import { describe, expect, it } from 'vitest';
import {
  loadProblems,
  loadQuizQuestions,
  loadQuizTopics,
  resultsEqual,
  untaxonomizedTags,
} from '../src';

let cached: ReturnType<typeof loadProblems> | undefined;
const problems = () => {
  cached ??= loadProblems();
  return cached;
};

describe('content', () => {
  it('every problem validates', () => {
    expect(() => problems()).not.toThrow();
  });
  it('every problem tag is in a topic group or deliberately excluded', () => {
    expect(untaxonomizedTags(problems())).toEqual([]);
  });
  it('tags are not duplicated within a problem', () => {
    for (const p of problems()) expect(new Set(p.tags).size, p.slug).toBe(p.tags.length);
  });
  it('every category and every topic-group tag has problems', () => {
    for (const c of PROBLEM_CATEGORIES)
      expect(
        problems().some((p) => p.category === c),
        c,
      ).toBe(true);
    const used = new Set(problems().flatMap((p) => p.tags));
    for (const g of TOPIC_GROUPS)
      for (const t of groupTags(g)) expect(used.has(t), `${g.slug}: ${t}`).toBe(true);
  });
  it('every quiz question validates', () => {
    expect(() => loadQuizTopics()).not.toThrow();
    expect(() => loadQuizQuestions()).not.toThrow();
  });
});

describe('resultsEqual', () => {
  it('exact', () => {
    expect(resultsEqual([1, 2], [1, 2], 'exact')).toBe(true);
    expect(resultsEqual([2, 1], [1, 2], 'exact')).toBe(false);
    expect(resultsEqual(0.1 + 0.2, 0.3, 'exact')).toBe(true);
    expect(resultsEqual(null, null, 'exact')).toBe(true);
  });
  it('unordered', () => {
    expect(resultsEqual([2, 1], [1, 2], 'unordered')).toBe(true);
    expect(resultsEqual([[2, 1]], [[1, 2]], 'unordered')).toBe(false);
    expect(resultsEqual([1, 1, 2], [1, 2, 2], 'unordered')).toBe(false);
  });
  it('unordered_deep', () => {
    expect(resultsEqual([[2, 1], [3]], [[3], [1, 2]], 'unordered_deep')).toBe(true);
  });
});
