import { QUANT_PATH_INFO, type QuizTopicStats } from '@ipp/contracts';
import { describe, expect, it } from 'vitest';
import { ApiRequestError } from '@/lib/api';
import {
  discussionPool,
  listTitles,
  loadRoundPrefs,
  PATHS,
  pathSteps,
  practiceCount,
  ROUND_OPTIONS,
  roundShape,
  roundStartError,
  topicBankHref,
  topicRoadmapHref,
} from './logic';

const topic = (slug: string, over: Partial<QuizTopicStats> = {}): QuizTopicStats => ({
  slug,
  title: slug,
  description: '',
  track: 'quant',
  questionCount: 10,
  shortCount: 2,
  answered: 0,
  accuracy: null,
  ...over,
});

const ALL = [
  topic('probability'),
  topic('brainteasers'),
  topic('betting-market-making'),
  topic('options'),
  topic('statistics'),
  topic('algebra-calculus'),
  topic('cpp', { track: 'fundamentals' }),
];

describe('pathSteps', () => {
  it('lists the path topics in the path order, not the server order', () => {
    const steps = pathSteps('researcher', [...ALL].reverse());
    expect(steps.map((s) => s.topic.slug)).toEqual(QUANT_PATH_INFO.researcher.topics);
    expect(steps.map((s) => s.position)).toEqual([1, 2, 3, 4]);
  });

  it('skips a topic the server does not have and renumbers the rest', () => {
    const steps = pathSteps(
      'trader',
      ALL.filter((t) => t.slug !== 'brainteasers'),
    );
    expect(steps.map((s) => [s.position, s.topic.slug])).toEqual([
      [1, 'probability'],
      [2, 'betting-market-making'],
      [3, 'options'],
    ]);
  });

  it('is empty when none of the path is there', () => {
    expect(pathSteps('trader', [topic('cpp')])).toEqual([]);
    expect(pathSteps('trader', [])).toEqual([]);
  });

  it('marks the first topic that is not complete as next up', () => {
    const steps = pathSteps('trader', [
      // complete: everything answered at the roadmap's accuracy
      topic('probability', { answered: 10, accuracy: 0.8 }),
      // everything answered but below it: not complete, so next up
      topic('brainteasers', { answered: 10, accuracy: 0.5 }),
      topic('betting-market-making', { answered: 3, accuracy: 1 }),
      topic('options'),
    ]);
    expect(steps.map((s) => s.state)).toEqual([
      'complete',
      'in_progress',
      'in_progress',
      'not_started',
    ]);
    expect(steps.map((s) => s.next)).toEqual([false, true, false, false]);
  });

  it('passes over a topic with no questions, and has no next up once all are complete', () => {
    const empty = pathSteps('trader', [
      topic('probability', { questionCount: 0, shortCount: 0 }),
      topic('brainteasers'),
    ]);
    expect(empty.map((s) => s.next)).toEqual([false, true]);
    const done = pathSteps(
      'trader',
      ALL.map((t) => ({ ...t, answered: t.questionCount, accuracy: 0.9 })),
    );
    expect(done.every((s) => s.state === 'complete' && !s.next)).toBe(true);
  });
});

describe('the rest', () => {
  it('pools the open questions of the topics that have any', () => {
    const steps = pathSteps('trader', [
      topic('probability', { shortCount: 4 }),
      topic('brainteasers', { shortCount: 0 }),
      topic('options', { shortCount: 7 }),
    ]);
    expect(discussionPool(steps)).toEqual({ topics: ['probability', 'options'], questions: 11 });
    expect(discussionPool([])).toEqual({ topics: [], questions: 0 });
  });

  it('counts what a practice round can draw on', () => {
    expect(practiceCount({ questionCount: 80, shortCount: 15 })).toBe(65);
  });

  it('joins titles for a sentence', () => {
    expect(listTitles([])).toBe('');
    expect(listTitles(['Probability'])).toBe('Probability');
    expect(listTitles(['Probability', 'Options'])).toBe('Probability and Options');
    expect(listTitles(['A', 'B', 'C'])).toBe('A, B and C');
  });

  it('links to the bank and the roadmap', () => {
    expect(topicBankHref('options')).toBe('/quiz/topics/options');
    expect(topicRoadmapHref('betting-market-making')).toBe(
      '/quiz?view=roadmap&roadmap=betting-market-making',
    );
  });

  it('starts on the trader path', () => {
    expect(PATHS[0]).toBe('trader');
    expect(PATHS).toEqual(['trader', 'researcher']);
  });
});

describe('the live round', () => {
  it('offers three lengths with the questions each asks', () => {
    expect(ROUND_OPTIONS).toEqual([
      { durationMin: 20, questions: 3 },
      { durationMin: 30, questions: 4 },
      { durationMin: 45, questions: 6 },
    ]);
    expect(roundShape(30)).toBe('4 questions, about 8 minutes each');
  });

  it('keeps the last setup, starting from the coding setup’s interviewer', () => {
    const style = { style: 'tough', proactivity: 'high', voice: false } as const;
    expect(loadRoundPrefs(style)).toEqual({ durationMin: 30, interviewer: style });
  });

  it('says why a round could not start', () => {
    const err = (status: number, code: string, retryAfter?: number) =>
      new ApiRequestError(status, code, 'server says', retryAfter);
    expect(roundStartError(err(409, 'ai_key_missing'), 30)).toContain('own AI API key');
    expect(roundStartError(err(409, 'quant_unavailable'), 45)).toBe(
      'This path does not have enough questions for a 6-question round yet. Try a shorter round.',
    );
    expect(roundStartError(err(429, 'rate_limited', 30), 30)).toBe(
      'You have started a lot of interviews in a short time. You can start another in 30s.',
    );
    expect(roundStartError(err(429, 'rate_limited'), 30)).toContain('Try again in a few minutes');
    expect(roundStartError(err(500, 'boom'), 30)).toBe('server says');
  });
});
