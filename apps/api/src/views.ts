/** Row -> contract mappers. Nothing here may expose server-only problem fields. */
import {
  type Interview,
  type InterviewStageView,
  type InterviewTemplate,
  type Message,
  type MessageIntent,
  type Pad,
  type ProblemDetail,
  type ProblemSummary,
  problemScaffolds,
  Recommendation,
  type Report,
  stageStatuses,
  type TimelineEvent,
} from '@ipp/contracts';
import type {
  interviews,
  interviewTemplates,
  messages,
  pads,
  problems,
  problemTests,
  runs,
  timelineEvents,
} from '@ipp/db';
import type { StoredRun } from './runs/redact';

type InterviewRow = typeof interviews.$inferSelect;
type TemplateRow = typeof interviewTemplates.$inferSelect;
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

/** What an interview's view needs of one stage's pad (`interviews/service.ts` loads it). */
export interface StagePadRow {
  id: string;
  stageIndex: number;
  title: string;
  format: Pad['format'];
  status: Pad['status'];
  startedAt: Date;
  endedAt: Date | null;
  /** The pad's problem's title (a coding stage's). */
  problemTitle: string | null;
  /** The pad's report, when it has one; `recommendation` as stored in its assessment. */
  report: { status: Report['status']; recommendation: unknown } | null;
}

/**
 * An interview with its stages' statuses, pads and report headlines. Nothing of a stage's draw
 * beyond its pad's title and its problem's title: a round's questions and a game's values stay
 * in the round's state.
 */
export function interviewView(row: InterviewRow, stagePads: readonly StagePadRow[]): Interview {
  const byIndex = new Map(stagePads.map((p) => [p.stageIndex, p]));
  const statuses = stageStatuses({
    count: row.stages.length,
    current: row.current,
    ended: row.status === 'ended',
    pad: (i) => byIndex.get(i)?.status,
  });
  return {
    id: row.id,
    title: row.title,
    track: row.track,
    preset: row.preset,
    status: row.status,
    current: row.current,
    stages: row.stages.map((stage, index): InterviewStageView => {
      const pad = byIndex.get(index);
      const recommendation = Recommendation.safeParse(pad?.report?.recommendation);
      return {
        index,
        stage,
        status: statuses[index] ?? 'upcoming',
        pad: pad
          ? {
              id: pad.id,
              title: pad.title,
              problemTitle: pad.format === 'coding' ? pad.problemTitle : null,
              startedAt: pad.startedAt.toISOString(),
              endedAt: pad.endedAt?.toISOString() ?? null,
            }
          : null,
        result:
          pad?.status === 'ended' && pad.report
            ? {
                report: pad.report.status,
                recommendation: recommendation.success ? recommendation.data : null,
              }
            : null,
      };
    }),
    interviewer: row.interviewer,
    startedAt: row.startedAt.toISOString(),
    endedAt: row.endedAt?.toISOString() ?? null,
  };
}

export const templateView = (row: TemplateRow): InterviewTemplate => ({
  id: row.id,
  name: row.name,
  track: row.track,
  stages: row.stages,
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
});
