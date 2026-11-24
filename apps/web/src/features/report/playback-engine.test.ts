import { type Playback, type TimelineEvent, YDOC } from '@ipp/contracts';
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import {
  activityHistogram,
  countAtTime,
  decodeUpdates,
  languageAt,
  PlaybackEngine,
  stepTime,
  timelineSpan,
} from './playback-engine';

const T0 = Date.parse('2026-11-20T15:00:00.000Z');
const at = (sec: number) => new Date(T0 + sec * 1000).toISOString();

/** Builds a history where update i (1-based) makes the python buffer equal to "x" repeated i times. */
function history(n: number): Playback['updates'] {
  const doc = new Y.Doc();
  const out: Playback['updates'] = [];
  let sec = 0;
  doc.on('update', (u: Uint8Array) => {
    out.push({ seq: out.length + 1, at: at(sec), update: Buffer.from(u).toString('base64') });
  });
  for (let i = 1; i <= n; i++) {
    sec = i * 10;
    doc.getText(YDOC.code('python')).insert(i - 1, 'x');
  }
  return out;
}

describe('PlaybackEngine', () => {
  it('reconstructs the text after any number of updates', () => {
    const engine = new PlaybackEngine(history(50), 8);
    for (const n of [0, 1, 7, 8, 9, 33, 50]) {
      engine.seek(n);
      expect(engine.code('python')).toBe('x'.repeat(n));
    }
  });

  it('applies only new updates when moving forward', () => {
    const engine = new PlaybackEngine(history(30), 10);
    engine.seek(20);
    const before = engine.appliedTotal;
    engine.seek(25);
    expect(engine.appliedTotal - before).toBe(5);
  });

  it('moves backward from the nearest snapshot instead of replaying from zero', () => {
    const engine = new PlaybackEngine(history(40), 10);
    engine.seek(40);
    const before = engine.appliedTotal;
    engine.seek(23);
    expect(engine.code('python')).toBe('x'.repeat(23));
    expect(engine.appliedTotal - before).toBe(3);
    engine.seek(5);
    expect(engine.code('python')).toBe('x'.repeat(5));
  });

  it('clamps out-of-range positions and seeks by time', () => {
    const engine = new PlaybackEngine(history(5));
    engine.seek(99);
    expect(engine.position).toBe(5);
    engine.seek(-3);
    expect(engine.code('python')).toBe('');
    engine.seekTime(T0 + 25_000);
    expect(engine.code('python')).toBe('xx');
  });

  it('sorts updates by seq', () => {
    const shuffled = history(6).reverse();
    const engine = new PlaybackEngine(shuffled);
    engine.seek(6);
    expect(engine.code('python')).toBe('xxxxxx');
  });
});

describe('timeline helpers', () => {
  const updates = decodeUpdates(history(4)); // at 10, 20, 30, 40 s

  it('counts updates at a time with binary search', () => {
    expect(countAtTime(updates, T0)).toBe(0);
    expect(countAtTime(updates, T0 + 10_000)).toBe(1);
    expect(countAtTime(updates, T0 + 35_000)).toBe(3);
    expect(countAtTime(updates, T0 + 99_000)).toBe(4);
  });

  it('steps between changes and stops at the span edges', () => {
    const span = { start: T0, end: T0 + 60_000 };
    expect(stepTime(updates, T0 + 15_000, 1, span)).toBe(T0 + 20_000);
    expect(stepTime(updates, T0 + 15_000, -1, span)).toBe(T0 + 10_000);
    expect(stepTime(updates, T0 + 45_000, 1, span)).toBe(span.end);
    expect(stepTime(updates, T0 + 5_000, -1, span)).toBe(span.start);
  });

  it('widens the span to include activity outside the pad times', () => {
    const span = timelineSpan(at(15), at(20), updates, [], []);
    expect(span.start).toBe(T0 + 10_000);
    expect(span.end).toBe(T0 + 40_000);
  });

  it('buckets edit activity', () => {
    const h = activityHistogram(updates, { start: T0, end: T0 + 40_000 }, 4);
    expect(h).toEqual([0, 1, 1, 2]);
  });

  it('follows language switches', () => {
    const ev = (sec: number, language: 'cpp' | 'java'): TimelineEvent => ({
      id: '00000000-0000-4000-8000-000000000001',
      padId: '00000000-0000-4000-8000-000000000002',
      at: at(sec),
      event: { type: 'language', language },
    });
    const events = [ev(100, 'java'), ev(50, 'cpp')];
    expect(languageAt(events, T0, 'python')).toBe('python');
    expect(languageAt(events, T0 + 60_000, 'python')).toBe('cpp');
    expect(languageAt(events, T0 + 200_000, 'python')).toBe('java');
  });
});
