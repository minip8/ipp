/**
 * The quiz roadmap: each topic's study areas (stored on `quiz_topics.roadmap` by the seed) with
 * the user's progress, counted from the same latest graded answers as the topic stats.
 */
import type { QuizProgress, QuizRoadmapNode, QuizRoadmapTopic } from '@ipp/contracts';
import { type Db, quizQuestions, quizTopics } from '@ipp/db';
import { and, asc, eq, inArray, or, sql } from '@ipp/db/orm';
import { badRequest } from '../http/errors';
import { latestAnswers } from './answers';

/** One subtopic of one topic: its active questions and the user's latest graded answers to them. */
export interface SubtopicCounts {
  topic: string;
  subtopic: string;
  questionCount: number;
  shortCount: number;
  answered: number;
  correct: number;
  /** sum of the answered questions' scores */
  scoreSum: number;
}

export async function subtopicCounts(db: Db, userId: string): Promise<SubtopicCounts[]> {
  const latest = db.$with('latest').as(latestAnswers(db, userId, { graded: true }));
  const n = (v: unknown) => Number(v ?? 0);
  return db
    .with(latest)
    .select({
      topic: quizQuestions.topic,
      subtopic: quizQuestions.subtopic,
      questionCount: sql<number>`count(*)`.mapWith(n),
      shortCount: sql<number>`count(*) filter (where ${quizQuestions.type} = 'short')`.mapWith(n),
      answered: sql<number>`count(${latest.questionId})`.mapWith(n),
      correct: sql<number>`count(*) filter (where ${latest.correct})`.mapWith(n),
      scoreSum: sql<number>`coalesce(sum(${latest.score}), 0)`.mapWith(n),
    })
    .from(quizQuestions)
    .leftJoin(latest, eq(latest.questionId, quizQuestions.id))
    .where(eq(quizQuestions.active, true))
    .groupBy(quizQuestions.topic, quizQuestions.subtopic);
}

const EMPTY: Omit<SubtopicCounts, 'topic' | 'subtopic'> = {
  questionCount: 0,
  shortCount: 0,
  answered: 0,
  correct: 0,
  scoreSum: 0,
};

export function progressOf(
  rows: readonly Omit<SubtopicCounts, 'topic' | 'subtopic'>[],
): QuizProgress {
  const t = rows.reduce(
    (s, r) => ({
      questionCount: s.questionCount + r.questionCount,
      shortCount: s.shortCount + r.shortCount,
      answered: s.answered + r.answered,
      correct: s.correct + r.correct,
      scoreSum: s.scoreSum + r.scoreSum,
    }),
    EMPTY,
  );
  return {
    questionCount: t.questionCount,
    shortCount: t.shortCount,
    answered: t.answered,
    correct: t.correct,
    accuracy: t.answered > 0 ? t.scoreSum / t.answered : null,
  };
}

type TopicRow = Pick<
  typeof quizTopics.$inferSelect,
  'slug' | 'title' | 'description' | 'track' | 'also' | 'roadmap'
>;

/** Topics (already in study order) with their nodes and progress. */
export function roadmapTopics(
  topics: readonly TopicRow[],
  counts: readonly SubtopicCounts[],
): QuizRoadmapTopic[] {
  return topics.map((t) => {
    const of = new Map(counts.filter((c) => c.topic === t.slug).map((c) => [c.subtopic, c]));
    const nodes = t.roadmap.map((n) => {
      const subtopics = n.subtopics.map((s) => ({
        subtopic: s,
        ...progressOf([of.get(s) ?? EMPTY]),
      }));
      return {
        id: n.id,
        title: n.title,
        description: n.description,
        requires: n.requires,
        // Absent on a roadmap stored before the field existed (until the next seed).
        related: n.related ?? [],
        subtopics,
        ...progressOf(n.subtopics.map((s) => of.get(s) ?? EMPTY)),
      };
    });
    return {
      slug: t.slug,
      title: t.title,
      description: t.description,
      track: t.track,
      also: t.also,
      // The whole topic, including any subtopic not (yet) on its roadmap.
      ...progressOf([...of.values()]),
      nodes,
    };
  });
}

export async function loadRoadmapTopics(db: Db, slugs?: string[]): Promise<TopicRow[]> {
  return db
    .select({
      slug: quizTopics.slug,
      title: quizTopics.title,
      description: quizTopics.description,
      track: quizTopics.track,
      also: quizTopics.also,
      roadmap: quizTopics.roadmap,
    })
    .from(quizTopics)
    .where(slugs ? inArray(quizTopics.slug, slugs) : undefined)
    .orderBy(asc(quizTopics.position), asc(quizTopics.title));
}

/**
 * The question filter for an attempt narrowed to roadmap nodes: each node narrows its own topic to
 * its subtopics, and a requested topic with no node listed is taken whole. 400 for a node that is
 * not on the roadmap of one of `topics`.
 */
export async function nodeFilter(db: Db, topics: string[], nodeIds: string[]) {
  const rows = await loadRoadmapTopics(db, topics);
  const nodes = new Map<string, { topic: string; node: QuizRoadmapNode }>();
  for (const t of rows) for (const n of t.roadmap) nodes.set(n.id, { topic: t.slug, node: n });
  const narrowed = new Map<string, Set<string>>();
  for (const id of new Set(nodeIds)) {
    const found = nodes.get(id);
    if (!found) throw badRequest('Unknown roadmap node for these topics', 'unknown_node');
    const set = narrowed.get(found.topic) ?? new Set<string>();
    for (const s of found.node.subtopics) set.add(s);
    narrowed.set(found.topic, set);
  }
  return or(
    ...topics.map((t) => {
      const subtopics = narrowed.get(t);
      return subtopics
        ? and(eq(quizQuestions.topic, t), inArray(quizQuestions.subtopic, [...subtopics]))
        : eq(quizQuestions.topic, t);
    }),
  );
}
