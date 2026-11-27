/**
 * The interview presets (@ipp/contracts `INTERVIEW_PRESETS`) name quiz topics by slug. The
 * contracts cannot see the content, so this is where a preset that names a topic the bank does
 * not have, or one too thin to fill its stage, is caught.
 */
import {
  INTERVIEW_PRESETS,
  LANGUAGE_TOPIC,
  LANGUAGES,
  presetStages,
  stageQuestionCount,
} from '@ipp/contracts';
import { describe, expect, it } from 'vitest';
import { loadProblems, loadQuantGames, loadQuizQuestions, loadQuizTopics } from '../src';

const topics = new Set(loadQuizTopics().map((t) => t.slug));
const questions = loadQuizQuestions();
const problems = loadProblems();
const games = loadQuantGames();

/** What a round may ask: `short` questions, and `numeric` ones with hints or follow-ups. */
const askable = (topic: string) =>
  questions.filter(
    (q) =>
      q.topic === topic &&
      (q.type === 'short' ||
        (q.type === 'numeric' && (q.hints ?? []).length + (q.followUps ?? []).length > 0)),
  ).length;

describe('interview presets', () => {
  it('a language topic is a topic of the bank', () => {
    for (const slug of Object.values(LANGUAGE_TOPIC)) expect(topics.has(slug)).toBe(true);
  });

  for (const preset of INTERVIEW_PRESETS) {
    for (const language of LANGUAGES) {
      it(`${preset.id} (${language}) can be filled from the content`, () => {
        for (const stage of presetStages(preset, language)) {
          if (stage.kind === 'questions') {
            for (const topic of stage.topics) expect(topics.has(topic), topic).toBe(true);
            const pool = stage.topics.reduce((n, t) => n + askable(t), 0);
            // Several rounds' worth, so recently posed questions can be left out.
            expect(pool).toBeGreaterThanOrEqual(6 * (stageQuestionCount(stage) ?? 0));
          } else if (stage.kind === 'game') {
            expect(games.length).toBeGreaterThan(0);
          } else {
            const matching = problems.filter(
              (p) =>
                (!stage.difficulty || p.difficulty === stage.difficulty) &&
                (!stage.category || p.category === stage.category) &&
                (p.languages ?? LANGUAGES).includes(stage.language),
            );
            expect(matching.length).toBeGreaterThan(0);
          }
        }
      });
    }
  }
});
