import { describe, expect, it } from 'vitest';
import {
  choiceFor,
  DEFAULT_MODEL_VALUE,
  expiresIn,
  keyFormatError,
  keyPlaceholder,
  maskedKey,
  normalizeKey,
  otherProvider,
  pickerOptions,
  pickerValue,
  problemText,
} from './logic';

const KEY = 'sk-ant-api03-abcdefghijklmnopqrstuvwxyz_0123456789-ABCD';
const OPENAI = 'sk-proj-abcdefghijklmnopqrstuvwxyz0123';
const GEMINI = 'AIzaSyAbcdefghijklmnopqrstuvwxyz0123456';

describe('key format', () => {
  it('accepts a pasted key, with surrounding whitespace', () => {
    expect(keyFormatError(KEY)).toBeNull();
    expect(keyFormatError(`  ${KEY}\n`)).toBeNull();
    expect(normalizeKey(`  ${KEY}\n`)).toBe(KEY);
    expect(keyFormatError(OPENAI, 'openai')).toBeNull();
    expect(keyFormatError(GEMINI, 'gemini')).toBeNull();
  });
  it('explains what is wrong', () => {
    expect(keyFormatError('')).toMatch(/Paste/);
    expect(keyFormatError(OPENAI)).toMatch(/looks like an OpenAI key, but Anthropic is selected/);
    expect(keyFormatError(KEY, 'gemini')).toMatch(/Anthropic key, but Google Gemini/);
    expect(keyFormatError('hello')).toMatch(/start with/);
    expect(keyFormatError('hello', 'gemini')).toMatch(/“AIza” or “AQ\.”/);
    expect(keyFormatError(`${KEY} ${KEY}`)).toMatch(/spaces/);
    expect(keyFormatError('sk-ant-abc')).toMatch(/incomplete/);
    expect(keyFormatError(`sk-ant-${'a'.repeat(300)}`)).toMatch(/too long/);
  });
  it('notices a key from another provider', () => {
    expect(otherProvider(OPENAI, 'anthropic')).toBe('openai');
    expect(otherProvider(OPENAI, 'openai')).toBeNull();
    expect(otherProvider('hello', 'openai')).toBeNull();
    expect(keyPlaceholder('openrouter')).toBe('sk-or-…');
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
    expect(maskedKey('ABCD', 'gemini')).toBe('AIza…ABCD');
    expect(maskedKey(null)).toBe('your key');
  });
  it('problems name the provider where it matters', () => {
    expect(problemText('invalid', 'openai')).toMatch(/^OpenAI no longer accepts it/);
    expect(problemText('billing', null)).toMatch(/credit/);
  });
});

describe('model picker', () => {
  const list = {
    provider: 'anthropic' as const,
    defaultModel: 'claude-opus-5-5',
    source: 'live' as const,
    models: [
      { id: 'claude-fable-5-2', label: 'Claude Fable 5.2', default: false },
      { id: 'claude-opus-5-5', label: 'Claude Opus 5.5', default: true },
      { id: 'claude-haiku-5-5', label: 'Claude Haiku 5.5', default: false },
    ],
  };
  it('the default first, then the other models; an unlisted choice is kept', () => {
    expect(pickerOptions(list, 'claude-opus-5-5', null).map((o) => o.value)).toEqual([
      DEFAULT_MODEL_VALUE,
      'claude-fable-5-2',
      'claude-haiku-5-5',
    ]);
    expect(pickerOptions(list, 'x', null)[0]?.label).toBe('Default: Claude Opus 5.5');
    expect(pickerOptions(list, 'x', 'claude-gone').at(-1)).toMatchObject({ value: 'claude-gone' });
    // No list (loading, failed, no key): just the default.
    expect(pickerOptions(undefined, 'claude-opus-5-5', null)).toEqual([
      { value: DEFAULT_MODEL_VALUE, label: 'Default: claude-opus-5-5', hint: 'claude-opus-5-5' },
    ]);
  });
  it('a choice for another provider shows as the default and is flagged', () => {
    const c = { provider: 'openai' as const, id: 'gpt-x' };
    expect(pickerValue(c, 'openai')).toEqual({ value: 'gpt-x', stale: null });
    expect(pickerValue(c, 'anthropic')).toEqual({ value: DEFAULT_MODEL_VALUE, stale: c });
    expect(pickerValue(null, 'anthropic')).toEqual({ value: DEFAULT_MODEL_VALUE, stale: null });
    expect(choiceFor(DEFAULT_MODEL_VALUE, 'openai')).toBeNull();
    expect(choiceFor('gpt-y', 'openai')).toEqual({ provider: 'openai', id: 'gpt-y' });
  });
});
