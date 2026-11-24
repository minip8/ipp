/**
 * In-memory pad rooms for the event channel. Everything that broadcasts goes through this one
 * interface so a Redis pub/sub implementation can replace it when the API scales out.
 */
import type { ServerEvent } from '@ipp/contracts';

export interface RoomClient {
  userId: string;
  send(data: string): void;
  close(code?: number, reason?: string): void;
}

export interface Rooms {
  join(padId: string, client: RoomClient): void;
  leave(padId: string, client: RoomClient): void;
  /** To everyone in the pad, or only to `toUserId`'s sockets when given. */
  broadcast(padId: string, event: ServerEvent, toUserId?: string): void;
  count(padId: string): number;
  /** Closes the pad's sockets (only `userId`'s when given); their close handlers leave the room. */
  close(padId: string, code: number, reason: string, userId?: string): void;
  pads(): string[];
  closeAll(): void;
}

export function createRooms(): Rooms {
  const rooms = new Map<string, Set<RoomClient>>();
  return {
    join(padId, client) {
      let set = rooms.get(padId);
      if (!set) {
        set = new Set();
        rooms.set(padId, set);
      }
      set.add(client);
    },
    leave(padId, client) {
      const set = rooms.get(padId);
      if (!set) return;
      set.delete(client);
      if (set.size === 0) rooms.delete(padId);
    },
    broadcast(padId, event, toUserId) {
      const set = rooms.get(padId);
      if (!set) return;
      const data = JSON.stringify(event);
      for (const c of set) {
        if (toUserId !== undefined && c.userId !== toUserId) continue;
        try {
          c.send(data);
        } catch {
          // a dead socket is cleaned up by its close handler
        }
      }
    },
    count: (padId) => rooms.get(padId)?.size ?? 0,
    close(padId, code, reason, userId) {
      const set = rooms.get(padId);
      if (!set) return;
      for (const c of [...set]) {
        if (userId !== undefined && c.userId !== userId) continue;
        try {
          c.close(code, reason);
        } catch {
          // already closing
        }
      }
    },
    pads: () => [...rooms.keys()],
    closeAll() {
      for (const set of rooms.values()) for (const c of set) c.close(1001, 'server shutting down');
      rooms.clear();
    },
  };
}
