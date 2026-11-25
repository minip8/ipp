'use client';
import { useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { type FormEvent, useEffect, useState } from 'react';
import { ApiRequestError } from '@/lib/api';
import { auth, safeNext, socialErrorMessage } from '@/lib/auth';
import { qk, useConfig, useMe } from '@/lib/queries';
import { Logo } from './logo';
import { InlineError, useRetryCountdown } from './states';
import { Button } from './ui/button';
import { FieldHint, Input, Label } from './ui/input';
import { Spinner } from './ui/spinner';

function GitHubIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden className="size-4" fill="currentColor">
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
    </svg>
  );
}

function GoogleIcon() {
  return (
    <svg viewBox="0 0 18 18" aria-hidden className="size-4">
      <path
        fill="#4285F4"
        d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62Z"
      />
      <path
        fill="#34A853"
        d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.8.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.33A9 9 0 0 0 9 18Z"
      />
      <path
        fill="#FBBC05"
        d="M3.97 10.72a5.4 5.4 0 0 1 0-3.44V4.95H.96a9 9 0 0 0 0 8.1l3.01-2.33Z"
      />
      <path
        fill="#EA4335"
        d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58A9 9 0 0 0 .96 4.95l3.01 2.33C4.68 5.16 6.66 3.58 9 3.58Z"
      />
    </svg>
  );
}

export function AuthForm({ mode }: { mode: 'sign-in' | 'sign-up' }) {
  const router = useRouter();
  const search = useSearchParams();
  const next = safeNext(search.get('next'));
  const qc = useQueryClient();
  const config = useConfig();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  // An OAuth flow that failed at the provider or at account linking returns here with ?error=.
  const socialError = socialErrorMessage(search.get('error'));
  const [error, setError] = useState<unknown>(socialError ? new Error(socialError) : null);
  const wait = useRetryCountdown(error);
  const isSignUp = mode === 'sign-up';
  const hasSocial = Boolean(config.data?.githubAuth || config.data?.googleAuth);
  // Someone who already has a session has nothing to do here: send them where they were going.
  // A guest (in a room by its link) is the exception; this is where they get a real account.
  const me = useMe();
  const signedIn = Boolean(me.data && !me.data.guest);
  useEffect(() => {
    if (signedIn) router.replace(next);
  }, [signedIn, next, router]);

  async function social(provider: 'github' | 'google') {
    try {
      await auth.social(provider, next);
    } catch (err) {
      setError(err);
    }
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (isSignUp) await auth.signUp(name.trim(), email.trim(), password);
      else await auth.signIn(email.trim(), password);
      // Everything cached so far was fetched signed out (including "no session"); drop it.
      qc.removeQueries({ queryKey: qk.me });
      await qc.invalidateQueries();
      router.replace(next);
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  }

  const fieldError = (field: 'email' | 'password') =>
    error instanceof ApiRequestError &&
    (error.status === 401 || error.status === 422 || error.status === 400) &&
    field === 'password';

  if (signedIn) return <div className="min-h-dvh bg-bg" />;

  return (
    <div className="flex min-h-dvh flex-col bg-bg">
      <header className="flex h-14 items-center px-4 sm:px-6">
        <Logo />
      </header>
      <main className="flex flex-1 items-start justify-center px-4 pt-[8vh] pb-16">
        <div className="w-full max-w-[380px]">
          <h1 className="text-xl font-semibold tracking-tight">
            {isSignUp ? 'Create your account' : 'Welcome back'}
          </h1>

          {hasSocial && (
            <>
              <div className="mt-6 space-y-2.5">
                {config.data?.googleAuth && (
                  <Button size="lg" className="w-full" onClick={() => social('google')}>
                    <GoogleIcon /> Continue with Google
                  </Button>
                )}
                {config.data?.githubAuth && (
                  <Button size="lg" className="w-full" onClick={() => social('github')}>
                    <GitHubIcon /> Continue with GitHub
                  </Button>
                )}
              </div>
              <div className="my-5 flex items-center gap-3 text-2xs font-medium tracking-wider text-fg-subtle uppercase">
                <span className="h-px flex-1 bg-border" /> or with email{' '}
                <span className="h-px flex-1 bg-border" />
              </div>
            </>
          )}

          <form
            onSubmit={onSubmit}
            className={hasSocial ? 'space-y-4' : 'mt-6 space-y-4'}
            noValidate={false}
          >
            {isSignUp && (
              <div className="space-y-1.5">
                <Label htmlFor="name">Name</Label>
                <Input
                  id="name"
                  autoComplete="name"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  maxLength={80}
                />
              </div>
            )}
            <div className="space-y-1.5">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                aria-invalid={fieldError('email') || undefined}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                autoComplete={isSignUp ? 'new-password' : 'current-password'}
                required
                minLength={isSignUp ? 8 : undefined}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                aria-invalid={fieldError('password') || undefined}
                aria-describedby={isSignUp ? 'password-hint' : undefined}
              />
              {isSignUp && <FieldHint id="password-hint">At least 8 characters.</FieldHint>}
            </div>
            <InlineError error={error} />
            <Button
              type="submit"
              variant="primary"
              size="lg"
              className="w-full"
              disabled={busy || wait > 0}
            >
              {busy && <Spinner />}
              {wait > 0 ? `Try again in ${wait}s` : isSignUp ? 'Create account' : 'Sign in'}
            </Button>
          </form>

          <p className="mt-6 text-sm text-fg-muted">
            {isSignUp ? 'Already have an account? ' : 'New here? '}
            <Link
              className="font-medium text-accent-text hover:underline"
              href={`${isSignUp ? '/sign-in' : '/sign-up'}${search.get('next') ? `?next=${encodeURIComponent(next)}` : ''}`}
            >
              {isSignUp ? 'Sign in' : 'Create an account'}
            </Link>
          </p>
        </div>
      </main>
    </div>
  );
}
