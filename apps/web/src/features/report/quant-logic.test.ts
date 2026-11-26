import type { QuantQuestionReview, QuantReport } from '@ipp/contracts';
import { describe, expect, it } from 'vitest';
import { hintsLabel, roundFigures, scoreView, timeLabel } from './quant-logic';

const review = (over: Partial<QuantQuestionReview>): QuantQuestionReview => ({
  index: 0,
  questionId: 'q',
  topic: 'probability',
  subtopic: 's',
  difficulty: 'easy',
  type: 'numeric',
  prompt: 'p',
  unit: null,
  solution: '1',
  keyPoints: [],
  explanation: '',
  status: 'answered',
  verdict: null,
  hintsGiven: 0,
  hintsAvailable: 2,
  timeSec: 60,
  budgetSec: 420,
  ...over,
});

describe('a quant report', () => {
  it('sums the round: answered, mean of the judged scores, hints over posed questions', () => {
    const report: QuantReport = {
      path: 'trader',
      questions: [
        review({ verdict: { score: 0.9, summary: '' }, hintsGiven: 1 }),
        review({ status: 'timed_out', verdict: { score: 0.3, summary: '' }, hintsGiven: 2 }),
        review({ status: 'unfinished', hintsAvailable: 3 }),
        review({ status: 'not_reached', hintsAvailable: 4, timeSec: null, budgetSec: null }),
      ],
    };
    const f = roundFigures(report);
    expect(f).toMatchObject({
      total: 4,
      posed: 3,
      answered: 1,
      judged: 2,
      hintsGiven: 3,
      hintsAvailable: 7,
    });
    expect(f.meanScore).toBeCloseTo(0.6);
    expect(roundFigures({ path: 'trader', questions: [] }).meanScore).toBeNull();
  });

  it('shows scores as percentages with a tone', () => {
    expect(scoreView(0.85)).toEqual({ label: '85%', tone: 'ok' });
    expect(scoreView(0.45)).toEqual({ label: '45%', tone: 'warn' });
    expect(scoreView(0.2)).toEqual({ label: '20%', tone: 'bad' });
  });

  it('counts hints against the written ladder, or alone when the interviewer added its own', () => {
    expect(hintsLabel({ hintsGiven: 2, hintsAvailable: 4 })).toBe('2 of 4 hints');
    expect(hintsLabel({ hintsGiven: 0, hintsAvailable: 1 })).toBe('0 of 1 hint');
    expect(hintsLabel({ hintsGiven: 3, hintsAvailable: 2 })).toBe('3 hints');
    expect(hintsLabel({ hintsGiven: 1, hintsAvailable: 0 })).toBe('1 hint');
  });

  it('puts the time against the budget', () => {
    expect(timeLabel({ timeSec: 312, budgetSec: 420 })).toEqual({
      label: '5:12 of 7:00',
      over: false,
    });
    expect(timeLabel({ timeSec: 500, budgetSec: 420 })?.over).toBe(true);
    expect(timeLabel({ timeSec: null, budgetSec: 420 })).toEqual({
      label: '7:00 given',
      over: false,
    });
    expect(timeLabel({ timeSec: null, budgetSec: null })).toBeNull();
  });
});
