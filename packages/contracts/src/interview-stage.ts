/**
 * One stage of a staged interview (`interview.ts`). Kept in its own file because both `pad.ts`
 * (a stage's pad names the stage after it) and `interview.ts` need it.
 *
 * A stage is a plan, not a session: it becomes an ordinary practice pad when it starts, and
 * what it draws (the random problem, the questions, the game) is chosen then, never before.
 *
 *  coding     a coding problem with the AI interviewer: a pad of format `coding`
 *  questions  questions asked live by the AI interviewer from the chosen quiz topics, of either
 *             home: a pad of format `quant` whose round is assembled from those topics
 *  game       one market-making game against the AI interviewer: a pad of format `quant` whose
 *             round is that game alone
 */
import { z } from 'zod';
import { Language, Slug } from './common';
import { Difficulty } from './problem';
import { ProblemCategory } from './taxonomy';

export const STAGE_KINDS = ['coding', 'questions', 'game'] as const;
export const StageKind = z.enum(STAGE_KINDS);
export type StageKind = z.infer<typeof StageKind>;

export const STAGE_KIND_INFO: Record<StageKind, { label: string; description: string }> = {
  coding: {
    label: 'Coding problem',
    description: 'Solve a problem in the editor while the interviewer watches, probes and hints.',
  },
  questions: {
    label: 'Questions',
    description:
      'The interviewer asks questions from the topics you choose, one after another, and digs into your reasoning.',
  },
  game: {
    label: 'Market-making game',
    description:
      'Quote a market on hidden dice or cards; the interviewer trades against you and shows them one by one.',
  },
};

/** Stage lengths offered, in minutes, per kind (the first is not the default: see the presets). */
export const CODING_STAGE_DURATIONS = [30, 45, 60] as const;
/** 2, 3, 4 and 6 questions (`quantQuestionCount`). */
export const QUESTIONS_STAGE_DURATIONS = [15, 20, 30, 45] as const;
export const GAME_STAGE_DURATIONS = [10, 15] as const;

/** Topics one questions stage may draw from. */
export const STAGE_TOPICS_MAX = 8;

const oneOf = <T extends readonly number[]>(values: T) =>
  z.int().refine((n) => values.includes(n), {
    message: `Must be one of ${values.join(', ')} minutes`,
  });

export const CodingStage = z.object({
  kind: z.literal('coding'),
  /** A specific problem; absent, one is picked at random when the stage starts. */
  problemSlug: Slug.optional(),
  /** Narrow the random pick; ignored with a `problemSlug`. */
  difficulty: Difficulty.optional(),
  category: ProblemCategory.optional(),
  language: Language,
  durationMin: oneOf(CODING_STAGE_DURATIONS),
});
export type CodingStage = z.infer<typeof CodingStage>;

export const QuestionsStage = z.object({
  kind: z.literal('questions'),
  /** Quiz topic slugs, of either home; the round's questions are spread over them. */
  topics: z
    .array(Slug)
    .min(1)
    .max(STAGE_TOPICS_MAX)
    .refine((t) => new Set(t).size === t.length, { message: 'A topic is listed twice' }),
  durationMin: oneOf(QUESTIONS_STAGE_DURATIONS),
});
export type QuestionsStage = z.infer<typeof QuestionsStage>;

export const GameStage = z.object({
  kind: z.literal('game'),
  durationMin: oneOf(GAME_STAGE_DURATIONS),
});
export type GameStage = z.infer<typeof GameStage>;

export const InterviewStage = z.discriminatedUnion('kind', [
  CodingStage,
  QuestionsStage,
  GameStage,
]);
export type InterviewStage = z.infer<typeof InterviewStage>;
