'use client';
import Link from 'next/link';
import { useMe } from '@/lib/queries';
import { ThemeToggle } from './theme-toggle';
import { Button } from './ui/button';

export function LandingNav() {
  const me = useMe();
  return (
    <nav className="ml-auto flex items-center gap-1.5" aria-label="Account">
      <ThemeToggle />
      {me.data ? (
        <Button asChild variant="primary" size="sm">
          <Link href="/dashboard">Open dashboard</Link>
        </Button>
      ) : (
        <>
          <Button asChild variant="ghost" size="sm">
            <Link href="/sign-in">Sign in</Link>
          </Button>
          <Button asChild variant="primary" size="sm">
            <Link href="/sign-up">Get started</Link>
          </Button>
        </>
      )}
    </nav>
  );
}
