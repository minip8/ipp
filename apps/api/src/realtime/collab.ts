/**
 * Hocuspocus (Yjs) at /collab. Document `pad:<padId>`; the WS ticket is the Hocuspocus token.
 *
 *  - first load seeds code:<language> for all languages with problemScaffold (the problem's
 *    starter code where it has some, else the generated scaffold), and records that
 *    seed as history row 1 so playback can start from an empty doc
 *  - state persisted to pad_docs (debounced by Hocuspocus)
 *  - incremental updates coalesced into pad_updates rows, at most one per historyCoalesceMs
 *  - ended pads are read-only
 *  - deleted pads: connections are dropped, and writes that land after the delete are ignored
 *  - raises code_changed at most once per codeChangedMinGapMs per pad
 *  - socket guard: one document per socket, a byte cap and a deadline before authentication
 *    (Hocuspocus queues unauthenticated messages without bound), a per-pad cap on accumulated
 *    update bytes, and awareness `user` must be the authenticated user
 */
import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import { Hocuspocus } from '@hocuspocus/server';
import {
  LANGUAGES,
  type Language,
  problemScaffold,
  type StarterSource,
  YDOC,
} from '@ipp/contracts';
import { padDocs, padMembers, pads, padUpdates, problems, user } from '@ipp/db';
import { and, eq, max, sql } from '@ipp/db/orm';
import { type RawData, WebSocketServer } from 'ws';
import * as Y from 'yjs';
import type { Ctx } from '../context';
import { isForeignKeyViolation } from '../pg';
import {
  type AwarenessEntry,
  isDocWrite,
  MSG_AWARENESS,
  readAwarenessStates,
  readHead,
  toBytes,
} from './yproto';

const LOAD_ORIGIN = 'ipp:load';

interface HistoryBuffer {
  updates: Uint8Array[];
  first: Date;
  timer: NodeJS.Timeout;
}

export interface PadTexts {
  code: Record<Language, string>;
  notes: string;
}

/** Hocuspocus sends `reason` to the client; an empty message keeps it from console-logging. */
const denied = (reason: string) => Object.assign(new Error(), { reason });
/** Thrown from beforeHandleMessage: Hocuspocus closes the connection with this code and reason. */
const refuse = (code: number, reason: string) => Object.assign(new Error(reason), { code, reason });

/** Per-socket state shared between the raw ws listener and the Hocuspocus hooks (via context). */
export interface SocketGuard {
  authenticated: boolean;
  userId: string | null;
  userName: string | null;
}

/**
 * Awareness may carry `user` only as the authenticated user, so presence (names on cursors)
 * cannot be spoofed. Providers also echo other clients' states back; an echo is recognised by a
 * clock the server has already seen for that client and is not checked.
 */
export function awarenessAllowed(
  entries: AwarenessEntry[],
  knownClock: (clientID: number) => number | undefined,
  userId: string,
  userName: string,
): boolean {
  for (const { clientID, clock, state } of entries) {
    if (state === null) continue;
    const known = knownClock(clientID);
    if (known !== undefined && clock <= known) continue;
    if (typeof state !== 'object' || Array.isArray(state)) return false;
    const u = (state as { user?: unknown }).user;
    if (u === undefined) continue;
    if (typeof u !== 'object' || u === null) return false;
    const { userId: id, name } = u as { userId?: unknown; name?: unknown };
    if (id !== userId || name !== userName) return false;
  }
  return true;
}

const padIdOf = (documentName: string): string | null => {
  const m = /^pad:([0-9a-f-]{36})$/.exec(documentName);
  return m ? (m[1] ?? null) : null;
};

/** `problem` null: a blank room, seeded with a small runnable program per language. */
export function seedDoc(doc: Y.Doc, problem: StarterSource | null): void {
  doc.transact(() => {
    for (const lang of LANGUAGES)
      doc.getText(YDOC.code(lang)).insert(0, problemScaffold(problem, lang));
    doc.getText(YDOC.notes);
  });
}

export class Collab {
  readonly hocuspocus: Hocuspocus;
  private readonly wss = new WebSocketServer({ noServer: true, maxPayload: 4 * 1024 * 1024 });
  private readonly history = new Map<string, HistoryBuffer>();
  private readonly seqs = new Map<string, number>();
  private readonly flushChains = new Map<string, Promise<void>>();
  private readonly codeChanged = new Map<string, { last: number; timer?: NodeJS.Timeout }>();
  /** Update bytes a loaded pad has accumulated (persisted history + live changes). */
  private readonly docBytes = new Map<string, number>();
  private stopped = false;

  constructor(private readonly ctx: Ctx) {
    const log = ctx.log.child({ component: 'collab' });
    const t = ctx.config.timing;
    this.hocuspocus = new Hocuspocus({
      name: 'ipp-collab',
      quiet: true,
      debounce: t.collabDebounceMs,
      maxDebounce: t.collabMaxDebounceMs,
      onAuthenticate: async ({ token, documentName, connectionConfig, context }) => {
        const padId = padIdOf(documentName);
        const claims = await ctx.tickets.redeem(token);
        if (!padId || !claims || claims.padId !== padId) throw denied('unauthorized');
        const [row] = await ctx.db
          .select({ status: pads.status })
          .from(pads)
          .innerJoin(
            padMembers,
            and(eq(padMembers.padId, pads.id), eq(padMembers.userId, claims.userId)),
          )
          .where(eq(pads.id, padId));
        if (!row) throw denied('forbidden');
        connectionConfig.readOnly = row.status !== 'active';
        const [u] = await ctx.db
          .select({ name: user.name })
          .from(user)
          .where(eq(user.id, claims.userId));
        const guard = context.guard as SocketGuard | undefined;
        if (guard) {
          guard.authenticated = true;
          guard.userId = claims.userId;
          guard.userName = u?.name ?? '';
        }
        return { userId: claims.userId, padId };
      },
      beforeHandleMessage: async ({ update, documentName, context, document }) => {
        const head = readHead(update);
        if (!head) throw refuse(4400, 'malformed-message');
        const padId = padIdOf(documentName);
        if (padId && isDocWrite(head)) {
          const bytes = this.docBytes.get(padId) ?? 0;
          if (bytes + update.length > ctx.config.limits.collab.docBytes)
            throw refuse(4413, 'document-too-large');
        }
        if (head.type === MSG_AWARENESS) {
          const guard = context.guard as SocketGuard | undefined;
          const states = readAwarenessStates(update);
          if (
            !states ||
            (guard?.userId &&
              !awarenessAllowed(
                states,
                (id) => document.awareness.meta.get(id)?.clock,
                guard.userId,
                guard.userName ?? '',
              ))
          )
            throw refuse(4403, 'awareness-identity');
        }
      },
      onLoadDocument: async ({ document, documentName }) => {
        const padId = padIdOf(documentName);
        if (!padId) throw new Error('bad document name');
        const state = await this.loadOrSeedState(padId);
        Y.applyUpdate(document, state, LOAD_ORIGIN);
        const [m] = await ctx.db
          .select({ seq: max(padUpdates.seq) })
          .from(padUpdates)
          .where(eq(padUpdates.padId, padId));
        this.seqs.set(padId, m?.seq ?? 0);
        const [b] = await ctx.db
          .select({
            n: sql<number>`coalesce(sum(octet_length(${padUpdates.update})), 0)`.mapWith(Number),
          })
          .from(padUpdates)
          .where(eq(padUpdates.padId, padId));
        this.docBytes.set(padId, Math.max(b?.n ?? 0, state.length));
      },
      onChange: async ({ documentName, update, transactionOrigin }) => {
        if (this.stopped || transactionOrigin === LOAD_ORIGIN) return;
        const padId = padIdOf(documentName);
        if (!padId) return;
        this.docBytes.set(padId, (this.docBytes.get(padId) ?? 0) + update.length);
        this.recordHistory(padId, update);
        this.raiseCodeChanged(padId);
      },
      onStoreDocument: async ({ document, documentName }) => {
        const padId = padIdOf(documentName);
        if (!padId || this.stopped) return;
        await this.persistState(padId, document);
      },
      afterUnloadDocument: async ({ documentName }) => {
        const padId = padIdOf(documentName);
        if (!padId) return;
        await this.flushHistory(padId).catch((err) =>
          log.error({ err, padId }, 'history flush failed'),
        );
        this.seqs.delete(padId);
        this.docBytes.delete(padId);
        const cc = this.codeChanged.get(padId);
        if (cc && !cc.timer) this.codeChanged.delete(padId);
      },
    });
  }

  handleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer): void {
    this.wss.handleUpgrade(req, socket, head, (ws) => {
      const limits = this.ctx.config.limits.collab;
      const guard: SocketGuard = { authenticated: false, userId: null, userName: null };
      let documentName: string | null = null;
      let preAuthBytes = 0;
      const deadline = setTimeout(() => {
        if (!guard.authenticated) ws.terminate();
      }, limits.authTimeoutMs);
      deadline.unref();
      ws.on('close', () => clearTimeout(deadline));
      // Registered before Hocuspocus's own listener, so it sees every message first.
      ws.on('message', (data: RawData) => {
        const bytes = toBytes(data);
        const h = readHead(bytes);
        if (!h) return ws.terminate();
        // One document per socket (the web client uses one provider per socket): otherwise an
        // authenticated socket could queue unlimited messages for a second, unauthenticated name.
        documentName ??= h.documentName;
        if (h.documentName !== documentName) return ws.terminate();
        if (!guard.authenticated) {
          preAuthBytes += bytes.length;
          if (preAuthBytes > limits.preAuthBytes) ws.terminate();
        }
      });
      this.hocuspocus.handleConnection(ws, req, { guard });
    });
  }

  connectionCount(padId: string): number {
    return this.hocuspocus.documents.get(YDOC.name(padId))?.getConnectionsCount() ?? 0;
  }

  /** Current editor contents: the live doc when loaded, else the persisted state, else scaffolds. */
  async readTexts(padId: string): Promise<PadTexts> {
    const live = this.hocuspocus.documents.get(YDOC.name(padId));
    let doc: Y.Doc;
    if (live) doc = live;
    else {
      doc = new Y.Doc();
      const [row] = await this.ctx.db
        .select({ state: padDocs.state })
        .from(padDocs)
        .where(eq(padDocs.padId, padId));
      if (row) Y.applyUpdate(doc, row.state);
      else {
        const starter = await this.starterFor(padId);
        if (starter) seedDoc(doc, starter.problem);
      }
    }
    const code = Object.fromEntries(
      LANGUAGES.map((l) => [l, doc.getText(YDOC.code(l)).toString()]),
    ) as Record<Language, string>;
    return { code, notes: doc.getText(YDOC.notes).toString() };
  }

  /**
   * Swaps the editor over to another problem, on the live document (loading and seeding it
   * first if nobody has it open): each language's code is stashed under the problem being left,
   * and replaced by what was stashed for the new one, or its starter code the first time.
   * `commit` records the change in the database once the document is loaded and before it is
   * rewritten; when it returns null nothing is touched.
   */
  async switchProblem<T>(
    padId: string,
    from: string | null,
    next: (StarterSource & { slug: string }) | null,
    commit: () => Promise<T | null>,
  ): Promise<T | null> {
    const conn = await this.hocuspocus.openDirectConnection(YDOC.name(padId), { server: true });
    try {
      const committed = await commit();
      if (committed === null) return null;
      await conn.transact((doc) => {
        const stash = doc.getMap<string>(YDOC.stash);
        for (const lang of LANGUAGES) {
          const text = doc.getText(YDOC.code(lang));
          stash.set(YDOC.stashKey(from, lang), text.toString());
          const restored = stash.get(YDOC.stashKey(next?.slug ?? null, lang));
          text.delete(0, text.length);
          text.insert(0, typeof restored === 'string' ? restored : problemScaffold(next, lang));
        }
      });
      return committed;
    } finally {
      await conn
        .disconnect()
        .catch((err) => this.ctx.log.warn({ err, padId }, 'closing the direct connection failed'));
    }
  }

  /** After a pad ends: persist now and drop connections so clients reconnect read-only. */
  async endPad(padId: string): Promise<void> {
    const name = YDOC.name(padId);
    const live = this.hocuspocus.documents.get(name);
    if (live) await this.persistState(padId, live);
    await this.flushHistory(padId);
    this.hocuspocus.closeConnections(name);
  }

  /**
   * After the pad row is gone: forget buffered history and drop every connection. The last
   * connection closing makes Hocuspocus store the doc once more; that write finds no pad and is
   * ignored (persistState), so nothing is resurrected. Reconnects fail authentication.
   */
  deletePad(padId: string): void {
    const buf = this.history.get(padId);
    if (buf) clearTimeout(buf.timer);
    this.history.delete(padId);
    const cc = this.codeChanged.get(padId);
    if (cc?.timer) clearTimeout(cc.timer);
    this.codeChanged.delete(padId);
    this.hocuspocus.closeConnections(YDOC.name(padId));
  }

  /** Drops one user's connections to a pad (they left it); they cannot authenticate again. */
  closeUser(padId: string, userId: string): void {
    const doc = this.hocuspocus.documents.get(YDOC.name(padId));
    if (!doc) return;
    for (const { connection } of doc.connections.values()) {
      const context = connection.context as { userId?: string } | undefined;
      if (context?.userId === userId) connection.close();
    }
  }

  async stop(): Promise<void> {
    for (const [name, doc] of this.hocuspocus.documents) {
      const padId = padIdOf(name);
      if (!padId) continue;
      await this.persistState(padId, doc).catch((err) =>
        this.ctx.log.error({ err, padId }, 'persist on stop failed'),
      );
      await this.flushHistory(padId).catch((err) =>
        this.ctx.log.error({ err, padId }, 'history on stop failed'),
      );
    }
    this.stopped = true;
    for (const c of this.codeChanged.values()) if (c.timer) clearTimeout(c.timer);
    this.hocuspocus.closeConnections();
    for (const ws of this.wss.clients) ws.terminate();
    this.wss.close();
  }

  // ------------------------------------------------------------------ internals

  /** The pad's starter source (`problem` null for a blank room); null when the pad is gone. */
  private async starterFor(padId: string): Promise<{ problem: StarterSource | null } | null> {
    const [row] = await this.ctx.db
      .select({
        slug: pads.problemSlug,
        signature: problems.signature,
        languages: problems.languages,
        starterCode: problems.starterCode,
      })
      .from(pads)
      .leftJoin(problems, eq(problems.slug, pads.problemSlug))
      .where(eq(pads.id, padId));
    if (!row) return null;
    if (!row.slug || !row.signature) return { problem: null };
    return {
      problem: {
        signature: row.signature,
        languages: row.languages ?? undefined,
        starterCode: row.starterCode ?? undefined,
      },
    };
  }

  private async loadOrSeedState(padId: string): Promise<Uint8Array> {
    const { db } = this.ctx;
    const [row] = await db
      .select({ state: padDocs.state })
      .from(padDocs)
      .where(eq(padDocs.padId, padId));
    if (row) return row.state;
    const starter = await this.starterFor(padId);
    if (!starter) throw new Error('pad not found');
    const doc = new Y.Doc();
    seedDoc(doc, starter.problem);
    const update = Y.encodeStateAsUpdate(doc);
    const won = await db.transaction(async (tx) => {
      const inserted = await tx
        .insert(padDocs)
        .values({ padId, state: update })
        .onConflictDoNothing()
        .returning({ padId: padDocs.padId });
      if (inserted.length === 0) return false;
      await tx.insert(padUpdates).values({ padId, seq: 1, update });
      return true;
    });
    if (won) return update;
    const [again] = await db
      .select({ state: padDocs.state })
      .from(padDocs)
      .where(eq(padDocs.padId, padId));
    return again?.state ?? update;
  }

  private async persistState(padId: string, doc: Y.Doc): Promise<void> {
    const state = Y.encodeStateAsUpdate(doc);
    try {
      await this.ctx.db
        .insert(padDocs)
        .values({ padId, state, updatedAt: new Date() })
        .onConflictDoUpdate({ target: padDocs.padId, set: { state, updatedAt: new Date() } });
    } catch (err) {
      // The pad was deleted; its document goes with it.
      if (!isForeignKeyViolation(err)) throw err;
    }
  }

  private recordHistory(padId: string, update: Uint8Array): void {
    const buf = this.history.get(padId);
    if (buf) {
      buf.updates.push(update);
      return;
    }
    const timer = setTimeout(() => {
      void this.flushHistory(padId).catch((err) =>
        this.ctx.log.error({ err, padId }, 'history flush failed'),
      );
    }, this.ctx.config.timing.historyCoalesceMs);
    timer.unref();
    this.history.set(padId, { updates: [update], first: new Date(), timer });
  }

  /** Writes the buffered updates as one row. Serialized per pad so seq stays dense and ordered. */
  flushHistory(padId: string): Promise<void> {
    const prev = this.flushChains.get(padId) ?? Promise.resolve();
    const next = prev.then(async () => {
      const buf = this.history.get(padId);
      if (!buf) return;
      this.history.delete(padId);
      clearTimeout(buf.timer);
      const update =
        buf.updates.length === 1 ? (buf.updates[0] as Uint8Array) : Y.mergeUpdates(buf.updates);
      let seq = this.seqs.get(padId);
      if (seq === undefined) {
        const [m] = await this.ctx.db
          .select({ seq: max(padUpdates.seq) })
          .from(padUpdates)
          .where(eq(padUpdates.padId, padId));
        seq = m?.seq ?? 0;
      }
      seq += 1;
      this.seqs.set(padId, seq);
      try {
        await this.ctx.db.insert(padUpdates).values({ padId, seq, at: buf.first, update });
      } catch (err) {
        if (!isForeignKeyViolation(err)) throw err; // the pad was deleted
      }
    });
    const settled = next.catch(() => {});
    this.flushChains.set(padId, settled);
    void settled.then(() => {
      if (this.flushChains.get(padId) === settled) this.flushChains.delete(padId);
    });
    return next;
  }

  private raiseCodeChanged(padId: string): void {
    const gap = this.ctx.config.timing.codeChangedMinGapMs;
    const now = Date.now();
    let s = this.codeChanged.get(padId);
    if (!s) {
      s = { last: 0 };
      this.codeChanged.set(padId, s);
    }
    if (s.timer) return;
    const fire = () => {
      const st = this.codeChanged.get(padId);
      if (st) {
        st.last = Date.now();
        st.timer = undefined;
      }
      this.ctx.ai.trigger(padId, { type: 'code_changed' });
    };
    const wait = s.last + gap - now;
    if (wait <= 0) fire();
    else {
      s.timer = setTimeout(fire, wait);
      s.timer.unref();
    }
  }
}
