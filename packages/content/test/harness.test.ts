import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { stringify } from 'yaml';
import { judgedReferenceSolutions, loadProblem } from '../src';

const require = createRequire(import.meta.url);
/** The C++-only fixture problem (a `Box<T>` template driven by a `BoxTests` harness). */
const BOX = JSON.parse(
  readFileSync(require.resolve('@ipp/contracts/fixtures/problem-box-cpp.json'), 'utf8'),
);

let root: string;
let dir: string;

/** Writes the fixture out in the authoring layout: problem.yaml + one file per text. */
function writeBox(meta: Record<string, unknown> = {}) {
  const { statement, interviewerNotes, tests, referenceSolutions, starterCode, harness, ...yaml } =
    BOX;
  writeFileSync(join(dir, 'problem.yaml'), stringify({ ...yaml, ...meta }));
  writeFileSync(join(dir, 'statement.md'), statement);
  writeFileSync(join(dir, 'notes.md'), interviewerNotes);
  writeFileSync(join(dir, 'tests.json'), JSON.stringify(tests));
  writeFileSync(join(dir, 'solution.cpp'), referenceSolutions.cpp);
  writeFileSync(join(dir, 'starter.cpp'), starterCode.cpp);
  writeFileSync(join(dir, 'harness.cpp'), harness.cpp);
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'ipp-content-harness-'));
  dir = join(root, 'problems', 'box-cpp');
  mkdirSync(dir, { recursive: true });
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe('language-restricted problems in the content layout', () => {
  it('loads languages, starter code and harness', () => {
    writeBox();
    const p = loadProblem('box-cpp', root);
    expect(p.languages).toEqual(['cpp']);
    expect(p.starterCode).toEqual({ cpp: BOX.starterCode.cpp });
    expect(p.harness).toEqual({ cpp: BOX.harness.cpp });
    expect(p.referenceSolutions).toEqual({ cpp: BOX.referenceSolutions.cpp });
  });

  it('hands the judge each reference solution with its harness appended', () => {
    writeBox();
    const judged = judgedReferenceSolutions(loadProblem('box-cpp', root));
    expect(judged.cpp).toBe(`${BOX.referenceSolutions.cpp}#line 1 "tests.cpp"\n${BOX.harness.cpp}`);
  });

  it('refuses a solution, starter or harness for a language the problem does not offer', () => {
    for (const file of ['solution.py', 'starter.java', 'harness.py']) {
      writeBox();
      writeFileSync(join(dir, file), 'x = 1\n');
      expect(() => loadProblem('box-cpp', root), file).toThrow(
        /not one of the problem's languages/,
      );
      rmSync(join(dir, file));
    }
  });

  it('needs the C++ solution of a C++-only problem, and both when languages is absent', () => {
    writeBox();
    rmSync(join(dir, 'solution.cpp'));
    expect(() => loadProblem('box-cpp', root)).toThrow(/cpp reference solution is required/);
    writeBox({ languages: undefined });
    rmSync(join(dir, 'harness.cpp'));
    rmSync(join(dir, 'starter.cpp'));
    expect(() => loadProblem('box-cpp', root)).toThrow(/python reference solution is required/);
  });
});
