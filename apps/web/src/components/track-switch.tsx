'use client';
import { TRACK_INFO, TRACKS, type Track } from '@ipp/contracts';
import {
  CheckIcon,
  ChevronDownIcon,
  CodeXmlIcon,
  LayersIcon,
  type LucideIcon,
  SigmaIcon,
} from 'lucide-react';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import { switchHref } from '@/lib/track';
import { useChosenTrack } from '@/lib/track-hooks';
import { cn } from '@/lib/utils';
import { Menu, MenuContent, MenuItem, MenuLabel, MenuTrigger } from './ui/menu';

export const TRACK_ICON: Record<Track, LucideIcon> = { software: CodeXmlIcon, quant: SigmaIcon };

/**
 * From `sm` up: both tracks side by side, the current one raised (the Segmented look). Before a
 * track is chosen (`useChosenTrack` null) neither is.
 */
function Segments({ search }: { search: string }) {
  const pathname = usePathname();
  const current = useChosenTrack();
  return (
    <nav
      aria-label="Track"
      data-testid="track-switch"
      className="inline-flex shrink-0 rounded-md border border-border-strong bg-surface-2 p-0.5 max-sm:hidden"
    >
      {TRACKS.map((t) => {
        const on = t === current;
        const Icon = TRACK_ICON[t];
        const className = cn(
          'flex h-7 items-center gap-1.5 rounded-[5px] px-2 text-sm font-medium whitespace-nowrap transition-colors focus-visible:outline-offset-0',
          on
            ? 'bg-surface text-fg shadow-[0_1px_2px_oklch(0_0_0/0.08),0_0_0_1px_var(--border)]'
            : 'text-fg-muted hover:text-fg',
        );
        const content = (
          <>
            <Icon aria-hidden className={cn('size-3.5 shrink-0', on && 'text-accent-text')} />
            {TRACK_INFO[t].label}
          </>
        );
        // The current track is where the user is: nothing to follow.
        return on ? (
          <span key={t} aria-current="true" className={className}>
            {content}
          </span>
        ) : (
          <Link key={t} href={switchHref(pathname, search, t)} className={className}>
            {content}
          </Link>
        );
      })}
    </nav>
  );
}

/**
 * Phones: the header has room for the tabs or for both track names, not both, so the switch is
 * the current track's icon opening a menu of the two, each with what it is for.
 */
function Compact({ search }: { search: string }) {
  const pathname = usePathname();
  const current = useChosenTrack();
  const Icon = current ? TRACK_ICON[current] : LayersIcon;
  return (
    <Menu>
      <MenuTrigger
        aria-label={current ? `Track: ${TRACK_INFO[current].label}` : 'Track: none chosen'}
        data-testid="track-menu"
        className="touch-hit flex h-8 shrink-0 items-center gap-0.5 rounded-md border border-border-strong bg-surface-2 pr-1 pl-1.5 text-fg transition-colors data-[state=open]:bg-surface-3 sm:hidden"
      >
        <Icon
          aria-hidden
          className={cn('size-4', current ? 'text-accent-text' : 'text-fg-muted')}
        />
        <ChevronDownIcon aria-hidden className="size-3.5 text-fg-muted" />
      </MenuTrigger>
      <MenuContent align="start" className="w-72">
        <MenuLabel>Track</MenuLabel>
        {TRACKS.map((t) => {
          const on = t === current;
          const ItemIcon = TRACK_ICON[t];
          const body = (
            <>
              <ItemIcon className={cn('mt-0.5', on && 'text-accent-text!')} />
              <span className="min-w-0 flex-1">
                <span className="block font-medium">{TRACK_INFO[t].label}</span>
                <span className="mt-0.5 block text-xs text-fg-muted">
                  {TRACK_INFO[t].description}
                </span>
              </span>
              {on && <CheckIcon className="mt-0.5 text-accent-text!" />}
            </>
          );
          const item = 'h-auto items-start py-2 pointer-coarse:h-auto';
          return on ? (
            <MenuItem key={t} aria-current="true" className={item}>
              {body}
            </MenuItem>
          ) : (
            <MenuItem key={t} asChild className={item}>
              <Link href={switchHref(pathname, search, t)}>{body}</Link>
            </MenuItem>
          );
        })}
      </MenuContent>
    </Menu>
  );
}

function Switch({ search }: { search: string }) {
  return (
    <>
      <Segments search={search} />
      <Compact search={search} />
    </>
  );
}

function WithSearch() {
  return <Switch search={useSearchParams().toString()} />;
}

/**
 * The header's track switch: Software | Quant. Each choice is a link to the same tab in that
 * track (`switchHref`); arriving there remembers the track. Search params are read under their
 * own Suspense so the header never waits on them.
 */
export function TrackSwitch() {
  return (
    <Suspense fallback={<Switch search="" />}>
      <WithSearch />
    </Suspense>
  );
}
