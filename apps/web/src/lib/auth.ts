/**
 * Better Auth is mounted by the API at /api/auth (proxied through the web origin, so the session
 * cookie is first-party). We call its documented REST endpoints directly rather than shipping
 * the Better Auth client: sign-in/email, sign-up/email, sign-in/social, sign-out.
 */
import { ApiRequestError } from './api';

async function authPost(path: string, body: unknown): Promise<unknown> {
  let res: Response;
  try {
    res = await fetch(`/api/auth${path}`, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body ?? {}),
    });
  } catch {
    throw new ApiRequestError(0, 'network', 'Could not reach the server. Check your connection.');
  }
  const json: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const j = (json ?? {}) as {
      message?: string;
      code?: string;
      error?: { message?: string; code?: string; retryAfter?: number };
    };
    const retry =
      Number(res.headers.get('x-retry-after') ?? res.headers.get('retry-after')) ||
      j.error?.retryAfter;
    const message =
      res.status === 429
        ? 'Too many attempts. Wait a moment and try again.'
        : (j.message ?? j.error?.message ?? defaultAuthMessage(res.status));
    throw new ApiRequestError(
      res.status,
      j.code ?? j.error?.code ?? `http_${res.status}`,
      message,
      retry || undefined,
    );
  }
  return json;
}

function defaultAuthMessage(status: number) {
  if (status === 401) return 'Email or password is incorrect.';
  if (status === 422 || status === 400) return 'Check the details and try again.';
  return 'Sign-in is unavailable right now.';
}

export const auth = {
  signIn: (email: string, password: string) =>
    authPost('/sign-in/email', { email, password, rememberMe: true }),
  signUp: (name: string, email: string, password: string) =>
    authPost('/sign-up/email', { name, email, password }),
  signOut: () => authPost('/sign-out', {}),
  /**
   * Starts an OAuth flow; the API answers with the provider URL to visit. Failures come back to
   * the sign-in page as `?error=<code>` (see `socialErrorMessage`).
   */
  async social(provider: 'github' | 'google', callbackPath: string) {
    const json = (await authPost('/sign-in/social', {
      provider,
      callbackURL: new URL(callbackPath, window.location.origin).toString(),
      errorCallbackURL: new URL('/sign-in', window.location.origin).toString(),
    })) as { url?: string } | null;
    if (json?.url) window.location.assign(json.url);
  },
};

/**
 * Only allow same-origin relative redirects after sign-in. Browsers strip tabs/newlines from URLs
 * and treat `\` as `/`, so `/\t/evil.com` or `/\\evil.com` would become `//evil.com`: reject any
 * control character or backslash, and confirm the resolved URL stays on the same origin.
 */
export function safeNext(next: string | null | undefined, fallback = '/dashboard'): string {
  if (!next?.startsWith('/') || next.startsWith('//')) return fallback;
  // biome-ignore lint/suspicious/noControlCharactersInRegex: rejecting control characters is the point
  if (/[\u0000-\u001f\u007f\\]/.test(next)) return fallback;
  const base = 'http://ipp.invalid';
  let url: URL;
  try {
    url = new URL(next, base);
  } catch {
    return fallback;
  }
  // `/.//evil.com` normalises to the path `//evil.com`, which is protocol-relative again.
  if (url.origin !== base || url.pathname.startsWith('//')) return fallback;
  return url.pathname + url.search + url.hash;
}

/** Human-readable text for the `error` query parameter an OAuth provider flow returns with. */
export function socialErrorMessage(code: string | null): string | null {
  if (!code) return null;
  if (code === 'account_not_linked') {
    return 'An account with that email already exists. Sign in with your email and password instead.';
  }
  if (code === 'access_denied') return 'Sign-in was cancelled.';
  return 'That sign-in did not complete. Please try again.';
}
