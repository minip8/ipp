import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { QuizRoadmapNode } from '@ipp/contracts';
import { afterAll, describe, expect, it } from 'vitest';
import {
  findCycle,
  loadQuizQuestions,
  loadQuizRoadmap,
  loadQuizTopics,
  type QuizRoadmap,
  roadmapErrors,
  roadmapGaps,
} from '../src';

const node = (id: string, subtopics: string[], requires: string[] = []) =>
  QuizRoadmapNode.parse({ id, title: id, description: 'd', subtopics, requires });

describe('the authored roadmap', () => {
  const roadmap = loadQuizRoadmap();
  const questions = loadQuizQuestions();

  it('is structurally sound', () => {
    expect(
      roadmapErrors(
        roadmap,
        loadQuizTopics().map((t) => t.slug),
      ),
    ).toEqual([]);
  });
  it('places every quiz subtopic on exactly one node, and every node subtopic has questions', () => {
    expect(roadmapGaps(roadmap, questions)).toEqual([]);
  });
  it('has a roadmap for every topic, of a readable size', () => {
    for (const t of loadQuizTopics()) {
      const nodes = roadmap[t.slug] ?? [];
      expect(nodes.length, t.slug).toBeGreaterThanOrEqual(6);
      expect(nodes.length, t.slug).toBeLessThanOrEqual(16);
      expect(
        nodes.some((n) => n.requires.length === 0),
        `${t.slug} has a starting point`,
      ).toBe(true);
    }
  });
  it('lists only direct prerequisites', () => {
    // An edge implied by another path only adds clutter to the graph.
    for (const [topic, nodes] of Object.entries(roadmap)) {
      const byId = new Map(nodes.map((n) => [n.id, n]));
      const reaches = (from: string, to: string, skip: string): boolean =>
        (byId.get(from)?.requires ?? []).some(
          (r) => r !== skip && (r === to || reaches(r, to, '')),
        );
      for (const n of nodes)
        for (const r of n.requires)
          expect(reaches(n.id, r, r), `${topic} ${n.id} -> ${r} is implied`).toBe(false);
    }
  });
});

describe('roadmapErrors', () => {
  it('accepts a sound roadmap', () => {
    const rm: QuizRoadmap = { a: [node('a-1', ['x']), node('a-2', ['y'], ['a-1'])] };
    expect(roadmapErrors(rm, ['a'])).toEqual([]);
  });
  it('rejects unknown topics, duplicate ids and a subtopic on two nodes', () => {
    const rm: QuizRoadmap = {
      a: [node('n-1', ['x']), node('n-2', ['x', 'y', 'y'])],
      b: [node('n-1', ['z'])],
    };
    const errors = roadmapErrors(rm, ['a']);
    expect(errors).toEqual(
      expect.arrayContaining([
        'b: not a topic in quiz/topics.yaml',
        'b n-1: duplicate node id (also in a)',
        expect.stringContaining('subtopic "x" is also on n-1'),
        'a n-2: subtopic "y" listed twice',
      ]),
    );
  });
  it('rejects bad prerequisites', () => {
    const rm: QuizRoadmap = {
      a: [node('a-1', ['x'], ['a-1', 'nope']), node('a-2', ['y'], ['b-1', 'a-1', 'a-1'])],
      b: [node('b-1', ['z'])],
    };
    expect(roadmapErrors(rm, ['a', 'b'])).toEqual([
      'a a-1: requires itself',
      'a a-1: requires unknown node "nope"',
      'a a-2: requires "b-1" from b; stay in a',
      'a a-2: requires "a-1" twice',
    ]);
  });
  it('rejects a cycle and names it', () => {
    const nodes = [node('p', ['x'], ['r']), node('q', ['y'], ['p']), node('r', ['z'], ['q'])];
    expect(findCycle(nodes)).toEqual(['p', 'r', 'q', 'p']);
    expect(roadmapErrors({ a: nodes }, ['a'])).toEqual([
      'a: prerequisites form a cycle: p -> r -> q -> p',
    ]);
    expect(findCycle([node('p', ['x']), node('q', ['y'], ['p'])])).toBeNull();
  });
});

describe('roadmapGaps', () => {
  const rm: QuizRoadmap = { a: [node('a-1', ['x', 'unused'])] };
  it('reports subtopics off the roadmap, unused node subtopics and topics without a roadmap', () => {
    const gaps = roadmapGaps(rm, [
      { topic: 'a', subtopic: 'x' },
      { topic: 'a', subtopic: 'new one' },
      { topic: 'b', subtopic: 'y' },
    ]);
    expect(gaps).toEqual([
      expect.stringContaining('a: subtopic "new one" (1 question) is on no roadmap node'),
      'b: has questions but no roadmap in quiz/roadmap.yaml',
      'a a-1: subtopic "unused" has no questions',
    ]);
  });
});

describe('loadQuizRoadmap', () => {
  const root = mkdtempSync(join(tmpdir(), 'ipp-roadmap-'));
  afterAll(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, 'quiz'));
  writeFileSync(join(root, 'quiz', 'topics.yaml'), '- { slug: a, title: A, description: d }\n');

  it('is empty without a file', () => {
    expect(loadQuizRoadmap(root)).toEqual({});
  });
  it('fills in defaults and throws on structural errors', () => {
    writeFileSync(
      join(root, 'quiz', 'roadmap.yaml'),
      'a:\n  - { id: a-1, title: One, description: d, subtopics: [x] }\n',
    );
    expect(loadQuizRoadmap(root).a?.[0]?.requires).toEqual([]);
    writeFileSync(
      join(root, 'quiz', 'roadmap.yaml'),
      'a:\n  - { id: a-1, title: One, description: d, subtopics: [x], requires: [a-2] }\n',
    );
    expect(() => loadQuizRoadmap(root)).toThrow(/requires unknown node "a-2"/);
    writeFileSync(
      join(root, 'quiz', 'roadmap.yaml'),
      `a:\n  - { id: a-1, title: ${'x'.repeat(40)}, description: d, subtopics: [x] }\n`,
    );
    expect(() => loadQuizRoadmap(root)).toThrow(/quiz\/roadmap.yaml/);
  });
});
