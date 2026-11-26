import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CONTENT_ROOT } from '@ipp/content';
import { createQuantRound, type InterviewerSettings } from '@ipp/contracts';
import { count, eq, inArray } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDb, type DbHandle, ensureDatabase, runMigrations } from '../src/client';
import {
  drillRuns,
  pads,
  problems,
  problemTests,
  quantGames,
  quantRounds,
  quizAnswers,
  quizAttempts,
  quizQuestions,
  quizTopics,
  user,
} from '../src/schema';
import { seed } from '../src/seed';

const URL = process.env.DB_TEST_DATABASE_URL ?? 'postgres://ipp:ipp@127.0.0.1:5432/ipp_test_db';
let h: DbHandle;
let root: string;

const counts = async () => ({
  problems: (await h.db.select({ n: count() }).from(problems))[0]?.n,
  tests: (await h.db.select({ n: count() }).from(problemTests))[0]?.n,
  topics: (await h.db.select({ n: count() }).from(quizTopics))[0]?.n,
  questions: (await h.db.select({ n: count() }).from(quizQuestions))[0]?.n,
  games: (await h.db.select({ n: count() }).from(quantGames))[0]?.n,
});

beforeAll(async () => {
  await ensureDatabase(URL);
  await runMigrations(URL);
  h = createDb(URL, { max: 2 });
  await h.sql`truncate quiz_answers, quiz_attempts, quiz_questions, quiz_topics, problem_tests, pads, problems, "user" cascade`;
  root = mkdtempSync(join(tmpdir(), 'ipp-seed-'));
  // One real problem plus one broken one.
  mkdirSync(join(root, 'problems'));
  cpSync(join(CONTENT_ROOT, 'problems', 'two-sum'), join(root, 'problems', 'two-sum'), {
    recursive: true,
  });
  mkdirSync(join(root, 'problems', 'broken'));
  writeFileSync(
    join(root, 'problems', 'broken', 'problem.yaml'),
    'slug: broken\ntitle: [unterminated\n',
  );
  mkdirSync(join(root, 'quiz', 'cpp'), { recursive: true });
  writeFileSync(join(root, 'quiz', 'topics.yaml'), '- { slug: cpp, title: C++, description: d }\n');
  writeFileSync(
    join(root, 'quiz', 'cpp', 'a.yaml'),
    `- { id: q-one, topic: cpp, subtopic: s, difficulty: easy, type: single, prompt: p, explanation: e, choices: [{id: a, text: A}, {id: b, text: B}], answer: a }
- { id: q-two, topic: cpp, subtopic: s, difficulty: easy, type: short, prompt: p, explanation: e, reference: r, keyPoints: [k] }
- { id: q-num, topic: cpp, subtopic: s, difficulty: easy, type: numeric, prompt: p, explanation: e, answer: 5/36 }
- { id: q-bad, topic: cpp, subtopic: s, difficulty: easy, type: single, prompt: p, explanation: e, choices: [{id: a, text: A}], answer: z }
`,
  );
});

afterAll(async () => {
  rmSync(root, { recursive: true, force: true });
  await h?.close();
});

describe('seed', () => {
  it('skips invalid content and is idempotent', async () => {
    const first = await seed(h.db, { root });
    expect(first.problems).toBe(1);
    expect(first.questions).toBe(3);
    expect(first.skipped.map((s) => s.where)).toEqual(
      expect.arrayContaining(['problems/broken', expect.stringContaining('q-bad')]),
    );
    const before = await counts();
    await seed(h.db, { root });
    expect(await counts()).toEqual(before);
    expect(before.problems).toBe(1);
    const [row] = await h.db.select().from(problems).where(eq(problems.slug, 'two-sum'));
    expect(row?.category).toBe('dsa');
    const [num] = await h.db.select().from(quizQuestions).where(eq(quizQuestions.id, 'q-num'));
    expect(num?.type).toBe('numeric');
    expect(num?.data).toMatchObject({ answer: '5/36', hints: [], followUps: [] });
  });

  it('writes languages, starter code and harness', async () => {
    // A C++-only variant of two-sum with its own starter code and harness.
    const dir = join(root, 'problems', 'two-sum-cpp');
    cpSync(join(CONTENT_ROOT, 'problems', 'two-sum'), dir, { recursive: true });
    for (const f of ['solution.py', 'solution.java']) rmSync(join(dir, f), { force: true });
    const yaml = readFileSync(join(dir, 'problem.yaml'), 'utf8');
    writeFileSync(
      join(dir, 'problem.yaml'),
      `${yaml.replace('slug: two-sum', 'slug: two-sum-cpp')}languages: [cpp]\n`,
    );
    writeFileSync(join(dir, 'starter.cpp'), '// starter\n');
    writeFileSync(join(dir, 'harness.cpp'), '// harness\n');
    try {
      const report = await seed(h.db, { root });
      expect(report.skipped.map((s) => s.where)).not.toContain('problems/two-sum-cpp');
      const [row] = await h.db.select().from(problems).where(eq(problems.slug, 'two-sum-cpp'));
      expect(row?.languages).toEqual(['cpp']);
      expect(row?.starterCode).toEqual({ cpp: '// starter\n' });
      expect(row?.harness).toEqual({ cpp: '// harness\n' });
      const [plain] = await h.db.select().from(problems).where(eq(problems.slug, 'two-sum'));
      expect(plain?.languages).toEqual(['cpp', 'python', 'java']);
      expect(plain?.harness).toEqual({});
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('removing a question keeps its answers and deactivates it', async () => {
    await h.db
      .insert(user)
      .values({ id: 'u-seed', name: 'n', email: 'seed@example.com' })
      .onConflictDoNothing();
    const [attempt] = await h.db
      .insert(quizAttempts)
      .values({ userId: 'u-seed', mode: 'practice', topics: ['cpp'], questionIds: ['q-one'] })
      .returning();
    await h.db.insert(quizAnswers).values({
      attemptId: attempt?.id ?? '',
      questionId: 'q-one',
      response: { type: 'single', choice: 'a' },
      score: 1,
      correct: true,
      gradedBy: 'auto',
    });
    writeFileSync(
      join(root, 'quiz', 'cpp', 'a.yaml'),
      '- { id: q-two, topic: cpp, subtopic: s, difficulty: easy, type: short, prompt: p, explanation: e, reference: r, keyPoints: [k] }\n',
    );
    await seed(h.db, { root });
    const [q] = await h.db.select().from(quizQuestions).where(eq(quizQuestions.id, 'q-one'));
    expect(q?.active).toBe(false);
    expect(await h.db.select().from(quizAnswers)).toHaveLength(1);
  });

  it('writes topic order, tracks, also and roadmaps; a broken roadmap keeps the stored one', async () => {
    writeFileSync(
      join(root, 'quiz', 'topics.yaml'),
      '- { slug: cpp, title: C++, description: d, also: [quant] }\n- { slug: py, title: Python, description: d, track: quant }\n',
    );
    const file = join(root, 'quiz', 'roadmap.yaml');
    writeFileSync(file, 'cpp:\n  - { id: cpp-s, title: S, description: d, subtopics: [s] }\n');
    try {
      const report = await seed(h.db, { root });
      expect(report.skipped.map((s) => s.where)).not.toContain('quiz/roadmap.yaml');
      const rows = await h.db
        .select({
          slug: quizTopics.slug,
          position: quizTopics.position,
          track: quizTopics.track,
          also: quizTopics.also,
          roadmap: quizTopics.roadmap,
        })
        .from(quizTopics)
        .orderBy(quizTopics.position);
      expect(rows).toEqual([
        {
          slug: 'cpp',
          position: 0,
          track: 'fundamentals',
          also: ['quant'],
          roadmap: [
            {
              id: 'cpp-s',
              title: 'S',
              description: 'd',
              subtopics: ['s'],
              requires: [],
              related: [],
            },
          ],
        },
        { slug: 'py', position: 1, track: 'quant', also: [], roadmap: [] },
      ]);

      // A cycle: reported, and the roadmap already stored stays.
      writeFileSync(
        file,
        'cpp:\n  - { id: cpp-s, title: S, description: d, subtopics: [s], requires: [cpp-s] }\n',
      );
      const broken = await seed(h.db, { root });
      expect(broken.skipped.map((s) => s.where)).toContain('quiz/roadmap.yaml');
      const [cpp] = await h.db.select().from(quizTopics).where(eq(quizTopics.slug, 'cpp'));
      expect(cpp?.roadmap.map((n) => n.id)).toEqual(['cpp-s']);

      // Taking `also` away from a topic clears it on the next seed.
      writeFileSync(
        join(root, 'quiz', 'topics.yaml'),
        '- { slug: cpp, title: C++, description: d }\n- { slug: py, title: Python, description: d, track: quant }\n',
      );
      await seed(h.db, { root });
      const [plain] = await h.db.select().from(quizTopics).where(eq(quizTopics.slug, 'cpp'));
      expect(plain?.also).toEqual([]);
    } finally {
      rmSync(file, { force: true });
      writeFileSync(
        join(root, 'quiz', 'topics.yaml'),
        '- { slug: cpp, title: C++, description: d }\n',
      );
    }
  });

  it('seeds games, skips a broken one, and retires a removed one', async () => {
    // cpp shows in the Quant track too, but its home is fundamentals: no game may name it.
    writeFileSync(
      join(root, 'quiz', 'topics.yaml'),
      '- { slug: cpp, title: C++, description: d, also: [quant] }\n- { slug: mm, title: MM, description: d, track: quant }\n',
    );
    const dir = join(root, 'games');
    mkdirSync(dir, { recursive: true });
    const game = (id: string, title = 'Two coins') =>
      `id: ${id}
topic: mm
title: ${title}
difficulty: easy
prompt: Make me a market on the number of heads.
components: [{ label: Coin 1, faces: [0, 1] }, { label: Coin 2, faces: [0, 1] }]
payoff: sum
reveal: [0]
tick: 0.25
maxSize: 2
counterparty: Uninformed.
hints: [Count the heads.]
explanation: Fair is 1.
expect: { fair: 1, sd: 0.7071, min: 0, max: 2 }
`;
    try {
      writeFileSync(join(dir, 'g-1.yaml'), game('g-1'));
      writeFileSync(
        join(dir, 'broken.yaml'),
        game('broken').replace('payoff: sum', 'payoff: mean'),
      );
      writeFileSync(join(dir, 'g-x.yaml'), game('g-3'));
      writeFileSync(join(dir, 'g-cpp.yaml'), game('g-cpp').replace('topic: mm', 'topic: cpp'));
      const first = await seed(h.db, { root });
      expect(first.games).toBe(1);
      expect(first.skipped).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ where: 'games/broken.yaml' }),
          expect.objectContaining({ where: 'games/g-x.yaml' }),
          { where: 'games/g-cpp.yaml', error: expect.stringMatching(/not a quant topic/) },
        ]),
      );
      rmSync(join(dir, 'g-cpp.yaml'));
      const [row] = await h.db.select().from(quantGames).where(eq(quantGames.id, 'g-1'));
      expect(row).toMatchObject({ topic: 'mm', difficulty: 'easy', active: true });
      expect(row?.data).toMatchObject({ title: 'Two coins', hints: ['Count the heads.'] });
      // Exact figures are kept as text, as a numeric answer is.
      expect(row?.data.expect).toMatchObject({ fair: '1', min: '0', max: '2' });
      // Idempotent, and an edit is written over the row.
      writeFileSync(join(dir, 'g-1.yaml'), game('g-1', 'Two fair coins'));
      const before = await counts();
      await seed(h.db, { root });
      expect(await counts()).toEqual(before);
      const [edited] = await h.db.select().from(quantGames).where(eq(quantGames.id, 'g-1'));
      expect(edited?.data.title).toBe('Two fair coins');
      // While a game file is broken nothing is retired; once all load, a removed game is.
      rmSync(join(dir, 'g-1.yaml'));
      writeFileSync(join(dir, 'g-2.yaml'), game('g-2'));
      await seed(h.db, { root });
      expect(
        (await h.db.select().from(quantGames).where(eq(quantGames.id, 'g-1')))[0]?.active,
      ).toBe(true);
      rmSync(join(dir, 'broken.yaml'));
      rmSync(join(dir, 'g-x.yaml'));
      const last = await seed(h.db, { root });
      expect(last.skipped.filter((s) => s.where.startsWith('games/'))).toEqual([]);
      const rows = await h.db
        .select({ id: quantGames.id, active: quantGames.active })
        .from(quantGames)
        .orderBy(quantGames.id);
      expect(rows).toEqual([
        { id: 'g-1', active: false },
        { id: 'g-2', active: true },
      ]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
      writeFileSync(
        join(root, 'quiz', 'topics.yaml'),
        '- { slug: cpp, title: C++, description: d }\n',
      );
    }
  });

  it('seeds the real content twice with identical row counts', async () => {
    // Snapshot first: content is being edited concurrently.
    const snap = mkdtempSync(join(tmpdir(), 'ipp-content-'));
    for (const d of ['problems', 'quiz', 'games'])
      cpSync(join(CONTENT_ROOT, d), join(snap, d), { recursive: true });
    const a = await seed(h.db, { root: snap });
    const before = await counts();
    const b = await seed(h.db, { root: snap });
    rmSync(snap, { recursive: true, force: true });
    expect(b.problems).toBe(a.problems);
    expect(a.games).toBeGreaterThanOrEqual(2);
    expect(a.skipped.filter((s) => s.where.startsWith('games/'))).toEqual([]);
    expect(await counts()).toEqual(before);
    const cats = Object.fromEntries(
      (
        await h.db
          .select({ slug: problems.slug, category: problems.category })
          .from(problems)
          .where(inArray(problems.slug, ['lru-cache', 'text-justification', 'two-sum']))
      ).map((r) => [r.slug, r.category]),
    );
    expect(cats).toEqual({
      'lru-cache': 'data-structure',
      'text-justification': 'implementation',
      'two-sum': 'dsa',
    });
  });
});

describe('drill_runs', () => {
  it('stores a run and goes when its user is deleted', async () => {
    await h.db.insert(user).values({ id: 'u-drill', name: 'n', email: 'drill@example.com' });
    const [run] = await h.db
      .insert(drillRuns)
      .values({
        userId: 'u-drill',
        durationSec: 60,
        level: 'standard',
        categories: ['multiply'],
        fullMix: false,
        byCategory: [{ category: 'multiply', correct: 3, wrong: 1, skipped: 0 }],
        correct: 3,
        wrong: 1,
        skipped: 0,
        score: 2,
        elapsedMs: 60_000,
      })
      .returning();
    expect(run?.finishedAt).toBeInstanceOf(Date);
    expect(run?.categories).toEqual(['multiply']);
    await h.db.delete(user).where(eq(user.id, 'u-drill'));
    expect(await h.db.select().from(drillRuns).where(eq(drillRuns.userId, 'u-drill'))).toEqual([]);
  });
});

describe('quant_rounds', () => {
  it("stores a round beside its pad and goes with the pad; old pads are 'coding'", async () => {
    await h.db.insert(user).values({ id: 'u-quant', name: 'n', email: 'quant@example.com' });
    const settings: InterviewerSettings = {
      enabled: true,
      style: 'neutral',
      proactivity: 'normal',
      voice: false,
    };
    const [coding] = await h.db
      .insert(pads)
      .values({
        ownerId: 'u-quant',
        title: 'Coding',
        language: 'python',
        interviewer: settings,
        shareToken: 'tok-coding',
      })
      .returning();
    expect(coding?.format).toBe('coding');

    const [pad] = await h.db
      .insert(pads)
      .values({
        ownerId: 'u-quant',
        title: 'Quant round',
        format: 'quant',
        language: 'python',
        interviewer: settings,
        shareToken: 'tok-quant',
      })
      .returning();
    if (!pad) throw new Error('no pad');
    const state = createQuantRound('trader', 30, [
      {
        questionId: 'q-num',
        topic: 'cpp',
        topicTitle: 'C++',
        difficulty: 'easy',
        prompt: 'p',
        unit: null,
        hintsAvailable: 0,
      },
    ]);
    await h.db.insert(quantRounds).values({ padId: pad.id, state });
    const [row] = await h.db.select().from(quantRounds).where(eq(quantRounds.padId, pad.id));
    expect(row?.version).toBe(0);
    expect(row?.state).toEqual(state);

    await h.db.delete(pads).where(eq(pads.id, pad.id));
    expect(await h.db.select().from(quantRounds).where(eq(quantRounds.padId, pad.id))).toEqual([]);
    await h.db.delete(user).where(eq(user.id, 'u-quant'));
  });
});
