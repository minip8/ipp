import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  CATEGORY_INFO,
  EXCLUDED_TAGS,
  groupOfTag,
  groupsOfTags,
  groupTags,
  PROBLEM_CATEGORIES,
  ProblemContent,
  ProblemSummary,
  Slug,
  subtopicLabel,
  TOPIC_GROUPS,
} from '../src';

const fixture = (name: string) =>
  JSON.parse(readFileSync(new URL(`../fixtures/${name}.json`, import.meta.url), 'utf8'));

describe('problem categories', () => {
  it('every category has labels and a description', () => {
    for (const c of PROBLEM_CATEGORIES) {
      expect(CATEGORY_INFO[c].label).not.toBe('');
      expect(CATEGORY_INFO[c].short).not.toBe('');
      expect(CATEGORY_INFO[c].description).not.toBe('');
    }
  });

  it('a problem needs a known category', () => {
    const p = fixture('problem-two-sum');
    expect(ProblemContent.parse(p).category).toBe('dsa');
    expect(ProblemContent.parse(fixture('problem-lru-cache')).category).toBe('data-structure');
    expect(ProblemContent.safeParse({ ...p, category: 'puzzles' }).success).toBe(false);
    const { category: _, ...without } = p;
    expect(ProblemContent.safeParse(without).success).toBe(false);
    expect(
      ProblemSummary.safeParse({ slug: 'a', title: 'A', difficulty: 'easy', tags: [] }).success,
    ).toBe(false);
  });
});

describe('topic groups', () => {
  it('each tag is in at most one group, and excluded tags are in none', () => {
    const seen = new Map<string, string>();
    for (const g of TOPIC_GROUPS) {
      expect(Slug.safeParse(g.slug).success).toBe(true);
      expect(groupTags(g).length).toBeGreaterThan(0);
      for (const t of groupTags(g)) {
        expect(Slug.safeParse(t).success).toBe(true);
        expect(seen.get(t), `${t} is in ${seen.get(t)} and ${g.slug}`).toBeUndefined();
        expect(EXCLUDED_TAGS[t]).toBeUndefined();
        seen.set(t, g.slug);
      }
    }
    expect(new Set(TOPIC_GROUPS.map((g) => g.slug)).size).toBe(TOPIC_GROUPS.length);
  });

  it('maps tags to groups and labels', () => {
    expect(groupOfTag('dijkstra')?.slug).toBe('graphs');
    expect(groupOfTag('graph')?.slug).toBe('graphs');
    expect(groupOfTag('design')).toBeUndefined();
    expect(groupsOfTags(['string', 'bfs', 'graph', 'design']).map((g) => g.slug)).toEqual([
      'graphs',
      'strings',
    ]);
    expect(subtopicLabel('bfs')).toBe('Breadth-first search');
    expect(subtopicLabel('graph')).toBeUndefined();
    expect(subtopicLabel('nope')).toBeUndefined();
  });
});
