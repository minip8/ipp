/**
 * Pure editor-history reconstruction for the report's playback.
 *
 * The API sends the pad's Yjs updates in order (`Playback.updates`, base64). To show the code at
 * time t we apply every update with `at <= t` to an empty doc. Moving forward applies only the new
 * updates; moving backward restores the nearest cached snapshot and replays from there.
 */
import {
  type Language,
  type Message,
  type Playback,
  type TimelineEvent,
  YDOC,
} from '@ipp/contracts';
import * as Y from 'yjs';

export type DecodedUpdate = { seq: number; t: number; bytes: Uint8Array };

export function decodeBase64(b64: string): Uint8Array {
  if (typeof atob === 'function') {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  return new Uint8Array(Buffer.from(b64, 'base64'));
}

export function decodeUpdates(updates: Playback['updates']): DecodedUpdate[] {
  return [...updates]
    .sort((a, b) => a.seq - b.seq)
    .map((u) => ({ seq: u.seq, t: Date.parse(u.at), bytes: decodeBase64(u.update) }));
}

/** Number of updates whose time is <= t (updates are sorted by seq, and therefore by time). */
export function countAtTime(updates: readonly DecodedUpdate[], t: number): number {
  let lo = 0;
  let hi = updates.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if ((updates[mid]?.t ?? Number.POSITIVE_INFINITY) <= t) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

export class PlaybackEngine {
  readonly updates: DecodedUpdate[];
  private doc = new Y.Doc();
  private applied = 0;
  private readonly snapshots = new Map<number, Uint8Array>();
  /** Exposed for tests: how many updates were applied in total (to check incremental behaviour). */
  appliedTotal = 0;

  constructor(
    updates: Playback['updates'] | DecodedUpdate[],
    private readonly snapshotEvery = 20,
  ) {
    const first = updates[0];
    this.updates =
      first && 'bytes' in first
        ? (updates as DecodedUpdate[])
        : decodeUpdates(updates as Playback['updates']);
  }

  get length() {
    return this.updates.length;
  }

  /** Move the doc to the state after `count` updates and return it. */
  seek(count: number): Y.Doc {
    const target = Math.max(0, Math.min(count, this.updates.length));
    if (target < this.applied) {
      let base = 0;
      for (const k of this.snapshots.keys()) if (k <= target && k > base) base = k;
      this.doc.destroy();
      this.doc = new Y.Doc();
      const snap = this.snapshots.get(base);
      if (snap) Y.applyUpdate(this.doc, snap);
      this.applied = base;
    }
    while (this.applied < target) {
      const u = this.updates[this.applied];
      if (u) Y.applyUpdate(this.doc, u.bytes);
      this.applied++;
      this.appliedTotal++;
      if (this.applied % this.snapshotEvery === 0 && !this.snapshots.has(this.applied)) {
        this.snapshots.set(this.applied, Y.encodeStateAsUpdate(this.doc));
      }
    }
    return this.doc;
  }

  seekTime(t: number): Y.Doc {
    return this.seek(countAtTime(this.updates, t));
  }

  text(key: string): string {
    return this.doc.getText(key).toString();
  }

  code(language: Language): string {
    return this.text(YDOC.code(language));
  }

  get position() {
    return this.applied;
  }

  destroy() {
    this.doc.destroy();
  }
}

/** The language buffer the candidate was in at time t, from `language` timeline events. */
export function languageAt(
  events: readonly TimelineEvent[],
  t: number,
  fallback: Language,
): Language {
  let current: Language | null = null;
  const sorted = [...events].sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  for (const e of sorted) {
    if (e.event.type === 'language' && Date.parse(e.at) <= t) current = e.event.language;
  }
  // Before the first switch the starting language is not recorded; `fallback` is the caller's best
  // guess (the pad's language).
  return current ?? fallback;
}

export type Span = { start: number; end: number };

/** The time range the scrubber covers: the pad's lifetime, widened to include all activity. */
export function timelineSpan(
  padStart: string,
  padEnd: string | null,
  updates: readonly DecodedUpdate[],
  events: readonly TimelineEvent[],
  messages: readonly Message[],
): Span {
  const times = [
    ...updates.map((u) => u.t),
    ...events.map((e) => Date.parse(e.at)),
    ...messages.map((m) => Date.parse(m.createdAt)),
  ].filter(Number.isFinite);
  const start = Math.min(Date.parse(padStart), ...times);
  const endCandidates = [padEnd ? Date.parse(padEnd) : Number.NEGATIVE_INFINITY, ...times];
  const end = Math.max(...endCandidates, start + 1000);
  return { start, end };
}

/** Edit density: how many updates fall in each of `buckets` equal slices of the span. */
export function activityHistogram(
  updates: readonly DecodedUpdate[],
  span: Span,
  buckets: number,
): number[] {
  const out = new Array<number>(buckets).fill(0);
  const width = (span.end - span.start) / buckets;
  for (const u of updates) {
    const i = Math.min(buckets - 1, Math.max(0, Math.floor((u.t - span.start) / width)));
    out[i] = (out[i] ?? 0) + 1;
  }
  return out;
}

/** The time of the previous/next update relative to t, for stepping through changes. */
export function stepTime(
  updates: readonly DecodedUpdate[],
  t: number,
  dir: -1 | 1,
  span: Span,
): number {
  if (dir > 0) {
    const next = updates.find((u) => u.t > t);
    return next ? next.t : span.end;
  }
  for (let i = updates.length - 1; i >= 0; i--) {
    const u = updates[i];
    if (u && u.t < t) return u.t;
  }
  return span.start;
}
