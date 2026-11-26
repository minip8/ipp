import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ReactMarkdown from 'react-markdown';
import rehypeKatex from 'rehype-katex';
import remarkMath from 'remark-math';
import { describe, expect, it } from 'vitest';
import {
  escapeOutsideMath,
  isMathSpan,
  rehypeMathGuard,
  settledMath,
  splitMath,
} from './math-guard';

/** The pipeline MathMarkdown uses (without GFM), as HTML. */
const render = (md: string) =>
  renderToStaticMarkup(
    createElement(
      ReactMarkdown,
      { remarkPlugins: [remarkMath], rehypePlugins: [rehypeMathGuard, rehypeKatex] },
      md,
    ),
  );

/** What a reader sees: each formula as [its TeX source], and the text around it. */
function visible(html: string): string {
  let out = '';
  let at = 0;
  for (;;) {
    const start = html.indexOf('<span class="katex', at);
    if (start === -1) break;
    out += html.slice(at, start);
    // Walk to the span that closes this one.
    const tags = /<(\/?)span\b[^>]*>/g;
    tags.lastIndex = start;
    let depth = 0;
    let end = start;
    for (let m = tags.exec(html); m; m = tags.exec(html)) {
      depth += m[1] ? -1 : 1;
      if (depth === 0) {
        end = m.index + m[0].length;
        break;
      }
    }
    const tex = /<annotation[^>]*>([\s\S]*?)<\/annotation>/.exec(html.slice(start, end))?.[1];
    out += `[${tex}]`;
    at = end;
  }
  return (out + html.slice(at)).replace(/<[^>]+>/g, '');
}

describe('isMathSpan', () => {
  it('takes $…$ with no space inside its dollars and no digit after', () => {
    expect(isMathSpan('$x^2$')).toBe(true);
    expect(isMathSpan('$5/36$', '.')).toBe(true);
    expect(isMathSpan('$5 and $', '1')).toBe(false);
    expect(isMathSpan('$MAX $', 'P')).toBe(false);
    expect(isMathSpan('$ x$')).toBe(false);
    expect(isMathSpan('$x$', '0')).toBe(false);
    expect(isMathSpan('$$')).toBe(false);
  });

  it('always takes $$…$$', () => {
    expect(isMathSpan('$$ x + y $$', '1')).toBe(true);
    expect(isMathSpan('$$$$')).toBe(false);
  });
});

describe('splitMath', () => {
  it('splits text, code and math, code first when it starts first', () => {
    expect(splitMath('run `echo $PATH` then $x$ and $$y$$.')).toEqual([
      { kind: 'text', text: 'run ' },
      { kind: 'code', text: '`echo $PATH`' },
      { kind: 'text', text: ' then ' },
      { kind: 'math', text: '$x$' },
      { kind: 'text', text: ' and ' },
      { kind: 'math', text: '$$y$$' },
      { kind: 'text', text: '.' },
    ]);
  });

  it('keeps prices and shell variables as text', () => {
    expect(splitMath('costs $5 and $10')).toEqual([{ kind: 'text', text: 'costs $5 and $10' }]);
    expect(splitMath('"$MAX $PERIOD"')).toEqual([{ kind: 'text', text: '"$MAX $PERIOD"' }]);
    expect(splitMath(String.raw`a \$5 fee`)).toEqual([
      { kind: 'text', text: String.raw`a \$5 fee` },
    ]);
  });
});

describe('escapeOutsideMath', () => {
  it('escapes Markdown punctuation and stray dollars, and leaves math alone', () => {
    expect(escapeOutsideMath('__init__ is $p_1 * q$; costs $5')).toBe(
      String.raw`\_\_init\_\_ is $p_1 * q$\; costs \$5`,
    );
  });

  it('renders exactly as written apart from the math', () => {
    const text = '# 1. __init__ *x* [a](b) <i> & so $P(A) = 0.5$ for $5';
    expect(visible(render(escapeOutsideMath(text)))).toBe(
      '# 1. __init__ *x* [a](b) &lt;i&gt; &amp; so [P(A) = 0.5] for $5',
    );
  });
});

describe('settledMath: a streaming message without its half-written formula', () => {
  it('holds back a formula until it closes', () => {
    expect(settledMath('So $\\frac{5}{')).toBe('So ');
    expect(settledMath('So $\\frac{5}{36}$ and $x')).toBe('So $\\frac{5}{36}$ and ');
    expect(settledMath('So $\\frac{5}{36}$.')).toBe('So $\\frac{5}{36}$.');
    expect(settledMath('Display $$\\sum_{i')).toBe('Display ');
    expect(settledMath('Display $$\\sum_i$$ done')).toBe('Display $$\\sum_i$$ done');
    expect(settledMath('Trailing $')).toBe('Trailing ');
    expect(settledMath('Trailing \\')).toBe('Trailing ');
  });

  it('never holds back what is not a formula', () => {
    expect(settledMath('It costs \\$10 and \\$')).toBe('It costs \\$10 and \\$');
    expect(settledMath('A $ sign, then more')).toBe('A $ sign, then more');
    expect(settledMath('Line $5\nnext line')).toBe('Line $5\nnext line');
    expect(settledMath('Code `echo $HOME` here')).toBe('Code `echo $HOME` here');
    const long = `Pay $5 ${'and so on '.repeat(25)}`;
    expect(settledMath(long)).toBe(long);
  });

  it('only ever grows as the text does (what was shown stays shown)', () => {
    const final = 'Since $P(A) = \\frac{1}{6}$ and $$E[X] = 3.5$$, it costs \\$2: `$x`.';
    let shown = '';
    for (let i = 0; i <= final.length; i++) {
      const s = settledMath(final.slice(0, i));
      expect(s.startsWith(shown)).toBe(true);
      shown = s;
    }
    expect(shown).toBe(final);
  });
});

describe('rehypeMathGuard in the pipeline', () => {
  it('typesets inline math', () => {
    const html = render('The answer is $\\frac{5}{36}$.');
    expect(html).toContain('class="katex"');
    expect(visible(html)).toBe('The answer is [\\frac{5}{36}].');
  });

  it('leaves dollar amounts and shell variables as text', () => {
    expect(render('It costs $5 and $10 now.')).toBe('<p>It costs $5 and $10 now.</p>');
    expect(render('`cpu.max` is "$MAX $PERIOD": a limit.')).toBe(
      '<p><code>cpu.max</code> is &quot;$MAX $PERIOD&quot;: a limit.</p>',
    );
  });

  it('makes $$…$$ display math, on its own lines or alone in a paragraph', () => {
    expect(render('$$\nx^2\n$$')).toContain('class="katex-display"');
    expect(render('Before\n\n$$x^2$$\n\nafter')).toContain('class="katex-display"');
    // Inside a sentence it stays inline.
    const inline = render('so $$x^2$$ here');
    expect(inline).not.toContain('katex-display');
    expect(inline).toContain('class="katex"');
  });

  it('renders text with no math as plain Markdown would', () => {
    expect(render('Plain **bold** and `code`.')).toBe(
      '<p>Plain <strong>bold</strong> and <code>code</code>.</p>',
    );
  });
});
