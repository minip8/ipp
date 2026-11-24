/** Public runtime configuration. NEXT_PUBLIC_WS_URL is inlined at build time by next.config. */
export function wsBaseUrl(): string {
  const fromEnv = process.env.NEXT_PUBLIC_WS_URL;
  if (fromEnv) return fromEnv.replace(/\/$/, '');
  if (typeof window === 'undefined') return 'ws://localhost:4000';
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${window.location.hostname}:4000`;
}
