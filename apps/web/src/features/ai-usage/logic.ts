/**
 * Pure rules of the "Daily limit" settings: reading what the user typed (dollars, "2M" tokens,
 * messages), formatting usage, and which caps apply. The server validates again
 * (`SetAiLimitsRequest`); these rules only make the form say what is wrong before it is sent.
 */
import {
  AI_LIMIT_BOUNDS,
  type AiCostTracking,
  type AiDailyLimits,
  type AiModelPrice,
  type AiUsageStatus,
} from '@ipp/contracts';

export type Parsed = { ok: true; value: number | null } | { ok: false; error: string };

const blank = (s: string) => s.trim() === '';
/** Thousands separators people type: commas, spaces, underscores, thin spaces. */
const SEPARATORS = /[,\s_  ]/g;

/** Dollars with at most two decimals ("5", "$2.50", "0.75") as micro-dollars; blank is no cap. */
export function parseDollars(raw: string): Parsed {
  if (blank(raw)) return { ok: true, value: null };
  const s = raw.trim().replace(/^\$/, '').replace(SEPARATORS, '');
  if (!/^\d+(\.\d{0,2})?$|^\.\d{1,2}$/.test(s))
    return { ok: false, error: 'Enter an amount in dollars, like 5 or 2.50.' };
  const [whole = '0', cents = ''] = s.split('.');
  const value = Number(whole || '0') * 1_000_000 + Number(cents.padEnd(2, '0')) * 10_000;
  return inBounds(value, 'costMicros');
}

/** Tokens as "2,000,000", "2000000", "2M", "1.5m", "500k" or "500K"; blank is no cap. */
export function parseTokens(raw: string): Parsed {
  if (blank(raw)) return { ok: true, value: null };
  const s = raw.trim().replace(SEPARATORS, '').toLowerCase();
  const m = /^(\d+(?:\.\d+)?|\.\d+)([km])?$/.exec(s);
  if (!m) return { ok: false, error: 'Enter a number of tokens, like 2,000,000 or 2M.' };
  const scale = m[2] === 'm' ? 1_000_000 : m[2] === 'k' ? 1_000 : 1;
  const exact = Number(m[1]) * scale;
  // 1.1 × 1,000,000 is 1100000.0000000002 in floating point.
  const value = Math.round(exact);
  if (Math.abs(exact - value) > 1e-6)
    return { ok: false, error: 'Enter a whole number of tokens.' };
  return inBounds(value, 'tokens');
}

/** A whole number of messages; blank is no cap. */
export function parseMessages(raw: string): Parsed {
  if (blank(raw)) return { ok: true, value: null };
  const s = raw.trim().replace(SEPARATORS, '');
  if (!/^\d+$/.test(s)) return { ok: false, error: 'Enter a whole number of messages.' };
  return inBounds(Number(s), 'messages');
}

function inBounds(value: number, field: keyof typeof AI_LIMIT_BOUNDS): Parsed {
  const b = AI_LIMIT_BOUNDS[field];
  const show = (n: number) =>
    field === 'costMicros' ? formatMicros(n) : field === 'tokens' ? formatCount(n) : String(n);
  if (value < b.min) return { ok: false, error: `The smallest limit is ${show(b.min)}.` };
  if (value > b.max) return { ok: false, error: `The largest limit is ${show(b.max)}.` };
  return { ok: true, value };
}

export interface LimitsForm {
  cost: string;
  tokens: string;
  messages: string;
}

export type FormErrors = Partial<Record<keyof LimitsForm | 'form', string>>;

/** The caps the form describes, or what is wrong with it (each field, and "at least one"). */
export function readLimitsForm(
  f: LimitsForm,
): { ok: true; limits: AiDailyLimits } | { ok: false; errors: FormErrors } {
  const cost = parseDollars(f.cost);
  const tokens = parseTokens(f.tokens);
  const messages = parseMessages(f.messages);
  const errors: FormErrors = {};
  if (!cost.ok) errors.cost = cost.error;
  if (!tokens.ok) errors.tokens = tokens.error;
  if (!messages.ok) errors.messages = messages.error;
  if (!cost.ok || !tokens.ok || !messages.ok) return { ok: false, errors };
  if (cost.value === null && tokens.value === null && messages.value === null)
    return {
      ok: false,
      errors: { form: 'Set at least one limit, or use the defaults.' },
    };
  return {
    ok: true,
    limits: { costMicros: cost.value, tokens: tokens.value, messages: messages.value },
  };
}

/** The form as saved caps fill it (empty for a cap that is not set). */
export function formOf(limits: AiDailyLimits | null): LimitsForm {
  return {
    cost: limits?.costMicros != null ? dollarsInput(limits.costMicros) : '',
    tokens: limits?.tokens != null ? formatCount(limits.tokens) : '',
    messages: limits?.messages != null ? String(limits.messages) : '',
  };
}

/** Micro-dollars as an input value: "5", "2.50". */
export function dollarsInput(micros: number): string {
  const cents = Math.round(micros / 10_000);
  return cents % 100 === 0 ? String(cents / 100) : (cents / 100).toFixed(2);
}

/** Micro-dollars for display: "$0.42", "$12.00", "less than $0.01" (never rounds up to zero). */
export function formatMicros(micros: number): string {
  if (micros > 0 && micros < 5_000) return 'less than $0.01';
  return `$${(micros / 1_000_000).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/** "2,000,000". */
export const formatCount = (n: number) => n.toLocaleString('en-US');

/** A list price per million tokens: "$4", "$0.20", "$0.075". */
export function formatPerMillion(dollars: number): string {
  if (Number.isInteger(dollars)) return `$${dollars.toLocaleString('en-US')}`;
  return `$${dollars.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 3 })}`;
}

/** "about $4 per million input tokens and $20 per million output tokens". */
export function priceLine(p: AiModelPrice): string {
  return `about ${formatPerMillion(p.input)} per million input tokens and ${formatPerMillion(p.output)} per million output tokens`;
}

export type CapKind = 'cost' | 'tokens' | 'messages' | 'inputTokens' | 'outputTokens';

export interface ActiveCap {
  kind: CapKind;
  label: string;
  used: number;
  cap: number;
  /** "$0.42 of $5.00", "12 of 1,500". */
  text: string;
  /** 0..1 of the cap used. */
  share: number;
}

/**
 * The caps that apply today and how much of each is used: the user's own, or the server
 * defaults (input and output tokens capped separately; a default of 0 is off). When cost is the
 * only cap and some of today's usage was unpriced, the default message limit applies too.
 */
export function activeCaps(s: AiUsageStatus): ActiveCap[] {
  const u = s.usage;
  const cap = (kind: CapKind, label: string, used: number, max: number): ActiveCap => ({
    kind,
    label,
    used,
    cap: max,
    text:
      kind === 'cost'
        ? `${formatMicros(used)} of ${formatMicros(max)}`
        : `${formatCount(used)} of ${formatCount(max)}`,
    share: max > 0 ? Math.min(1, used / max) : 1,
  });
  if (!s.limits) {
    const out = [cap('messages', 'Messages', u.messages, s.defaults.messages)];
    if (s.defaults.inputTokens > 0)
      out.push(cap('inputTokens', 'Input tokens', u.inputTokens, s.defaults.inputTokens));
    if (s.defaults.outputTokens > 0)
      out.push(cap('outputTokens', 'Output tokens', u.outputTokens, s.defaults.outputTokens));
    return out;
  }
  const l = s.limits;
  const out: ActiveCap[] = [];
  if (l.costMicros !== null) out.push(cap('cost', 'Estimated cost', u.costMicros, l.costMicros));
  if (l.tokens !== null) out.push(cap('tokens', 'Tokens', u.totalTokens, l.tokens));
  if (l.messages !== null) out.push(cap('messages', 'Messages', u.messages, l.messages));
  if (costFallbackActive(s))
    out.push(cap('messages', 'Messages (default)', u.messages, s.defaults.messages));
  return out;
}

/** "1,500 messages, 5,000,000 input tokens and 500,000 output tokens a day" (a 0 cap is off). */
export function defaultsLine(d: AiUsageStatus['defaults']): string {
  const parts = [`${formatCount(d.messages)} messages`];
  if (d.inputTokens > 0) parts.push(`${formatCount(d.inputTokens)} input tokens`);
  if (d.outputTokens > 0) parts.push(`${formatCount(d.outputTokens)} output tokens`);
  const last = parts.pop();
  return `${parts.length ? `${parts.join(', ')} and ` : ''}${last} a day`;
}

/** Cost is the only cap and today has unpriced usage: the default message limit applies too. */
export function costFallbackActive(s: AiUsageStatus): boolean {
  const l = s.limits;
  return (
    !!l &&
    l.costMicros !== null &&
    l.tokens === null &&
    l.messages === null &&
    s.usage.unpricedTokens > 0
  );
}

/**
 * What to say under the dollar field when the current model's calls cannot be costed: they will
 * not count toward a cost limit, and what applies instead. Null when cost is tracked.
 */
export function untrackedNote(
  t: AiCostTracking | null,
  defaults: { messages: number },
): string | null {
  if (!t || t.tracked) return null;
  return `Calls on ${t.model} have no known price, so they will not count toward a cost limit. If cost is your only limit, the default limit of ${formatCount(defaults.messages)} messages a day applies to them as well; set a token or message limit to choose your own.`;
}

/**
 * Caps low enough to stop an interview in its first minutes (a warning, not a refusal): about a
 * dime, 100,000 tokens (a few model calls with a problem in context), 10 messages.
 */
export function lowCapWarning(l: AiDailyLimits): string | null {
  const low: string[] = [];
  if (l.costMicros !== null && l.costMicros < 100_000) low.push('cost');
  if (l.tokens !== null && l.tokens < 100_000) low.push('token');
  if (l.messages !== null && l.messages < 10) low.push('message');
  if (low.length === 0) return null;
  const which = low.length === 1 ? `This ${low[0]} limit is` : 'These limits are';
  return `${which} low enough to stop an interview in its first few minutes.`;
}
