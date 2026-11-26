/** Fake platform + fake model + fake clock for orchestration tests. */
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import {
  type AiModelChoice,
  type InterviewerSettings,
  type Message,
  type Pad,
  ProblemContent,
  type PublicTestResult,
  type Run,
  type RunVerdict,
  type ServerEvent,
} from '@ipp/contracts';
import {
  createInterviewer,
  type InterviewerOptions,
  type InterviewerRuntime,
  type TraceEvent,
} from '../src/interviewer';
import {
  type KeyFailure,
  type ModelClient,
  ModelError,
  type ModelRequest,
  type ModelResponse,
} from '../src/model';
import type {
  AiScope,
  InterviewContext,
  ModelUsage,
  NewMessage,
  ResolvedKey,
  Trigger,
} from '../src/types';

const require = createRequire(import.meta.url);
export const PROBLEM = ProblemContent.parse(
  JSON.parse(readFileSync(require.resolve('@ipp/contracts/fixtures/problem-two-sum.json'), 'utf8')),
);
const { tests: _t, ...PROBLEM_NO_TESTS } = PROBLEM;

export const SCAFFOLD =
  'class Solution:\n    def twoSum(self, nums: list[int], target: int) -> list[int]:\n        pass\n';

export type Reply =
  | string
  | { text: string; refused?: boolean }
  | { error: 'transient' | 'permanent'; keyFailure?: KeyFailure; status?: number }
  | { wait: Promise<string>; ignoreAbort?: boolean };

/** Scripted model: `respond` decides per request; records every request. */
export class FakeModel implements ModelClient {
  readonly model = 'fake-model';
  readonly calls: ModelRequest[] = [];
  aborted = 0;
  constructor(public respond: (req: ModelRequest, n: number) => Reply = defaultRespond) {}

  async call(req: ModelRequest): Promise<ModelResponse> {
    this.calls.push(req);
    const r = this.respond(req, this.calls.length);
    let text: string;
    let refused = false;
    if (typeof r === 'string') text = r;
    else if ('error' in r) throw new ModelError(r.error, `fake ${r.error}`, r.status, r.keyFailure);
    else if ('wait' in r) {
      text = await new Promise<string>((resolve, reject) => {
        if (!r.ignoreAbort) {
          req.signal?.addEventListener('abort', () => {
            this.aborted++;
            reject(new ModelError('aborted', 'aborted'));
          });
        }
        r.wait.then(resolve, reject);
      });
    } else {
      text = r.text;
      refused = !!r.refused;
    }
    if (req.onText && !refused)
      for (const chunk of text.match(/.{1,12}/gs) ?? []) req.onText(chunk);
    return {
      text,
      stopReason: refused ? 'refusal' : 'end_turn',
      refused,
      model: this.model,
      usage: {
        inputTokens: 100,
        outputTokens: 20,
        cacheReadInputTokens: 0,
        cacheCreationInputTokens: 0,
      },
      latencyMs: 1,
      ttftMs: 1,
      fallback: false,
    };
  }

  byPurpose(p: ModelRequest['purpose']) {
    return this.calls.filter((c) => c.purpose === p);
  }
  /** Moment kind of each decision call (parsed from the task text). */
  decisionKinds(): string[] {
    return this.byPurpose('decision').map((c) => {
      const last = c.messages[c.messages.length - 1];
      const text = typeof last?.content === 'string' ? last.content : '';
      return /Moment: (\w+)/.exec(text)?.[1] ?? '?';
    });
  }
}

export const silent = (reason = 'nothing to add') =>
  JSON.stringify({ reason, speak: false, intent: 'nudge', message: '', note: '' });
export const speak = (message: string, intent = 'nudge', note = '') =>
  JSON.stringify({ reason: 'test', speak: true, intent, message, note });

function defaultRespond(req: ModelRequest): Reply {
  if (req.purpose === 'decision') return silent();
  return 'Sure, go ahead.';
}

export interface HarnessOptions {
  settings?: Partial<InterviewerSettings>;
  /** null: no time limit. */
  durationMin?: number | null;
  model?: FakeModel;
  budget?: () => { ok: true } | { ok: false; reason: string };
  greeted?: boolean;
  /** The pad owner's key; defaults to a usable test key. Mutable through `h.key`. */
  key?: ResolvedKey;
  /** Model-aware clients instead of the single fake `model`. */
  clientFor?: InterviewerOptions['clientFor'];
  modelUnavailable?: (padId: string, model: AiModelChoice) => void;
}

export const TEST_KEY = 'sk-ant-api03-TEST-harness-key-0000000000000000';

export function harness(opts: HarnessOptions = {}) {
  const START = Date.parse('2026-11-24T10:00:00.000Z');
  const state = { clock: START };
  const padId = randomUUID();
  const pad: Pad = {
    id: padId,
    ownerId: 'u1',
    title: 't',
    kind: 'practice',
    format: 'coding',
    problemSlug: 'two-sum',
    language: 'python',
    status: 'active',
    durationMin: opts.durationMin === undefined ? 45 : opts.durationMin,
    interviewer: {
      enabled: true,
      style: 'neutral',
      proactivity: 'normal',
      voice: false,
      ...opts.settings,
    },
    shareToken: null,
    startedAt: new Date(START).toISOString(),
    endedAt: null,
  };
  const model = opts.model ?? new FakeModel();
  const transcript: Message[] = [];
  const runs: Run[] = [];
  const notes: string[] = [];
  const saved: NewMessage[] = [];
  const events: ServerEvent[] = [];
  const traces: TraceEvent[] = [];
  const usage: ModelUsage[] = [];
  const logs: { level: string; msg?: string; obj: object }[] = [];
  const keyLookups: AiScope[] = [];
  const rejected: { scope: AiScope; keyId: string; problem: string }[] = [];
  const keyState: { current: ResolvedKey } = {
    current: opts.key ?? { ok: true, keyId: 'k1', provider: 'anthropic', apiKey: TEST_KEY },
  };
  let code = SCAFFOLD;

  const iso = () => new Date(state.clock).toISOString();
  const iv: InterviewerRuntime = createInterviewer(
    { model: 'fake-model' },
    {
      now: () => new Date(state.clock),
      async resolveKey(scope) {
        keyLookups.push(scope);
        return keyState.current;
      },
      async keyRejected(scope, keyId, problem) {
        rejected.push({ scope, keyId, problem });
        keyState.current = { ok: false, state: 'rejected' };
      },
      async loadContext(): Promise<InterviewContext> {
        return {
          pad,
          problem: PROBLEM_NO_TESTS,
          language: pad.language,
          code,
          notes: '',
          transcript: [...transcript],
          recentRuns: [...runs].reverse().slice(0, 10),
          privateNotes: [...notes],
          now: new Date(state.clock),
        };
      },
      async saveMessage(id, m) {
        saved.push(m);
        const msg: Message = {
          id: m.id ?? randomUUID(),
          padId: id,
          role: 'interviewer',
          kind: m.kind,
          intent: m.intent,
          text: m.text,
          via: 'text',
          userId: null,
          createdAt: iso(),
        };
        transcript.push(msg);
        return msg;
      },
      async modelUnavailable(id, m) {
        opts.modelUnavailable?.(id, m);
      },
      async appendPrivateNote(_id, note) {
        notes.push(note);
      },
      emit(_id, e) {
        events.push(e);
      },
      async checkBudget() {
        return opts.budget ? opts.budget() : { ok: true };
      },
      recordUsage(_id, u) {
        usage.push(u);
      },
      log: {
        info: (obj, msg) => logs.push({ level: 'info', obj, msg }),
        warn: (obj, msg) => logs.push({ level: 'warn', obj, msg }),
        error: (obj, msg) => logs.push({ level: 'error', obj, msg }),
      },
    },
    opts.clientFor
      ? { clientFor: opts.clientFor, trace: (_p, e) => traces.push(e) }
      : { modelClient: model, trace: (_p, e) => traces.push(e) },
  );

  const h = {
    padId,
    pad,
    model,
    iv,
    transcript,
    runs,
    notes,
    saved,
    events,
    traces,
    usage,
    logs,
    state,
    keyLookups,
    rejected,
    get key() {
      return keyState.current;
    },
    set key(k: ResolvedKey) {
      keyState.current = k;
    },
    get code() {
      return code;
    },
    set code(c: string) {
      code = c;
    },
    elapsed: () => (state.clock - START) / 1000,
    async send(t: Trigger) {
      iv.handle(padId, t);
      await iv.idle(padId);
    },
    /** Advance the clock, ticking every 5 s. */
    async advance(seconds: number) {
      const end = state.clock + seconds * 1000;
      while (state.clock < end) {
        state.clock = Math.min(end, state.clock + 5000);
        await h.send({ type: 'tick' });
      }
    },
    async say(text: string, via: 'text' | 'voice' = 'text') {
      transcript.push({
        id: randomUUID(),
        padId,
        role: 'candidate',
        kind: 'chat',
        intent: null,
        text,
        via,
        userId: 'u1',
        createdAt: iso(),
      });
      await h.send({ type: 'candidate_message', text, via, userId: 'u1' });
    },
    /** Candidate types for `seconds` (code_changed every second, ticks every 5 s), ending with `final`. */
    async type(seconds: number, final?: string) {
      for (let i = 1; i <= seconds; i++) {
        state.clock += 1000;
        if (final !== undefined && i === seconds) code = final;
        else code += ' ';
        await h.send({ type: 'code_changed' });
        if (i % 5 === 0) await h.send({ type: 'tick' });
      }
    },
    async run(
      mode: Run['mode'],
      verdict: RunVerdict,
      passed: number,
      total: number,
      hiddenFailures = 0,
    ) {
      const tests: PublicTestResult[] = Array.from({ length: total }, (_, i) => ({
        id: `t${i}`,
        hidden: false as const,
        verdict: i < passed ? ('pass' as const) : ('fail' as const),
        timeMs: 1,
        actual: [[0, 0]],
        stdout: '',
        stderr: '',
        message: null,
      }));
      const r: Run = {
        id: randomUUID(),
        padId,
        userId: 'u1',
        mode,
        language: 'python',
        status: 'finished',
        verdict,
        compile: null,
        file: null,
        tests,
        passed,
        total,
        message: null,
        createdAt: iso(),
        finishedAt: iso(),
      };
      runs.push(r);
      await h.send({ type: 'run_finished', run: r, hiddenFailures });
      return r;
    },
    proactive: () => saved.filter((m) => m.kind === 'proactive' && m.intent !== 'greeting'),
    replies: () => saved.filter((m) => m.kind === 'chat'),
    /** Start the session and let the greeting happen. */
    async start() {
      await h.send({ type: 'session_started' });
    },
  };
  return h;
}

export const BIG_CODE = `${SCAFFOLD.replace('        pass\n', '')}        seen = {}
        for i, x in enumerate(nums):
            if target - x in seen:
                return [seen[target - x], i]
            seen[x] = i
        return []
`;
