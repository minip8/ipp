'use client';
/**
 * The current site track and remembering it. The current track is the URL's when the path names
 * one, else the remembered one (`GET /api/me`'s `user.track`), else software. Arriving on a track
 * page whose track is not the remembered one remembers it: the `me` cache is updated at once (so
 * the header on the next leaf page matches) and one `PUT /api/me/track` is sent. Never for a
 * guest, who has no track.
 */
import type { Track } from '@ipp/contracts';
import { useQueryClient } from '@tanstack/react-query';
import { usePathname } from 'next/navigation';
import { useCallback, useEffect } from 'react';
import { api } from './api';
import { qk, useMe } from './queries';
import type { Me } from './schemas';
import { currentTrack } from './track';

export function useTrack(): Track {
  const pathname = usePathname();
  const me = useMe();
  return currentTrack(pathname, me.data?.track);
}

/** Save `track` as the user's remembered one (cache first, then the request). */
export function useSaveTrack() {
  const qc = useQueryClient();
  return useCallback(
    (track: Track) => {
      const me = qc.getQueryData<Me | null>(qk.me);
      if (!me || me.guest || me.track === track) return;
      const next: Me = { ...me, track };
      qc.setQueryData<Me | null>(qk.me, next);
      // Best effort: the page works without it, and the next visit's /api/me says what stuck.
      api.setTrack(track).catch(() => {});
    },
    [qc],
  );
}

/** On a track page: remember its track once the session is known. */
export function useRememberTrack(track: Track) {
  const me = useMe();
  const save = useSaveTrack();
  const known = me.data !== undefined;
  useEffect(() => {
    if (known) save(track);
  }, [known, save, track]);
}
