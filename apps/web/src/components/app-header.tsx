'use client';
import { PlusIcon } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';
import { Logo } from './logo';
import { ThemeToggle } from './theme-toggle';
import { Button } from './ui/button';
import { UserMenu } from './user-menu';

const NAV = [
  { href: '/dashboard', label: 'Interviews' },
  { href: '/quiz', label: 'Quizzes' },
];

export function AppHeader() {
  const pathname = usePathname();
  // Not where the page has its own button for it, nor on the quiz pages, where it would compete
  // with "Start quiz" and "Finish quiz".
  const hideNew =
    ['/', '/dashboard', '/new'].includes(pathname) ||
    pathname === '/quiz' ||
    pathname.startsWith('/quiz/');
  return (
    <header className="sticky top-0 z-40 border-b border-border bg-bg/90 backdrop-blur-sm">
      <div className="mx-auto flex h-13 max-w-6xl items-center gap-4 px-4 sm:px-6">
        <Logo />
        <nav aria-label="Main" className="flex items-center gap-0.5">
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
                  'rounded-md px-2.5 py-1 text-sm font-medium transition-colors',
                  active ? 'bg-surface-3 text-fg' : 'text-fg-muted hover:text-fg',
                )}
              >
                {n.label}
              </Link>
            );
          })}
        </nav>
        <div className="ml-auto flex items-center gap-1.5">
          <Button
            asChild
            variant="primary"
            size="sm"
            className={cn('hidden sm:inline-flex', hideNew && 'sm:hidden')}
          >
            <Link href="/new">
              <PlusIcon /> New interview
            </Link>
          </Button>
          <ThemeToggle />
          <UserMenu />
        </div>
      </div>
    </header>
  );
}
