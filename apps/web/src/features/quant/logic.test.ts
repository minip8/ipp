import { describe, expect, it } from 'vitest';
import { ApiRequestError } from '@/lib/api';
import {
  includesGame,
  loadRoundPrefs,
  PATHS,
  ROUND_OPTIONS,
  RoundPrefs,
  roundShape,
  roundStartError,
} from './logic';

describe('the paths', () => {
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
    expect(loadRoundPrefs(style)).toEqual({ durationMin: 30, interviewer: style, games: {} });
  });

  it('includes a game on the trader path unless turned off, on the researcher path only if asked', () => {
    expect(includesGame({ games: {} }, 'trader')).toBe(true);
    expect(includesGame({ games: {} }, 'researcher')).toBe(false);
    expect(includesGame({ games: { trader: false } }, 'trader')).toBe(false);
    expect(includesGame({ games: { trader: false } }, 'researcher')).toBe(false);
    expect(includesGame({ games: { researcher: true } }, 'researcher')).toBe(true);
    expect(RoundPrefs.parse({ durationMin: 45, games: { trader: 'no' } }).games).toEqual({});
    expect(RoundPrefs.parse({ games: { trader: false } }).games).toEqual({ trader: false });
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
