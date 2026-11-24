import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { ProblemContent, QuizQuestion, type QuizTopic } from '@ipp/contracts';
import {
  createDb,
  ensureDatabase,
  problems,
  problemTests,
  quizQuestions,
  quizTopics,
  runMigrations,
} from '@ipp/db';
import { sql } from '@ipp/db/orm';
import { TEST_DATABASE_URL } from './env';
import { QUIZ_FIXTURE, QUIZ_TOPIC } from './fixtures';

const require = createRequire(import.meta.url);
const fixturesDir = join(dirname(require.resolve('@ipp/contracts/fixtures/problem-two-sum.json')));

export default async function setup() {
  await ensureDatabase(TEST_DATABASE_URL);
  await runMigrations(TEST_DATABASE_URL);
  const h = createDb(TEST_DATABASE_URL, { max: 1 });
  try {
    await h.db.execute(
      sql`truncate "user", problems, problem_tests, quiz_topics, quiz_questions cascade`,
    );
    for (const name of ['problem-two-sum', 'problem-lru-cache']) {
      const p = ProblemContent.parse(
        JSON.parse(readFileSync(join(fixturesDir, `${name}.json`), 'utf8')),
      );
      await h.db.insert(problems).values({
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
        source: p.source ?? null,
      });
      await h.db
        .insert(problemTests)
        .values(p.tests.map((t, idx) => ({ problemSlug: p.slug, idx, hidden: t.hidden, data: t })));
    }
    const topic: QuizTopic = QUIZ_TOPIC;
    await h.db.insert(quizTopics).values(topic);
    for (const raw of QUIZ_FIXTURE) {
      const q = QuizQuestion.parse(raw);
      await h.db.insert(quizQuestions).values({
        id: q.id,
        topic: q.topic,
        subtopic: q.subtopic,
        difficulty: q.difficulty,
        type: q.type,
        data: q,
      });
    }
  } finally {
    await h.close();
  }
}
