import { z } from 'zod';
// Types only: quiz.ts and pad.ts import this file at runtime, so a value import back would be a cycle.
import type { PadFormat } from './pad';
import type { QuizTrack } from './quiz';

/**
 * The site track the header switch chooses: everything below the header is scoped to it. A user's
 * choice is remembered (null until they make one, when the site asks). Not to be confused with
 * `QuizTrack`, a topic's home, which decides its content rules; `homeTrack` maps one to the other.
 */
export const TRACKS = ['software', 'quant'] as const;
export const Track = z.enum(TRACKS);
export type Track = z.infer<typeof Track>;

export const TRACK_INFO: Record<Track, { label: string; description: string }> = {
  software: {
    label: 'Software',
    description:
      'Coding problems with an AI interviewer and quizzes on languages and systems, for developer interviews.',
  },
  quant: {
    label: 'Quant',
    description:
      'Probability, statistics, markets and puzzles, with live rounds, for trading and research interviews.',
  },
};

const HOME_TRACK: Record<QuizTrack, Track> = { fundamentals: 'software', quant: 'quant' };

/** The site track a topic's home belongs to. */
export function homeTrack(quizTrack: QuizTrack): Track {
  return HOME_TRACK[quizTrack];
}

/** Every site track a topic shows in: its home's first, then `also` in `TRACKS` order. */
export function topicTracks(topic: { track: QuizTrack; also?: readonly Track[] }): Track[] {
  const home = homeTrack(topic.track);
  const also = new Set(topic.also ?? []);
  return [home, ...TRACKS.filter((t) => t !== home && also.has(t))];
}

export function topicInTrack(
  topic: { track: QuizTrack; also?: readonly Track[] },
  track: Track,
): boolean {
  return topicTracks(topic).includes(track);
}

const PAD_TRACK: Record<PadFormat, Track> = { coding: 'software', quant: 'quant' };

/** The site track a pad belongs to, by its format. */
export function padTrack(pad: { format: PadFormat }): Track {
  return PAD_TRACK[pad.format];
}

/** `PUT /api/me/track`: remember the user's site track. */
export const SetTrackRequest = z.object({ track: Track });
export type SetTrackRequest = z.infer<typeof SetTrackRequest>;
export const SetTrackResponse = z.object({ track: Track });
export type SetTrackResponse = z.infer<typeof SetTrackResponse>;
