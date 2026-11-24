import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { MAX_PEN_COORDS, parseShape, presenceUser, readShapes } from './yjs-guards';

describe('presenceUser', () => {
  it('passes a well-formed user through', () => {
    expect(presenceUser({ name: 'Ada', color: '#3b82f6', userId: 'u1' })).toEqual({
      name: 'Ada',
      color: '#3b82f6',
      userId: 'u1',
    });
  });

  it('neutralises hostile fields from another member', () => {
    // A non-string name used to crash the pad page (`name.split is not a function`).
    expect(
      presenceUser({ name: { boom: 1 }, color: 'red;background:url(//x)', userId: 7 }),
    ).toEqual({ name: 'Guest', color: '#8b5cf6' });
    expect(presenceUser({ name: 'x'.repeat(1000) })?.name).toHaveLength(60);
    expect(presenceUser(null)).toBeNull();
    expect(presenceUser('Ada')).toBeNull();
  });
});

describe('parseShape / readShapes', () => {
  it('keeps valid shapes and uses the map key as id', () => {
    expect(
      parseShape('k1', {
        id: 'other',
        z: 2,
        color: 'red',
        width: 4,
        type: 'text',
        x: 1,
        y: 2,
        text: 'hi',
      }),
    ).toEqual({ id: 'k1', z: 2, color: 'red', width: 4, type: 'text', x: 1, y: 2, text: 'hi' });
    expect(
      parseShape('k2', { z: 1, color: 'ink', width: 2, type: 'pen', points: [0, 0, 1, 1] }),
    ).toMatchObject({ type: 'pen', points: [0, 0, 1, 1] });
  });

  it('drops or repairs malformed shapes instead of throwing at render time', () => {
    // `text` as an object made React throw and took down the whole pad page.
    expect(parseShape('a', { type: 'text', x: 1, y: 1, text: { boom: 1 } })).toBeNull();
    expect(parseShape('b', { type: 'pen' })).toBeNull();
    expect(parseShape('c', { type: 'pen', points: [0, 'x'] })).toBeNull();
    expect(parseShape('d', { type: 'rect', x1: 0, y1: 0, x2: Number.NaN, y2: 1 })).toBeNull();
    expect(parseShape('e', { type: 'script' })).toBeNull();
    expect(parseShape('f', [1, 2])).toBeNull();
    expect(parseShape('g', 'text')).toBeNull();
    const s = parseShape('h', {
      type: 'line',
      x1: 0,
      y1: 0,
      x2: 1,
      y2: 1,
      color: 'url(x)',
      width: 1e6,
    });
    expect(s).toMatchObject({ color: 'ink', width: 16 });
    const long = parseShape('i', { type: 'text', x: 0, y: 0, text: 'x'.repeat(10_000) });
    expect(long?.type === 'text' && long.text.length).toBe(500);
    const big = parseShape('j', { type: 'pen', points: new Array(1_000_001).fill(1) });
    expect(big?.type === 'pen' && big.points.length).toBe(MAX_PEN_COORDS);
  });

  it('reads a Y.Map written by a hostile client', () => {
    const doc = new Y.Doc();
    const m = doc.getMap<unknown>('drawing');
    m.set('ok', { z: 2, color: 'ink', width: 2, type: 'line', x1: 0, y1: 0, x2: 5, y2: 5 });
    m.set('evil', { z: 1, type: 'text', x: 0, y: 0, text: { boom: 1 } });
    m.set('num', 5);
    m.set('first', { z: 0, color: 'ink', width: 2, type: 'pen', points: [1, 2] });
    expect(readShapes(m.entries()).map((s) => s.id)).toEqual(['first', 'ok']);
  });
});
