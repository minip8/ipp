import {
  createGameState,
  gameReview,
  postQuote,
  type QuantQuestionReview,
  type QuantReport,
  revealNext,
  settleGame,
  tradeQuote,
} from '@ipp/contracts';
import { describe, expect, it } from 'vitest';
import {
  answeredDetail,
  FAIR_SIDE_LABEL,
  fairSide,
  hintsLabel,
  pnlParts,
  quoteRows,
  quoteSummary,
  REVEAL_TONE,
  revealRows,
  roundFigures,
  scoreView,
  signTone,
  timeLabel,
} from './quant-logic';

const review = (over: Partial<QuantQuestionReview>): QuantQuestionReview => ({
  index: 0,
  questionId: 'q',
  topic: 'probability',
  topicTitle: 'Probability',
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
  hintRungs: [],
  followUpAsked: false,
  timeSec: 60,
  budgetSec: 420,
  game: null,
  ...over,
});

describe('a quant report', () => {
  it('sums the round: answered, mean of the judged scores, hints over posed questions', () => {
    const report: QuantReport = {
      mode: 'ai',
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
      timedOut: 1,
      judged: 2,
      hintsGiven: 3,
      hintsAvailable: 7,
    });
    expect(f.meanScore).toBeCloseTo(0.6);
    expect(roundFigures({ mode: 'ai', path: 'trader', questions: [] }).meanScore).toBeNull();
    expect(answeredDetail(f)).toBe('3 asked · 1 timed out · 1 not reached');
    expect(
      answeredDetail(roundFigures({ mode: 'ai', path: 'trader', questions: [review({})] })),
    ).toBe('1 asked');
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

describe('a market-making game’s review', () => {
  const DIE = [1, 2, 3, 4, 5, 6];
  const at = (s: number) => new Date(Date.UTC(2026, 0, 1, 12, 0, s));
  /**
   * The engine's own review of a game played to the end: three dice [6, 2, 5] (worth 13), Die 1
   * then Die 2 shown. A market at 9.5 – 11.5 lifted for 2; Die 1 (6) shown; a market at 12 – 13
   * hit for 3; another left at 12 – 13 when Die 2 (2) is shown; then 10 – 11 that nobody trades.
   */
  function played() {
    let s = createGameState(
      {
        title: 'Sum of three dice',
        components: [1, 2, 3].map((i) => ({ label: `Die ${i}`, faces: DIE })),
        payoff: 'sum',
        reveal: [0, 1],
        tick: 0.5,
        maxSize: 5,
      },
      [6, 2, 5],
    );
    const step = (out: ReturnType<typeof postQuote>) => {
      if (!out.ok) throw new Error(out.reason);
      s = out.state;
    };
    step(postQuote(s, { bid: 9.5, ask: 11.5, size: 2 }, at(1)));
    step(tradeQuote(s, { interviewerSide: 'buy', quantity: 2 }, at(2)));
    step(revealNext(s, at(3)));
    step(postQuote(s, { bid: 12, ask: 13, size: 3 }, at(4)));
    step(tradeQuote(s, { interviewerSide: 'sell', quantity: 3 }, at(5)));
    step(postQuote(s, { bid: 12, ask: 13, size: 1 }, at(6)));
    step(revealNext(s, at(7)));
    step(postQuote(s, { bid: 10, ask: 11, size: 1 }, at(8)));
    step(settleGame(s, at(9)));
    return gameReview(s);
  }

  it('lists each market with its width in standard deviations and where fair value was', () => {
    const rows = quoteRows(played());
    expect(rows.map((r) => [r.n, r.width, r.fair, r.side, r.traded])).toEqual([
      [1, 2, 10.5, 'inside', true],
      [2, 1, 13, 'inside', true],
      [3, 1, 13, 'inside', false],
      [4, 1, 11.5, 'above', false],
    ]);
    expect(rows[0]?.widthSd).toBeCloseTo(2 / 2.958, 3);
    expect(fairSide({ bid: 12, ask: 13, fair: 11.5 })).toBe('below');
    expect(FAIR_SIDE_LABEL.above).toBe('Above your offer');
  });

  it('sums the markets', () => {
    const s = quoteSummary(played());
    expect(s).toMatchObject({ count: 4, inside: 3, traded: 2, meanWidth: 1.25 });
    expect(s?.meanWidthSd).toBeGreaterThan(0);
    expect(quoteSummary({ quotes: [] })).toBeNull();
  });

  it('compares the mid’s move on each reveal with the fair value’s', () => {
    const rows = revealRows(played());
    // Die 1 = 6: fair 10.5 → 13, mid 10.5 → 12.5 (80%). Die 2 = 2: fair 13 → 11.5, mid 12.5 → 10.5.
    expect(rows.map((r) => [r.label, r.fairMove, r.midMove, r.verdict])).toEqual([
      ['Die 1', 2.5, 2, 'followed'],
      ['Die 2', -1.5, -2, 'overshot'],
    ]);
    expect(rows[0]?.verdictLabel).toBe('Moved with it');
    expect(rows[1]?.verdictLabel).toBe('Moved too far (133%)');
    const verdict = (fairAfter: number, midAfter: number | null, midBefore: number | null = 10) =>
      revealRows({
        reveals: [
          {
            at: at(0).toISOString(),
            component: 0,
            label: 'Die 1',
            value: 6,
            fairBefore: 10,
            fairAfter,
            midBefore,
            midAfter,
          },
        ],
      })[0];
    expect(verdict(12, 11)).toMatchObject({ verdict: 'partly', share: 0.5 });
    expect(verdict(12, 10.25)).toMatchObject({ verdict: 'barely' });
    expect(verdict(12, 9)).toMatchObject({ verdict: 'wrong_way' });
    expect(verdict(10, 11)).toMatchObject({ verdict: 'no_change', share: null });
    expect(verdict(12, null)).toMatchObject({
      verdict: 'no_quote',
      verdictLabel: 'No market after it',
    });
    expect(verdict(12, 11, null)).toMatchObject({ verdictLabel: 'No market before it' });
    expect(REVEAL_TONE.followed).toBe('ok');
  });

  it('splits the P&L into the expected edge and what luck added', () => {
    const g = played();
    // Sold 2 at 11.5 against 10.5 (+2), bought 3 at 12 against 13 (+3); long 1 at 13 with −13 cash.
    expect(g.expectedEdge).toBe(5);
    expect(pnlParts(g)).toEqual({ expectedEdge: 5, pnl: 0, luck: -5 });
    expect(pnlParts({ expectedEdge: 0.1, pnl: 0.3 }).luck).toBe(0.2);
    expect(signTone(2)).toBe('ok');
    expect(signTone(-0.5)).toBe('bad');
    expect(signTone(0)).toBe('neutral');
  });
});
