/**
 * The landing page's few formulas, typeset on the server. The page ships KaTeX's stylesheet (its
 * fonts load only for the glyphs used) but none of its script: the HTML is rendered here, once
 * per formula per server process, and arrives with the page.
 */
import katex from 'katex';

const cache = new Map<string, string>();

/** KaTeX HTML for `source` (inline, or display when asked). Throws on a typo, at render time. */
export function tex(source: string, display = false): string {
  const key = `${display ? 'D' : 'I'}${source}`;
  let html = cache.get(key);
  if (html === undefined) {
    // HTML only, without the MathML copy: the previews are pictures, hidden from screen readers.
    html = katex.renderToString(source, {
      displayMode: display,
      output: 'html',
      throwOnError: true,
    });
    cache.set(key, html);
  }
  return html;
}
