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
import { useHydrated } from './hydration';
import { qk, useMe } from './queries';
import type { Me } from './schemas';
import { currentTrack, trackFromPath } from './track';

export function useTrack(): Track {
  const pathname = usePathname();
  const me = useMe();
  // As the server rendered it (no session, so no remembered track) until hydration is over.
  const hydrated = useHydrated();
  return currentTrack(pathname, hydrated ? me.data?.track : undefined);
}

/**
 * The track the header switch shows as chosen. On a track page it is that page's. On a page of no
 * track it is the remembered one, and none until the session has loaded (the server cannot know
 * it, and showing Software for a moment to someone in Quant would be wrong) or while an account
 * has never chosen (the first-visit question at the home).
 */
export function useChosenTrack(): Track | null {
  const pathname = usePathname();
  const me = useMe();
  const hydrated = useHydrated();
  const here = trackFromPath(pathname);
  if (here) return here;
  // The server rendered no track here; neither does the first render over its HTML.
  if (!hydrated || !me.data) return null;
  return me.data.guest ? 'software' : me.data.track;
}

/** Whether an account has yet to choose a track and this page does not name one. */
export function useUndecided(): boolean {
  const pathname = usePathname();
  const me = useMe();
  const hydrated = useHydrated();
  return Boolean(
    hydrated &&
      me.data &&
      !me.data.guest &&
      me.data.track === null &&
      trackFromPath(pathname) === null,
  );
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
