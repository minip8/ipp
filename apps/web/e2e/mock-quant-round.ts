/**
 * Mock of the live quant round, kept apart from mock-api.ts (which delegates here):
 *
 *   POST /api/pads/quant          a quant pad, its round assembled from fixtures-quant-round
 *   GET  /api/pads/:id            `round` (kept in the pad detail as the round changes)
 *   POST /api/pads/:id/end        pad.updated (ended), then round.updated (finished)
 *   GET  /api/pads/:id/report     `Report.quant`, with every question's status
 *   GET  /api/pads/:id/playback   the scratchpad's history, question events and messages
 *   WS   on connect               round.updated to that socket alone
 *   WS   chat.send                the candidate's message, then the scripted interviewer's step
 *   POST /api/pads/:id/round/quote  a market on the current game (§8.3): 200 with the round, or
 *                                 409 with the round's refusal; the quote's message and
 *                                 round.updated, then the scripted interviewer's answer
 *
 * Every change to a round goes through the contract's own `advanceRound`, as on the server, and
 * a step's events go out in the API's order: the interviewer's message, the revealed question,
 * then `round.updated`. The scripted interviewer reads chat like the API's test harness: "hint…"
 * gives the next hint, "follow…" the follow-up, "answer…" closes the question with a verdict,
 * "skip…" closes it without one; anything else stays on the question. Specs can also call the
 * steps directly (`hint`, `followUp`, `close`, `nudge`, `timeout`, `finish`).
 *
 * Streaming, as the API's interviewer does it: `streamMessages` streams every scripted reply's
 * message (`message.delta`) before its step, which posts it under the same id
 * (`QuantStep.messageId`), and a refused step drops it (`message.discarded`). Specs drive a stream
 * by hand with `streamDeltas`, then post it (a step helper given the id) or `discard` it.
 *
 * A trader round has the market-making game in its second slot unless `includeGame` is false (a
 * researcher round only when it is true), as the API's assembler. The scripted interviewer answers
 * each quote (`gameReply`): a market wider than 3 is sent back to be tightened (it stays live);
 * otherwise it trades on the public fair value from `gameBooks`, the full size against a quote
 * that is off fair and one lot otherwise, and on every second trade it also shows the next die.
 * "reveal…" or "show…" in chat shows the next die at once (withdrawing a live quote). Specs can
 * also make a move directly (`gameMove`).
 */
import {
  type AiKeyStatus,
  advanceRound,
  CreateQuantPadRequest,
  createQuantRound,
  formatGameNumber,
  gameBooks,
  gameSolution,
  gameStats,
  type Message,
  type PadDetail,
  type PadSummary,
  Playback,
  PostQuantQuoteRequest,
  publicRound,
  QUANT_PATH_INFO,
  type QuantGameMove,
  type QuantPath,
  QuantQuestionReview,
  type QuantRoundState,
  type QuantRoundStep,
  type QuantRoundView,
  type QuantVerdict,
  quantGameReview,
  quantQuestionCount,
  quantQuestionStatus,
  quantRoundEndsAt,
  quantTimeSec,
  Report,
  type ServerEvent,
  type TimelineEvent,
  YDOC,
} from '@ipp/contracts';
import type { WebSocketRoute } from '@playwright/test';
import * as Y from 'yjs';
import { makeMessage, makePadDetail, uuid } from './fixtures';
import {
  type BankQuestion,
  GAME_LINES,
  LINES,
  QUANT_ENDED_PAD_ID,
  QUANT_ENDED_STARTED_AT,
  QUANT_GAME_ENDED_PAD_ID,
  QUANT_GAME_ENDED_STARTED_AT,
  QUANT_GAME_PAD_ID,
  QUANT_PAD_ID,
  ROUND_BANK,
  ROUND_GAMES,
  roundPicks,
  VERDICTS,
} from './fixtures-quant-round';

/** What the mock needs of MockBackend (an interface, so the two files do not import each other). */
export interface QuantHost {
  pads: Map<string, PadDetail>;
  summaries: PadSummary[];
  aiKey: AiKeyStatus;
  me: { id: string; name: string; guest?: boolean };
  push(event: ServerEvent): void;
}

type Round = {
  padId: string;
  state: QuantRoundState;
  version: number;
  /** `question`, `game` and `ended` timeline events, for the playback. */
  timeline: TimelineEvent[];
  /** The scratchpad's history for the playback: [seconds since start, text appended]. */
  notes: [number, string][];
  greeted: boolean;
};

/** A seeded round's script, at seconds after the pad started. */
export type ScriptLine =
  | { at: number; step: QuantRoundStep }
  | { at: number; candidate: string }
  | { at: number; notes: string };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const b64 = (u: Uint8Array) => Buffer.from(u).toString('base64');

function response(status: number, code: string, message: string) {
  return new Response(JSON.stringify({ error: { code, message } }), { status });
}

export class MockQuantRounds {
  rounds = new Map<string, Round>();
  /** The interviewer greets and poses the first question when a pending round's pad is opened. */
  autoStart = true;
  greetDelayMs = 400;
  /** How long the scripted interviewer "thinks" before each reply. */
  replyDelayMs = 250;
  /** POST /api/pads/quant refuses with `quant_unavailable` (true: every path). */
  unavailable: boolean | QuantPath = false;
  /** Send a step's round.updated before its messages (the API sends it after). */
  roundFirst = false;
  /**
   * Steps change the round but send nothing, as if every socket had missed them (a reconnect
   * then has to bring the browser up to date).
   */
  muted = false;
  /** Every view broadcast, in order (specs replay an old one to test that it is ignored). */
  broadcast: QuantRoundView[] = [];
  /** Every step tried, and whether the shared transition accepted it. */
  log: { step: QuantRoundStep; ok: boolean; reason?: string }[] = [];
  /** Stream each scripted reply's message before its step (`message.delta`, then the step). */
  streamMessages = false;
  /** The pause between streamed pieces. */
  streamChunkMs = 40;
  /** How the scripted interviewer answers a quote: `auto` (see the module comment) or not at all. */
  gameReply: 'auto' | 'off' = 'auto';
  /** A market wider than this is sent back to be tightened. */
  gameMaxWidth = 3;

  constructor(private host: QuantHost) {
    this.seedEnded();
    // A round under way: the first question was posed a minute and a half ago.
    this.seed({
      id: QUANT_PAD_ID,
      path: 'trader',
      durationMin: 30,
      startedAt: new Date(Date.now() - 100_000).toISOString(),
      script: [{ at: 8, step: { type: 'start', version: 0, say: LINES.greeting } }],
    });
    this.seedGame();
    this.seedGameEnded();
  }

  // ---------------------------------------------------------------- pads

  private makeDetail(o: {
    id: string;
    path: QuantPath;
    durationMin: number;
    startedAt: string;
    interviewer?: Partial<PadDetail['pad']['interviewer']>;
    title?: string;
  }): PadDetail {
    return makePadDetail({
      pad: {
        id: o.id,
        format: 'quant',
        problemSlug: null,
        language: 'python',
        title: o.title ?? `${QUANT_PATH_INFO[o.path].label} quant round`,
        durationMin: o.durationMin,
        interviewer: {
          style: 'neutral',
          proactivity: 'normal',
          voice: false,
          ...o.interviewer,
          enabled: true,
        },
        shareToken: `sh_${o.id.slice(-8)}`,
        startedAt: o.startedAt,
      },
      messages: [],
    });
  }

  /**
   * A quant pad whose round has been played to some point already: each line of the script is
   * applied at its time (seconds after the start), through the shared transition.
   */
  seed(o: {
    id: string;
    path: QuantPath;
    durationMin: number;
    startedAt: string;
    script: ScriptLine[];
    endedAtSec?: number;
    voice?: boolean;
    /** A market-making game in the second slot. */
    game?: boolean;
  }): PadDetail {
    const detail = this.makeDetail({ ...o, interviewer: { voice: o.voice ?? false } });
    this.host.pads.set(o.id, detail);
    const round: Round = {
      padId: o.id,
      state: createQuantRound(
        o.path,
        o.durationMin,
        roundPicks(o.path, quantQuestionCount(o.durationMin), o.game ?? false),
      ),
      version: 0,
      timeline: [],
      notes: [],
      greeted: false,
    };
    this.rounds.set(o.id, round);
    const at = (sec: number) => new Date(Date.parse(o.startedAt) + sec * 1000);
    for (const line of o.script) {
      if ('step' in line) {
        // Steps in a script name version 0; they apply to whatever the round is at.
        const step =
          line.step.type === 'end' || line.step.type === 'quote'
            ? line.step
            : { ...line.step, version: round.version };
        const r = this.apply(round, step as QuantRoundStep, at(line.at), false);
        if (!r) throw new Error(`seeded step refused: ${JSON.stringify(line.step)}`);
        if (line.step.type === 'start') round.greeted = true;
      } else if ('candidate' in line) {
        detail.messages.push(this.candidateMessage(o.id, line.candidate, at(line.at)));
      } else round.notes.push([line.at, line.notes]);
    }
    if (o.endedAtSec !== undefined) {
      const endedAt = at(o.endedAtSec);
      detail.pad = { ...detail.pad, status: 'ended', endedAt: endedAt.toISOString() };
      this.apply(round, { type: 'end' }, endedAt, false);
      round.timeline.push({
        id: uuid(),
        padId: o.id,
        at: endedAt.toISOString(),
        event: { type: 'ended' },
      });
    }
    return detail;
  }

  /** The ended round the report specs read: answered, timed out, unfinished and not reached. */
  private seedEnded() {
    const close = (verdict: QuantVerdict | null, say: string) =>
      ({
        type: 'close',
        version: 0,
        index: 0,
        kind: 'chat',
        say,
        by: 'interviewer',
        verdict,
      }) as const;
    this.seed({
      id: QUANT_ENDED_PAD_ID,
      path: 'trader',
      durationMin: 30,
      startedAt: QUANT_ENDED_STARTED_AT,
      endedAtSec: 1140,
      script: [
        { at: 6, step: { type: 'start', version: 0, say: LINES.greeting } },
        { at: 40, notes: 'Q1: pairs summing to 8\n(2,6) (3,5) (4,4) (5,3) (6,2) -> 5 of 36\n' },
        { at: 62, candidate: 'Five ordered pairs give 8 out of 36, so 5/36.' },
        { at: 75, step: { ...close(VERDICTS.good, LINES.close), index: 0 } },
        { at: 130, candidate: 'Could I have a hint on the ropes?' },
        {
          at: 140,
          step: {
            type: 'turn',
            version: 0,
            index: 1,
            kind: 'chat',
            action: 'hint',
            hintRung: 1,
            say: 'Think about what lighting a rope at both ends does to its time.',
          },
        },
        { at: 200, notes: '\nQ2: both ends -> 30 min?\n' },
        { at: 330, candidate: 'So both ends of A, one end of B, and then...' },
        {
          at: 345,
          step: {
            type: 'turn',
            version: 0,
            index: 1,
            kind: 'chat',
            action: 'hint',
            hintRung: 2,
            say: 'Good. What is left of rope $B$ when $A$ burns out?',
          },
        },
        {
          at: 700,
          step: {
            type: 'close',
            version: 0,
            index: 1,
            kind: 'proactive',
            say: LINES.timeout,
            by: 'timeout',
            verdict: null,
          },
        },
        { at: 760, notes: '\nQ3: E = sum 2^-n * 2^n for n<=6, then 64 * P(n>=7)\n' },
        {
          at: 800,
          step: {
            type: 'turn',
            version: 0,
            index: 2,
            kind: 'proactive',
            action: 'follow_up',
            say: 'Before you sum it: what is $P(n \\ge 7)$?',
          },
        },
        { at: 880, candidate: 'P(n >= 7) is 1/64, so that tail adds 1.' },
      ],
    });
  }

  /** A trader round whose second question, the game, was posed a minute and a half ago. */
  private seedGame() {
    this.seed({
      id: QUANT_GAME_PAD_ID,
      path: 'trader',
      durationMin: 30,
      startedAt: new Date(Date.now() - 170_000).toISOString(),
      game: true,
      script: [
        { at: 6, step: { type: 'start', version: 0, say: LINES.greeting } },
        { at: 60, candidate: 'Five ordered pairs give 8 out of 36, so 5/36.' },
        {
          at: 75,
          step: {
            type: 'close',
            version: 0,
            index: 0,
            kind: 'chat',
            say: LINES.close,
            by: 'interviewer',
            verdict: VERDICTS.good,
          },
        },
      ],
    });
  }

  /**
   * The ended round with a game the report specs read. The dice are 6, 2 and 5 (worth 13). Markets:
   * 9.5 – 11.5 lifted for 2; Die 1 (6) shown; 11 – 12.5, too low, lifted for 2; 12.5 – 13.5 lifted
   * for 1 and Die 2 (2) shown; 11 – 12 lifted for 1 by a counterparty that now knows. Expected
   * edge +2, realised −4.5: luck and an informed counterparty took 6.5.
   */
  private seedGameEnded() {
    const turn = (index: number, say: string, game: QuantGameMove) =>
      ({ type: 'turn', version: 0, index, kind: 'chat', action: 'stay', say, game }) as const;
    const quote = (bid: number, ask: number, size: number) =>
      ({ type: 'quote', index: 1, bid, ask, size }) as const;
    const buy = (quantity: number) => ({ trade: { interviewerSide: 'buy' as const, quantity } });
    this.seed({
      id: QUANT_GAME_ENDED_PAD_ID,
      path: 'trader',
      durationMin: 30,
      startedAt: QUANT_GAME_ENDED_STARTED_AT,
      endedAtSec: 1000,
      game: true,
      script: [
        { at: 6, step: { type: 'start', version: 0, say: LINES.greeting } },
        { at: 50, candidate: 'Five ordered pairs give 8 out of 36, so 5/36.' },
        {
          at: 64,
          step: {
            type: 'close',
            version: 0,
            index: 0,
            kind: 'chat',
            say: LINES.close,
            by: 'interviewer',
            verdict: VERDICTS.good,
          },
        },
        { at: 100, candidate: 'Each die averages 3.5, so the sum is 10.5. I will go 9.5 at 11.5.' },
        { at: 104, step: quote(9.5, 11.5, 2) },
        { at: 118, step: turn(1, 'I buy 2 at your offer of 11.5.', buy(2)) },
        { at: 150, step: turn(1, 'Die 1 shows 6. Make me a market.', { reveal: true }) },
        { at: 190, step: quote(11, 12.5, 2) },
        { at: 200, step: turn(1, 'I buy 2 at your offer of 12.5.', buy(2)) },
        { at: 230, candidate: 'You keep buying. Die 1 is a 6, so the other two average 7: 13.' },
        { at: 236, step: quote(12.5, 13.5, 2) },
        {
          at: 250,
          step: turn(1, 'I buy 1 at your offer of 13.5. Die 2 shows 2.', {
            ...buy(1),
            reveal: true,
          }),
        },
        { at: 300, step: quote(11, 12, 1) },
        { at: 312, step: turn(1, 'I buy 1 at your offer of 12.', buy(1)) },
        {
          at: 380,
          step: {
            type: 'close',
            version: 0,
            index: 1,
            kind: 'chat',
            say: 'That settles the game at 13 (Die 1: 6, Die 2: 2, Die 3: 5). You finish short 6, a loss of 4.5. Let’s look at how that went in the report.',
            by: 'interviewer',
            verdict: {
              score: 0.6,
              summary:
                'A sound first market around $10.5$. After the 6 the market moved only half way, to $11.75$, and was lifted; the last stage traded against someone who knew.',
            },
          },
        },
        { at: 700, candidate: 'Put-call parity: P = C − S + K e^{−rT}.' },
      ],
    });
  }

  /** The quant pads as GET /api/pads lists them (for the dashboard specs and screens). */
  summaryOf(id: string): PadSummary | null {
    const d = this.host.pads.get(id);
    if (d?.pad.format !== 'quant') return null;
    return {
      id: d.pad.id,
      title: d.pad.title,
      kind: 'practice',
      format: 'quant',
      problemSlug: null,
      language: 'python',
      status: d.pad.status,
      startedAt: d.pad.startedAt,
      endedAt: d.pad.endedAt,
      problemTitle: null,
      difficulty: null,
      accepted: false,
      role: d.role,
      quantPath: this.rounds.get(id)?.state.path ?? null,
    };
  }

  /** Puts the seeded quant pads on the dashboard (not the ones with a game). */
  listOnDashboard() {
    for (const id of [QUANT_PAD_ID, QUANT_ENDED_PAD_ID]) {
      const s = this.summaryOf(id);
      if (s && !this.host.summaries.some((x) => x.id === id)) this.host.summaries.unshift(s);
    }
    this.host.summaries.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  }

  /** POST /api/pads/quant, with the API's refusals. */
  create(body: unknown): Response | PadDetail['pad'] {
    if (this.host.me.guest)
      return response(403, 'account_required', 'Sign in with an account to do this');
    const parsed = CreateQuantPadRequest.safeParse(body);
    if (!parsed.success)
      return response(400, 'validation_error', parsed.error.issues[0]?.message ?? 'Invalid body');
    const req = parsed.data;
    if (this.host.aiKey.state !== 'active')
      return response(
        409,
        'ai_key_missing',
        'The quant round runs on your own AI API key. Add one first.',
      );
    if (this.unavailable === true || this.unavailable === req.path)
      return response(409, 'quant_unavailable', 'Not enough questions for this round yet.');
    const id = uuid();
    const detail = this.makeDetail({
      id,
      path: req.path,
      durationMin: req.durationMin,
      startedAt: new Date().toISOString(),
      interviewer: req.interviewer,
      title: req.title,
    });
    this.host.pads.set(id, detail);
    // As the API's assembler: absent, a trader round has a game and a researcher round none.
    const game = req.includeGame ?? req.path === 'trader';
    const state = createQuantRound(
      req.path,
      req.durationMin,
      roundPicks(req.path, quantQuestionCount(req.durationMin), game),
    );
    this.rounds.set(id, { padId: id, state, version: 0, timeline: [], notes: [], greeted: false });
    detail.round = publicRound(state, 0);
    const summary = this.summaryOf(id);
    if (summary) this.host.summaries.unshift(summary);
    return detail.pad;
  }

  // ---------------------------------------------------------------- the transition

  view(padId: string): QuantRoundView | null {
    const r = this.rounds.get(padId);
    return r ? publicRound(r.state, r.version) : null;
  }

  private candidateMessage(padId: string, text: string, at: Date, via: 'text' | 'voice' = 'text') {
    return makeMessage({
      padId,
      role: 'candidate',
      userId: this.host.me.id,
      text,
      via,
      createdAt: at.toISOString(),
    });
  }

  /**
   * One step through `advanceRound`, then its effects in the API's order: the interviewer's
   * message, the revealed question (with its timeline event), then round.updated. Null when the
   * transition refused it (nothing changes, nothing is sent).
   */
  private apply(r: Round, step: QuantRoundStep, now = new Date(), send = true) {
    const d = this.host.pads.get(r.padId);
    if (!d) return null;
    const res = advanceRound(r.state, step, {
      version: r.version,
      now,
      roundEndsAt: quantRoundEndsAt(d.pad.startedAt, r.state.durationMin),
      newId: () => uuid(),
    });
    this.log.push(res.ok ? { step, ok: true } : { step, ok: false, reason: res.reason });
    if (!res.ok) return null;
    r.state = res.state;
    r.version = res.version;
    const messages: Message[] = [];
    const { say, reveal, quote, game } = res.effects;
    // A market posted: the poster's message, before the game's entry for it.
    if (quote) messages.push(this.candidateMessage(r.padId, quote.text, now));
    if (say)
      messages.push(
        makeMessage({
          // The id it was streamed under, when it was.
          ...(say.messageId ? { id: say.messageId } : {}),
          padId: r.padId,
          role: 'interviewer',
          kind: say.kind,
          intent: say.intent,
          text: say.text,
          createdAt: now.toISOString(),
        }),
      );
    // What the step did to a game (a quote; a trade, a reveal; the settlement), after its message
    // and before the next question's.
    for (const entry of game?.entries ?? [])
      r.timeline.push({
        id: uuid(),
        padId: r.padId,
        at: now.toISOString(),
        event: { type: 'game', index: game?.index ?? 0, entry },
      });
    if (reveal) {
      // After the message that introduced it (the API sets the two times apart explicitly).
      const at = new Date(now.getTime() + 1).toISOString();
      messages.push(
        makeMessage({
          id: reveal.messageId,
          padId: r.padId,
          role: 'interviewer',
          kind: 'proactive',
          intent: 'question',
          text: reveal.text,
          createdAt: at,
        }),
      );
      r.timeline.push({
        id: uuid(),
        padId: r.padId,
        at,
        event: { type: 'question', index: reveal.index, total: reveal.total },
      });
    }
    d.messages.push(...messages);
    const view = publicRound(r.state, r.version);
    d.round = view;
    if (send && !this.muted) {
      this.broadcast.push(view);
      const updated: ServerEvent = { type: 'round.updated', round: view };
      if (this.roundFirst) this.host.push(updated);
      for (const message of messages) this.host.push({ type: 'message.created', message });
      if (!this.roundFirst) this.host.push(updated);
    }
    return res;
  }

  private round(padId: string): Round {
    const r = this.rounds.get(padId);
    if (!r) throw new Error(`no quant round for ${padId}`);
    return r;
  }

  /**
   * The interviewer at work: thinking, then the step. With `messageId` (a message streamed by
   * hand) or `streamMessages`, the step posts its message under the id it was streamed under,
   * and a refused step drops what was streamed.
   */
  private async speak(padId: string, step: () => QuantRoundStep | null, messageId?: string) {
    if (!this.muted) this.host.push({ type: 'interviewer.thinking', active: true });
    await sleep(this.replyDelayMs);
    let s = step();
    let id = messageId;
    if (s && !id && this.streamMessages && !this.muted && 'say' in s && s.say) {
      id = uuid();
      await this.streamDeltas(id, s.say);
      // Decided again on the round as it now is (the API's step names the version it read).
      s = step();
    }
    if (s && id && (s.type === 'start' || s.type === 'turn' || s.type === 'close'))
      s = { ...s, messageId: id };
    const ok = s ? this.apply(this.round(padId), s) !== null : false;
    if (!ok && id && !this.muted) this.host.push({ type: 'message.discarded', messageId: id });
    if (!this.muted) this.host.push({ type: 'interviewer.thinking', active: false });
    return ok;
  }

  /** The interviewer writing a message: `text` as deltas under `id`, nothing posted yet. */
  async streamDeltas(id: string, text: string, chunkMs = this.streamChunkMs) {
    this.host.push({ type: 'interviewer.thinking', active: true });
    for (const piece of text.match(/[\s\S]{1,6}/g) ?? []) {
      this.host.push({ type: 'message.delta', messageId: id, delta: piece });
      await sleep(chunkMs);
    }
  }

  /** What was streamed under `id` will not be posted (the turn was aborted or refused). */
  discard(id: string) {
    this.host.push({ type: 'message.discarded', messageId: id });
    this.host.push({ type: 'interviewer.thinking', active: false });
  }

  // ---------------------------------------------------------------- the socket

  /** A pad socket opened: send it the round, and start a pending round once. */
  connected(ws: WebSocketRoute, padId: string) {
    const r = this.rounds.get(padId);
    if (!r) return;
    // Asynchronously, as the API does: other events may come first.
    setTimeout(() => {
      const view = this.view(padId);
      if (view) ws.send(JSON.stringify({ type: 'round.updated', round: view }));
    }, 30);
    if (this.autoStart && r.state.current === -1 && !r.greeted) {
      r.greeted = true;
      setTimeout(() => void this.start(padId), this.greetDelayMs);
    }
  }

  /** chat.send on a quant pad: the message comes back, then the interviewer's turn. */
  chat(padId: string, text: string, via: 'text' | 'voice', interviewerOn: boolean) {
    const d = this.host.pads.get(padId);
    if (!d) return;
    const m = this.candidateMessage(padId, text, new Date(), via);
    d.messages.push(m);
    this.host.push({ type: 'message.created', message: m });
    if (!interviewerOn) return;
    const r = this.round(padId);
    if (r.state.current < 0 || r.state.current >= r.state.questions.length) return;
    void this.speak(padId, () => this.replyStep(r, text));
  }

  private nextRung(r: Round): number {
    const q = r.state.questions[r.state.current];
    if (!q) return 0;
    const given = q.hintRungs.filter((x) => x > 0).length;
    return given < q.hintsAvailable ? given + 1 : 0;
  }

  private isLast(r: Round) {
    return r.state.current === r.state.questions.length - 1;
  }

  private replyStep(r: Round, text: string): QuantRoundStep | null {
    const index = r.state.current;
    const base = { version: r.version, index, kind: 'chat' as const };
    const game = r.state.questions[index]?.game;
    if (game && /^\s*(reveal|show)/i.test(text)) {
      const books = gameBooks(game);
      const next = books.nextReveal;
      if (!next) return { ...base, type: 'turn', action: 'stay', say: GAME_LINES.nothingLeft };
      const value = books.components[next.component]?.value ?? 0;
      return {
        ...base,
        type: 'turn',
        action: 'stay',
        say: `${GAME_LINES.shown(next.label, value)} ${books.quote ? GAME_LINES.withdrawn : GAME_LINES.again}`,
        game: { reveal: true },
      };
    }
    if (/^\s*hint/i.test(text)) {
      const rung = this.nextRung(r);
      return {
        ...base,
        type: 'turn',
        action: 'hint',
        hintRung: rung,
        say: rung > 0 ? LINES.hint : LINES.ownHint,
      };
    }
    if (/^\s*follow/i.test(text))
      return { ...base, type: 'turn', action: 'follow_up', say: LINES.followUp };
    if (/^\s*answer/i.test(text))
      return {
        ...base,
        type: 'close',
        by: 'interviewer',
        verdict: VERDICTS.good,
        say: this.isLast(r) ? LINES.wrapUp : LINES.close,
      };
    if (/^\s*skip/i.test(text))
      return {
        ...base,
        type: 'close',
        by: 'interviewer',
        verdict: null,
        say: this.isLast(r) ? LINES.wrapUp : LINES.closeNoVerdict,
      };
    return { ...base, type: 'turn', action: 'stay', say: LINES.stay };
  }

  // ---------------------------------------------------------------- the game

  /**
   * POST /api/pads/:id/round/quote on a quant pad (mock-api refuses any other pad with
   * `wrong_format`): a `quote` step through the shared transition, its refusal as a 409 with the
   * refusal as its code. Then, as the API feeds the interviewer the quote, its answer.
   */
  quote(padId: string, body: unknown, interviewerOn: boolean): Response | QuantRoundView {
    const r = this.rounds.get(padId);
    if (!r) return response(404, 'not_found', 'Not found');
    const parsed = PostQuantQuoteRequest.safeParse(body);
    if (!parsed.success)
      return response(400, 'validation_error', parsed.error.issues[0]?.message ?? 'Invalid body');
    const res = this.apply(r, { type: 'quote', ...parsed.data });
    if (!res) {
      const reason = this.log.at(-1)?.reason ?? 'invalid';
      return response(409, reason, `The round refused the quote (${reason}).`);
    }
    if (interviewerOn && this.gameReply === 'auto')
      void this.speak(padId, () => this.gameReplyStep(r));
    return publicRound(r.state, r.version);
  }

  /** The scripted interviewer's answer to the live quote (see the module comment). */
  private gameReplyStep(r: Round): QuantRoundStep | null {
    const index = r.state.current;
    const game = r.state.questions[index]?.game;
    if (!game?.quote) return null;
    const books = gameBooks(game);
    const q = books.quote;
    if (!q) return null;
    const base = { type: 'turn', version: r.version, index, kind: 'chat', action: 'stay' } as const;
    if (q.width > this.gameMaxWidth) return { ...base, say: GAME_LINES.tighten };
    const [side, quantity] =
      q.liftOffer.vsFair > 0
        ? (['buy', q.size] as const)
        : q.hitBid.vsFair > 0
          ? (['sell', q.size] as const)
          : (['buy', 1] as const);
    const trades = books.log.filter((e) => e.kind === 'trade').length + 1;
    const next = trades % 2 === 0 ? books.nextReveal : null;
    const price = formatGameNumber(side === 'buy' ? q.ask : q.bid);
    const shown = next
      ? GAME_LINES.shown(next.label, books.components[next.component]?.value ?? 0)
      : null;
    return {
      ...base,
      say: [GAME_LINES.trade(side, quantity, price), shown, GAME_LINES.again]
        .filter(Boolean)
        .join(' '),
      game: { trade: { interviewerSide: side, quantity }, ...(next ? { reveal: true } : {}) },
    };
  }

  /** A move made directly: a trade against the live quote and/or a reveal, with what is said. */
  gameMove(padId: string, move: QuantGameMove, say: string | null = null) {
    const r = this.round(padId);
    return this.speak(padId, () => ({
      type: 'turn',
      version: r.version,
      index: r.state.current,
      kind: 'proactive',
      action: 'stay',
      say,
      game: move,
    }));
  }

  // ---------------------------------------------------------------- steps for specs

  /** The greeting and the first question (what opening a pending round's pad does). */
  start(padId: string, say: string = LINES.greeting) {
    const r = this.round(padId);
    r.greeted = true;
    return this.speak(padId, () => ({ type: 'start', version: r.version, say }));
  }

  /**
   * The next authored hint (or one in the interviewer's own words once they are used up).
   * `messageId`: the id its text was streamed under (`streamDeltas`).
   */
  hint(padId: string, say?: string, messageId?: string) {
    const r = this.round(padId);
    return this.speak(
      padId,
      () => {
        const rung = this.nextRung(r);
        return {
          type: 'turn',
          version: r.version,
          index: r.state.current,
          kind: 'proactive',
          action: 'hint',
          hintRung: rung,
          say: say ?? (rung > 0 ? LINES.hint : LINES.ownHint),
        };
      },
      messageId,
    );
  }

  followUp(padId: string, say: string = LINES.followUp) {
    const r = this.round(padId);
    return this.speak(padId, () => ({
      type: 'turn',
      version: r.version,
      index: r.state.current,
      kind: 'proactive',
      action: 'follow_up',
      say,
    }));
  }

  /** The interviewer closes the current question; the next is revealed or the round finishes. */
  close(padId: string, verdict: QuantVerdict | null = VERDICTS.good, say?: string) {
    const r = this.round(padId);
    return this.speak(padId, () => ({
      type: 'close',
      version: r.version,
      index: r.state.current,
      kind: 'proactive',
      by: 'interviewer',
      verdict,
      say: say ?? (this.isLast(r) ? LINES.wrapUp : LINES.close),
    }));
  }

  /** Moves the current question's clock back by `sec` (as if it had been posed that long ago). */
  age(padId: string, sec: number) {
    const r = this.round(padId);
    const q = r.state.questions[r.state.current];
    if (!q?.posedAt) return;
    q.posedAt = new Date(Date.parse(q.posedAt) - sec * 1000).toISOString();
    const d = this.host.pads.get(padId);
    if (d) d.round = publicRound(r.state, r.version);
  }

  /** The question's time is up: the interviewer says so (once), and the clock shows "over". */
  nudge(padId: string, say: string = LINES.nudge) {
    const r = this.round(padId);
    const q = r.state.questions[r.state.current];
    if (q?.posedAt && q.budgetSec) {
      const left = Date.parse(q.posedAt) + q.budgetSec * 1000 - Date.now();
      if (left > -20_000) this.age(padId, left / 1000 + 20);
    }
    return this.speak(padId, () => ({
      type: 'turn',
      version: r.version,
      index: r.state.current,
      kind: 'proactive',
      action: 'stay',
      nudge: true,
      say,
    }));
  }

  /** The question's budget and grace ran out: closed for time, the next one revealed. */
  timeout(padId: string, say: string = LINES.timeout) {
    const r = this.round(padId);
    const q = r.state.questions[r.state.current];
    if (q?.posedAt && q.budgetSec) {
      const left = Date.parse(q.posedAt) + (q.budgetSec + 90) * 1000 - Date.now();
      if (left > 0) this.age(padId, left / 1000 + 1);
    }
    return this.speak(padId, () => ({
      type: 'close',
      version: r.version,
      index: r.state.current,
      kind: 'proactive',
      by: 'timeout',
      verdict: null,
      say,
    }));
  }

  /** Closes every question left, the last with the wrap-up: the round finishes. */
  async finish(padId: string) {
    const r = this.round(padId);
    while (r.state.current >= 0 && r.state.current < r.state.questions.length)
      await this.close(padId, VERDICTS.good, this.isLast(r) ? LINES.wrapUp : LINES.close);
  }

  /** The pad ended (after its pad.updated): the open question is closed as `ended`. */
  end(padId: string, at = new Date()) {
    const r = this.rounds.get(padId);
    if (!r) return;
    // A round that already finished has nothing to close (the API treats `ended` as a no-op).
    if (r.state.current < r.state.questions.length) this.apply(r, { type: 'end' }, at);
    r.timeline.push({ id: uuid(), padId, at: at.toISOString(), event: { type: 'ended' } });
  }

  // ---------------------------------------------------------------- after the pad ended

  /**
   * GET /report for a quant pad. As the API's assessment does, any closed question without a
   * verdict is judged first (a `verdict` step through the shared transition).
   */
  report(padId: string): Report | Response {
    const r = this.rounds.get(padId);
    const d = this.host.pads.get(padId);
    if (!r || !d) return response(404, 'not_found', 'Not found');
    if (d.pad.status !== 'ended')
      return response(409, 'pad_active', 'The report is written when the interview ends.');
    r.state.questions.forEach((q, index) => {
      if (q.closedAt && !q.verdict)
        this.apply(
          r,
          {
            type: 'verdict',
            version: r.version,
            index,
            verdict: q.closedBy === 'timeout' ? VERDICTS.partial : VERDICTS.weak,
          },
          new Date(),
          false,
        );
    });
    const questions = r.state.questions.map((q, index) => {
      if (q.game)
        // As the API's `buildQuantReport` for a game.
        return QuantQuestionReview.parse({
          index,
          questionId: q.questionId,
          topic: q.topic,
          topicTitle: q.topicTitle ?? q.topic,
          subtopic: '',
          difficulty: q.difficulty,
          type: 'game',
          prompt: q.prompt,
          unit: null,
          solution: gameSolution(gameStats(q.game.spec)),
          keyPoints: [],
          explanation: ROUND_GAMES[q.questionId]?.explanation ?? '',
          status: quantQuestionStatus(q),
          verdict: q.verdict,
          hintsGiven: q.hintRungs.length,
          hintsAvailable: q.hintsAvailable,
          timeSec: quantTimeSec(q),
          budgetSec: q.budgetSec,
          game: quantGameReview(q),
        });
      const bank = ROUND_BANK[q.questionId] as BankQuestion;
      return QuantQuestionReview.parse({
        index,
        questionId: q.questionId,
        topic: q.topic,
        topicTitle: q.topicTitle ?? q.topic,
        subtopic: bank.subtopic,
        difficulty: q.difficulty,
        type: bank.type,
        prompt: q.prompt,
        unit: q.unit,
        solution: bank.solution,
        keyPoints: bank.keyPoints,
        explanation: bank.explanation,
        status: quantQuestionStatus(q),
        verdict: q.verdict,
        hintsGiven: q.hintRungs.length,
        hintsAvailable: q.hintsAvailable,
        timeSec: quantTimeSec(q),
        budgetSec: q.budgetSec,
      });
    });
    const durationSec = d.pad.endedAt
      ? Math.round((Date.parse(d.pad.endedAt) - Date.parse(d.pad.startedAt)) / 1000)
      : 0;
    return Report.parse({
      padId,
      status: 'ready',
      generatedAt: d.pad.endedAt,
      stats: {
        durationSec,
        // A quant pad has no runs (`Report.stats`).
        runs: null,
        submissions: null,
        accepted: null,
        candidateMessages: d.messages.filter((m) => m.role === 'candidate').length,
        interviewerMessages: d.messages.filter((m) => m.role === 'interviewer').length,
      },
      assessment: QUANT_ASSESSMENT,
      assessmentUnavailable: null,
      quant: { path: r.state.path, questions },
    });
  }

  /** GET /playback for a quant pad: the scratchpad as it was written, the questions, the chat. */
  playback(padId: string): Playback | null {
    const r = this.rounds.get(padId);
    const d = this.host.pads.get(padId);
    if (!r || !d) return null;
    const doc = new Y.Doc();
    const start = Date.parse(d.pad.startedAt);
    const updates: Playback['updates'] = [];
    let at = start;
    let seq = 0;
    doc.on('update', (u: Uint8Array) => {
      updates.push({ seq: ++seq, at: new Date(at).toISOString(), update: b64(u) });
    });
    const text = doc.getText(YDOC.notes);
    for (const [sec, chunk] of r.notes) {
      // A line at a time, a couple of seconds apart, as typed.
      chunk.split(/(?<=\n)/).forEach((line, i) => {
        at = start + (sec + i * 3) * 1000;
        doc.transact(() => text.insert(text.length, line));
      });
    }
    return Playback.parse({ updates, events: r.timeline, messages: d.messages });
  }
}

/**
 * The mock's assessment of a quant round: the five quant dimensions, with math in the summary, an
 * evidence line, a strength and an improvement (a live model writes it in all of them).
 */
export const QUANT_ASSESSMENT = {
  recommendation: 'lean_hire',
  summary:
    'Ada set up the dice question cleanly and reached $\\frac{5}{36}$ quickly. On the ropes she needed both hints and ran out of time; on the capped game she had the right sum, $E = \\sum_{n \\le 6} 2^{-n} 2^n + 64 \\cdot 2^{-6}$, when the round ended.',
  scores: [
    {
      dimension: 'structuring',
      score: 3,
      evidence: 'Wrote the sample space down before counting, and split the capped game at n = 6.',
    },
    {
      dimension: 'correctness',
      score: 3,
      evidence:
        'The one finished answer, $\\frac{5}{36}$, was right; the capped game was on track.',
    },
    {
      dimension: 'communication',
      score: 3,
      evidence: 'Said what she was doing at each step, though quieter on the ropes.',
    },
    {
      dimension: 'speed',
      score: 2,
      evidence: 'The ropes took the whole budget and the grace.',
    },
    {
      dimension: 'independence',
      score: 2,
      evidence: 'Asked for a hint early on the ropes and needed the second rung as well.',
    },
  ],
  strengths: [
    'Counts outcomes before reaching for formulas: $6 \\times 6 = 36$ cases',
    'Clear working on the scratchpad',
  ],
  improvements: [
    'Try a minute of your own ideas before asking for a hint',
    'Say the answer, with its unit, before moving to checks: $E = 4$ minutes, not just 4',
  ],
} as const;
