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
});
