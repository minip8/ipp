import { describe, expect, it } from 'vitest';
import { matches } from './shortcuts';

const ev = (o: Partial<KeyboardEvent>) =>
  ({
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    altKey: false,
    code: '',
    ...o,
  }) as KeyboardEvent;

describe('matches', () => {
  it('maps Mod to Ctrl elsewhere and Cmd on macOS', () => {
    expect(matches(ev({ ctrlKey: true, code: 'Enter' }), 'Mod+Enter', false)).toBe(true);
    expect(matches(ev({ metaKey: true, code: 'Enter' }), 'Mod+Enter', true)).toBe(true);
    expect(matches(ev({ ctrlKey: true, code: 'Enter' }), 'Mod+Enter', true)).toBe(false);
  });
  it('requires exact modifiers', () => {
    expect(matches(ev({ ctrlKey: true, shiftKey: true, code: 'Enter' }), 'Mod+Enter', false)).toBe(
      false,
    );
    expect(
      matches(ev({ ctrlKey: true, shiftKey: true, code: 'Enter' }), 'Mod+Shift+Enter', false),
    ).toBe(true);
    expect(matches(ev({ altKey: true, code: 'KeyM' }), 'Alt+M', false)).toBe(true);
    expect(matches(ev({ ctrlKey: true, code: 'Quote' }), "Mod+'", false)).toBe(true);
  });
});
