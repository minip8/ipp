'use client';
import { ArrowRightIcon } from 'lucide-react';
import Link from 'next/link';
import { useMe } from '@/lib/queries';
import { tabHref } from '@/lib/track';
import { AppHeader } from './app-header';
import { Logo } from './logo';
import { ThemeToggle } from './theme-toggle';
import { Button } from './ui/button';

/**
 * The home page is the same URL signed in or out; only its links differ. A guest (in a room by
 * its link, no account) is shown the signed-out links, since the app pages would refuse them.
 */
function useAccount() {
  const me = useMe();
  return { loading: me.isPending, account: me.data && !me.data.guest ? me.data : null };
}

/** Signed in, the home page carries the app's own header, so the links do not move about. */
export function LandingHeader() {
  const { loading, account } = useAccount();
  if (account) return <AppHeader />;
  return (
    <header className="mx-auto flex h-14 max-w-6xl items-center px-4 sm:px-6">
      <Logo />
      <nav className="ml-auto flex items-center gap-1.5" aria-label="Account">
        <ThemeToggle />
        {!loading && (
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
    </header>
  );
}

/**
 * The hero's buttons: signed in, straight into each track (a coding interview, the quant
 * questions); signed out, to the account pages.
 */
export function LandingActions() {
  const { loading, account } = useAccount();
  return (
    <div className="mt-7 flex flex-wrap items-center gap-3">
      {account ? (
        <>
          <Button asChild variant="primary" size="lg">
            <Link href={tabHref('software', 'interviews')}>
              Start a coding interview <ArrowRightIcon />
            </Link>
          </Button>
          <Button asChild variant="secondary" size="lg">
            <Link href={tabHref('quant', 'practice')}>
              Quant questions <ArrowRightIcon />
            </Link>
          </Button>
        </>
      ) : (
        <Button asChild variant="primary" size="lg">
          <Link href="/sign-up">
            Create an account <ArrowRightIcon />
          </Link>
        </Button>
      )}
      {!loading && !account && (
        <Button asChild variant="ghost" size="lg">
          <Link href="/sign-in">I have an account</Link>
        </Button>
      )}
    </div>
  );
}
