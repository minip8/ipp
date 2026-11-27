import { QUANT_PATH_INFO, type QuizTopicStats } from '@ipp/contracts';
import { describe, expect, it } from 'vitest';
import {
  interviewPool,
  listTitles,
  pathSteps,
  pathTopicSlugs,
  pickPath,
  topicBankHref,
  topicRoadmapHref,
  trackPaths,
} from './logic';

const TRADER = QUANT_PATH_INFO.trader.topics;

const topic = (slug: string, over: Partial<QuizTopicStats> = {}): QuizTopicStats => ({
  slug,
  title: slug,
  description: '',
  track: 'quant',
  also: [],
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
    const steps = pathSteps(QUANT_PATH_INFO.researcher.topics, [...ALL].reverse());
    expect(steps.map((s) => s.topic.slug)).toEqual(QUANT_PATH_INFO.researcher.topics);
    expect(steps.map((s) => s.position)).toEqual([1, 2, 3, 4]);
  });

  it('skips a topic the server does not have and renumbers the rest', () => {
    const steps = pathSteps(
      TRADER,
      ALL.filter((t) => t.slug !== 'brainteasers'),
    );
    expect(steps.map((s) => [s.position, s.topic.slug])).toEqual([
      [1, 'probability'],
      [2, 'betting-market-making'],
      [3, 'options'],
    ]);
  });

  it('is empty when none of the path is there', () => {
    expect(pathSteps(TRADER, [topic('cpp')])).toEqual([]);
    expect(pathSteps(TRADER, [])).toEqual([]);
  });

  it('marks the first topic that is not complete as next up', () => {
    const steps = pathSteps(TRADER, [
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
    const empty = pathSteps(TRADER, [
      topic('probability', { questionCount: 0, shortCount: 0 }),
      topic('brainteasers'),
    ]);
    expect(empty.map((s) => s.next)).toEqual([false, true]);
    const done = pathSteps(
      TRADER,
      ALL.map((t) => ({ ...t, answered: t.questionCount, accuracy: 0.9 })),
    );
    expect(done.every((s) => s.state === 'complete' && !s.next)).toBe(true);
  });
});

describe('the rest', () => {
  it('pools the topics with open questions, for one interview', () => {
    const steps = pathSteps(TRADER, [
      topic('probability', { shortCount: 4 }),
      topic('brainteasers', { shortCount: 0 }),
      topic('options', { shortCount: 7 }),
    ]);
    expect(interviewPool(steps)).toEqual({
      topics: ['probability', 'options'],
      titles: ['probability', 'options'],
    });
    expect(interviewPool([])).toEqual({ topics: [], titles: [] });
  });

  it('joins titles for a sentence', () => {
    expect(listTitles([])).toBe('');
    expect(listTitles(['Probability'])).toBe('Probability');
    expect(listTitles(['Probability', 'Options'])).toBe('Probability and Options');
    expect(listTitles(['A', 'B', 'C'])).toBe('A, B and C');
  });

  it('links to the bank and to the topic maps of the track', () => {
    expect(topicBankHref('options')).toBe('/quiz/topics/options');
    expect(topicRoadmapHref('quant', 'betting-market-making')).toBe(
      '/quant/roadmap?view=maps&roadmap=betting-market-making',
    );
    expect(topicRoadmapHref('software', 'cpp')).toBe('/software/roadmap?view=maps&roadmap=cpp');
  });
});

describe("a track's paths", () => {
  it('gives Quant its two curated paths and Software one of all its topics', () => {
    expect(trackPaths('quant').map((p) => p.id)).toEqual(['trader', 'researcher']);
    expect(trackPaths('software').map((p) => p.id)).toEqual(['software']);
    expect(pickPath('quant', 'researcher').id).toBe('researcher');
    expect(pickPath('quant', 'quant-dev').id).toBe('trader');
    expect(pickPath('quant', null).id).toBe('trader');
    expect(pickPath('software', 'trader').id).toBe('software');
  });

  it('walks Software in the server order, a shared topic included, and Quant as curated', () => {
    const shared = topic('python', { track: 'fundamentals', also: ['quant'] });
    const topics = [topic('cpp', { track: 'fundamentals' }), shared, ...ALL.slice(0, 6)];
    expect(pathTopicSlugs(pickPath('software', null), topics, 'software')).toEqual([
      'cpp',
      'python',
    ]);
    // Python shows in the Quant track but is on neither curated path.
    const trader = pathTopicSlugs(pickPath('quant', 'trader'), topics, 'quant');
    expect(trader).toEqual(TRADER);
    expect(pathSteps(trader, topics).map((s) => s.topic.slug)).not.toContain('python');
  });
});
