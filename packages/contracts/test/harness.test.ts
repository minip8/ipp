import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  composeJudgedSource,
  generateScaffold,
  ProblemContent,
  ProblemDetail,
  ProblemSummary,
  problemScaffold,
  problemScaffolds,
} from '../src';

const fixture = (name: string) =>
  JSON.parse(readFileSync(new URL(`../fixtures/${name}.json`, import.meta.url), 'utf8'));

describe('language-restricted problems', () => {
  const box = ProblemContent.parse(fixture('problem-box-cpp'));

  it('parses the C++-only fixture with its harness and starter code', () => {
    expect(box.languages).toEqual(['cpp']);
    expect(box.harness.cpp).toContain('class BoxTests');
    expect(box.starterCode.cpp).toContain('template <typename T>');
    expect(Object.keys(box.referenceSolutions)).toEqual(['cpp']);
  });

  it('defaults to every language with no harness or starter code', () => {
    const p = ProblemContent.parse(fixture('problem-two-sum'));
    expect(p.languages).toEqual(['cpp', 'python', 'java']);
    expect(p.harness).toEqual({});
    expect(p.starterCode).toEqual({});
  });

  it('requires a reference solution only for offered C++ / Python', () => {
    const raw = fixture('problem-box-cpp');
    const noCpp = ProblemContent.safeParse({ ...raw, referenceSolutions: {} });
    expect(noCpp.success).toBe(false);
    expect(noCpp.error?.issues[0]?.message).toBe('cpp reference solution is required');
    const two = fixture('problem-two-sum');
    const neither = ProblemContent.safeParse({ ...two, referenceSolutions: { java: 'x' } });
    expect(neither.error?.issues[0]?.message).toBe(
      'cpp and python reference solutions are required',
    );
    // Python-only problem: no C++ solution needed.
    const py = ProblemContent.safeParse({
      ...two,
      languages: ['python'],
      referenceSolutions: { python: two.referenceSolutions.python },
    });
    expect(py.success).toBe(true);
  });

  it('refuses files for languages the problem does not offer', () => {
    const raw = fixture('problem-box-cpp');
    for (const field of ['referenceSolutions', 'starterCode', 'harness']) {
      const r = ProblemContent.safeParse({ ...raw, [field]: { ...raw[field], python: 'x' } });
      expect(r.success, field).toBe(false);
      expect(r.error?.issues.map((i) => i.path)).toContainEqual([field, 'python']);
    }
  });

  it('refuses empty or repeated language lists and normalises the order', () => {
    const raw = fixture('problem-two-sum');
    expect(ProblemContent.safeParse({ ...raw, languages: [] }).success).toBe(false);
    expect(ProblemContent.safeParse({ ...raw, languages: ['cpp', 'cpp'] }).success).toBe(false);
    expect(ProblemContent.safeParse({ ...raw, languages: ['ruby'] }).success).toBe(false);
    expect(
      ProblemContent.parse({ ...raw, languages: ['java', 'cpp', 'python'] }).languages,
    ).toEqual(['cpp', 'python', 'java']);
  });

  it('summaries without languages (older responses, mocks) mean every language', () => {
    const s = ProblemSummary.parse({
      slug: 'a',
      title: 'A',
      difficulty: 'easy',
      category: 'dsa',
      tags: [],
    });
    expect(s.languages).toEqual(['cpp', 'python', 'java']);
    expect(ProblemDetail.shape).not.toHaveProperty('harness');
  });

  it('uses starter code where there is some, the generated scaffold elsewhere', () => {
    expect(problemScaffold(box, 'cpp')).toBe(box.starterCode.cpp);
    // Not offered: nothing (the generated one would be the harness class).
    expect(problemScaffolds(box)).toEqual({ cpp: box.starterCode.cpp, python: '', java: '' });
    const two = ProblemContent.parse(fixture('problem-two-sum'));
    expect(problemScaffolds(two).java).toBe(generateScaffold(two.signature, 'java'));
    expect(problemScaffold({ signature: two.signature }, 'cpp')).toBe(
      generateScaffold(two.signature, 'cpp'),
    );
  });

  it('a harness needs starter code for its language', () => {
    const raw = fixture('problem-box-cpp');
    const r = ProblemContent.safeParse({ ...raw, starterCode: {} });
    expect(r.error?.issues.map((i) => i.message)).toEqual([
      'a problem with a cpp harness needs cpp starter code',
    ]);
  });
});

describe('composeJudgedSource', () => {
  it('returns the candidate source unchanged without a harness', () => {
    expect(composeJudgedSource('cpp', 'int x;', undefined)).toBe('int x;');
  });

  it('appends a C++ harness after a #line marker, keeping the candidate lines first', () => {
    expect(composeJudgedSource('cpp', 'A\nB', 'H1\nH2')).toBe(
      'A\nB\n#line 1 "tests.cpp"\nH1\nH2\n',
    );
    expect(composeJudgedSource('cpp', 'A\n', 'H\n')).toBe('A\n#line 1 "tests.cpp"\nH\n');
    expect(composeJudgedSource('cpp', '', 'H\n')).toBe('#line 1 "tests.cpp"\nH\n');
  });

  it('appends other languages after a blank line', () => {
    expect(composeJudgedSource('python', 'a = 1', 'class T: pass')).toBe(
      'a = 1\n\nclass T: pass\n',
    );
  });
});
