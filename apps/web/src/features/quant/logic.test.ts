import { describe, expect, it } from 'vitest';
import { PATHS } from './logic';

describe('the paths', () => {
  it('starts on the trader path', () => {
    expect(PATHS[0]).toBe('trader');
    expect(PATHS).toEqual(['trader', 'researcher']);
  });
});
