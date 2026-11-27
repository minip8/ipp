/** Row -> contract mappers. Nothing here may expose server-only problem fields. */
import {
  type Message,
  type MessageIntent,
  type Pad,
  type ProblemDetail,
  type ProblemSummary,
  problemScaffolds,
  type TimelineEvent,
} from '@ipp/contracts';
import type { messages, pads, problems, problemTests, runs, timelineEvents } from '@ipp/db';
import type { StoredRun } from './runs/redact';

type PadRow = typeof pads.$inferSelect;
type ProblemRow = typeof problems.$inferSelect;
type TestRow = typeof problemTests.$inferSelect;
type MessageRow = typeof messages.$inferSelect;
type EventRow = typeof timelineEvents.$inferSelect;
type RunRow = typeof runs.$inferSelect;

export function padView(row: PadRow, viewerId: string | null): Pad {
  return {
    id: row.id,
    ownerId: row.ownerId,
    title: row.title,
    kind: row.kind,
    format: row.format,
    problemSlug: row.problemSlug,
    language: row.language,
    status: row.status,
    durationMin: row.durationMin,
    interviewer: row.interviewer,
    shareToken: viewerId !== null && viewerId === row.ownerId ? row.shareToken : null,
    startedAt: row.startedAt.toISOString(),
    endedAt: row.endedAt?.toISOString() ?? null,
    interviewId: row.interviewId,
  };
}

export function problemSummary(row: ProblemRow): ProblemSummary {
  return {
    slug: row.slug,
    title: row.title,
    difficulty: row.difficulty,
    category: row.category,
    tags: row.tags,
    languages: row.languages,
  };
}

/**
 * Visible tests only; hidden tests are counted, never included. Scaffolds carry the problem's
 * starter code where it has some; the harness never leaves the server.
 */
export function problemDetail(row: ProblemRow, tests: TestRow[]): ProblemDetail {
  const visible = tests.filter((t) => !t.hidden).sort((a, b) => a.idx - b.idx);
  return {
    ...problemSummary(row),
    statement: row.statement,
    signature: row.signature,
    limits: row.limits,
    sampleTests: visible.map((t) => t.data),
    hiddenTestCount: tests.length - visible.length,
    scaffolds: problemScaffolds(row),
  };
}

export function messageView(row: MessageRow): Message {
  return {
    id: row.id,
    padId: row.padId,
    role: row.role,
    kind: row.kind,
    intent: (row.intent as MessageIntent | null) ?? null,
    text: row.text,
    via: row.via,
    userId: row.userId,
    createdAt: row.createdAt.toISOString(),
  };
}

export function eventView(row: EventRow): TimelineEvent {
  return { id: row.id, padId: row.padId, at: row.at.toISOString(), event: row.event };
}

export function storedRun(row: RunRow): StoredRun {
  return {
    id: row.id,
    padId: row.padId,
    userId: row.userId,
    problemSlug: row.problemSlug,
    mode: row.mode,
    language: row.language,
    status: row.status,
    result: row.result,
    hiddenIds: row.hiddenIds,
    testCount: row.testCount,
    createdAt: row.createdAt,
    finishedAt: row.finishedAt,
  };
}
