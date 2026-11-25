'use client';
import { ArrowRightIcon } from 'lucide-react';
import Link from 'next/link';
import { useMe } from '@/lib/queries';
import { ThemeToggle } from './theme-toggle';
import { Button } from './ui/button';
import { UserMenu } from './user-menu';

/**
 * The home page is the same URL signed in or out; only its links differ. A guest (in a room by
 * its link, no account) is shown the signed-out links, since the app pages would refuse them.
 */
function useAccount() {
  const me = useMe();
  return { loading: me.isPending, account: me.data && !me.data.guest ? me.data : null };
}

export function LandingNav() {
  const { loading, account } = useAccount();
  return (
    <nav className="ml-auto flex items-center gap-1.5" aria-label="Account">
      {account ? (
        <>
          <Button asChild variant="ghost" size="sm">
            <Link href="/dashboard">Interviews</Link>
          </Button>
          <Button asChild variant="ghost" size="sm">
            <Link href="/quiz">Quizzes</Link>
          </Button>
          <ThemeToggle />
          <UserMenu />
        </>
      ) : (
        <>
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
        </>
      )}
    </nav>
  );
}

/** The hero's two buttons: straight into the app when signed in, to the account pages when not. */
export function LandingActions() {
  const { loading, account } = useAccount();
  return (
    <div className="mt-7 flex flex-wrap items-center gap-3">
      <Button asChild variant="primary" size="lg">
        <Link href={account ? '/new' : '/sign-up'}>
          Start a practice interview <ArrowRightIcon />
        </Link>
      </Button>
      {!loading && (
        <Button asChild variant="ghost" size="lg">
          {account ? (
            <Link href="/dashboard">Go to your interviews</Link>
          ) : (
            <Link href="/sign-in">I have an account</Link>
          )}
        </Button>
      )}
    </div>
  );
}
