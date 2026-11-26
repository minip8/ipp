/**
 * Pure rules of the Interviews tab, the same page in both tracks: which pads are the track's
 * (`padTrack`: coding pads and coding rooms are Software, quant rounds and quant rooms Quant),
 * split into those under way and those finished, the figures over the page and what a pad is
 * called in the lists.
 */
import { type PadSummary, padTrack, type Track } from '@ipp/contracts';

/** What a pad is called in lists: its problem, or its own title when it has none (a room, a round). */
export const padName = (p: Pick<PadSummary, 'problemTitle' | 'title'>) => p.problemTitle ?? p.title;

/** A room's report is its host's; a candidate with an account only gets the pad back. */
export const canOpenReport = (p: Pick<PadSummary, 'kind' | 'role'>) =>
  p.kind !== 'room' || p.role === 'owner';

/** Seconds from start to end, or null while it has not ended. */
export const padLength = (p: Pick<PadSummary, 'startedAt' | 'endedAt'>) =>
  p.endedAt ? (Date.parse(p.endedAt) - Date.parse(p.startedAt)) / 1000 : null;

export type TrackPads = { active: PadSummary[]; ended: PadSummary[] };

/** The track's pads, in the order given (the API's: newest first), under way and finished. */
export function padsInTrack(pads: readonly PadSummary[], track: Track): TrackPads {
  const mine = pads.filter((p) => padTrack(p) === track);
  return {
    active: mine.filter((p) => p.status === 'active'),
    ended: mine.filter((p) => p.status === 'ended'),
  };
}

/**
 * The figures over the page. Software: interviews finished and how many were solved. Quant:
 * rounds finished (a quant room counts: it is a round the user hosted or took), since a round is
 * scored question by question in its report rather than solved.
 */
export function interviewFigures(
  track: Track,
  { ended }: Pick<TrackPads, 'ended'>,
): { label: string; value: number }[] {
  if (track === 'quant') return [{ label: 'Rounds', value: ended.length }];
  return [
    { label: 'Interviews', value: ended.length },
    { label: 'Solved', value: ended.filter((p) => p.accepted).length },
  ];
}
