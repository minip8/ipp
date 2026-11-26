'use client';
/**
 * The app's home (`/dashboard`, and `/new` from older links): on to the remembered track's
 * Interviews with the query kept (`homeTarget`). An account that has never chosen a track is
 * asked first, once: choosing remembers it and goes on. Only accounts get here (the gate keeps
 * guests out).
 */
import { TRACK_INFO, TRACKS, type Track } from '@ipp/contracts';
import { ArrowRightIcon } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect } from 'react';
import { TRACK_ICON } from '@/components/track-switch';
import { Spinner } from '@/components/ui/spinner';
import { useMe } from '@/lib/queries';
import { homeTarget } from '@/lib/track';
import { useSaveTrack } from '@/lib/track-hooks';

function TrackChoice({ track, onChoose }: { track: Track; onChoose: (t: Track) => void }) {
  const Icon = TRACK_ICON[track];
  const info = TRACK_INFO[track];
  return (
    <button
      type="button"
      onClick={() => onChoose(track)}
      data-testid={`choose-${track}`}
      className="group flex flex-col gap-3 rounded-lg border border-border bg-surface p-5 text-left transition-[border-color,box-shadow] hover:border-accent/60 hover:shadow-pop focus-visible:outline-offset-[-2px] sm:p-6"
    >
      <span className="flex size-10 items-center justify-center rounded-lg bg-accent-soft text-accent-text">
        <Icon aria-hidden className="size-5" />
      </span>
      <span className="text-lg font-semibold tracking-tight">{info.label}</span>
      <span className="text-sm text-fg-muted">{info.description}</span>
      <span className="mt-auto inline-flex items-center gap-1.5 pt-2 text-sm font-medium text-accent-text">
        Start with {info.label}
        <ArrowRightIcon
          aria-hidden
          className="size-3.5 transition-transform group-hover:translate-x-0.5"
        />
      </span>
    </button>
  );
}

/** The first-visit question: which side of the site the user is here for. */
export function TrackChooser({ onChoose }: { onChoose: (t: Track) => void }) {
  return (
    <div className="mx-auto max-w-3xl px-4 pt-12 pb-[calc(2rem_+_env(safe-area-inset-bottom))] sm:px-6 sm:pt-20">
      <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">
        What are you preparing for?
      </h1>
      <p className="mt-1.5 text-sm text-fg-muted">
        The site shows one side at a time. You can switch whenever you like from the header.
      </p>
      <div className="mt-8 grid gap-4 sm:grid-cols-2" data-testid="track-chooser">
        {TRACKS.map((t) => (
          <TrackChoice key={t} track={t} onChoose={onChoose} />
        ))}
      </div>
    </div>
  );
}

export function HomeRedirect() {
  const me = useMe();
  const router = useRouter();
  const search = useSearchParams().toString();
  const save = useSaveTrack();
  const target = me.data ? homeTarget(search, me.data.track) : null;
  useEffect(() => {
    if (target) router.replace(target);
  }, [target, router]);
  if (!me.data || target)
    return (
      <div className="flex justify-center pt-24" role="status" aria-label="Loading">
        <Spinner />
      </div>
    );
  // Choosing remembers the track, which gives a target, and the effect goes on.
  return <TrackChooser onChoose={save} />;
}
