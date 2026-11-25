/**
 * The pad's phone layout (below the `lg` breakpoint): one pane at a time, switched by a bottom tab
 * bar. Pure rules for which pane to show and when a tab gets an unread mark, unit-tested in
 * layout.test.ts; the hooks that read the browser are in use-layout.ts.
 */
import type { Message, Run } from '@ipp/contracts';
import type { EditorSettings } from './editor/settings';

export const DESKTOP_QUERY = '(min-width: 1024px)';

export type Pane = 'problem' | 'code' | 'console' | 'chat';
export const PANES: readonly Pane[] = ['problem', 'code', 'console', 'chat'];

/** A pad with a problem opens on its statement; a blank room opens on the code. */
export function initialPane(hasProblem: boolean): Pane {
  return hasProblem ? 'problem' : 'code';
}

/**
 * The desktop "show or hide" shortcuts on a single pane: show it, or go back to the code when it
 * is the pane already showing (hiding the only pane would leave nothing).
 */
export function togglePane(current: Pane, target: Pane): Pane {
  return current === target ? 'code' : target;
}

export type Unread = { chat: number; console: boolean };
export const NO_UNREAD: Unread = { chat: 0, console: false };

/** Messages from someone else (the interviewer or another person) among messages[from..]. */
export function incomingMessages(messages: readonly Message[], from: number, me: string): number {
  let n = 0;
  for (let i = Math.max(0, from); i < messages.length; i++) if (messages[i]?.userId !== me) n++;
  return n;
}

/** Ids of runs that are finished now and were not in `finished` before. */
export function newlyFinished(finished: ReadonlySet<string>, runs: readonly Run[]): string[] {
  return runs.filter((r) => r.status === 'finished' && !finished.has(r.id)).map((r) => r.id);
}

/** Marks what happened on a pane other than the one showing. */
export function noteActivity(
  unread: Unread,
  showing: Pane,
  activity: { messages: number; finishedRuns: number },
): Unread {
  const chat = showing === 'chat' ? 0 : unread.chat + activity.messages;
  const console = showing === 'console' ? false : unread.console || activity.finishedRuns > 0;
  return chat === unread.chat && console === unread.console ? unread : { chat, console };
}

/** Opening a pane reads what was waiting there. */
export function clearUnread(unread: Unread, pane: Pane): Unread {
  if (pane === 'chat' && unread.chat) return { ...unread, chat: 0 };
  if (pane === 'console' && unread.console) return { ...unread, console: false };
  return unread;
}

/**
 * The on-screen keyboard is open when the visual viewport is much shorter than the layout
 * viewport (iOS Safari, and Chrome on Android, which by default resize only the visual viewport).
 * Pinch zoom also shrinks the visual viewport, so a zoomed page never counts. Returns the box the
 * page should fit into, or null when the keyboard is closed.
 */
export function keyboardBox(
  innerHeight: number,
  vv: { height: number; offsetTop: number; scale: number },
): { height: number; top: number } | null {
  if (vv.scale > 1.05) return null;
  if (innerHeight - vv.height < 150) return null;
  return { height: Math.round(vv.height), top: Math.max(0, Math.round(vv.offsetTop)) };
}

/**
 * Editor settings on a phone: lines wrap (a horizontal scroll is awkward on a touch screen and a
 * 360 px wide editor shows few columns) and there is no minimap, unless the user chose otherwise.
 */
export function touchEditorSettings(
  s: EditorSettings,
  saved: ReadonlySet<keyof EditorSettings>,
): EditorSettings {
  return {
    ...s,
    wordWrap: saved.has('wordWrap') ? s.wordWrap : true,
    minimap: saved.has('minimap') ? s.minimap : false,
  };
}
