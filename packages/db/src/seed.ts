/**
 * Idempotent upsert of packages/content into Postgres.
 *
 * Tolerant by design: content is authored in parallel, so an invalid problem, quiz question or
 * market-making game is skipped (and reported) instead of aborting the whole seed. Removing
 * something from content never deletes rows: problems, questions and games are marked inactive.
 * A roadmap that does not load leaves every topic's stored roadmap as it was.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  CONTENT_ROOT,
  listProblemSlugs,
  listQuantGameFiles,
  loadProblem,
  loadQuantGame,
  loadQuizRoadmap,
  loadQuizTopics,
  type QuizRoadmap,
  ROADMAP_FILE,
} from '@ipp/content';
import { type ProblemContent, type QuantGame, QuizQuestion, type QuizTopic } from '@ipp/contracts';
import { and, eq, notInArray, sql } from 'drizzle-orm';
import { parse as parseYaml } from 'yaml';
import { z } from 'zod';
import type { Db } from './client';
import { problems, problemTests, quantGames, quizQuestions, quizTopics } from './schema';

export interface SeedReport {
  problems: number;
  topics: number;
  questions: number;
  games: number;
  skipped: { where: string; error: string }[];
}

interface SeedOptions {
  root?: string;
  log?: (msg: string) => void;
}

function firstLine(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  return msg.split('\n').slice(0, 4).join(' | ');
}

/** Per-question tolerant version of @ipp/content's loadQuizQuestions (same rules). */
function loadQuestionsTolerant(
  root: string,
  topics: Set<string>,
  skipped: SeedReport['skipped'],
): QuizQuestion[] {
  const dir = join(root, 'quiz');
  if (!existsSync(dir)) return [];
  const seen = new Set<string>();
  const out: QuizQuestion[] = [];
  for (const topicDir of readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory())) {
    if (!topics.has(topicDir.name)) {
      skipped.push({ where: `quiz/${topicDir.name}`, error: 'not listed in quiz/topics.yaml' });
      continue;
    }
    for (const file of readdirSync(join(dir, topicDir.name))
      .filter((f) => f.endsWith('.yaml'))
      .sort()) {
      const where = `quiz/${topicDir.name}/${file}`;
      let raw: unknown;
      try {
        raw = parseYaml(readFileSync(join(dir, topicDir.name, file), 'utf8'));
      } catch (e) {
        skipped.push({ where, error: firstLine(e) });
        continue;
      }
      if (!Array.isArray(raw)) {
        skipped.push({ where, error: 'file must contain a list of questions' });
        continue;
      }
      for (const [i, item] of raw.entries()) {
        const parsed = QuizQuestion.safeParse(item);
        const id = (item as { id?: unknown })?.id;
        const label = `${where}[${i}]${typeof id === 'string' ? ` ${id}` : ''}`;
        if (!parsed.success) {
          skipped.push({ where: label, error: firstLine(z.prettifyError(parsed.error)) });
          continue;
        }
        const q = parsed.data;
        if (q.topic !== topicDir.name) {
          skipped.push({ where: label, error: `topic must be "${topicDir.name}"` });
          continue;
        }
        if (seen.has(q.id)) {
          skipped.push({ where: label, error: 'duplicate id' });
          continue;
        }
        if (q.type === 'single' || q.type === 'multiple') {
          const ids = new Set(q.choices.map((c) => c.id));
          if (ids.size !== q.choices.length) {
            skipped.push({ where: label, error: 'duplicate choice ids' });
            continue;
          }
          const answers = q.type === 'single' ? [q.answer] : q.answer;
          if (answers.some((a) => !ids.has(a))) {
            skipped.push({ where: label, error: 'answer is not a choice id' });
            continue;
          }
        }
        seen.add(q.id);
        out.push(q);
      }
    }
  }
  return out;
}

/** Every game file that loads (`loadQuantGame`'s rules); the others are skipped, one by one. */
function loadGamesTolerant(
  root: string,
  topics: readonly QuizTopic[],
  skipped: SeedReport['skipped'],
): QuantGame[] {
  const quant = new Set(topics.filter((t) => t.track === 'quant').map((t) => t.slug));
  const out: QuantGame[] = [];
  for (const file of listQuantGameFiles(root)) {
    try {
      out.push(loadQuantGame(file, quant, root));
    } catch (e) {
      skipped.push({ where: `games/${file}`, error: firstLine(e) });
    }
  }
  return out;
}

export async function seed(db: Db, opts: SeedOptions = {}): Promise<SeedReport> {
  const root = opts.root ?? CONTENT_ROOT;
  const log = opts.log ?? (() => {});
  const skipped: SeedReport['skipped'] = [];

  const loaded: ProblemContent[] = [];
  for (const slug of listProblemSlugs(root)) {
    try {
      loaded.push(loadProblem(slug, root));
    } catch (e) {
      skipped.push({ where: `problems/${slug}`, error: firstLine(e) });
    }
  }

  let topics: QuizTopic[] = [];
  try {
    topics = loadQuizTopics(root);
  } catch (e) {
    skipped.push({ where: 'quiz/topics.yaml', error: firstLine(e) });
  }
  const questions = loadQuestionsTolerant(root, new Set(topics.map((t) => t.slug)), skipped);
  const games = loadGamesTolerant(root, topics, skipped);
  let roadmap: QuizRoadmap | null = null;
  try {
    roadmap = loadQuizRoadmap(root);
  } catch (e) {
    skipped.push({ where: ROADMAP_FILE, error: firstLine(e) });
  }

  await db.transaction(async (tx) => {
    // Serialize concurrent seeds (e.g. two test workers) on one advisory lock.
    await tx.execute(sql`select pg_advisory_xact_lock(724100)`);

    for (const p of loaded) {
      const row = {
        slug: p.slug,
        title: p.title,
        difficulty: p.difficulty,
        category: p.category,
        tags: p.tags,
        statement: p.statement,
        signature: p.signature,
        limits: p.limits,
        interviewerNotes: p.interviewerNotes,
        referenceSolutions: p.referenceSolutions,
        languages: p.languages,
        starterCode: p.starterCode,
        harness: p.harness,
        source: p.source ?? null,
        active: true,
        updatedAt: new Date(),
      };
      const { slug: _slug, ...update } = row;
      await tx
        .insert(problems)
        .values(row)
        .onConflictDoUpdate({ target: problems.slug, set: update });
      await tx.delete(problemTests).where(eq(problemTests.problemSlug, p.slug));
      await tx
        .insert(problemTests)
        .values(p.tests.map((t, idx) => ({ problemSlug: p.slug, idx, hidden: t.hidden, data: t })));
    }
    const slugs = loaded.map((p) => p.slug);
    // Only deactivate when the whole problems directory loaded; a broken file must not hide a problem.
    const brokenProblem = skipped.some((s) => s.where.startsWith('problems/'));
    if (!brokenProblem) {
      await tx
        .update(problems)
        .set({ active: false })
        .where(slugs.length ? notInArray(problems.slug, slugs) : sql`true`);
    }

    for (const [position, t] of topics.entries()) {
      const set = {
        title: t.title,
        description: t.description,
        track: t.track,
        position,
        ...(roadmap ? { roadmap: roadmap[t.slug] ?? [] } : {}),
      };
      await tx
        .insert(quizTopics)
        .values({ slug: t.slug, ...set })
        .onConflictDoUpdate({ target: quizTopics.slug, set });
    }
    // Batched upsert: content has on the order of a thousand questions.
    for (let i = 0; i < questions.length; i += 200) {
      const rows = questions.slice(i, i + 200).map((q) => ({
        id: q.id,
        topic: q.topic,
        subtopic: q.subtopic,
        difficulty: q.difficulty,
        type: q.type,
        data: q,
        active: true,
      }));
      await tx
        .insert(quizQuestions)
        .values(rows)
        .onConflictDoUpdate({
          target: quizQuestions.id,
          set: {
            topic: sql`excluded.topic`,
            subtopic: sql`excluded.subtopic`,
            difficulty: sql`excluded.difficulty`,
            type: sql`excluded.type`,
            data: sql`excluded.data`,
            active: true,
          },
        });
    }
    // The roadmap has no say in which questions exist.
    const brokenQuiz = skipped.some((s) => s.where.startsWith('quiz/') && s.where !== ROADMAP_FILE);
    if (!brokenQuiz) {
      const ids = questions.map((q) => q.id);
      await tx
        .update(quizQuestions)
        .set({ active: false })
        .where(
          and(
            eq(quizQuestions.active, true),
            ids.length ? notInArray(quizQuestions.id, ids) : sql`true`,
          ),
        );
    }

    for (const g of games) {
      const set = { topic: g.topic, difficulty: g.difficulty, data: g, active: true };
      await tx
        .insert(quantGames)
        .values({ id: g.id, ...set })
        .onConflictDoUpdate({ target: quantGames.id, set });
    }
    // As for questions: a broken game file must not retire a game.
    if (!skipped.some((s) => s.where.startsWith('games/'))) {
      const ids = games.map((g) => g.id);
      await tx
        .update(quantGames)
        .set({ active: false })
        .where(
          and(eq(quantGames.active, true), ids.length ? notInArray(quantGames.id, ids) : sql`true`),
        );
    }
  });

  for (const s of skipped) log(`skipped ${s.where}: ${s.error}`);
  log(
    `seeded ${loaded.length} problems, ${topics.length} quiz topics, ${questions.length} quiz questions, ${games.length} games`,
  );
  return {
    problems: loaded.length,
    topics: topics.length,
    questions: questions.length,
    games: games.length,
    skipped,
  };
}
