import { describe, expect, it } from 'vitest';
import { parseModelJson, repairLatexEscapes } from '../src/quant/latex';
import { MessageStream, settledLength, TurnJsonReader } from '../src/quant/stream';
import { parseTurn, sayOf } from '../src/quant/turn';

/**
 * The tests that try every way of cutting a turn into pieces are a second or so of pure CPU;
 * a loaded CI runner has taken more than the default five.
 */
const SPLITS_TIMEOUT = 30_000;

/** Every way of cutting `raw` into two pieces, and into three. */
function* splits(raw: string): Generator<string[]> {
  for (let i = 0; i <= raw.length; i++) yield [raw.slice(0, i), raw.slice(i)];
  for (let i = 1; i < raw.length; i++)
    for (let j = i + 1; j < raw.length; j++) yield [raw.slice(0, i), raw.slice(i, j), raw.slice(j)];
}

/**
 * A turn as a model writes it, with everything that is hard to decode in pieces: escaped quotes
 * and backslashes (one before a LaTeX command), `\u` escapes (a surrogate pair among them), a
 * literal dollar, a newline, a nested value with braces and quotes to skip, a decoy key, and
 * `message` after the fields before it.
 */
const TRICKY = [
  '{"reason":"r \\"q\\" \\\\ {x}",',
  '"extra":{"a":[1,"}\\"]",{"b":null}],"c":true},',
  '"action":"hint","hint_rung":1,',
  '"messages":"decoy \\"message\\"",',
  '"message":"Try $\\\\frac{5}{36}$ \\u00e9 \\u2014 \\\\$10 \\\\\\\\ x\\nnext \\ud83d\\ude00 \\"quoted\\" \\/ end",',
  '"score":0.5,"summary":"S {not} [json]","note":""}',
].join('');

describe('reading a turn as it streams', () => {
  it(
    'decodes action and message exactly as JSON.parse does, wherever the pieces are cut',
    () => {
      const want = JSON.parse(TRICKY) as { action: string; message: string };
      expect(want.message).toContain('\\frac{5}{36}');
      expect(want.message).toContain('😀');
      for (const pieces of splits(TRICKY)) {
        const r = new TurnJsonReader();
        for (const p of pieces) r.push(p);
        if (r.action !== want.action || r.message !== want.message || !r.messageDone || !r.done)
          throw new Error(`cut as ${JSON.stringify(pieces)}: ${JSON.stringify(r.message)}`);
      }
      const one = new TurnJsonReader();
      for (const c of TRICKY) one.push(c);
      expect(one.message).toBe(want.message);
    },
    SPLITS_TIMEOUT,
  );

  it('reads invalid escapes as the repair before parsing does (the backslash stands for itself)', () => {
    const raw =
      '{"action":"stay","message":"Use $\\alpha + \\sigma$ and \\$5, \\u12zz or \\u00e9\\q"}';
    const want = (parseModelJson(raw) as { message: string }).message;
    expect(want).toBe('Use $\\alpha + \\sigma$ and \\$5, \\u12zz or é\\q');
    for (const pieces of splits(raw)) {
      const r = new TurnJsonReader();
      for (const p of pieces) r.push(p);
      expect(r.message).toBe(want);
    }
  });

  it('skips a code fence before the object and ignores what follows it', () => {
    const r = new TurnJsonReader();
    r.push('```json\n{"action":"stay","message":"Hi"}\n``` and {"message":"again"}');
    expect([r.action, r.message, r.done]).toEqual(['stay', 'Hi', true]);
  });

  it('never throws on malformed input; it just stops producing text', () => {
    for (const raw of [
      '',
      '}{',
      '{"action":',
      '{"action":"st',
      '{"a"::"b",,}',
      '\\u',
      '{"message":"\\u',
    ]) {
      const r = new TurnJsonReader();
      expect(() => r.push(raw)).not.toThrow();
    }
    const cut = new TurnJsonReader();
    cut.push('{"action":"stay","message":"Half a sen');
    expect([cut.message, cut.messageDone]).toEqual(['Half a sen', false]);
  });
});

describe('what of a streaming message is shown', () => {
  const streamed = (pieces: string[]) => {
    const s = new MessageStream();
    let out = '';
    const seen: string[] = [];
    for (const p of pieces) {
      out += s.push(p);
      seen.push(out);
    }
    return { out, seen };
  };

  it(
    'shows the posted message in the end, only ever appending, wherever the pieces are cut',
    () => {
      const final = sayOf((parseTurn(TRICKY) as { message: string }).message);
      for (const pieces of splits(TRICKY)) {
        const { out, seen } = streamed(pieces);
        if (out !== final)
          throw new Error(`cut as ${JSON.stringify(pieces)}: ${JSON.stringify(out)}`);
        for (const s of seen)
          if (!final.startsWith(s)) throw new Error(`showed ${JSON.stringify(s)}`);
      }
    },
    SPLITS_TIMEOUT,
  );

  it(
    'repairs LaTeX written with one backslash, without ever showing the control character',
    () => {
      // `\frac` and `\times` with one backslash decode to a form feed and a tab; `\nu` to a newline.
      const raw =
        '{"reason":"","action":"stay","hint_rung":0,"message":"So $\\frac{1}{6} \\times 6 = 1$ and $\\nu$ is fine.\\nNext line.","score":0,"summary":"","note":""}';
      const final = sayOf((parseTurn(raw) as { message: string }).message);
      expect(final).toBe('So $\\frac{1}{6} \\times 6 = 1$ and $\\nu$ is fine.\nNext line.');
      for (const pieces of splits(raw)) {
        const { out, seen } = streamed(pieces);
        expect(out).toBe(final);
        for (const s of seen) {
          expect(final.startsWith(s)).toBe(true);
          expect(s).not.toMatch(/[\f\b]/);
        }
      }
    },
    SPLITS_TIMEOUT,
  );

  it('shows nothing until the action is known, and nothing at all for silent', () => {
    const late = new MessageStream();
    expect(late.push('{"reason":"r","message":"Hello there",')).toBe('');
    expect(late.push('"action":"stay"}')).toBe('Hello there');
    const silent = new MessageStream();
    expect(silent.push('{"action":"silent","message":"thinking aloud"}')).toBe('');
    const unknown = new MessageStream();
    expect(unknown.push('{"action":"speak","message":"Hi"}')).toBe('');
    for (const action of ['stay', 'hint', 'follow_up', 'close'])
      expect(new MessageStream().push(`{"action":"${action}","message":"Hi"}`)).toBe('Hi');
  });

  it('drops leading whitespace and a role label, as the posted message does', () => {
    const s = new MessageStream();
    const parts = ['{"action":"stay","message":"  \\n Inter', 'viewer', ': ', 'Go on."}'];
    expect(parts.map((p) => s.push(p))).toEqual(['', '', '', 'Go on.']);
    const word = new MessageStream();
    expect(word.push('{"action":"stay","message":"Inter')).toBe('');
    expect(word.push('esting')).toBe('Interesting');
  });

  it('holds back what a later character could still change', () => {
    expect(settledLength('abc', false)).toBe(3);
    expect(settledLength('a $x', false)).toBe(4);
    expect(settledLength('a $', false)).toBe(2);
    expect(settledLength('a \\', false)).toBe(2);
    expect(settledLength('a $$', false)).toBe(2);
    // A newline waits for 15 characters after it (`\nu`, `\neq` and the like are decided there).
    expect(settledLength('line\nnext', false)).toBe(4);
    expect(settledLength(`line\n${'x'.repeat(15)}`, false)).toBe(20);
    expect(settledLength('half \ud83d', false)).toBe(5);
    expect(settledLength('a $', true)).toBe(3);
    expect(repairLatexEscapes('$\u000crac$')).toBe('$\\frac$');
  });
});
