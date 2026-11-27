/** The pure rules of a staged interview's server side (unit-tested in test/interviews.test.ts). */
import { type InterviewStage, presetById, type StageKind } from '@ipp/contracts';
import type { StagePosition } from '../interviewer/types';

/** Topic titles named in a pad's title before the rest are counted ("C++, Concurrency + 2 more"). */
const TITLE_TOPICS = 3;

/** A questions stage's pad title: its topics' titles, in the stage's order, shortened past three. */
export function topicsTitle(titles: readonly string[]): string {
  if (titles.length <= TITLE_TOPICS) return titles.join(', ');
  return `${titles.slice(0, TITLE_TOPICS - 1).join(', ')} + ${titles.length - (TITLE_TOPICS - 1)} more`;
}

export const GAME_STAGE_TITLE = 'Market-making game';

/** The interview's title: the one given, else its preset's label, else a plain name. */
export function interviewTitle(given: string | undefined, preset: string | null): string {
  return given?.trim() || presetById(preset)?.label || 'Custom interview';
}

/** How an error names a stage: "Stage 2". */
export const stageName = (index: number) => `Stage ${index + 1}`;

/**
 * Where a stage's pad sits for its interviewer (`StagePosition`); null for an interview of one
 * stage, which the interviewer runs as any pad, or an index the plan does not have.
 */
export function stagePosition(
  stages: readonly Pick<InterviewStage, 'kind'>[],
  index: number,
): StagePosition | null {
  if (stages.length <= 1 || index < 0 || index >= stages.length) return null;
  const next: StageKind | null = stages[index + 1]?.kind ?? null;
  return { index, total: stages.length, next };
}
