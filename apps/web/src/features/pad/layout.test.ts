import type { Message, Run } from '@ipp/contracts';
import { describe, expect, it } from 'vitest';
import type { EditorSettings } from './editor/settings';
import {
  clearUnread,
  incomingMessages,
  initialPane,
  keyboardBox,
  NO_UNREAD,
  newlyFinished,
  noteActivity,
  togglePane,
  touchEditorSettings,
} from './layout';

const msg = (id: string, userId: string | null): Message => ({
  id,
  padId: 'p',
  role: userId ? 'candidate' : 'interviewer',
  kind: 'chat',
  intent: null,
  text: id,
  via: 'text',
  userId,
  createdAt: '2026-01-01T10:00:00.000Z',
});
const run = (id: string, status: Run['status']) => ({ id, status }) as Run;

describe('pad phone layout', () => {
  it('opens on the problem, or on the code when there is none', () => {
    expect(initialPane(true)).toBe('problem');
    expect(initialPane(false)).toBe('code');
  });

  it('a show-or-hide shortcut shows the pane, and goes back to the code from it', () => {
    expect(togglePane('code', 'console')).toBe('console');
    expect(togglePane('problem', 'chat')).toBe('chat');
    expect(togglePane('console', 'console')).toBe('code');
    expect(togglePane('code', 'code')).toBe('code');
  });

  it('counts messages from anyone but me', () => {
    const ms = [msg('a', 'me'), msg('b', null), msg('c', 'other'), msg('d', 'me')];
    expect(incomingMessages(ms, 0, 'me')).toBe(2);
    expect(incomingMessages(ms, 2, 'me')).toBe(1);
    expect(incomingMessages(ms, 4, 'me')).toBe(0);
    expect(incomingMessages(ms, -3, 'me')).toBe(2);
  });

  it('finds runs that finished since last time', () => {
    const runs = [run('a', 'finished'), run('b', 'running'), run('c', 'finished')];
    expect(newlyFinished(new Set(['a']), runs)).toEqual(['c']);
    expect(newlyFinished(new Set(['a', 'c']), runs)).toEqual([]);
  });

  it('marks chat and console only while another pane is showing', () => {
    const a = noteActivity(NO_UNREAD, 'code', { messages: 2, finishedRuns: 1 });
    expect(a).toEqual({ chat: 2, console: true });
    expect(noteActivity(a, 'code', { messages: 1, finishedRuns: 0 })).toEqual({
      chat: 3,
      console: true,
    });
    expect(noteActivity(NO_UNREAD, 'chat', { messages: 3, finishedRuns: 0 })).toEqual(NO_UNREAD);
    expect(noteActivity(NO_UNREAD, 'console', { messages: 0, finishedRuns: 2 })).toEqual(NO_UNREAD);
    // Nothing new: the same object, so React does not re-render.
    expect(noteActivity(a, 'code', { messages: 0, finishedRuns: 0 })).toBe(a);
  });

  it('opening a pane clears its mark and keeps the other', () => {
    const u = { chat: 2, console: true };
    expect(clearUnread(u, 'chat')).toEqual({ chat: 0, console: true });
    expect(clearUnread(u, 'console')).toEqual({ chat: 2, console: false });
    expect(clearUnread(u, 'code')).toBe(u);
  });

  it('detects the on-screen keyboard from the visual viewport, but not a pinch zoom', () => {
    expect(keyboardBox(844, { height: 844, offsetTop: 0, scale: 1 })).toBeNull();
    // Browser chrome showing and hiding is a small change.
    expect(keyboardBox(844, { height: 780, offsetTop: 0, scale: 1 })).toBeNull();
    expect(keyboardBox(844, { height: 480.4, offsetTop: 120.2, scale: 1 })).toEqual({
      height: 480,
      top: 120,
    });
    expect(keyboardBox(844, { height: 300, offsetTop: 0, scale: 2 })).toBeNull();
  });

  it('wraps lines and drops the minimap on a phone unless the user chose', () => {
    const s: EditorSettings = {
      fontSize: 14,
      tabSize: 4,
      keymap: 'standard',
      wordWrap: false,
      autocomplete: true,
      minimap: true,
      lineNumbers: 'on',
      ligatures: false,
    };
    expect(touchEditorSettings(s, new Set())).toMatchObject({ wordWrap: true, minimap: false });
    expect(touchEditorSettings(s, new Set(['wordWrap', 'minimap']))).toMatchObject({
      wordWrap: false,
      minimap: true,
    });
    expect(touchEditorSettings(s, new Set()).fontSize).toBe(14);
  });
});
