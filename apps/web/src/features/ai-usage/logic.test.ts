import type { AiUsageStatus } from '@ipp/contracts';
import { describe, expect, it } from 'vitest';
import {
  activeCaps,
  costFallbackActive,
  defaultsLine,
  dollarsInput,
  formatMicros,
  formatPerMillion,
  formOf,
  lowCapWarning,
  parseDollars,
  parseMessages,
  parseTokens,
  priceLine,
  readLimitsForm,
  untrackedNote,
} from './logic';

const value = (p: ReturnType<typeof parseTokens>) => (p.ok ? p.value : `error: ${p.error}`);

describe('parsing', () => {
  it('reads dollars with up to two decimals as micro-dollars', () => {
    expect(value(parseDollars('5'))).toBe(5_000_000);
    expect(value(parseDollars('$2.50'))).toBe(2_500_000);
    expect(value(parseDollars(' 0.75 '))).toBe(750_000);
    expect(value(parseDollars('.5'))).toBe(500_000);
    expect(value(parseDollars('1,000'))).toBe(1_000_000_000);
    expect(value(parseDollars(''))).toBeNull();
    expect(value(parseDollars('   '))).toBeNull();
    for (const bad of ['2.555', 'abc', '-1', '1e3', '$'])
      expect(parseDollars(bad).ok, bad).toBe(false);
    expect(value(parseDollars('0'))).toMatch(/smallest limit is \$0\.01/);
    expect(value(parseDollars('1000.01'))).toMatch(/largest limit is \$1,000\.00/);
  });

  it('reads tokens with separators or a k/M suffix', () => {
    expect(value(parseTokens('2,000,000'))).toBe(2_000_000);
    expect(value(parseTokens('2000000'))).toBe(2_000_000);
    expect(value(parseTokens('2M'))).toBe(2_000_000);
    expect(value(parseTokens('2m'))).toBe(2_000_000);
    expect(value(parseTokens('1.1M'))).toBe(1_100_000);
    expect(value(parseTokens('500k'))).toBe(500_000);
    expect(value(parseTokens('500 K'))).toBe(500_000);
    expect(value(parseTokens('2 000 000'))).toBe(2_000_000);
    expect(value(parseTokens(''))).toBeNull();
    expect(value(parseTokens('2.5'))).toMatch(/whole number/);
    for (const bad of ['2MM', 'two', '-5', '2G', 'M']) expect(parseTokens(bad).ok, bad).toBe(false);
    expect(value(parseTokens('999'))).toMatch(/smallest limit is 1,000/);
    expect(value(parseTokens('1.5B'))).toMatch(/Enter a number/);
    expect(value(parseTokens('1001M'))).toMatch(/largest limit is 1,000,000,000/);
  });

  it('reads whole messages', () => {
    expect(value(parseMessages('300'))).toBe(300);
    expect(value(parseMessages('1,500'))).toBe(1_500);
    expect(value(parseMessages(''))).toBeNull();
    expect(parseMessages('2.5').ok).toBe(false);
    expect(value(parseMessages('0'))).toMatch(/smallest/);
    expect(value(parseMessages('100001'))).toMatch(/largest/);
  });
});

describe('the form', () => {
  it('wants at least one cap', () => {
    expect(readLimitsForm({ cost: '', tokens: '', messages: '' })).toEqual({
      ok: false,
      errors: { form: 'Set at least one limit, or use the defaults.' },
    });
  });

  it('reports each field it cannot read', () => {
    const r = readLimitsForm({ cost: 'x', tokens: '2M', messages: '1.5' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(Object.keys(r.errors).sort()).toEqual(['cost', 'messages']);
  });

  it('gives the caps, blank ones null', () => {
    expect(readLimitsForm({ cost: '3', tokens: '', messages: '' })).toEqual({
      ok: true,
      limits: { costMicros: 3_000_000, tokens: null, messages: null },
    });
  });

  it('fills back from saved caps', () => {
    expect(formOf(null)).toEqual({ cost: '', tokens: '', messages: '' });
    expect(formOf({ costMicros: 2_500_000, tokens: 2_000_000, messages: 40 })).toEqual({
      cost: '2.50',
      tokens: '2,000,000',
      messages: '40',
    });
    expect(dollarsInput(5_000_000)).toBe('5');
  });

  it('warns about a cap that could stop an interview early, without refusing it', () => {
    expect(lowCapWarning({ costMicros: 50_000, tokens: null, messages: null })).toMatch(
      /This cost limit is low/,
    );
    expect(lowCapWarning({ costMicros: 50_000, tokens: 5_000, messages: null })).toMatch(
      /These limits are low/,
    );
    expect(lowCapWarning({ costMicros: 5_000_000, tokens: 2_000_000, messages: 50 })).toBeNull();
  });
});

describe('formatting', () => {
  it('formats micro-dollars, never showing a small cost as zero', () => {
    expect(formatMicros(0)).toBe('$0.00');
    expect(formatMicros(1)).toBe('less than $0.01');
    expect(formatMicros(420_000)).toBe('$0.42');
    expect(formatMicros(1_234_560_000)).toBe('$1,234.56');
  });

  it('formats prices per million tokens', () => {
    expect(formatPerMillion(4)).toBe('$4');
    expect(formatPerMillion(0.2)).toBe('$0.20');
    expect(formatPerMillion(0.075)).toBe('$0.075');
    expect(formatPerMillion(0.125)).toBe('$0.125');
    expect(formatPerMillion(1.5)).toBe('$1.50');
    expect(priceLine({ input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 })).toBe(
      'about $4 per million input tokens and $20 per million output tokens',
    );
  });
});

const status = (over: Partial<AiUsageStatus> = {}): AiUsageStatus => ({
  usage: {
    day: '2026-11-27',
    messages: 12,
    inputTokens: 100_000,
    outputTokens: 5_000,
    totalTokens: 105_000,
    costMicros: 420_000,
    unpricedTokens: 0,
  },
  limits: null,
  defaults: { messages: 1500, inputTokens: 5_000_000, outputTokens: 500_000 },
  costTracking: {
    provider: 'anthropic',
    model: 'claude-opus-5-5',
    tracked: true,
    source: 'list',
    price: { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 },
  },
  resetsAt: '2026-11-28T00:00:00.000Z',
  ...over,
});

describe('which caps apply', () => {
  it('the defaults, with input and output tokens apart', () => {
    expect(activeCaps(status()).map((c) => [c.label, c.text])).toEqual([
      ['Messages', '12 of 1,500'],
      ['Input tokens', '100,000 of 5,000,000'],
      ['Output tokens', '5,000 of 500,000'],
    ]);
    const off = status({ defaults: { messages: 1500, inputTokens: 0, outputTokens: 0 } });
    expect(activeCaps(off).map((c) => c.kind)).toEqual(['messages']);
  });

  it('the user’s own, tokens counted together', () => {
    const s = status({ limits: { costMicros: 5_000_000, tokens: 1_000_000, messages: null } });
    expect(activeCaps(s).map((c) => [c.label, c.text, c.share])).toEqual([
      ['Estimated cost', '$0.42 of $5.00', 0.084],
      ['Tokens', '105,000 of 1,000,000', 0.105],
    ]);
  });

  it('cost alone with unpriced usage: the default message limit as well', () => {
    const s = status({ limits: { costMicros: 5_000_000, tokens: null, messages: null } });
    expect(costFallbackActive(s)).toBe(false);
    const unpriced = { ...s, usage: { ...s.usage, unpricedTokens: 10 } };
    expect(costFallbackActive(unpriced)).toBe(true);
    expect(activeCaps(unpriced).map((c) => c.label)).toEqual([
      'Estimated cost',
      'Messages (default)',
    ]);
  });

  it('describes the defaults, leaving out a cap that is off', () => {
    expect(defaultsLine(status().defaults)).toBe(
      '1,500 messages, 5,000,000 input tokens and 500,000 output tokens a day',
    );
    expect(defaultsLine({ messages: 1500, inputTokens: 0, outputTokens: 0 })).toBe(
      '1,500 messages a day',
    );
  });

  it('says when the model has no price', () => {
    expect(untrackedNote(status().costTracking, { messages: 1500 })).toBeNull();
    expect(untrackedNote(null, { messages: 1500 })).toBeNull();
    const note = untrackedNote(
      { provider: 'gemini', model: 'gemini-x', tracked: false, source: null, price: null },
      { messages: 1500 },
    );
    expect(note).toMatch(/gemini-x have no known price/);
    expect(note).toMatch(/1,500 messages a day/);
    expect(note).not.toMatch(/—/);
  });
});
