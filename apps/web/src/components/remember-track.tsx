'use client';
import type { Track } from '@ipp/contracts';
import { useRememberTrack } from '@/lib/track-hooks';

/** Rendered by a track's layout: arriving in the track remembers it (see `track-hooks.ts`). */
export function RememberTrack({ track }: { track: Track }) {
  useRememberTrack(track);
  return null;
}
