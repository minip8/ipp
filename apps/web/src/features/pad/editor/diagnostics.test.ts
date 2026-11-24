import { describe, expect, it } from 'vitest';
import { linkifyLocations, parseCompilerOutput } from './diagnostics';

describe('parseCompilerOutput', () => {
  it('reads gcc/clang errors and warnings, skipping notes', () => {
    const out = `main.cpp:7:31: error: 'unordered_mapp' was not declared in this scope
    7 |         unordered_mapp<int, int> seen;
main.cpp:3:5: note: declared here
main.cpp:12:9: warning: unused variable 'x' [-Wunused-variable]`;
    expect(parseCompilerOutput(out, 'cpp')).toEqual([
      {
        line: 7,
        column: 31,
        severity: 'error',
        message: "'unordered_mapp' was not declared in this scope",
      },
      {
        line: 12,
        column: 9,
        severity: 'warning',
        message: "unused variable 'x' [-Wunused-variable]",
      },
    ]);
  });
  it('reads javac errors', () => {
    expect(
      parseCompilerOutput(
        'Main.java:5: error: cannot find symbol\n        foo();\n        ^',
        'java',
      ),
    ).toEqual([{ line: 5, column: null, severity: 'error', message: 'cannot find symbol' }]);
  });
  it('reads the innermost frame of a Python traceback', () => {
    const tb = `Traceback (most recent call last):
  File "main.py", line 20, in <module>
  File "main.py", line 4
    def f(:
          ^
SyntaxError: invalid syntax`;
    expect(parseCompilerOutput(tb, 'python')).toEqual([
      { line: 4, column: null, severity: 'error', message: 'SyntaxError: invalid syntax' },
    ]);
  });
});

describe('linkifyLocations', () => {
  it('splits out file:line:col references', () => {
    const parts = linkifyLocations('main.cpp:7:31: error: x\nFile "main.py", line 3, in f');
    expect(parts).toEqual([
      { text: 'main.cpp:7:31', line: 7, column: 31 },
      { text: ': error: x\n' },
      { text: 'File "main.py", line 3', line: 3, column: null },
      { text: ', in f' },
    ]);
  });

  it('still finds a reference that follows other path-like text', () => {
    expect(linkifyLocations('in ./src/a.b-c/main.cpp:3: x')).toEqual([
      { text: 'in ' },
      { text: './src/a.b-c/main.cpp:3', line: 3, column: null },
      { text: ': x' },
    ]);
  });

  it('is linear on long program output (no catastrophic backtracking)', () => {
    // A program can print 64 KiB+ of stderr; the old regex took ~6 s on this in V8.
    for (const text of ['a'.repeat(256 * 1024), 'a.'.repeat(128 * 1024), 'File "'.repeat(40_000)]) {
      const t0 = performance.now();
      const parts = linkifyLocations(text);
      expect(performance.now() - t0).toBeLessThan(500);
      expect(parts.map((p) => p.text).join('')).toBe(text);
    }
  });
});
