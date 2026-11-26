import type { QuizDifficulty } from '@ipp/contracts';
import { describe, expect, it } from 'vitest';
import {
  type AssembleInput,
  assembleRound,
  difficultySlots,
  type PoolQuestion,
} from '../src/quant/assemble';
import { seededRand, shuffle } from '../src/random';

const LEVELS: QuizDifficulty[] = ['easy', 'medium', 'hard'];
const level = (d: QuizDifficulty) => LEVELS.indexOf(d);
const TOPICS = ['probability', 'brainteasers', 'betting-market-making', 'options'];

/** `per` questions in every (topic, difficulty) cell, alternating short and numeric, each its own subtopic. */
function richPool(per = 4, topics = TOPICS): PoolQuestion[] {
  const pool: PoolQuestion[] = [];
  for (const topic of topics)
    for (const difficulty of LEVELS)
      for (let k = 0; k < per; k++)
        pool.push({
          id: `${topic}-${difficulty}-${k}`,
          topic,
          subtopic: `${difficulty}-${k}`,
          difficulty,
          type: k % 2 === 0 ? 'short' : 'numeric',
        });
  return pool;
}

function input(over: Partial<AssembleInput> & { seed?: number } = {}): AssembleInput {
  return {
    pool: richPool(),
    seen: new Map(),
    recent: new Set(),
    n: 4,
    topics: TOPICS,
    rand: seededRand(over.seed ?? 1),
    ...over,
  };
}

const SEEDS = Array.from({ length: 400 }, (_, i) => i + 1);

describe('difficulty slots', () => {
  it('rise for the three round lengths', () => {
    expect(difficultySlots(3)).toEqual(['easy', 'medium', 'hard']);
    expect(difficultySlots(4)).toEqual(['easy', 'medium', 'medium', 'hard']);
    expect(difficultySlots(6)).toEqual(['easy', 'medium', 'medium', 'medium', 'hard', 'hard']);
  });
});

describe('seeded randomness', () => {
  it('replays from a seed and shuffles without losing anything', () => {
    const a = seededRand(42);
    const b = seededRand(42);
    const xs = Array.from({ length: 50 }, (_, i) => i);
    expect(shuffle(xs, a)).toEqual(shuffle(xs, b));
    expect([...shuffle(xs, seededRand(7))].sort((x, y) => x - y)).toEqual(xs);
    for (let i = 0; i < 1000; i++) {
      const v = a();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});

describe('assembleRound over a rich pool', () => {
  it.each([3, 4, 6])('a %i-question round keeps every rule, for every seed', (n) => {
    for (const seed of SEEDS) {
      const picks = assembleRound(input({ n, seed }));
      expect(picks, `seed ${seed}`).not.toBeNull();
      const p = picks as PoolQuestion[];
      expect(p).toHaveLength(n);
      expect(new Set(p.map((q) => q.id)).size).toBe(n);
      // Exactly the slots' difficulties, rising.
      expect(p.map((q) => q.difficulty)).toEqual(difficultySlots(n));
      // No subtopic twice (subtopics are per topic).
      expect(new Set(p.map((q) => `${q.topic}/${q.subtopic}`)).size).toBe(n);
      // Both types.
      expect(p.some((q) => q.type === 'short')).toBe(true);
      expect(p.some((q) => q.type === 'numeric')).toBe(true);
      // Round-robin: no topic more than its share.
      const counts = new Map<string, number>();
      for (const q of p) counts.set(q.topic, (counts.get(q.topic) ?? 0) + 1);
      expect(Math.max(...counts.values())).toBeLessThanOrEqual(Math.ceil(n / TOPICS.length));
      expect(counts.size).toBe(Math.min(n, TOPICS.length));
    }
  });

  it('is deterministic for a seed and varies between seeds', () => {
    const a = assembleRound(input({ n: 6, seed: 9 }))?.map((q) => q.id);
    const b = assembleRound(input({ n: 6, seed: 9 }))?.map((q) => q.id);
    expect(a).toEqual(b);
    const distinct = new Set(
      SEEDS.map((seed) =>
        assembleRound(input({ n: 6, seed }))
          ?.map((q) => q.id)
          .join(),
      ),
    );
    expect(distinct.size).toBeGreaterThan(50);
    // Every topic starts a round sometimes.
    const firsts = new Set(SEEDS.map((seed) => assembleRound(input({ n: 3, seed }))?.[0]?.topic));
    expect(firsts.size).toBe(TOPICS.length);
  });

  it('leaves out the questions of recent rounds', () => {
    const pool = richPool();
    for (const seed of SEEDS.slice(0, 100)) {
      const recent = new Set(
        shuffle(pool, seededRand(seed + 1000))
          .slice(0, 20)
          .map((q) => q.id),
      );
      const picks = assembleRound(input({ n: 6, seed, recent })) as PoolQuestion[];
      expect(picks).toHaveLength(6);
      for (const q of picks) expect(recent.has(q.id)).toBe(false);
    }
  });

  it('asks the weak questions first: missed or never answered before answered correctly', () => {
    const pool = richPool();
    // One short and one numeric per cell are weak (never answered or missed); the rest are right.
    const weak = new Set(
      pool.filter((q) => q.id.endsWith('-0') || q.id.endsWith('-1')).map((q) => q.id),
    );
    // The weak ones were missed or never answered; the rest were answered correctly.
    const seen = new Map<string, { correct: boolean; answeredAt: Date }>();
    pool.forEach((q, i) => {
      if (!weak.has(q.id)) seen.set(q.id, { correct: true, answeredAt: new Date(i * 1000) });
      else if (i % 2) seen.set(q.id, { correct: false, answeredAt: new Date(i * 1000) });
    });
    for (const seed of SEEDS) {
      for (const n of [3, 4, 6]) {
        const picks = assembleRound(input({ n, seed, seen })) as PoolQuestion[];
        for (const q of picks) expect(weak.has(q.id), `${q.id} (seed ${seed})`).toBe(true);
      }
    }
  });

  it('among questions answered correctly, takes the least recently answered', () => {
    const pool: PoolQuestion[] = [
      { id: 'e-new', topic: 'probability', subtopic: 'a', difficulty: 'easy', type: 'short' },
      { id: 'e-old', topic: 'probability', subtopic: 'b', difficulty: 'easy', type: 'short' },
      { id: 'm', topic: 'probability', subtopic: 'c', difficulty: 'medium', type: 'numeric' },
      { id: 'h', topic: 'probability', subtopic: 'd', difficulty: 'hard', type: 'short' },
    ];
    const seen = new Map([
      ['e-new', { correct: true, answeredAt: new Date(2_000) }],
      ['e-old', { correct: true, answeredAt: new Date(1_000) }],
    ]);
    for (const seed of SEEDS.slice(0, 50)) {
      const picks = assembleRound(input({ pool, seen, n: 3, seed, topics: ['probability'] }));
      expect(picks?.map((q) => q.id)).toEqual(['e-old', 'm', 'h']);
    }
  });
});

describe('assembleRound over a thin pool', () => {
  it('is null when the pool has fewer questions than the round', () => {
    const pool = richPool(1, ['probability']).slice(0, 2);
    expect(assembleRound(input({ pool, n: 3 }))).toBeNull();
    expect(assembleRound(input({ pool: [], n: 3 }))).toBeNull();
  });

  it('relaxes the topic before the difficulty', () => {
    // brainteasers has no hard question: a hard slot dealt to it takes probability's.
    const pool = richPool(2, ['probability', 'brainteasers']).filter(
      (q) => !(q.topic === 'brainteasers' && q.difficulty === 'hard'),
    );
    for (const seed of SEEDS) {
      const picks = assembleRound(
        input({ pool, n: 4, seed, topics: ['probability', 'brainteasers'] }),
      );
      expect(picks?.map((q) => q.difficulty)).toEqual(['easy', 'medium', 'medium', 'hard']);
      expect(picks?.find((q) => q.difficulty === 'hard')?.topic).toBe('probability');
    }
  });

  it('takes the nearest difficulty when no topic has the slot’s, and still rises', () => {
    const pool = richPool(3, ['probability', 'brainteasers']).filter(
      (q) => q.difficulty !== 'hard',
    );
    for (const seed of SEEDS) {
      const picks = assembleRound(input({ pool, n: 6, seed })) as PoolQuestion[];
      expect(picks).toHaveLength(6);
      expect(picks.map((q) => q.difficulty)).toEqual([
        'easy',
        'medium',
        'medium',
        'medium',
        'medium',
        'medium',
      ]);
      const levels = picks.map((q) => level(q.difficulty));
      expect([...levels].sort()).toEqual(levels);
    }
  });

  it('repeats a subtopic only when nothing else is left', () => {
    const pool: PoolQuestion[] = ['easy', 'medium', 'hard', 'hard'].map((d, i) => ({
      id: `q${i}`,
      topic: 'probability',
      subtopic: 'only',
      difficulty: d as QuizDifficulty,
      type: i % 2 ? 'numeric' : 'short',
    }));
    for (const seed of SEEDS.slice(0, 50)) {
      const picks = assembleRound(input({ pool, n: 3, seed }));
      expect(picks?.map((q) => q.difficulty)).toEqual(['easy', 'medium', 'hard']);
    }
  });

  it('finds the one short question when everything else is numeric', () => {
    const pool: PoolQuestion[] = richPool(2, ['probability', 'brainteasers']).map((q) => ({
      ...q,
      type: 'numeric',
    }));
    const only = pool.find((q) => q.topic === 'brainteasers' && q.difficulty === 'hard');
    if (!only) throw new Error('fixture');
    only.type = 'short';
    for (const seed of SEEDS) {
      for (const n of [3, 4, 6]) {
        const picks = assembleRound(input({ pool, n, seed })) as PoolQuestion[];
        expect(
          picks.map((q) => q.id),
          `seed ${seed}`,
        ).toContain(only.id);
        expect(picks.some((q) => q.type === 'numeric')).toBe(true);
        expect(new Set(picks.map((q) => q.id)).size).toBe(n);
      }
    }
    // With no short question at all, an all-numeric round is fine.
    const numeric = pool.map((q) => ({ ...q, type: 'numeric' as const }));
    expect(assembleRound(input({ pool: numeric, n: 4 }))).toHaveLength(4);
  });

  it('falls back on recent questions, last, when the rest would be too few', () => {
    const pool = richPool(1, ['probability']); // three questions, one per difficulty
    const extra: PoolQuestion = {
      id: 'extra',
      topic: 'probability',
      subtopic: 'extra',
      difficulty: 'medium',
      type: 'numeric',
    };
    const all = [...pool, extra];
    const recent = new Set([pool[1]?.id as string, 'extra']);
    for (const seed of SEEDS.slice(0, 50)) {
      const picks = assembleRound(input({ pool: all, n: 3, seed, recent })) as PoolQuestion[];
      expect(picks).toHaveLength(3);
      // Both fresh ones are in; one recent fills the medium slot.
      for (const q of all.filter((q) => !recent.has(q.id)))
        expect(picks.map((p) => p.id)).toContain(q.id);
    }
  });
});
