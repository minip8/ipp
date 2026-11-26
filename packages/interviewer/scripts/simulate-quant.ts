/**
 * A scripted quant round against the real model (`simulate.ts --quant`): three questions from
 * the bank, an in-memory round driven by the shared `advanceRound` (as the API does, minus the
 * database), a virtual clock, and every turn printed: the action, the step taken or refused, the
 * books after it, latencies and token usage. Ends with the verdicts, the assessment, latency
 * percentiles, and how many raw outputs needed their JSON or LaTeX escapes repaired.
 *
 * The candidate thinks aloud with a tentative number, asks for a hint, commits, answers the
 * follow-up (Q1); gets past the first rungs alone, stalls, asks for the answer outright, trails off
 * mid-thought and runs out of time (Q2); quotes one side only, then a two-sided market, updates on
 * a revealed die and sizes up (Q3).
 *
 * Not part of the checks: it needs a real key and spends real tokens.
 */
import { randomUUID } from 'node:crypto';
import { appendFileSync, writeFileSync } from 'node:fs';
import { loadQuantGames, loadQuizQuestions } from '@ipp/content';
import {
  advanceRound,
  createQuantRound,
  formatGameNumber,
  formatQuote,
  gameBooks,
  gameConditional,
  gameReview,
  type InterviewerSettings,
  type Message,
  type Pad,
  type QuantPick,
  type QuantRoundStep,
  type QuantStepResult,
  quantClock,
  quantGamePick,
  quantPhase,
  quantRoundEndsAt,
  quantTimeSec,
} from '@ipp/contracts';
import {
  createInterviewer,
  createModelClient,
  type InterviewerConfig,
  type ModelClient,
  type QuantContext,
  type QuantQuestion,
  type TraceEvent,
} from '../src/index';
import { repairLatexEscapes } from '../src/quant/latex';

/** The round: a Bayes calculation, a puzzle with a short answer, and a market to make. */
const QUESTION_IDS = ['prob-conditional-003', 'bt-weighing-006', 'bmm-quoting-001'];
/** With `--game`: the Bayes calculation, then the game (in the puzzle's slot), then the puzzle. */
const GAME_ROUND_IDS = ['prob-conditional-003', 'bt-weighing-006', 'bt-weighing-006'];
const GAME_SLOT = 1;

const C = {
  dim: '\x1b[2m',
  bold: '\x1b[1m',
  cyan: '\x1b[36m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  magenta: '\x1b[35m',
  reset: '\x1b[0m',
};

export async function simulateQuant(o: {
  config: InterviewerConfig;
  devKey: string;
  settings: InterviewerSettings;
  skipAssessment: boolean;
  /** Append every model request and its raw output to this file, one JSON object per line. */
  dump?: string;
  /**
   * Play a round with this market-making game (`packages/content/games/<id>.yaml`) as its second
   * question, instead of the market-making bank question (`--game <id>`): see `playGame`.
   */
  gameId?: string;
  /** The game's hidden values (`--values 6,2,5`); drawn at random when absent. */
  gameValues?: number[];
}): Promise<void> {
  const bank = loadQuizQuestions();
  const ids = o.gameId ? GAME_ROUND_IDS : QUESTION_IDS;
  const questions = ids.map((id) => {
    const q = bank.find((x) => x.id === id);
    if (!q || (q.type !== 'short' && q.type !== 'numeric')) throw new Error(`no question ${id}`);
    return q as QuantQuestion;
  });
  const game = o.gameId ? loadQuantGames().find((g) => g.id === o.gameId) : undefined;
  if (o.gameId && !game) throw new Error(`no game ${o.gameId}`);
  const START = Date.parse('2026-11-24T10:00:00.000Z');
  let clock = START;
  const iso = (t = clock) => new Date(t).toISOString();
  const mmss = (t = clock) => {
    const s = Math.floor((t - START) / 1000);
    return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
  };
  const durationMin = 20;
  const padId = randomUUID();
  const pad: Pad = {
    id: padId,
    ownerId: 'user-1',
    title: 'Quant round',
    kind: 'practice',
    format: 'quant',
    problemSlug: null,
    language: 'python',
    status: 'active',
    durationMin,
    interviewer: o.settings,
    shareToken: null,
    startedAt: iso(START),
    endedAt: null,
  };
  const roundEndsAt = quantRoundEndsAt(pad.startedAt, durationMin);
  const picks: QuantPick[] = questions.map((q) => ({
    questionId: q.id,
    topic: q.topic,
    topicTitle: q.topic,
    difficulty: q.difficulty,
    prompt: q.prompt,
    unit: q.type === 'numeric' ? (q.unit ?? null) : null,
    hintsAvailable: (q.hints ?? []).length,
  }));
  if (game) {
    const values = o.gameValues;
    let k = 0;
    picks[GAME_SLOT] = quantGamePick(game, 'Betting & market making', () => {
      const c = game.components[k];
      const v = values?.[k++];
      if (!c || v === undefined) return Math.random();
      const at = c.faces.indexOf(v);
      if (at < 0) throw new Error(`${v} is not a face of ${c.label}`);
      return (at + 0.5) / c.faces.length;
    });
  }
  let round = createQuantRound('trader', durationMin, picks);
  let version = 0;
  const transcript: Message[] = [];
  const notes: string[] = [];
  let scratch = '';
  const totals = { calls: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
  /** Per call, on the game and on the other questions, for comparing latency and caching. */
  type CallStat = {
    latencyMs: number;
    ttftMs: number | null;
    input: number;
    cacheRead: number;
    cacheWrite: number;
    output: number;
  };
  const groups: { game: CallStat[]; other: CallStat[] } = { game: [], other: [] };
  let adjustedCount = 0;
  const latencies: number[] = [];
  /** Raw outputs: how many were not valid JSON as sent, and how many had LaTeX escapes repaired. */
  const raw = { outputs: 0, invalidJson: 0, latexRepaired: 0, refused: 0, fallback: 0 };
  if (o.dump) writeFileSync(o.dump, '');
  /**
   * Streaming: when the current call started, the first delta of each streamed message (time to
   * first character), what was streamed under each id, and how each stream ended.
   */
  let callStarted = 0;
  /** Whether the call in flight is on the game (for the latency and cache comparison). */
  let callOnGame = false;
  const firstChar: number[] = [];
  /** The whole call, for the calls that streamed (replies and the opening). */
  const streamedCalls: number[] = [];
  const streamedText = new Map<string, string>();
  const ends = { posted: 0, differed: 0, discarded: 0 };
  /** A posted message: the same as what was streamed under its id? */
  const settle = (id: string | undefined, text: string) => {
    const s = id ? streamedText.get(id) : undefined;
    if (s === undefined || !id) return;
    streamedText.delete(id);
    ends.posted++;
    if (s !== text) {
      ends.differed++;
      console.log(
        `${C.yellow}        streamed text differs from the posted one: ${JSON.stringify(s)}${C.reset}`,
      );
    }
  };

  /** The real client, wrapped to look at what the model actually sent back. */
  const inspect = (inner: ModelClient): ModelClient => ({
    model: inner.model,
    async call(req) {
      callStarted = performance.now();
      callOnGame = round.questions[round.current]?.game != null;
      const chunks: string[] = [];
      const onText = req.onText;
      const res = await inner.call(
        onText
          ? {
              ...req,
              onText: (d) => {
                chunks.push(d);
                onText(d);
              },
            }
          : req,
      );
      if (onText) streamedCalls.push(res.latencyMs);
      raw.outputs++;
      if (res.refused) raw.refused++;
      if (res.fallback) raw.fallback++;
      let parsed: unknown = null;
      try {
        parsed = JSON.parse(res.text);
      } catch {
        raw.invalidJson++;
        console.log(
          `${C.red}        raw output is not valid JSON: ${res.text.slice(0, 300)}${C.reset}`,
        );
      }
      const strings =
        parsed && typeof parsed === 'object'
          ? Object.values(parsed as Record<string, unknown>).filter(
              (v): v is string => typeof v === 'string',
            )
          : [];
      if (strings.some((v) => repairLatexEscapes(v) !== v)) {
        raw.latexRepaired++;
        console.log(`${C.yellow}        LaTeX escapes repaired in this output${C.reset}`);
      }
      if (o.dump) {
        const { signal: _s, schema: _z, onText: _t, ...body } = req;
        appendFileSync(
          o.dump,
          `${JSON.stringify({ at: mmss(), request: body, text: res.text, chunks, usage: res.usage, model: res.model, stopReason: res.stopReason, latencyMs: res.latencyMs, ttftMs: res.ttftMs })}\n`,
        );
      }
      return res;
    },
  });

  const post = (
    m: Pick<Message, 'role' | 'kind' | 'intent' | 'text'> & { id?: string; via?: Message['via'] },
  ) => {
    const msg: Message = {
      id: m.id ?? randomUUID(),
      padId,
      role: m.role,
      kind: m.kind,
      intent: m.intent,
      text: m.text,
      via: m.via ?? 'text',
      userId: m.role === 'candidate' ? 'user-1' : null,
      createdAt: iso(),
    };
    transcript.push(msg);
    if (m.role === 'interviewer') {
      const colour = m.intent === 'question' ? C.magenta : C.cyan;
      console.log(
        `${C.bold}${colour}[${mmss()}] INTERVIEWER (${m.kind}/${m.intent}):${C.reset} ${m.text.trim()}`,
      );
    }
    return msg;
  };

  function apply(step: QuantRoundStep): QuantStepResult {
    const adv = advanceRound(round, step, {
      version,
      now: new Date(clock),
      roundEndsAt,
      newId: randomUUID,
    });
    if (!adv.ok) {
      console.log(`${C.yellow}[${mmss()}] step ${step.type} refused: ${adv.reason}${C.reset}`);
      return { ok: false, reason: adv.reason };
    }
    round = adv.state;
    version = adv.version;
    const e = adv.effects;
    if (e.say) {
      settle(e.say.messageId, e.say.text);
      post({
        id: e.say.messageId,
        role: 'interviewer',
        kind: e.say.kind,
        intent: e.say.intent,
        text: e.say.text,
      });
    }
    if (e.quote) {
      // As the API: the poster's chat message, at the step's time.
      post({ role: 'candidate', kind: 'chat', intent: null, text: e.quote.text });
      console.log(`${C.bold}[${mmss()}] CANDIDATE (quote box):${C.reset} ${e.quote.text}`);
    }
    if (e.game)
      for (const g of e.game.entries)
        if (g.kind !== 'quote')
          console.log(`${C.magenta}        game: ${JSON.stringify(g)}${C.reset}`);
    if (e.reveal)
      post({
        id: e.reveal.messageId,
        role: 'interviewer',
        kind: 'proactive',
        intent: 'question',
        text: e.reveal.text,
      });
    if (e.note) notes.push(e.note);
    const q = round.questions[Math.min(round.current, round.questions.length - 1)];
    const gs = round.questions[GAME_SLOT]?.game;
    const gb = gs ? gameBooks(gs) : null;
    console.log(
      `${C.dim}        books: v${version} ${quantPhase(round)} current=${round.current}${q ? ` hints=[${q.hintRungs.join(',')}] followUp=${q.followUpAsked} nudged=${q.nudgedAt !== null}` : ''}${gb && round.questions[GAME_SLOT]?.posedAt ? ` | game: revealed=${gb.revealed} quote=${gb.quote ? formatQuote(gb.quote) : 'none'} position=${gb.position} cash=${gb.cash} fair=${gb.fair} value=${gb.value} markToValue=${gb.markToValue}${gb.settlement ? ` settled pnl=${gb.settlement.pnl}` : ''}` : ''}${C.reset}`,
    );
    return { ok: true, version, phase: quantPhase(round), clock: quantClock(round, roundEndsAt) };
  }

  function context(scope: 'current' | 'all' = 'current'): QuantContext {
    const phase = quantPhase(round);
    const posed = round.questions.flatMap((q, i) => (q.posedAt ? [i] : []));
    const entry = (i: number): QuantContext['questions'][number] => {
      const q = round.questions[i];
      if (q?.game && game)
        return {
          kind: 'game',
          index: i,
          game: {
            id: game.id,
            topic: game.topic,
            title: game.title,
            difficulty: game.difficulty,
            prompt: q.prompt,
            counterparty: game.counterparty,
            hints: game.hints.slice(0, q.hintsAvailable),
            explanation: game.explanation,
            mechanics: q.game.spec,
          },
          books: gameBooks(q.game),
          state: q.game,
          hintRungs: [...q.hintRungs],
          followUpAsked: q.followUpAsked,
        };
      return {
        index: i,
        question: questions[i] as QuantQuestion,
        hintRungs: [...(q?.hintRungs ?? [])],
        followUpAsked: q?.followUpAsked ?? false,
      };
    };
    let shown = transcript.slice(-200);
    if (scope === 'current') {
      const cut = posed.length ? round.questions[posed.at(-1) as number]?.posedMessageId : null;
      const at = cut ? transcript.findIndex((m) => m.id === cut) : -1;
      shown = at >= 0 ? transcript.slice(at + 1) : [...transcript];
    }
    return {
      pad,
      round: {
        version,
        total: round.questions.length,
        phase,
        clock: quantClock(round, roundEndsAt),
        path: round.path,
        closed: round.questions.flatMap((q, i) =>
          q.closedAt
            ? [
                {
                  index: i,
                  topic: q.topic,
                  difficulty: q.difficulty,
                  hints: q.hintRungs.length,
                  timeSec: quantTimeSec(q) ?? 0,
                  verdict: q.verdict,
                  budgetSec: q.budgetSec,
                  closedBy: q.closedBy,
                },
              ]
            : [],
        ),
      },
      questions:
        scope === 'all' ? posed.map(entry) : phase === 'asking' ? [entry(round.current)] : [],
      transcript: shown,
      scratch,
      privateNotes: [...notes],
      now: new Date(clock),
    };
  }

  function onTrace(_pad: string, e: TraceEvent): void {
    if (e.type === 'error')
      console.log(`[${mmss()}] ${C.red}ERROR ${e.purpose} ${e.kind}: ${e.message}${C.reset}`);
    if (e.type !== 'quant') return;
    if (e.usage && e.latencyMs !== undefined) {
      const onGame = callOnGame;
      (onGame ? groups.game : groups.other).push({
        latencyMs: e.latencyMs,
        ttftMs: e.ttftMs ?? null,
        input: e.usage.inputTokens,
        cacheRead: e.usage.cacheReadInputTokens,
        cacheWrite: e.usage.cacheCreationInputTokens,
        output: e.usage.outputTokens,
      });
    }
    if (e.adjusted) {
      adjustedCount += e.adjusted.length;
      console.log(`${C.red}        adjusted: ${e.adjusted.join('; ')}${C.reset}`);
    }
    if (e.usage) {
      if (e.latencyMs !== undefined) latencies.push(e.latencyMs);
      totals.calls++;
      totals.input += e.usage.inputTokens;
      totals.output += e.usage.outputTokens;
      totals.cacheRead += e.usage.cacheReadInputTokens;
      totals.cacheWrite += e.usage.cacheCreationInputTokens;
    }
    const colour = e.outcome === 'applied' ? C.green : e.outcome === 'silent' ? C.dim : C.yellow;
    const perf =
      e.latencyMs !== undefined && e.usage
        ? ` ${C.dim}(${(e.latencyMs / 1000).toFixed(1)} s; in ${e.usage.inputTokens} + cache_read ${e.usage.cacheReadInputTokens} + cache_write ${e.usage.cacheCreationInputTokens}, out ${e.usage.outputTokens})${C.reset}`
        : '';
    console.log(
      `[${mmss()}] ${colour}TURN ${e.trigger} -> ${e.outcome.toUpperCase()}${e.step ? ` ${e.step}` : ''}${e.why ? ` (${e.why})` : ''}${C.reset}${perf}`,
    );
    if (e.turn) {
      console.log(
        `        action: ${e.turn.action}${e.turn.action === 'hint' ? ` rung ${e.turn.hint_rung}` : ''}${e.turn.trade !== 'none' || e.turn.reveal ? `; move: trade=${e.turn.trade} quantity=${e.turn.quantity} reveal=${e.turn.reveal}` : ''}; reason: ${e.turn.reason}`,
      );
      if (e.turn.action === 'close')
        console.log(`        verdict: ${e.turn.score} ${e.turn.summary}`);
      if (e.turn.note) console.log(`        note: ${e.turn.note}`);
      if (e.outcome !== 'applied' && e.turn.message)
        console.log(`        (unsent: ${e.turn.message})`);
    }
  }

  const interviewer = createInterviewer(
    o.config,
    {
      now: () => new Date(clock),
      resolveKey: async () => ({ ok: true, keyId: 'dev', provider: 'anthropic', apiKey: o.devKey }),
      keyRejected: async (_s, _id, problem) => console.error(`The key was refused (${problem}).`),
      loadContext: async () => {
        throw new Error('a quant pad has no problem');
      },
      loadQuantContext: async (_id, scope) => context(scope),
      applyQuantStep: async (_id, step) => apply(step),
      async saveMessage(_id, m) {
        settle(m.id, m.text);
        return post({
          id: m.id,
          role: 'interviewer',
          kind: m.kind,
          intent: m.intent,
          text: m.text,
        });
      },
      async appendPrivateNote(_id, note) {
        notes.push(note);
      },
      emit(_id, e) {
        if (e.type === 'message.delta') {
          const before = streamedText.get(e.messageId);
          if (before === undefined) firstChar.push(performance.now() - callStarted);
          streamedText.set(e.messageId, (before ?? '') + e.delta);
        } else if (e.type === 'message.discarded') {
          streamedText.delete(e.messageId);
          ends.discarded++;
          console.log(`${C.dim}        (streamed message discarded)${C.reset}`);
        }
      },
      checkBudget: async () => ({ ok: true }),
      log: {
        info() {},
        warn: (obj, m) => console.log(`${C.yellow}warn: ${m} ${JSON.stringify(obj)}${C.reset}`),
        error: (obj, m) => console.log(`${C.red}error: ${m} ${JSON.stringify(obj)}${C.reset}`),
      },
    },
    {
      trace: onTrace,
      voiceSettleMs: 0,
      clientFor: (key, model) => inspect(createModelClient(key.provider, key.apiKey, model)),
    },
  );

  const send = async (t: Parameters<typeof interviewer.handle>[1]) => {
    interviewer.handle(padId, t);
    await interviewer.idle(padId);
  };
  const wait = async (seconds: number) => {
    const end = clock + seconds * 1000;
    while (clock < end) {
      clock = Math.min(end, clock + 5000);
      await send({ type: 'tick' });
    }
  };
  const via = o.settings.voice ? 'voice' : 'text';
  const say = async (text: string) => {
    post({ role: 'candidate', kind: 'chat', intent: null, text, via });
    console.log(`${C.bold}[${mmss()}] CANDIDATE:${C.reset} ${text}`);
    await send({ type: 'candidate_message', text, via, userId: 'user-1' });
  };
  const work = async (seconds: number, lines: string) => {
    console.log(
      `${C.dim}[${mmss()}] (candidate works on the scratchpad for ${seconds}s)${C.reset}`,
    );
    for (let i = 1; i <= seconds; i++) {
      clock += 1000;
      if (i === seconds) scratch += `${lines}\n`;
      await send({ type: 'scratch_changed' });
      if (i % 5 === 0) await send({ type: 'tick' });
    }
  };
  /**
   * The candidate posts a market through the quote box, as the API's quote route does: the
   * `quote` step (whose effects post the candidate's message), then the trigger it raises.
   */
  const postQuote = async (bid: number, ask: number, size: number) => {
    const r = apply({ type: 'quote', index: round.current, bid, ask, size });
    if (!r.ok) return false;
    const text = transcript.at(-1)?.text ?? '';
    await send({ type: 'candidate_message', text, via: 'text', userId: 'user-1' });
    return true;
  };

  /**
   * The game, played by a scripted candidate: a sensible market around the public fair value
   * (a width of about 0.8 standard deviations, shaded a little after each fill the way a careful
   * candidate would), once a stale market left where it was before a reveal, once a market typed
   * in the chat instead of posted, once "what's the fair value?", and remarks on the position.
   * Runs until the interviewer closes the game or its time (budget and grace) is up.
   */
  async function playGame(): Promise<void> {
    const at = round.current;
    const state = () => round.questions[at]?.game;
    const g0 = state();
    if (!g0) throw new Error('the game is not posed');
    const tick = g0.spec.tick;
    const size = g0.spec.maxSize >= 10 ? 5 : Math.min(2, g0.spec.maxSize);
    const snap = (x: number) => Math.round(x / tick) * tick;
    /** Shading: how far the candidate has moved their mid after fills (up after being lifted). */
    let skew = 0;
    let fills = 0;
    let lastRevealed = 0;
    let staleDone = false;
    let typedDone = false;
    let askedFair = false;
    let remarked = 0;
    const open = () => round.current === at && state()?.settlement === null;
    const clockOf = () => quantClock(round, roundEndsAt);
    const timeLeft = () => {
      const c = clockOf();
      return c ? c.posedAt + c.budgetMs + c.graceMs - clock : 0;
    };
    /** Half-width in standard deviations; cut when the interviewer asks for a tighter market. */
    let width = 0.4;
    const market = (fair: number, sd: number) => {
      const half = Math.max(tick, snap(width * sd));
      const mid = snap(fair + skew);
      return { bid: mid - half, ask: mid + half };
    };
    let step = 0;
    await wait(15);
    await say(
      `Okay. Before I quote, the expected value: ${g0.spec.payoff === 'sum' ? 'I add up the expected value of each component' : 'I need the distribution of the payoff'}, and I want a feel for the spread too.`,
    );
    await work(25, 'E[each], Var[each] -> fair, sd');
    while (open() && timeLeft() > 20_000 && step < 18) {
      step++;
      const s = state();
      if (!s) break;
      const now = gameConditional(s.spec, s.values, s.revealed);
      const before = gameConditional(s.spec, s.values, Math.max(0, s.revealed - 1));
      // Fills since the last look: shade the market the way they point.
      const trades = s.events.filter((e) => e.kind === 'trade');
      for (const t of trades.slice(fills))
        skew += t.kind === 'trade' && t.interviewerSide === 'buy' ? tick : -tick;
      fills = trades.length;
      const revealedNow = s.revealed > lastRevealed;
      lastRevealed = s.revealed;
      if (s.quote) {
        // Their market still stands: tighten it when asked, else say something, as a candidate
        // waiting would.
        const last = transcript.filter((m) => m.role === 'interviewer').at(-1)?.text ?? '';
        if (/tight|narrow|too wide|wide for/i.test(last) && width > 0.3) {
          width *= 0.6;
          const m = market(now.fair, now.sd);
          await postQuote(m.bid, m.ask, size);
        } else if (!askedFair && step >= 3) {
          askedFair = true;
          await say(
            "Before I go on: what's the fair value here, roughly? Just so I know I'm in the right place.",
          );
        } else if (remarked < 1) {
          remarked++;
          await say(
            s.position === 0
              ? "I'm flat, so I'm happy to leave that market up. Do you want to trade it?"
              : `I'm ${s.position > 0 ? 'long' : 'short'} ${Math.abs(s.position)} now, so I'd rather not add to that. Do you want to trade my market?`,
          );
        } else {
          const m = market(now.fair, now.sd);
          await postQuote(m.bid, m.ask, size);
        }
        await wait(15);
        continue;
      }
      if (revealedNow && !staleDone && s.revealed > 0) {
        // Once: the market left where it was before the reveal.
        staleDone = true;
        const m = market(before.fair, before.sd);
        await postQuote(m.bid, m.ask, size);
        await wait(20);
        continue;
      }
      if (!typedDone && step >= 2) {
        typedDone = true;
        const m = market(now.fair, now.sd);
        await say(
          `New market: ${formatGameNumber(m.bid)} at ${formatGameNumber(m.ask)}, ${size} up.`,
        );
        await wait(20);
        continue;
      }
      if (!askedFair && step >= 4) {
        askedFair = true;
        await say("Before I quote again: what's the fair value here, roughly?");
        await wait(15);
        continue;
      }
      await work(10, `fair now ${formatGameNumber(now.fair, 2)}?`);
      const m = market(now.fair, now.sd);
      await postQuote(m.bid, m.ask, size);
      await wait(20);
    }
    if (open()) {
      // Let the clock close it (the nudge, then the close for time).
      const c = clockOf();
      if (c) await wait(Math.ceil((c.posedAt + c.budgetMs + c.graceMs - clock) / 1000) + 10);
    }
    const s = state();
    if (s) {
      const r = gameReview(s);
      console.log(
        `${C.bold}Game over: settled at ${r.value}; final position ${r.finalPosition}, largest ${r.maxAbsPosition}; expected edge ${r.expectedEdge}, P&L ${r.pnl}; ${r.quotes.length} quotes, ${r.trades.length} trades, ${r.reveals.length} reveals.${C.reset}`,
      );
    }
  }

  const t0 = performance.now();
  console.log(
    `${C.bold}Simulating a ${durationMin}-minute quant round (${game ? `${ids[0]}, the game ${game.id}${o.gameValues ? ` [${o.gameValues.join(', ')}]` : ''}, ${ids[2]}` : QUESTION_IDS.join(', ')}), style=${o.settings.style}, voice=${o.settings.voice}, model=${o.config.model}${C.reset}\n`,
  );

  await send({ type: 'session_started' });
  await wait(10);

  if (game) {
    // Q1, Bayes, briefly: the baseline for an ordinary question's latency and caching.
    await say(
      "The test is 99% accurate but the disease is rare, so I'll use Bayes: P(D|+) = P(+|D)P(D) / P(+).",
    );
    await work(30, 'P(D)=0.001, P(+|D)=0.99, P(+|~D)=0.05');
    await say('That gives 0.00099 over 0.00099 plus 0.04995, about 1.9%. That is my final answer.');
    await wait(20);
    if (round.current === 0)
      await say(
        'If a second test is also positive, the prior becomes 1.9%, so it rises to about 28%.',
      );
    await wait(20);
    if (round.current === 0) await say("I'm happy with that; shall we move on?");
    await wait(10);
    if (round.current === GAME_SLOT) await playGame();
    else console.log(`${C.red}The game was not posed (current=${round.current}).${C.reset}`);
    apply({ type: 'end' });
    pad.status = 'ended';
    pad.endedAt = iso();
    await send({ type: 'session_ended' });
    return finish();
  }

  // Q1, Bayes: tentative numbers, a hint request, a committed answer, the follow-up.
  await say(
    'Okay, the test is 99% accurate, so if I test positive... is it like 99%? Hmm, no, that ignores how rare it is.',
  );
  await work(40, 'P(D) = 0.001, P(+|D) = 0.99, P(+|not D) = 0.05');
  await say(
    "I'm not sure how to put the base rate and the false positives together. Can I get a hint?",
  );
  await work(45, 'per 1000 people: ~1 sick & positive, ~50 healthy & positive');
  await say(
    'So out of a thousand people about one is sick and tests positive, and about fifty are healthy and test positive. So roughly one in fifty-one, maybe 2%?',
  );
  await wait(15);
  await say(
    'Yes, that is my final answer: 0.99 times 0.001 over 0.99 times 0.001 plus 0.05 times 0.999, which is about 1.9%.',
  );
  await wait(20);
  await say(
    'If a second independent test is also positive, I would redo the update with a prior of about 2% instead of 0.1%, so it should go up to roughly 28%.',
  );
  await wait(20);

  // Q2, the ropes: thinking quietly, a stall, past the first rungs on their own, asking for the
  // answer outright, a half-finished thought, then the clock runs out.
  await work(60, 'rope A: light both ends -> 30 min');
  await wait(120);
  await say('Lighting both ends of one rope gives 30 minutes, but I still need 15 more somehow.');
  await wait(60);
  await say("Honestly I'm stuck. Can you just tell me the answer?");
  await wait(30);
  await say('Hmm, so if I light the second rope at the same time as the first one...');
  await work(30, 'rope B: light one end at t=0?');
  let c = quantClock(round, roundEndsAt);
  if (c) await wait(Math.ceil((c.posedAt + c.budgetMs + c.graceMs - clock) / 1000) + 5);

  // Q3, a market to make: a one-sided quote, a two-sided one, an update on information, size,
  // then the end of the round.
  await say("Three dice, the expected sum is 10.5. I'd be happy to buy at 10.");
  await wait(20);
  await say(
    "Okay, 10 at 11, one up. The sum runs from 3 to 18, so I want a bit of room, and if you don't know anything I make about 50 cents a trade.",
  );
  await wait(20);
  await say(
    'If you lift my offer at 11 and then the first die comes up 6, the expected sum is 6 plus 7, so 13: I would move to 12.5 at 13.5, and I am down about 2 on the one I sold.',
  );
  await wait(30);
  await say(
    "For 50 contracts I'd go wider, maybe 9 at 12, because a position that size can lose a lot if the dice go against me.",
  );
  c = quantClock(round, roundEndsAt);
  if (c)
    await wait(
      Math.ceil(
        (Math.min(c.posedAt + c.budgetMs + c.graceMs, roundEndsAt.getTime()) - clock) / 1000,
      ) + 5,
    );
  await say('Thanks, how did I do overall?');

  apply({ type: 'end' });
  pad.status = 'ended';
  pad.endedAt = iso();
  await send({ type: 'session_ended' });
  await finish();

  async function finish(): Promise<void> {
    console.log(
      `\n${C.bold}Private notes:${C.reset}\n${notes.map((n) => `- ${n}`).join('\n') || '(none)'}`,
    );
    if (!o.skipAssessment) {
      console.log(`\n${C.bold}Generating the assessment (verdicts first)...${C.reset}`);
      const a0 = performance.now();
      const assessment = await interviewer.generateQuantAssessment(padId);
      console.log(`${C.dim}(${((performance.now() - a0) / 1000).toFixed(1)} s)${C.reset}`);
      console.log(
        `Verdicts:\n${round.questions.map((q, i) => `- Q${i + 1} ${q.closedBy ?? 'open'}: ${q.verdict ? `${q.verdict.score} ${q.verdict.summary}` : 'none'}`).join('\n')}`,
      );
      console.log(JSON.stringify(assessment, null, 2));
    }
    const lat = [...latencies].sort((a, b) => a - b);
    const at = (p: number) =>
      ((lat[Math.min(lat.length - 1, Math.floor((lat.length * p) / 100))] ?? 0) / 1000).toFixed(1);
    console.log(
      `\n${C.bold}Turn calls: ${totals.calls}; input ${totals.input} uncached + ${totals.cacheRead} cache read + ${totals.cacheWrite} cache write; output ${totals.output}; latency p50 ${at(50)} s, p90 ${at(90)} s, max ${at(100)} s; wall ${((performance.now() - t0) / 1000).toFixed(0)} s${C.reset}`,
    );
    const pct = (xs: number[], p: number) => {
      const sorted = [...xs].sort((a, b) => a - b);
      const v = sorted[Math.min(sorted.length - 1, Math.floor((sorted.length * p) / 100))] ?? 0;
      return (v / 1000).toFixed(1);
    };
    console.log(
      `${C.bold}Streamed messages: ${firstChar.length}; first character after p50 ${pct(firstChar, 50)} s, p90 ${pct(firstChar, 90)} s, max ${pct(firstChar, 100)} s; the same ${streamedCalls.length} calls whole: p50 ${pct(streamedCalls, 50)} s, p90 ${pct(streamedCalls, 90)} s, max ${pct(streamedCalls, 100)} s; posted under their id ${ends.posted} (text changed when posted ${ends.differed}), discarded ${ends.discarded}, left over ${streamedText.size}${C.reset}`,
    );
    console.log(
      `${C.bold}Raw outputs (all calls): ${raw.outputs}; not valid JSON as sent ${raw.invalidJson}; LaTeX escapes repaired ${raw.latexRepaired}; refused ${raw.refused}; served by a fallback ${raw.fallback}${C.reset}`,
    );
    if (game) {
      const summary = (name: string, xs: CallStat[]) => {
        if (!xs.length) return `${name}: no calls`;
        const avg = (f: (x: CallStat) => number) =>
          Math.round(xs.reduce((s, x) => s + f(x), 0) / xs.length);
        const ttft = xs.flatMap((x) => (x.ttftMs === null ? [] : [x.ttftMs]));
        return `${name}: ${xs.length} calls; latency p50 ${pct(
          xs.map((x) => x.latencyMs),
          50,
        )} s, p90 ${pct(
          xs.map((x) => x.latencyMs),
          90,
        )} s; ttft p50 ${pct(ttft, 50)} s; per call: uncached in ${avg((x) => x.input)}, cache read ${avg((x) => x.cacheRead)}, cache write ${avg((x) => x.cacheWrite)}, out ${avg((x) => x.output)}`;
      };
      console.log(`${C.bold}${summary('Game turns', groups.game)}${C.reset}`);
      console.log(`${C.bold}${summary('Other turns', groups.other)}${C.reset}`);
      console.log(`${C.bold}Moves adjusted by the books: ${adjustedCount}${C.reset}`);
    }
  }
}
