/** Pure helpers for the Quant page: the chosen path, its topics in order, and where each leads. */
import { QUANT_PATH_INFO, QUANT_PATHS, type QuantPath, type QuizTopicStats } from '@ipp/contracts';
import { bankHref } from '@/features/quiz/bank-logic';
import { type NodeState, nodeState, ROADMAP_TOPIC_PARAM } from '@/features/quiz/roadmap-logic';

/** Where the chosen path lives in the URL; the first path is the default and leaves it out. */
export const PATH_PARAM = 'path';

/** The paths in tab order (the first is the default). */
export const PATHS: readonly [QuantPath, ...QuantPath[]] = QUANT_PATHS;

export interface PathStep {
  topic: QuizTopicStats;
  /** 1-based position on the path, counting only the topics the server has */
  position: number;
  /** complete as a roadmap area is: every question answered, at the roadmap's accuracy */
  state: NodeState;
  /** the first topic on the path that is not complete (and has questions) */
  next: boolean;
}

/**
 * The path's topics in its order, each with its state. A topic the server did not return is
 * skipped (and the rest renumbered), so a path can name a topic before its content is loaded.
 */
export function pathSteps(path: QuantPath, topics: readonly QuizTopicStats[]): PathStep[] {
  const bySlug = new Map(topics.map((t) => [t.slug, t]));
  const found = QUANT_PATH_INFO[path].topics
    .map((slug) => bySlug.get(slug))
    .filter((t): t is QuizTopicStats => t !== undefined);
  const states = found.map((t) => nodeState(t));
  const next = found.findIndex((t, i) => t.questionCount > 0 && states[i] !== 'complete');
  return found.map((topic, i) => ({
    topic,
    position: i + 1,
    state: states[i] ?? 'not_started',
    next: i === next,
  }));
}

/** How many questions a practice round on the topic can draw on (open ones are discussed). */
export const practiceCount = (t: Pick<QuizTopicStats, 'questionCount' | 'shortCount'>) =>
  t.questionCount - t.shortCount;

/** The open questions along a path, for one discussion: the topics that have any, and how many. */
export function discussionPool(steps: readonly PathStep[]): {
  topics: string[];
  questions: number;
} {
  const open = steps.filter((s) => s.topic.shortCount > 0);
  return {
    topics: open.map((s) => s.topic.slug),
    questions: open.reduce((n, s) => n + s.topic.shortCount, 0),
  };
}

/** "Probability, Statistics and Options" */
export function listTitles(titles: readonly string[]): string {
  if (titles.length <= 1) return titles[0] ?? '';
  return `${titles.slice(0, -1).join(', ')} and ${titles.at(-1)}`;
}

/** A topic's whole bank. */
export const topicBankHref = (slug: string) => bankHref(slug);

/** A topic's roadmap: the Quizzes page's Roadmap view (`VIEW_PARAM` in page-tabs) on it. */
export function topicRoadmapHref(slug: string): string {
  const q = new URLSearchParams({ view: 'roadmap', [ROADMAP_TOPIC_PARAM]: slug });
  return `/quiz?${q}`;
}
