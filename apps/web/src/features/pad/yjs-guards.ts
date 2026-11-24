/**
 * Guards for data that arrives from other pad members through Yjs. The collab server relays
 * awareness states and document updates verbatim, so anything another member (e.g. someone who
 * joined with the share link) puts there is untrusted: a non-string name or a malformed shape used
 * to throw during render and take down the whole pad page for everyone in it.
 */
import type { PresenceUser } from './editor/binding';

const SAFE_COLOR = /^#[0-9a-fA-F]{6}$/;
const FALLBACK_COLOR = '#8b5cf6';
const MAX_NAME = 60;

/** A remote awareness `user` field as something safe to render, or null if unusable. */
export function presenceUser(raw: unknown): PresenceUser | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const name = typeof r.name === 'string' && r.name.trim() ? r.name.slice(0, MAX_NAME) : 'Guest';
  const color = typeof r.color === 'string' && SAFE_COLOR.test(r.color) ? r.color : FALLBACK_COLOR;
  const userId = typeof r.userId === 'string' ? r.userId.slice(0, 100) : undefined;
  return userId === undefined ? { name, color } : { name, color, userId };
}

export type ShapeColor = 'ink' | 'blue' | 'red' | 'green' | 'amber';
type Base = { id: string; z: number; color: ShapeColor; width: number };
export type Shape =
  | (Base & { type: 'pen'; points: number[] })
  | (Base & {
      type: 'line' | 'arrow' | 'rect' | 'ellipse';
      x1: number;
      y1: number;
      x2: number;
      y2: number;
    })
  | (Base & { type: 'text'; x: number; y: number; text: string });

const COLORS = new Set<string>(['ink', 'blue', 'red', 'green', 'amber']);
const SEGMENT_TYPES = new Set<string>(['line', 'arrow', 'rect', 'ellipse']);
/** Pen strokes are capped (x,y pairs); far more than a real stroke, small enough to render. */
export const MAX_PEN_COORDS = 20_000;
export const MAX_TEXT = 500;
const LIMIT = 1e7;

const coord = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= LIMIT ? v : null;

/**
 * A whiteboard entry from the shared Y.Map as a well-formed shape, or null to ignore it.
 * The shape's id is always its map key, so erase/move/delete act on the entry that was drawn.
 */
export function parseShape(key: string, raw: unknown): Shape | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const z = coord(r.z) ?? 0;
  const color = (
    typeof r.color === 'string' && COLORS.has(r.color) ? r.color : 'ink'
  ) as ShapeColor;
  const w = coord(r.width);
  const width = w === null ? 2 : Math.min(16, Math.max(1, w));
  const base = { id: key, z, color, width };
  if (r.type === 'pen') {
    if (!Array.isArray(r.points)) return null;
    const pts: number[] = [];
    const n = Math.min(r.points.length, MAX_PEN_COORDS) & ~1;
    for (let i = 0; i < n; i++) {
      const v = coord(r.points[i]);
      if (v === null) return null;
      pts.push(v);
    }
    if (pts.length < 2) return null;
    return { ...base, type: 'pen', points: pts };
  }
  if (typeof r.type === 'string' && SEGMENT_TYPES.has(r.type)) {
    const x1 = coord(r.x1);
    const y1 = coord(r.y1);
    const x2 = coord(r.x2);
    const y2 = coord(r.y2);
    if (x1 === null || y1 === null || x2 === null || y2 === null) return null;
    return { ...base, type: r.type as 'line' | 'arrow' | 'rect' | 'ellipse', x1, y1, x2, y2 };
  }
  if (r.type === 'text') {
    const x = coord(r.x);
    const y = coord(r.y);
    if (x === null || y === null || typeof r.text !== 'string') return null;
    return { ...base, type: 'text', x, y, text: r.text.slice(0, MAX_TEXT) };
  }
  return null;
}

/** Every well-formed shape in the map, bottom to top. */
export function readShapes(entries: Iterable<[string, unknown]>): Shape[] {
  const out: Shape[] = [];
  for (const [k, v] of entries) {
    const s = parseShape(k, v);
    if (s) out.push(s);
  }
  return out.sort((a, b) => a.z - b.z);
}
