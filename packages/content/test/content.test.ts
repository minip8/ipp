import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { groupTags, PROBLEM_CATEGORIES, TOPIC_GROUPS } from '@ipp/contracts';
import { afterAll, describe, expect, it } from 'vitest';
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

describe('quiz loading', () => {
  const root = mkdtempSync(join(tmpdir(), 'ipp-quiz-'));
  afterAll(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, 'quiz', 'q'), { recursive: true });
  const file = join(root, 'quiz', 'q', 'a.yaml');
  const numeric = (fields: string) =>
    `- { id: q-1, topic: q, subtopic: s, difficulty: easy, type: numeric, prompt: p, explanation: e, ${fields} }\n`;

  it('reads the track of each topic, fundamentals by default', () => {
    writeFileSync(
      join(root, 'quiz', 'topics.yaml'),
      '- { slug: f, title: F, description: d }\n- { slug: q, title: Q, description: d, track: quant }\n',
    );
    expect(loadQuizTopics(root).map((t) => [t.slug, t.track])).toEqual([
      ['f', 'fundamentals'],
      ['q', 'quant'],
    ]);
    writeFileSync(
      join(root, 'quiz', 'topics.yaml'),
      '- { slug: q, title: Q, description: d, track: physics }\n',
    );
    expect(() => loadQuizTopics(root)).toThrow(/quiz\/topics.yaml/);
    writeFileSync(
      join(root, 'quiz', 'topics.yaml'),
      '- { slug: q, title: Q, description: d, track: quant }\n',
    );
  });
  it('reads numeric questions, keeping the answer as text', () => {
    writeFileSync(
      file,
      numeric('answer: 5/36, unit: dollars, hints: [count the pairs], followUps: [three dice?]'),
    );
    expect(loadQuizQuestions(root)).toEqual([
      expect.objectContaining({
        type: 'numeric',
        answer: '5/36',
        unit: 'dollars',
        hints: ['count the pairs'],
        followUps: ['three dice?'],
      }),
    ]);
    writeFileSync(file, numeric('answer: 0.25, tolerance: { rel: 0.01 }'));
    expect(loadQuizQuestions(root)).toEqual([
      expect.objectContaining({ answer: '0.25', tolerance: { rel: 0.01 }, hints: [] }),
    ]);
  });
  it('rejects a numeric answer that is not a number, and an empty tolerance', () => {
    writeFileSync(file, numeric('answer: about a third'));
    expect(() => loadQuizQuestions(root)).toThrow(/not a number/);
    writeFileSync(file, numeric('answer: 1/3, tolerance: {}'));
    expect(() => loadQuizQuestions(root)).toThrow(/tolerance/);
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
