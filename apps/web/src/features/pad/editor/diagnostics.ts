import type { Run } from '@ipp/contracts';

export type Diagnostic = {
  line: number;
  column: number | null;
  severity: 'error' | 'warning';
  message: string;
};

const GCC = /^[^\s:]+\.(?:cpp|cc|cxx|h|hpp):(\d+):(\d+):\s+(error|warning|fatal error):\s+(.*)$/;
const JAVA = /^[^\s:]+\.java:(\d+):\s+(error|warning):\s+(.*)$/;
const PY_FILE = /^\s*File "[^"]*", line (\d+)/;
const PY_ERROR = /^([A-Za-z_][\w.]*(?:Error|Exception)):?\s*(.*)$/;

/** Extracts line-addressable diagnostics from compiler output or a Python traceback. */
export function parseCompilerOutput(output: string, language: Run['language']): Diagnostic[] {
  const lines = output.split('\n');
  const out: Diagnostic[] = [];
  if (language === 'python') {
    let lastLine: number | null = null;
    for (const l of lines) {
      const f = PY_FILE.exec(l);
      if (f) lastLine = Number(f[1]);
    }
    const errLine = [...lines].reverse().find((l) => PY_ERROR.test(l.trim()));
    if (lastLine !== null && errLine)
      out.push({ line: lastLine, column: null, severity: 'error', message: errLine.trim() });
    return out;
  }
  for (const l of lines) {
    const g = GCC.exec(l);
    if (g) {
      out.push({
        line: Number(g[1]),
        column: Number(g[2]),
        severity: g[3] === 'warning' ? 'warning' : 'error',
        message: g[4] ?? '',
      });
      continue;
    }
    const j = JAVA.exec(l);
    if (j)
      out.push({
        line: Number(j[1]),
        column: null,
        severity: j[2] === 'warning' ? 'warning' : 'error',
        message: j[3] ?? '',
      });
  }
  return out;
}

export function parseDiagnostics(run: Run): Diagnostic[] {
  if (run.verdict === 'compile_error' && run.compile)
    return parseCompilerOutput(run.compile.output, run.language);
  if (
    run.language === 'python' &&
    run.mode === 'file' &&
    run.file?.stderr &&
    /SyntaxError|IndentationError/.test(run.file.stderr)
  )
    return parseCompilerOutput(run.file.stderr, 'python');
  return [];
}

/** Splits output into segments so "main.cpp:7:31" references can be rendered as links. */
export function linkifyLocations(
  text: string,
): ({ text: string } | { text: string; line: number; column: number | null })[] {
  // The lookbehind makes a path match start only at the beginning of a path-like run. Without it
  // the regex retries from every position inside a long run (`aaaa…` with no `.cpp:`), which is
  // quadratic: 64 KiB of program stderr froze the tab for seconds on every render.
  const re =
    /(?<![\w./-])([\w./-]+\.(?:cpp|cc|h|hpp|java|py)):(\d+)(?::(\d+))?|File "([^"\n]+)", line (\d+)/g;
  const parts: ({ text: string } | { text: string; line: number; column: number | null })[] = [];
  let last = 0;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    if (m.index > last) parts.push({ text: text.slice(last, m.index) });
    const line = Number(m[2] ?? m[5]);
    const column = m[3] ? Number(m[3]) : null;
    parts.push({ text: m[0], line, column });
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push({ text: text.slice(last) });
  return parts;
}
