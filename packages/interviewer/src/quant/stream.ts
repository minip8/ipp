/**
 * Streaming a quant turn's `message` while the model writes the turn. The turn is one JSON object
 * (`QuantTurnSchema`), and the text arrives in arbitrary pieces, so this reads the object
 * incrementally: `TurnJsonReader` follows the JSON's structure and decodes the top-level `action`
 * and `message` strings as they come (escapes split across pieces included), and `MessageStream`
 * decides what of the message may be shown yet.
 *
 * What is streamed is provisional: the posted message is the parsed turn after `normaliseTurn`
 * (`repairLatexEscapes`, `stripJsonDebris`, `cleanSay`), and it replaces the streamed text under
 * the same id. Both classes are pure (no I/O, no clock) and never throw on malformed input: they
 * simply stop producing text.
 */
import { repairLatexEscapes } from './latex';

type State =
  /** Before the object's `{` (a code fence or whitespace may come first). */
  | 'before'
  /** Inside the object, expecting a key, `,` or `}`. */
  | 'key'
  | 'in_key'
  /** After a key, expecting `:`. */
  | 'colon'
  | 'value'
  | 'in_string'
  /** A number, `true`, `false`, `null`, or a nested object or array being skipped. */
  | 'other'
  | 'done';

const ESCAPES: Record<string, string> = {
  '"': '"',
  '\\': '\\',
  '/': '/',
  b: '\b',
  f: '\f',
  n: '\n',
  r: '\r',
  t: '\t',
};

/** Top-level strings decoded (`message` as it streams, the others once complete). */
type StringField = 'action' | 'message' | 'trade';
const STRING_FIELDS: ReadonlySet<string> = new Set<StringField>(['action', 'message', 'trade']);
/** Top-level scalars kept as their JSON text once complete (a number, `true`, `false`). */
const SCALAR_FIELDS: ReadonlySet<string> = new Set(['quantity', 'reveal']);

/**
 * Follows a JSON object as it streams and decodes its top-level string fields `action`, `trade`
 * and `message`, and the scalars `quantity` and `reveal`. Decoding is `JSON.parse`'s, with one
 * difference that matches `parseModelJson`'s repair: a backslash that starts no valid escape
 * (`\alpha`, `\$`, `\u` without four hex digits) stands for itself.
 */
export class TurnJsonReader {
  private state: State = 'before';
  private key = '';
  private field: StringField | null = null;
  /** An escape begun in a string and not finished yet (`\`, or `\u` and up to three digits). */
  private escape: string | null = null;
  /** Nesting depth and string state of a value being skipped. */
  private skip = { depth: 0, inString: false, escaped: false };
  /** The scalar being read (its key and text so far), when it is one of `SCALAR_FIELDS`. */
  private scalar: { key: string; text: string } | null = null;
  private actionText = '';
  private tradeText = '';
  private messageText = '';
  /** The top-level `action`, once its string is complete. */
  action: string | null = null;
  /** The top-level `trade`, once its string is complete. */
  trade: string | null = null;
  /** The top-level scalars of `SCALAR_FIELDS` read so far, as their JSON text. */
  readonly scalars: Record<string, string> = {};
  /** Whether the `message` string has begun (every field before it is complete). */
  messageStarted = false;
  /** The move fields as they stood when the message began (null before it did). */
  atMessage: { trade: string | null; scalars: Record<string, string> } | null = null;
  /** Whether the `message` string has closed. */
  messageDone = false;

  /** The `message` decoded so far. */
  get message(): string {
    return this.messageText;
  }

  get done(): boolean {
    return this.state === 'done';
  }

  push(chunk: string): void {
    for (const c of chunk) {
      if (this.state === 'done') return;
      this.step(c);
    }
  }

  private step(c: string): void {
    switch (this.state) {
      case 'before':
        if (c === '{') this.state = 'key';
        return;
      case 'key':
        if (c === '"') {
          this.state = 'in_key';
          this.key = '';
        } else if (c === '}') this.state = 'done';
        return;
      case 'in_key':
        if (this.escape !== null) {
          this.key += this.decode(c) ?? '';
          return;
        }
        if (c === '\\') this.escape = '';
        else if (c === '"') this.state = 'colon';
        else this.key += c;
        return;
      case 'colon':
        if (c === ':') this.state = 'value';
        return;
      case 'value':
        if (/\s/.test(c)) return;
        if (c === '"') {
          this.state = 'in_string';
          this.field = STRING_FIELDS.has(this.key) ? (this.key as StringField) : null;
          if (this.field === 'action') this.actionText = '';
          if (this.field === 'trade') this.tradeText = '';
          if (this.field === 'message' && !this.messageStarted) {
            this.messageStarted = true;
            this.atMessage = { trade: this.trade, scalars: { ...this.scalars } };
          }
          return;
        }
        this.state = 'other';
        this.skip = { depth: 0, inString: false, escaped: false };
        this.scalar = SCALAR_FIELDS.has(this.key) ? { key: this.key, text: '' } : null;
        this.other(c);
        return;
      case 'in_string':
        this.string(c);
        return;
      case 'other':
        this.other(c);
        return;
    }
  }

  private string(c: string): void {
    if (this.escape !== null) {
      const out = this.decode(c);
      if (out !== null) this.append(out);
      return;
    }
    if (c === '\\') {
      this.escape = '';
      return;
    }
    if (c === '"') {
      if (this.field === 'action') this.action = this.actionText;
      if (this.field === 'trade') this.trade = this.tradeText;
      if (this.field === 'message') this.messageDone = true;
      this.field = null;
      this.state = 'key';
      return;
    }
    this.append(c);
  }

  private append(s: string): void {
    if (this.field === 'action') this.actionText += s;
    else if (this.field === 'trade') this.tradeText += s;
    else if (this.field === 'message') this.messageText += s;
  }

  /** A scalar of `SCALAR_FIELDS` ended: keep its text. */
  private endScalar(): void {
    if (this.scalar) this.scalars[this.scalar.key] = this.scalar.text.trim();
    this.scalar = null;
  }

  /**
   * One more character of an escape: the decoded text once the escape is complete, else null.
   * An invalid escape decodes to itself; the character that ended it is handled again, as it may
   * be the closing quote.
   */
  private decode(c: string): string | null {
    const e = this.escape as string;
    if (e === '') {
      if (c in ESCAPES) {
        this.escape = null;
        return ESCAPES[c] as string;
      }
      if (c === 'u') {
        this.escape = 'u';
        return null;
      }
      this.escape = null;
      // `\a` stands for itself; a backslash before the closing quote cannot happen (`\"` is an
      // escape), so `c` is an ordinary character here.
      return `\\${c}`;
    }
    // `\u` and 0 to 3 hex digits so far.
    if (/[0-9a-fA-F]/.test(c)) {
      const next = e + c;
      if (next.length < 5) {
        this.escape = next;
        return null;
      }
      this.escape = null;
      return String.fromCharCode(Number.parseInt(next.slice(1), 16));
    }
    // Not four hex digits: the backslash and what followed stand for themselves, and `c` is read
    // as it is (in a key, as text; in a string, perhaps its end).
    this.escape = null;
    const literal = `\\${e}`;
    if (this.state === 'in_key') {
      this.key += literal;
      this.step(c);
      return null;
    }
    this.append(literal);
    this.string(c);
    return null;
  }

  private other(c: string): void {
    const k = this.skip;
    if (k.inString) {
      if (k.escaped) k.escaped = false;
      else if (c === '\\') k.escaped = true;
      else if (c === '"') k.inString = false;
      return;
    }
    if (c === '"') k.inString = true;
    else if (c === '{' || c === '[') k.depth++;
    else if (c === '}' || c === ']') {
      if (k.depth === 0) {
        // The object's own closing brace ends a scalar value.
        if (c === '}') {
          this.endScalar();
          this.state = 'done';
        }
        return;
      }
      k.depth--;
    } else if (c === ',' && k.depth === 0) {
      this.endScalar();
      this.state = 'key';
    } else if (k.depth === 0 && this.scalar) this.scalar.text += c;
  }
}

/** The actions whose message is shown as it streams (never `silent`, nor an unknown one). */
const SPOKEN_ACTIONS: ReadonlySet<string> = new Set(['stay', 'hint', 'follow_up', 'close']);

/** A role label the model sometimes puts first (`cleanSay` drops it from the posted message). */
const LABEL = /^(?:interviewer|assistant)\s*:\s*/i;
const LABEL_PREFIXES = ['interviewer:', 'assistant:'];

/**
 * How far the message is settled, so text once shown never changes: `repairLatexEscapes` decides
 * a tab, carriage return or newline by up to 15 characters after it, and `mathMask` a `$` or `\`
 * by the character after it, so those wait for what follows (or for the end of the message).
 */
export function settledLength(text: string, complete: boolean): number {
  if (complete) return text.length;
  let end = text.length;
  for (let i = Math.max(0, text.length - 15); i < text.length; i++) {
    const c = text[i];
    if (c === '\t' || c === '\r' || c === '\n') {
      end = i;
      break;
    }
  }
  while (end > 0 && (text[end - 1] === '$' || text[end - 1] === '\\')) end--;
  // Half of a surrogate pair waits for the other half.
  const last = text.charCodeAt(end - 1);
  if (end > 0 && last >= 0xd800 && last <= 0xdbff) end--;
  return end;
}

/**
 * The head of a turn: what it does, read before a word of its message. A move field is null when
 * the message began before it was written (a provider that does not keep the schema's order).
 */
export interface TurnHead {
  action: string;
  trade: string | null;
  quantity: number | null;
  reveal: boolean | null;
}

/**
 * Decides, once the head is read, whether the message may be shown as it streams: null hides it
 * (the posted message then appears whole), a string is shown first (the platform's facts of a
 * trade, '' for none), the model's words after it.
 */
export type StreamGate = (head: TurnHead) => string | null;

const numberOf = (raw: string | undefined): number | null => {
  if (raw === undefined) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
};
const boolOf = (raw: string | undefined): boolean | null =>
  raw === 'true' ? true : raw === 'false' ? false : null;

/**
 * The visible part of a streaming turn's message: nothing until `action` is known and is one that
 * speaks and the message has begun (so every field before it, the game move included, is known),
 * and nothing at all when the gate says so; then the gate's prefix, and the message with LaTeX
 * escapes repaired, leading whitespace and a role label dropped, after a space. `push` returns
 * the text to append to what was shown (often ''). The shown text only ever grows; should a
 * repair ever change text already shown, the stream stops instead.
 */
export class MessageStream {
  private readonly reader = new TurnJsonReader();
  private shown = '';
  private stopped = false;
  /** The gate's answer once asked (undefined before). */
  private prefix: string | undefined;

  constructor(private readonly gate: StreamGate | null = null) {}

  /** Everything shown so far. */
  get text(): string {
    if (this.prefix === undefined) return '';
    return [this.prefix, this.shown].filter(Boolean).join(' ');
  }

  push(chunk: string): string {
    if (this.stopped) return '';
    this.reader.push(chunk);
    const action = this.reader.action;
    if (action === null) return '';
    if (!SPOKEN_ACTIONS.has(action)) {
      this.stopped = true;
      return '';
    }
    if (!this.reader.messageStarted) return '';
    let head = '';
    if (this.prefix === undefined) {
      const r = this.reader;
      const p = this.gate
        ? this.gate({
            action,
            trade: r.atMessage?.trade ?? null,
            quantity: numberOf(r.atMessage?.scalars.quantity),
            reveal: boolOf(r.atMessage?.scalars.reveal),
          })
        : '';
      if (p === null) {
        this.stopped = true;
        return '';
      }
      this.prefix = p;
      head = p;
    }
    // The first words after a prefix are set off from it by a space.
    const first = this.shown.length === 0;
    const delta = this.messageDelta();
    if (!delta) return head;
    return head + (this.prefix && first ? ' ' : '') + delta;
  }

  /** What of the model's words may be shown now, as a delta on what was shown. */
  private messageDelta(): string {
    const raw = this.reader.message;
    const settled = raw.slice(0, settledLength(raw, this.reader.messageDone));
    let visible = repairLatexEscapes(settled).trimStart();
    if (!this.reader.messageDone) {
      // "Interv…" could still become a label: wait until it cannot.
      const lower = visible.toLowerCase();
      if (LABEL_PREFIXES.some((p) => p.startsWith(lower) && lower.length < p.length)) return '';
      const label = LABEL.exec(visible);
      if (label && label[0].length === visible.length) return '';
    }
    visible = visible.replace(LABEL, '');
    if (!visible.startsWith(this.shown)) {
      this.stopped = true;
      return '';
    }
    const delta = visible.slice(this.shown.length);
    this.shown = visible;
    return delta;
  }
}
