import { describe, expect, it } from 'vitest';
import { problemPrompt } from '../src/prompts';
import { PROBLEM } from './harness';

describe('problem prompt', () => {
  it('asks for carefulness over insight only on implementation-style problems', () => {
    expect(problemPrompt(PROBLEM)).not.toContain('Category:');
    expect(problemPrompt({ ...PROBLEM, category: 'implementation' })).toContain(
      'Category: implementation.',
    );
    expect(problemPrompt({ ...PROBLEM, category: 'data-structure' })).toContain(
      'Category: data structure implementation.',
    );
  });

  it('carries the harness and the language restriction when the problem has them', () => {
    expect(problemPrompt(PROBLEM)).not.toContain('Test harness');
    expect(problemPrompt(PROBLEM)).not.toContain('Languages:');
    const harness = 'class SolutionTests { public: int f() { return 1; } };';
    const p = problemPrompt({ ...PROBLEM, languages: ['cpp'], harness: { cpp: harness } });
    expect(p).toContain('Languages: C++ only.');
    expect(p).toContain('## Test harness in C++ (private; the candidate does not see it)');
    expect(p).toContain(harness);
    expect(p).toContain('## Signature of the harness class the tests call');
    expect(p).not.toContain('## Required signature');
  });
});
