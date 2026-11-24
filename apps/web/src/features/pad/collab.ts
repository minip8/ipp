import { HocuspocusProvider } from '@hocuspocus/provider';
import { YDOC } from '@ipp/contracts';
import * as Y from 'yjs';
import { wsBaseUrl } from '@/lib/env';
import type { PresenceUser } from './editor/binding';

export type CollabStatus = 'connecting' | 'connected' | 'disconnected' | 'denied';

/**
 * The shared editor document over Hocuspocus. The single-use ws ticket is the Hocuspocus token,
 * fetched fresh for every (re)connect.
 */
export function createCollab(opts: {
  padId: string;
  getTicket: () => Promise<string>;
  user: PresenceUser;
  onStatus: (s: CollabStatus) => void;
  onSynced: (synced: boolean) => void;
}) {
  const doc = new Y.Doc();
  const provider = new HocuspocusProvider({
    url: `${wsBaseUrl()}/collab`,
    name: YDOC.name(opts.padId),
    document: doc,
    token: opts.getTicket,
    onStatus: ({ status }) => opts.onStatus(status as CollabStatus),
    onSynced: ({ state }) => opts.onSynced(state),
    onAuthenticationFailed: () => opts.onStatus('denied'),
  });
  provider.setAwarenessField('user', opts.user);
  return {
    doc,
    provider,
    awareness: provider.awareness,
    destroy() {
      provider.destroy();
      doc.destroy();
    },
  };
}

export type Collab = ReturnType<typeof createCollab>;

const PRESENCE_COLORS = [
  '#3b82f6',
  '#10b981',
  '#f59e0b',
  '#ef4444',
  '#8b5cf6',
  '#ec4899',
  '#14b8a6',
  '#f97316',
];
export function colorFor(id: string) {
  let h = 0;
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) | 0;
  return PRESENCE_COLORS[Math.abs(h) % PRESENCE_COLORS.length] as string;
}
