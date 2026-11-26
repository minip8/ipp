/**
 * `buildQuantReport` for a round holding a market-making game (ARCHITECTURE §8.3): pure, from the
 * round's state, the bank and the games' content.
 */
import {
  advanceRound,
  createQuantRound,
  QuantGame,
  QuantReport,
  type QuantRoundState,
  type QuantRoundStep,
  quantGamePick,
  quantRoundEndsAt,
} from '@ipp/contracts';
import { describe, expect, it } from 'vitest';
import { buildQuantReport } from '../src/quant/round';

const GAME = QuantGame.parse({
  id: 'mm-game-test',
  topic: 'betting-market-making',
  title: 'Three dice',
  difficulty: 'medium',
  prompt: 'Make me a market on the sum of three dice.',
  components: [1, 2, 3].map((i) => ({ label: `Die ${i}`, faces: [1, 2, 3, 4, 5, 6] })),
  payoff: 'sum',
  reveal: [0, 1],
  tick: 0.5,
  maxSize: 5,
  counterparty: 'COUNTERPARTY-SECRET',
  hints: ['HINT-SECRET'],
  explanation: 'Fair value is 10.5.',
  expect: { fair: 10.5, sd: 2.958, min: 3, max: 18 },
});

describe('buildQuantReport with a game', () => {
  it('reviews the game from its state, with the content’s explanation and nothing secret', () => {
    const T0 = Date.parse('2026-11-26T10:00:00.000Z');
    const draws = [5.5 / 6, 1.5 / 6, 4.5 / 6]; // 6, 2, 5
    let k = 0;
    let state: QuantRoundState = createQuantRound('trader', 20, [
      quantGamePick(GAME, 'Betting & market making', () => draws[k++] ?? 0),
    ]);
    let version = 0;
    const step = (s: QuantRoundStep, sec: number) => {
      const out = advanceRound(state, s, {
        version,
        now: new Date(T0 + sec * 1000),
        roundEndsAt: quantRoundEndsAt(new Date(T0), 20),
        newId: () => '00000000-0000-4000-8000-000000000001',
      });
      if (!out.ok) throw new Error(out.reason);
      state = out.state;
      version = out.version;
    };
    step({ type: 'start', version, say: null }, 0);
    step({ type: 'quote', index: 0, bid: 9.5, ask: 11.5, size: 1 }, 10);
    step(
      {
        type: 'turn',
        version,
        index: 0,
        kind: 'chat',
        say: 'I buy one.',
        action: 'stay',
        game: { trade: { interviewerSide: 'buy', quantity: 1 } },
      },
      20,
    );
    step({ type: 'end' }, 30);

    const report = QuantReport.parse(
      buildQuantReport(state, new Map(), new Map([[GAME.id, GAME]])),
    );
    const q = report.questions[0];
    expect(q).toMatchObject({
      type: 'game',
      subtopic: '',
      solution: 'Fair value 10.5, standard deviation 2.96, from 3 to 18',
      keyPoints: [],
      explanation: 'Fair value is 10.5.',
      status: 'unfinished',
      hintsAvailable: 1,
    });
    expect(q?.game).toMatchObject({
      value: 13,
      pnl: 11.5 - 13,
      finalPosition: -1,
      expectedEdge: 1,
    });
    expect(JSON.stringify(report)).not.toMatch(/SECRET/);
    // Without the content the review still stands; only the explanation is missing.
    expect(buildQuantReport(state, new Map()).questions[0]?.explanation).toBe('');
  });
});
