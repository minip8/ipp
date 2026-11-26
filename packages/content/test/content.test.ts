import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  groupTags,
  PROBLEM_CATEGORIES,
  QUANT_PATH_INFO,
  QUANT_PATHS,
  TOPIC_GROUPS,
} from '@ipp/contracts';
import { afterAll, describe, expect, it } from 'vitest';
import {
  CONTENT_ROOT,
  gameIdCollisions,
  loadProblems,
  loadQuantGames,
  loadQuizQuestions,
  loadQuizTopics,
  quantGameErrors,
  resultsEqual,
  untaxonomizedTags,
} from '../src';
import { quantGameMathErrors } from '../src/math';

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
  it('every market-making game validates, typesets and has the figures the engine computes', () => {
    const games = loadQuantGames();
    expect(games.length).toBeGreaterThanOrEqual(2);
    expect(games.flatMap(quantGameErrors)).toEqual([]);
    expect(quantGameMathErrors(games)).toEqual([]);
    expect(gameIdCollisions(games, loadQuizQuestions())).toEqual([]);
    // A game on the trader path, so the assembler has one to put in a trader round.
    expect(games.some((g) => QUANT_PATH_INFO.trader.topics.includes(g.topic))).toBe(true);
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

describe('game loading', () => {
  const root = mkdtempSync(join(tmpdir(), 'ipp-games-'));
  afterAll(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, 'quiz'), { recursive: true });
  mkdirSync(join(root, 'games'), { recursive: true });
  writeFileSync(
    join(root, 'quiz', 'topics.yaml'),
    '- { slug: f, title: F, description: d }\n- { slug: q, title: Q, description: d, track: quant }\n',
  );
  const game = (over = '') =>
    `id: g-1
topic: q
title: Two coins
difficulty: easy
prompt: Make me a market on the number of heads, $H$.
components: [{ label: Coin 1, faces: [0, 1] }, { label: Coin 2, faces: [0, 1] }]
payoff: sum
reveal: [0]
tick: 0.25
maxSize: 2
counterparty: Uninformed.
explanation: Fair is 1.
expect: { fair: 1, sd: 0.7071, min: 0, max: 2 }
${over}`;
  const write = (name: string, text: string) => {
    rmSync(join(root, 'games'), { recursive: true, force: true });
    mkdirSync(join(root, 'games'));
    writeFileSync(join(root, 'games', name), text);
  };

  it('reads one game per file, its figures checked by the engine', () => {
    write('g-1.yaml', game());
    const [g] = loadQuantGames(root);
    expect(g).toMatchObject({ id: 'g-1', payoff: 'sum', hints: [], expect: { fair: '1' } });
    expect(quantGameErrors(g as NonNullable<typeof g>)).toEqual([]);
    const wrong = {
      ...(g as NonNullable<typeof g>),
      expect: { fair: '1/2', sd: 0.5, min: '0', max: '2' },
    };
    expect(quantGameErrors(wrong)).toEqual([
      'g-1: expect.fair is 1/2, the engine computes 1',
      'g-1: expect.sd is 0.5, the engine computes 0.707106781187 (give at least four significant figures)',
    ]);
    expect(gameIdCollisions([wrong], [{ id: 'g-1' }])).toEqual(['g-1']);
  });
  it('the id is the file name, and the topic a quant topic', () => {
    write('other.yaml', game());
    expect(() => loadQuantGames(root)).toThrow(/must match the file name/);
    write('g-1.yaml', game().replace('topic: q', 'topic: f'));
    expect(() => loadQuantGames(root)).toThrow(/not a quant topic/);
    write('g-1.yaml', game().replace('reveal: [0]', 'reveal: [2]'));
    expect(() => loadQuantGames(root)).toThrow(/no component 2/);
  });
  it('a prompt whose formula does not typeset', () => {
    write('g-1.yaml', game().replace('$H$', '$\\frac{H$'));
    expect(quantGameMathErrors(loadQuantGames(root))[0]).toMatch(/^g-1 prompt: .*does not typeset/);
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

describe('quant answer checks', () => {
  // The checks themselves run in `pnpm --filter @ipp/content check` (Python); this only makes sure
  // none is missing, so a numeric answer cannot ship without an independent recomputation.
  it('every numeric question of a quant topic has a check in scripts/quant_checks', () => {
    const quant = new Set(
      loadQuizTopics()
        .filter((t) => t.track === 'quant')
        .map((t) => t.slug),
    );
    const dir = join(CONTENT_ROOT, 'scripts', 'quant_checks');
    const checked = new Set<string>();
    for (const f of readdirSync(dir).filter((f) => f.endsWith('.py')))
      for (const m of readFileSync(join(dir, f), 'utf8').matchAll(/^@check\("([^"]+)"\)/gm))
        checked.add(m[1] as string);
    const questions = loadQuizQuestions().filter((q) => quant.has(q.topic));
    const games = loadQuantGames();
    const ids = new Set([...questions.map((q) => q.id), ...games.map((g) => g.id)]);
    expect(
      questions.filter((q) => q.type === 'numeric' && !checked.has(q.id)).map((q) => q.id),
    ).toEqual([]);
    // Every game's fair value is recomputed too, in scripts/quant_checks/games.py.
    expect(games.filter((g) => !checked.has(g.id)).map((g) => g.id)).toEqual([]);
    expect([...checked].filter((id) => !ids.has(id))).toEqual([]);
  });
});

describe('quant paths', () => {
  it('every topic on a path of the Quant page is a quant topic, and every quant topic is on a path', () => {
    const quant = loadQuizTopics()
      .filter((t) => t.track === 'quant')
      .map((t) => t.slug);
    const onPaths = new Set(QUANT_PATHS.flatMap((p) => QUANT_PATH_INFO[p].topics));
    expect([...onPaths].filter((t) => !quant.includes(t))).toEqual([]);
    expect(quant.filter((t) => !onPaths.has(t))).toEqual([]);
  });
});
