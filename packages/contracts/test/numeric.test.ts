import { describe, expect, it } from 'vitest';
import {
  NUMERIC_INPUT_MAX,
  numericMatches,
  numericToNumber,
  PublicQuizQuestion,
  parseNumeric,
  QuizQuestion,
  QuizResponse,
  QuizTopic,
} from '../src';

const p = (s: string) => {
  const v = parseNumeric(s);
  if (!v) throw new Error(`"${s}" did not parse`);
  return v;
};
const matches = (answer: string, given: string, tolerance?: { abs?: number; rel?: number }) =>
  numericMatches(p(answer), p(given), tolerance);

describe('parseNumeric', () => {
  it('reads integers, fractions, decimals and percentages as exact rationals', () => {
    expect(p('42')).toEqual({ num: 42n, den: 1n, form: 'integer' });
    expect(p(' -7 ')).toEqual({ num: -7n, den: 1n, form: 'integer' });
    expect(p('1,000,000')).toEqual({ num: 1_000_000n, den: 1n, form: 'integer' });
    expect(p('2/6')).toEqual({ num: 1n, den: 3n, form: 'fraction' });
    expect(p('-5 / 36')).toEqual({ num: -5n, den: 36n, form: 'fraction' });
    expect(p('0.25')).toEqual({ num: 1n, den: 4n, form: 'decimal' });
    expect(p('.5')).toEqual({ num: 1n, den: 2n, form: 'decimal' });
    expect(p('3.')).toEqual({ num: 3n, den: 1n, form: 'decimal' });
    expect(p('12.5%')).toEqual({ num: 1n, den: 8n, form: 'decimal' });
    expect(p('50 %')).toEqual({ num: 1n, den: 2n, form: 'decimal' });
    expect(p('1.5e-3')).toEqual({ num: 3n, den: 2000n, form: 'decimal' });
    expect(p('2E3')).toEqual({ num: 2000n, den: 1n, form: 'decimal' });
    expect(p('−1/2')).toEqual({ num: -1n, den: 2n, form: 'fraction' });
    expect(p('0')).toEqual({ num: 0n, den: 1n, form: 'integer' });
    expect(p('-0.0')).toEqual({ num: 0n, den: 1n, form: 'decimal' });
    expect(numericToNumber(p('1/8'))).toBe(0.125);
  });

  it('rejects everything else', () => {
    for (const bad of [
      '',
      '  ',
      'abc',
      '1/0',
      '1/2/3',
      '1.5/3',
      '1/3%',
      '1 2',
      '1,00',
      '0,5',
      '1e',
      '1e99',
      '--1',
      '1+1',
      'sqrt(2)',
      '.',
      '%',
      '1/-2',
      '9'.repeat(NUMERIC_INPUT_MAX + 1),
    ]) {
      expect(parseNumeric(bad), bad).toBeNull();
    }
  });
});

describe('numericMatches', () => {
  it('accepts any exact form of the answer', () => {
    expect(matches('1/3', '2/6')).toBe(true);
    expect(matches('1/2', '0.5')).toBe(true);
    expect(matches('1/2', '50%')).toBe(true);
    expect(matches('0.25', '1/4')).toBe(true);
    expect(matches('6', '6.0')).toBe(true);
    expect(matches('1000', '1e3')).toBe(true);
  });

  it('accepts a decimal correct to three significant figures, not two', () => {
    expect(matches('1/3', '0.333')).toBe(true);
    expect(matches('1/3', '33.3%')).toBe(true);
    expect(matches('2/3', '0.667')).toBe(true);
    expect(matches('2/3', '0.666')).toBe(true);
    expect(matches('1/3', '0.33')).toBe(false);
    expect(matches('1/3', '0.3')).toBe(false);
    expect(matches('0.36787944', '0.368')).toBe(true);
    expect(matches('-7/2', '-3.5')).toBe(true);
    expect(matches('-7/2', '3.5')).toBe(false);
  });

  it('holds an integer or a fraction to the exact value', () => {
    expect(matches('1/3', '33/100')).toBe(false);
    expect(matches('1/3', '333/1000')).toBe(false);
    expect(matches('7/2', '4')).toBe(false);
  });

  it('holds every form to the exact value when the answer is a whole number', () => {
    expect(matches('252', '253')).toBe(false);
    expect(matches('252', '252.4')).toBe(false);
    expect(matches('252', '252.0')).toBe(true);
    expect(matches('0', '0.0001')).toBe(false);
  });

  it('uses the question tolerance for every form when there is one', () => {
    expect(matches('330000000', '300000000', { rel: 0.25 })).toBe(true);
    expect(matches('330000000', '200000000', { rel: 0.25 })).toBe(false);
    expect(matches('0.5', '11/20', { abs: 0.05 })).toBe(true);
    expect(matches('0.5', '0.56', { abs: 0.05 })).toBe(false);
    expect(matches('100', '104', { abs: 1, rel: 0.05 })).toBe(true);
  });
});

describe('numeric quiz contracts', () => {
  const base = {
    id: 'prob-ev-001',
    topic: 'probability',
    subtopic: 'Expectation',
    difficulty: 'easy',
    prompt: 'What is the expected value of one roll of a fair die?',
    explanation: 'The mean of 1..6.',
  };

  it('keeps an authored number as text and defaults the interview extras', () => {
    const q = QuizQuestion.parse({ ...base, type: 'numeric', answer: 3.5 });
    expect(q).toMatchObject({ type: 'numeric', answer: '3.5', hints: [], followUps: [] });
    const frac = QuizQuestion.parse({
      ...base,
      type: 'numeric',
      answer: '7/2',
      unit: 'pips',
      tolerance: { rel: 0.1 },
      hints: ['Each face is equally likely.'],
      followUps: ['And for two dice?'],
    });
    expect(frac).toMatchObject({ answer: '7/2', unit: 'pips', tolerance: { rel: 0.1 } });
  });

  it('rejects an answer that is not a number and an empty tolerance', () => {
    expect(QuizQuestion.safeParse({ ...base, type: 'numeric', answer: 'a third' }).success).toBe(
      false,
    );
    expect(
      QuizQuestion.safeParse({ ...base, type: 'numeric', answer: '1/3', tolerance: {} }).success,
    ).toBe(false);
  });

  it('short questions take hints and follow-ups', () => {
    const q = QuizQuestion.parse({
      ...base,
      type: 'short',
      reference: '3.5',
      keyPoints: ['Linearity'],
      followUps: ['What about the variance?'],
    });
    expect(q).toMatchObject({ hints: [], followUps: ['What about the variance?'] });
  });

  it('a numeric response must be a readable number', () => {
    expect(QuizResponse.parse({ type: 'numeric', value: ' 1/3 ' })).toEqual({
      type: 'numeric',
      value: '1/3',
    });
    expect(QuizResponse.safeParse({ type: 'numeric', value: 'one third' }).success).toBe(false);
    expect(QuizResponse.safeParse({ type: 'numeric', value: '' }).success).toBe(false);
  });

  it('topics default to the fundamentals track and public questions to no unit', () => {
    expect(QuizTopic.parse({ slug: 'cpp', title: 'C++', description: 'd' }).track).toBe(
      'fundamentals',
    );
    expect(
      QuizTopic.safeParse({ slug: 'p', title: 'P', description: 'd', track: 'other' }).success,
    ).toBe(false);
    const pub = PublicQuizQuestion.parse({
      id: base.id,
      topic: base.topic,
      subtopic: base.subtopic,
      difficulty: 'easy',
      type: 'numeric',
      prompt: base.prompt,
      choices: null,
      code: null,
    });
    expect(pub.unit).toBeNull();
  });
});
