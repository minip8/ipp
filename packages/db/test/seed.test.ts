import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CONTENT_ROOT } from '@ipp/content';
import { count, eq, inArray } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDb, type DbHandle, ensureDatabase, runMigrations } from '../src/client';
import {
  drillRuns,
  problems,
  problemTests,
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

  it('writes topic order, tracks and roadmaps; a broken roadmap keeps the stored one', async () => {
    writeFileSync(
      join(root, 'quiz', 'topics.yaml'),
      '- { slug: cpp, title: C++, description: d }\n- { slug: py, title: Python, description: d, track: quant }\n',
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
          roadmap: quizTopics.roadmap,
        })
        .from(quizTopics)
        .orderBy(quizTopics.position);
      expect(rows).toEqual([
        {
          slug: 'cpp',
          position: 0,
          track: 'fundamentals',
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
        { slug: 'py', position: 1, track: 'quant', roadmap: [] },
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
    } finally {
      rmSync(file, { force: true });
      writeFileSync(
        join(root, 'quiz', 'topics.yaml'),
        '- { slug: cpp, title: C++, description: d }\n',
      );
    }
  });

  it('seeds the real content twice with identical row counts', async () => {
    // Snapshot first: content is being edited concurrently.
    const snap = mkdtempSync(join(tmpdir(), 'ipp-content-'));
    for (const d of ['problems', 'quiz'])
      cpSync(join(CONTENT_ROOT, d), join(snap, d), { recursive: true });
    const a = await seed(h.db, { root: snap });
    const before = await counts();
    const b = await seed(h.db, { root: snap });
    rmSync(snap, { recursive: true, force: true });
    expect(b.problems).toBe(a.problems);
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
