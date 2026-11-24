import { describe, expect, it } from 'vitest';
import { expiresIn, keyFormatError, maskedKey, normalizeKey } from './logic';

const KEY = 'sk-ant-api03-abcdefghijklmnopqrstuvwxyz_0123456789-ABCD';

describe('key format', () => {
  it('accepts a pasted key, with surrounding whitespace', () => {
    expect(keyFormatError(KEY)).toBeNull();
    expect(keyFormatError(`  ${KEY}\n`)).toBeNull();
    expect(normalizeKey(`  ${KEY}\n`)).toBe(KEY);
  });
  it('explains what is wrong', () => {
    expect(keyFormatError('')).toMatch(/Paste/);
    expect(keyFormatError('sk-proj-abcdefghijklmnopqrstuvwxyz')).toMatch(/another provider/);
    expect(keyFormatError('hello')).toMatch(/start with/);
    expect(keyFormatError(`${KEY} ${KEY}`)).toMatch(/spaces/);
    expect(keyFormatError('sk-ant-abc')).toMatch(/incomplete/);
    expect(keyFormatError(`sk-ant-${'a'.repeat(300)}`)).toMatch(/too long/);
  });
});

describe('display', () => {
  it('expiry is relative and coarse', () => {
    const now = Date.parse('2026-11-24T10:00:00Z');
    expect(expiresIn('2026-11-25T10:00:00Z', now)).toBe('in 24 hours');
    expect(expiresIn('2026-11-24T10:40:00Z', now)).toBe('in 40 minutes');
    expect(expiresIn('2026-11-24T10:01:00Z', now)).toBe('in 1 minute');
    expect(expiresIn('2026-11-24T10:00:10Z', now)).toBe('in less than a minute');
    expect(expiresIn(null, now)).toBeNull();
  });
  it('never shows more than the last four characters', () => {
    expect(maskedKey('ABCD')).toBe('sk-ant-…ABCD');
    expect(maskedKey(null)).toBe('your key');
  });
});
