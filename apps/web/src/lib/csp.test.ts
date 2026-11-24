import { describe, expect, it } from 'vitest';
import { buildCsp, newNonce } from './csp';

const directive = (csp: string, name: string) =>
  csp
    .split(';')
    .map((d) => d.trim())
    .find((d) => d.startsWith(`${name} `)) ?? '';

describe('content security policy', () => {
  it('production scripts need the nonce: no unsafe-inline, no unsafe-eval', () => {
    const csp = buildCsp({ nonce: 'abc123', dev: false, wsUrl: 'wss://interview.example.com' });
    const script = directive(csp, 'script-src');
    expect(script).toContain("'nonce-abc123'");
    expect(script).toContain("'strict-dynamic'");
    expect(script).not.toContain('unsafe-inline');
    expect(script).not.toContain('unsafe-eval');
    expect(directive(csp, 'connect-src')).toBe(
      "connect-src 'self' ws://interview.example.com wss://interview.example.com",
    );
    expect(directive(csp, 'worker-src')).toBe("worker-src 'self' blob:");
    expect(directive(csp, 'frame-ancestors')).toBe("frame-ancestors 'none'");
    expect(directive(csp, 'object-src')).toBe("object-src 'none'");
    // Inline styles stay allowed (Monaco); a nonce there would switch that off.
    expect(directive(csp, 'style-src')).toBe("style-src 'self' 'unsafe-inline'");
  });

  it('development adds eval (React debugging) and local sockets', () => {
    const csp = buildCsp({ nonce: 'n', dev: true, wsUrl: 'ws://localhost:4000' });
    expect(directive(csp, 'script-src')).toContain("'unsafe-eval'");
    expect(directive(csp, 'connect-src')).toContain('ws://localhost:*');
  });

  it('nonces are fresh and unguessable', () => {
    const a = newNonce();
    expect(a).toMatch(/^[A-Za-z0-9+/]{22}==$/);
    expect(newNonce()).not.toBe(a);
  });
});
