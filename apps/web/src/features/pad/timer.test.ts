import { describe, expect, it } from 'vitest';
import { timerView } from './timer';

const start = Date.parse('2026-01-01T10:00:00.000Z');
const pad = (durationMin: number | null, endedAt: string | null = null) => ({
  startedAt: new Date(start).toISOString(),
  endedAt,
  durationMin,
  status: endedAt ? ('ended' as const) : ('active' as const),
});
const min = (m: number) => start + m * 60_000;

describe('pad timer', () => {
  it('counts down to the planned end, warns near it and counts over after', () => {
    expect(timerView(pad(45), min(10))).toEqual({
      label: '35:00',
      elapsed: false,
      over: false,
      warn: false,
    });
    expect(timerView(pad(45), min(41))).toMatchObject({ label: '4:00', warn: true, over: false });
    expect(timerView(pad(45), min(47))).toMatchObject({ label: '+2:00', warn: false, over: true });
  });

  it('with no time limit shows the time elapsed and never warns', () => {
    expect(timerView(pad(null), min(10))).toEqual({
      label: '10:00',
      elapsed: true,
      over: false,
      warn: false,
    });
    expect(timerView(pad(null), min(200))).toMatchObject({ over: false, warn: false });
    // A clock that is behind the server never shows a negative time.
    expect(timerView(pad(null), start - 5000).label).toBe('0:00');
  });

  it('stops at the end of an ended pad', () => {
    const ended = pad(null, new Date(min(30)).toISOString());
    expect(timerView(ended, min(500)).label).toBe('30:00');
  });
});
