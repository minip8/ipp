import { describe, expect, it } from 'vitest';
import { safeNext, socialErrorMessage } from './auth';

describe('safeNext', () => {
  it('keeps same-origin paths', () => {
    expect(safeNext('/pads/abc?x=1#y')).toBe('/pads/abc?x=1#y');
    expect(safeNext('/quiz')).toBe('/quiz');
  });

  it('falls back for missing or absolute values', () => {
    expect(safeNext(null)).toBe('/dashboard');
    expect(safeNext('')).toBe('/dashboard');
    expect(safeNext('https://evil.example')).toBe('/dashboard');
    expect(safeNext('javascript:alert(1)')).toBe('/dashboard');
    expect(safeNext('//evil.example')).toBe('/dashboard');
  });

  it('rejects values a browser would turn into a protocol-relative URL', () => {
    // `?next=/%09/evil.example` decodes to "/\t/evil.example"; URL parsing strips the tab.
    for (const v of [
      '/\t/evil.example',
      '/\n/evil.example',
      '/\r/evil.example',
      '/\\evil.example',
      '/\\/evil.example',
      '/\u0000/evil.example',
    ]) {
      expect(safeNext(v)).toBe('/dashboard');
    }
  });

  it('never returns something that resolves off-origin', () => {
    for (const v of ['/.//evil.example', '/%2F/evil.example', '/a/../../evil.example']) {
      const out = safeNext(v);
      expect(new URL(out, 'https://app.example').origin).toBe('https://app.example');
    }
  });
});

describe('socialErrorMessage', () => {
  it('explains an email that already has a password account', () => {
    expect(socialErrorMessage('account_not_linked')).toMatch(/already exists/);
  });
  it('has a generic message for other codes and none without an error', () => {
    expect(socialErrorMessage('something_else')).toMatch(/did not complete/);
    expect(socialErrorMessage(null)).toBeNull();
  });
});
