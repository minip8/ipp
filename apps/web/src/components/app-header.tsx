'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';
import { Logo } from './logo';
import { ThemeToggle } from './theme-toggle';
import { UserMenu } from './user-menu';

const NAV = [
  { href: '/dashboard', label: 'Interviews' },
  { href: '/quant', label: 'Quant' },
  { href: '/quiz', label: 'Quizzes' },
];

export function AppHeader() {
  const pathname = usePathname();
  return (
    <header className="sticky top-0 z-40 border-b border-border bg-bg/90 pt-[env(safe-area-inset-top)] backdrop-blur-sm">
      {/* Phones: tighter gaps, and below 440px the logo is just its mark (the word stays for
          screen readers), so logo, the three nav links, theme and account fit on one line down
          to 360px. */}
      <div className="mx-auto flex h-13 max-w-6xl items-center gap-2 px-4 min-[400px]:gap-3 sm:gap-4 sm:px-6">
        <Logo wordmarkClassName="max-[439px]:sr-only" />
        <nav aria-label="Main" className="flex min-w-0 items-center gap-0.5">
          {NAV.map((n) => {
            const active =
              pathname === n.href ||
              pathname.startsWith(`${n.href}/`) ||
              (n.href === '/dashboard' && pathname.startsWith('/pads'));
            return (
              <Link
                key={n.href}
                href={n.href}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'touch-hit rounded-md px-2.5 py-1 text-sm font-medium whitespace-nowrap transition-colors',
                  active ? 'bg-surface-3 text-fg' : 'text-fg-muted hover:text-fg',
                )}
              >
                {n.label}
              </Link>
            );
          })}
        </nav>
        <div className="ml-auto flex shrink-0 items-center gap-1.5">
          <ThemeToggle />
          <UserMenu />
        </div>
      </div>
    </header>
  );
}
