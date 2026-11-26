/**
 * A scripted quant round against the real model (`simulate.ts --quant`): three questions from
 * the bank, an in-memory round driven by the shared `advanceRound` (as the API does, minus the
 * database), a virtual clock, and every turn printed: the action, the step taken or refused, the
 * books after it, latencies and token usage. Ends with the verdicts and the assessment.
 *
 * Not part of the checks: it needs a real key and spends real tokens.
 */
import { randomUUID } from 'node:crypto';
import { loadQuizQuestions } from '@ipp/content';
import {
  advanceRound,
  createQuantRound,
  type InterviewerSettings,
  type Message,
  type Pad,
  type QuantRoundStep,
  type QuantStepResult,
  quantClock,
  quantPhase,
  quantRoundEndsAt,
  quantTimeSec,
} from '@ipp/contracts';
import {
  createInterviewer,
  type InterviewerConfig,
  type QuantContext,
  type QuantQuestion,
  type TraceEvent,
} from '../src/index';

/** The round: a Bayes calculation, a puzzle with a short answer, and a market to make. */
const QUESTION_IDS = ['prob-conditional-003', 'bt-weighing-006', 'bmm-quoting-001'];

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
}): Promise<void> {
  const bank = loadQuizQuestions();
  const questions = QUESTION_IDS.map((id) => {
    const q = bank.find((x) => x.id === id);
    if (!q || (q.type !== 'short' && q.type !== 'numeric')) throw new Error(`no question ${id}`);
    return q as QuantQuestion;
  });
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
  let round = createQuantRound(
    'trader',
    durationMin,
    questions.map((q) => ({
      questionId: q.id,
      topic: q.topic,
      difficulty: q.difficulty,
      prompt: q.prompt,
      unit: q.type === 'numeric' ? (q.unit ?? null) : null,
      hintsAvailable: (q.hints ?? []).length,
    })),
  );
  let version = 0;
  const transcript: Message[] = [];
  const notes: string[] = [];
  let scratch = '';
  const totals = { calls: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };

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
    if (e.say)
      post({ role: 'interviewer', kind: e.say.kind, intent: e.say.intent, text: e.say.text });
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
    console.log(
      `${C.dim}        books: v${version} ${quantPhase(round)} current=${round.current}${q ? ` hints=[${q.hintRungs.join(',')}] followUp=${q.followUpAsked} nudged=${q.nudgedAt !== null}` : ''}${C.reset}`,
    );
    return { ok: true, version, phase: quantPhase(round), clock: quantClock(round, roundEndsAt) };
  }

  function context(scope: 'current' | 'all' = 'current'): QuantContext {
    const phase = quantPhase(round);
    const posed = round.questions.flatMap((q, i) => (q.posedAt ? [i] : []));
    const entry = (i: number) => ({
      index: i,
      question: questions[i] as QuantQuestion,
      hintRungs: [...(round.questions[i]?.hintRungs ?? [])],
      followUpAsked: round.questions[i]?.followUpAsked ?? false,
    });
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
    if (e.usage) {
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
        `        action: ${e.turn.action}${e.turn.action === 'hint' ? ` rung ${e.turn.hint_rung}` : ''}; reason: ${e.turn.reason}`,
      );
      if (e.turn.action === 'close')
        console.log(`        verdict: ${e.turn.score} ${e.turn.summary}`);
      if (e.turn.note) console.log(`        note: ${e.turn.note}`);
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
        return post({ role: 'interviewer', kind: m.kind, intent: m.intent, text: m.text });
      },
      async appendPrivateNote(_id, note) {
        notes.push(note);
      },
      emit() {},
      checkBudget: async () => ({ ok: true }),
      log: {
        info() {},
        warn: (obj, m) => console.log(`${C.yellow}warn: ${m} ${JSON.stringify(obj)}${C.reset}`),
        error: (obj, m) => console.log(`${C.red}error: ${m} ${JSON.stringify(obj)}${C.reset}`),
      },
    },
    { trace: onTrace, voiceSettleMs: 0 },
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
  const t0 = performance.now();
  console.log(
    `${C.bold}Simulating a ${durationMin}-minute quant round (${QUESTION_IDS.join(', ')}), style=${o.settings.style}, voice=${o.settings.voice}, model=${o.config.model}${C.reset}\n`,
  );

  await send({ type: 'session_started' });
  await wait(10);

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

  // Q2, the ropes: thinking quietly, a stall, then the clock runs out.
  await work(60, 'rope A: light both ends -> 30 min');
  await wait(120);
  await say('Lighting both ends of one rope gives 30 minutes, but I still need 15 more somehow.');
  let c = quantClock(round, roundEndsAt);
  if (c) await wait(Math.ceil((c.posedAt + c.budgetMs + c.graceMs - clock) / 1000) + 5);

  // Q3, a market to make: a quote, a trade against it, an update, the end of the round.
  await say('Three dice, expected sum is 10.5. I will make it 10 at 11, one up.');
  await wait(20);
  await say(
    'If you buy at 11 I would move up a little, say 10.5 at 11.5, since you might know something, but the fair value has not changed.',
  );
  await wait(20);
  await say("That's my market, and fair value is 10.5.");
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
  console.log(
    `\n${C.bold}Turn calls: ${totals.calls}; input ${totals.input} uncached + ${totals.cacheRead} cache read + ${totals.cacheWrite} cache write; output ${totals.output}; wall ${((performance.now() - t0) / 1000).toFixed(0)} s${C.reset}`,
  );
}
