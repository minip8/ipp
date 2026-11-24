import { describe, expect, it } from 'vitest';
import { loadProblems, loadQuizQuestions, loadQuizTopics, resultsEqual } from '../src';

describe('content', () => {
  it('every problem validates', () => {
    expect(() => loadProblems()).not.toThrow();
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
