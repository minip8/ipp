'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { TAB_LABEL, TABS, tabFromPath, tabHref } from '@/lib/track';
import { useChosenTrack, useTrack } from '@/lib/track-hooks';
import { cn } from '@/lib/utils';
import { Logo } from './logo';
import { ThemeToggle } from './theme-toggle';
import { TrackSwitch } from './track-switch';
import { UserMenu } from './user-menu';

/**
 * Logo, the track switch, the track's three tabs, theme and account. The tabs are the same in
 * both tracks and lead into the current one (`useTrack`); on a page of no track the one its
 * section belongs to is highlighted (a quiz under Practice, a pad under Interviews). Before an
 * account has chosen a track, none is shown as chosen and no tab as current.
 */
export function AppHeader() {
  const pathname = usePathname();
  const track = useTrack();
  // Before the user has chosen a track (the first-visit question), no tab is theirs yet.
  const here = useChosenTrack() === null ? null : tabFromPath(pathname);
  return (
    <header className="sticky top-0 z-40 border-b border-border bg-bg/90 pt-[env(safe-area-inset-top)] backdrop-blur-sm">
      {/* Phones (below sm): the logo is its mark (the word stays for screen readers), the switch
          is a menu behind the track's icon, and the theme is in the account menu, so logo,
          switch, the three tabs and account fit on one line down to 360px. The wordmark comes
          back from md. */}
      <div className="mx-auto flex h-13 max-w-6xl items-center gap-1.5 px-4 min-[400px]:gap-2.5 sm:gap-4 sm:px-6">
        <Logo wordmarkClassName="max-md:sr-only" />
        <TrackSwitch />
        <nav aria-label="Main" className="flex min-w-0 items-center gap-0.5">
          {TABS.map((tab) => (
            <Link
              key={tab}
              href={tabHref(track, tab)}
              aria-current={here === tab ? 'page' : undefined}
              className={cn(
                'touch-hit rounded-md px-1.5 py-1 text-sm font-medium whitespace-nowrap transition-colors min-[400px]:px-2.5',
                here === tab ? 'bg-surface-3 text-fg' : 'text-fg-muted hover:text-fg',
              )}
            >
              {TAB_LABEL[tab]}
            </Link>
          ))}
        </nav>
        <div className="ml-auto flex shrink-0 items-center gap-1.5">
          <div className="max-sm:hidden">
            <ThemeToggle />
          </div>
          <UserMenu />
        </div>
      </div>
    </header>
  );
}
