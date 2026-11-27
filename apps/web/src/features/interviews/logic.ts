/**
 * Pure rules of the Interviews tab, the same page in both tracks: which pads and staged
 * interviews are the track's, split into those under way and those finished, merged into one
 * list newest first, the figures over the page and what a pad is called in the lists.
 *
 * A pad started on its own belongs to its format's track (`padTrack`: coding pads and coding
 * rooms are Software, quant rounds and quant rooms Quant). A staged interview belongs to the
 * track it was built in (`interview.track`), whatever its stages are, and is one row: its
 * stages' pads (`interviewId` set) are never listed on their own. A one-stage interview is
 * shown as its pad would be, and opens its pad's report.
 */
import { type Interview, type PadSummary, padTrack, type Track } from '@ipp/contracts';

/** What a pad is called in lists: its problem, or its own title when it has none (a room, a round). */
export const padName = (p: Pick<PadSummary, 'problemTitle' | 'title'>) => p.problemTitle ?? p.title;

/** A room's report is its host's; a candidate with an account only gets the pad back. */
export const canOpenReport = (p: Pick<PadSummary, 'kind' | 'role'>) =>
  p.kind !== 'room' || p.role === 'owner';

/** Seconds from start to end, or null while it has not ended. */
export const padLength = (p: Pick<PadSummary, 'startedAt' | 'endedAt'>) =>
  p.endedAt ? (Date.parse(p.endedAt) - Date.parse(p.startedAt)) / 1000 : null;

export type TrackPads = { active: PadSummary[]; ended: PadSummary[] };

/**
 * The track's pads started on their own, in the order given (the API's: newest first), under
 * way and finished. A stage's pad is its interview's, never a row of its own.
 */
export function padsInTrack(pads: readonly PadSummary[], track: Track): TrackPads {
  const mine = pads.filter((p) => p.interviewId === null && padTrack(p) === track);
  return {
    active: mine.filter((p) => p.status === 'active'),
    ended: mine.filter((p) => p.status === 'ended'),
  };
}

/** A row of the lists: a pad of its own, a staged interview, or a one-stage interview. */
export type Row =
  | { kind: 'pad'; pad: PadSummary }
  | { kind: 'interview'; interview: Interview }
  /** Shown as its pad: `pad` is the stage's pad (made from the interview while not listed). */
  | { kind: 'single'; interview: Interview; pad: PadSummary };

export const rowStartedAt = (r: Row) =>
  r.kind === 'pad' ? r.pad.startedAt : r.interview.startedAt;

export const rowKey = (r: Row) => (r.kind === 'pad' ? `pad:${r.pad.id}` : `iv:${r.interview.id}`);

/**
 * A one-stage interview's pad as the lists show it: its summary from `GET /api/pads`, or (while
 * that is not here) one made from what the interview says about it.
 */
export function stagePad(interview: Interview, pads: readonly PadSummary[]): PadSummary | null {
  const view = interview.stages[0];
  if (!view?.pad) return null;
  const listed = pads.find((p) => p.id === view.pad?.id);
  if (listed) return listed;
  const coding = view.stage.kind === 'coding' ? view.stage : null;
  return {
    id: view.pad.id,
    title: view.pad.title,
    kind: 'practice',
    format: coding ? 'coding' : 'quant',
    problemSlug: coding?.problemSlug ?? null,
    language: coding?.language ?? 'python',
    status: view.pad.endedAt ? 'ended' : 'active',
    startedAt: view.pad.startedAt,
    endedAt: view.pad.endedAt,
    interviewId: interview.id,
    problemTitle: view.pad.problemTitle,
    difficulty: null,
    accepted: false,
    role: 'owner',
    quantPath: null,
  };
}

function interviewRow(interview: Interview, pads: readonly PadSummary[]): Row | null {
  if (interview.stages.length > 1) return { kind: 'interview', interview };
  const pad = stagePad(interview, pads);
  return pad ? { kind: 'single', interview, pad } : { kind: 'interview', interview };
}

/** Rows newest first; rows that started together keep their order. */
const byStart = (rows: Row[]) =>
  rows
    .map((r, i) => ({ r, i, t: Date.parse(rowStartedAt(r)) }))
    .sort((a, b) => b.t - a.t || a.i - b.i)
    .map((x) => x.r);

export type TrackRows = { active: Row[]; ended: Row[] };

/** The track's interviews and its own pads, under way and finished, each newest first. */
export function rowsInTrack(
  interviews: readonly Interview[],
  pads: readonly PadSummary[],
  track: Track,
): TrackRows {
  const own = padsInTrack(pads, track);
  const mine = interviews.filter((i) => i.track === track);
  const rows = (status: Interview['status'], list: PadSummary[]) =>
    byStart([
      ...mine.filter((i) => i.status === status).flatMap((i) => interviewRow(i, pads) ?? []),
      ...list.map((pad): Row => ({ kind: 'pad', pad })),
    ]);
  return { active: rows('active', own.active), ended: rows('ended', own.ended) };
}

/** Whether any coding stage of the interview was solved (its pad has an accepted submission). */
export const solvedStages = (interview: Interview, pads: readonly PadSummary[]) =>
  interview.stages.filter(
    (s) => s.stage.kind === 'coding' && s.pad && pads.find((p) => p.id === s.pad?.id)?.accepted,
  ).length;

/**
 * The figures over the page: interviews finished (a staged interview once, whatever its stages)
 * and, on Software, the problems solved in them (every coding stage accepted counts, as does a
 * pad of its own). A quant round is scored question by question in its report, so Quant counts
 * only what was finished.
 */
export function interviewFigures(
  track: Track,
  { ended }: Pick<TrackRows, 'ended'>,
  pads: readonly PadSummary[],
): { label: string; value: number }[] {
  const interviews = { label: 'Interviews', value: ended.length };
  if (track === 'quant') return [interviews];
  const solved = ended.reduce(
    (n, r) => n + (r.kind === 'pad' ? (r.pad.accepted ? 1 : 0) : solvedStages(r.interview, pads)),
    0,
  );
  return [interviews, { label: 'Solved', value: solved }];
}
