import { describe, expect, it } from 'vitest';
import * as P from '../src/policy';

const T0 = 1_000_000_000;
const sec = (s: number) => T0 + s * 1000;

/** poll(), ignoring checkpoint moments (stage-1 candidates that stage 2 usually drops). */
function next(s: P.PolicyState, t: number): P.Moment | null {
  for (;;) {
    const m = P.poll(s, t);
    if (m?.kind !== 'checkpoint') return m;
    P.take(s, m);
  }
}

function state(overrides: Partial<P.PolicyState> = {}): P.PolicyState {
  return {
    ...P.initialPolicyState(),
    startedAt: T0,
    durationMs: 45 * 60_000,
    greeted: true,
    lastActivityAt: T0,
    lastInterviewerMsgAt: T0,
    ...overrides,
  };
}

describe('policy: typing and stalls', () => {
  it('never offers a moment while the candidate types steadily', () => {
    const s = state();
    for (let t = 1; t <= 600; t++) {
      P.observe(s, { type: 'code_changed' }, sec(t));
      if (t % 5 === 0) expect(P.poll(s, sec(t))).toBeNull();
    }
  });

  it('offers a stall after stallMs of idleness, then escalates once, then stops', () => {
    const s = state();
    P.observe(s, { type: 'code_changed' }, sec(10));
    expect(next(s, sec(105))).toBeNull(); // 95 s idle < 100 s
    const m = next(s, sec(115));
    expect(m?.kind).toBe('stall');
    P.take(s, m as P.Moment);
    P.markConsidered(s, m as P.Moment, sec(115));
    // Escalation at 2.5x the threshold measured from the last activity.
    expect(next(s, sec(200))).toBeNull();
    const m2 = next(s, sec(10 + 250));
    expect(m2?.kind).toBe('stall');
    expect(m2?.data?.level).toBe(2);
    P.take(s, m2 as P.Moment);
    expect(next(s, sec(2000))).toBeNull();
  });

  it('style changes the stall threshold', () => {
    const tough = state({ settings: { ...P.DEFAULT_SETTINGS, style: 'tough' } });
    const supportive = state({ settings: { ...P.DEFAULT_SETTINGS, style: 'supportive' } });
    expect(next(supportive, sec(85))?.kind).toBe('stall'); // 0.8 * 100 s
    expect(next(tough, sec(120))).toBeNull(); // 1.3 * 100 s = 130 s
    expect(next(tough, sec(131))?.kind).toBe('stall');
  });

  it('a candidate message resets the stall clock and clears pending non-clock moments', () => {
    const s = state();
    P.observe(s, { type: 'telemetry', kind: 'paste', chars: 900 }, sec(5));
    expect(s.pending.map((m) => m.kind)).toEqual(['paste']);
    P.observe(s, { type: 'candidate_message', text: 'hi', via: 'text', userId: 'u' }, sec(6));
    expect(s.pending).toEqual([]);
    expect(next(s, sec(90))).toBeNull();
  });
});

describe('policy: gaps and caps', () => {
  it('respects the minimum gap after an interviewer message', () => {
    const s = state({ lastInterviewerMsgAt: sec(0) });
    P.observe(s, { type: 'telemetry', kind: 'paste', chars: 900 }, sec(1));
    expect(next(s, sec(10))).toBeNull(); // within the 20 s floor gap
    expect(next(s, sec(21))?.kind).toBe('paste');
  });

  it('caps consecutive unanswered proactive messages per proactivity', () => {
    for (const [level, cap] of [
      ['low', 1],
      ['normal', 2],
      ['high', 3],
    ] as const) {
      const s = state({ settings: { ...P.DEFAULT_SETTINGS, proactivity: level }, unanswered: cap });
      P.observe(s, { type: 'telemetry', kind: 'paste', chars: 5000 }, sec(100));
      const m = s.pending[0] as P.Moment;
      expect(P.blocked(s, m, sec(400))).toBe('unanswered_cap');
      s.unanswered = cap - 1;
      expect(P.blocked(s, m, sec(400))).toBeNull();
    }
  });

  it('accepted submissions and time-up bypass the unanswered cap', () => {
    const s = state({ unanswered: 5, durationMs: 10 * 60_000 });
    P.observe(
      s,
      { type: 'run_finished', run: run('submit', 'accepted'), hiddenFailures: 0 },
      sec(100),
    );
    expect(next(s, sec(104))?.kind).toBe('run_accepted');
    const up = state({ unanswered: 5, durationMs: 10 * 60_000 });
    expect(next(up, sec(601))?.kind).toBe('time_up');
  });

  it('backs off after model errors except for must-speak moments', () => {
    const s = state({ backoffUntil: sec(500), durationMs: 10 * 60_000 });
    P.observe(s, { type: 'telemetry', kind: 'paste', chars: 900 }, sec(100));
    expect(next(s, sec(200))).toBeNull();
    expect(next(s, sec(601))?.kind).toBe('time_up');
  });

  it('enforces the per-pad consideration cap', () => {
    const s = state({ considerations: P.CONST.maxConsiderations });
    P.observe(s, { type: 'telemetry', kind: 'paste', chars: 900 }, sec(100));
    expect(next(s, sec(200))).toBeNull();
  });
});

describe('policy: runs', () => {
  it('normal: a failed submission is considered after a quiet period, typing cancels it', () => {
    const s = state();
    P.observe(
      s,
      { type: 'run_finished', run: run('submit', 'wrong_answer'), hiddenFailures: 2 },
      sec(100),
    );
    expect(next(s, sec(110))).toBeNull(); // still reading the result
    expect(next(s, sec(116))?.kind).toBe('run_failed');
    const s2 = state();
    P.observe(
      s2,
      { type: 'run_finished', run: run('submit', 'wrong_answer'), hiddenFailures: 2 },
      sec(100),
    );
    P.observe(s2, { type: 'code_changed' }, sec(105));
    expect(next(s2, sec(130))).toBeNull();
  });

  it('normal ignores a single failed sample run; high reacts to it', () => {
    const normal = state();
    P.observe(
      normal,
      { type: 'run_finished', run: run('samples', 'wrong_answer'), hiddenFailures: 0 },
      sec(100),
    );
    expect(next(normal, sec(130))).toBeNull();
    const high = state({ settings: { ...P.DEFAULT_SETTINGS, proactivity: 'high' } });
    P.observe(
      high,
      { type: 'run_finished', run: run('samples', 'wrong_answer'), hiddenFailures: 0 },
      sec(100),
    );
    expect(next(high, sec(130))?.kind).toBe('run_failed');
  });

  it('repeated failures produce a repeat moment that typing does not cancel', () => {
    const s = state();
    for (let i = 0; i < 3; i++)
      P.observe(
        s,
        { type: 'run_finished', run: run('samples', 'wrong_answer'), hiddenFailures: 0 },
        sec(100 + i * 20),
      );
    P.observe(s, { type: 'code_changed' }, sec(150));
    expect(next(s, sec(155))).toBeNull(); // typing
    expect(next(s, sec(160))?.kind).toBe('run_failed_repeat');
  });

  it('compile errors alone are left to the candidate', () => {
    const s = state();
    P.observe(
      s,
      { type: 'run_finished', run: run('submit', 'compile_error'), hiddenFailures: 0 },
      sec(100),
    );
    expect(next(s, sec(150))).toBeNull();
  });

  it('file and custom runs never trigger reactions', () => {
    const s = state();
    P.observe(
      s,
      { type: 'run_finished', run: run('file', 'runtime_error'), hiddenFailures: 0 },
      sec(100),
    );
    P.observe(s, { type: 'run_finished', run: run('custom', 'ok'), hiddenFailures: 0 }, sec(101));
    expect(s.pending).toEqual([]);
  });
});

describe('policy: clock', () => {
  it('fires half, ten and five minute checks once, then time up', () => {
    const s = state({ durationMs: 30 * 60_000, lastInterviewerMsgAt: null });
    const kinds: string[] = [];
    for (let t = 0; t <= 31 * 60; t += 5) {
      // keep the candidate active so stalls don't interfere
      P.observe(
        s,
        { type: 'candidate_message', text: 'x', via: 'text', userId: 'u' },
        sec(t) - 20_000,
      );
      const m = next(s, sec(t));
      if (m) {
        kinds.push(`${m.kind}@${Math.round(t / 60)}`);
        P.take(s, m);
        P.markConsidered(s, m, sec(t));
      }
    }
    expect(kinds).toEqual(['time_check@15', 'time_check@20', 'time_check@25', 'time_up@30']);
  });

  it('low proactivity only gives the five-minute warning and time up', () => {
    const s = state({
      durationMs: 30 * 60_000,
      settings: { ...P.DEFAULT_SETTINGS, proactivity: 'low' },
      lastInterviewerMsgAt: null,
    });
    const kinds: string[] = [];
    for (let t = 0; t <= 31 * 60; t += 5) {
      P.observe(
        s,
        { type: 'candidate_message', text: 'x', via: 'text', userId: 'u' },
        sec(t) - 20_000,
      );
      const m = next(s, sec(t));
      if (m) {
        kinds.push(m.kind);
        P.take(s, m);
        P.markConsidered(s, m, sec(t));
      }
    }
    expect(kinds).toEqual(['time_check', 'time_up']);
  });

  it('nothing after wrap-up', () => {
    const s = state({ wrappedUp: true });
    P.observe(s, { type: 'telemetry', kind: 'paste', chars: 900 }, sec(10));
    expect(next(s, sec(100))).toBeNull();
  });
});

describe('policy: stage 2', () => {
  it('turns a checkpoint into an approach check once enough code exists without an explanation', () => {
    const s = state();
    const cp: P.Moment = {
      kind: 'checkpoint',
      createdAt: sec(1),
      expiresAt: sec(100),
      quietMs: 0,
      detail: '',
    };
    expect(P.refine(s, cp, { newLines: 1, candidateWords: 0 }, true, sec(2))).toBeNull();
    expect(P.refine(s, cp, { newLines: 5, candidateWords: 0 }, true, sec(2))?.kind).toBe(
      'approach_check',
    );
    expect(P.refine(s, cp, { newLines: 5, candidateWords: 80 }, true, sec(2))).toBeNull();
  });

  it('counts only meaningful lines beyond the scaffold', () => {
    const scaffold = 'class A:\n    def f(self):\n        pass\n';
    const code = `${scaffold}        # comment\n        x = 1\n\n        y = 2\n        }\n`;
    expect(P.codeFacts(code, scaffold, ['one two three', 'four']).newLines).toBe(2);
    expect(P.codeFacts(code, scaffold, ['one two three', 'four']).candidateWords).toBe(4);
  });
});

function run(mode: 'samples' | 'submit' | 'file' | 'custom', verdict: string) {
  return {
    id: '00000000-0000-4000-8000-000000000000',
    padId: '00000000-0000-4000-8000-000000000001',
    userId: 'u',
    mode,
    language: 'python' as const,
    status: 'finished' as const,
    verdict: verdict as never,
    compile: null,
    file: null,
    tests: [],
    passed: verdict === 'accepted' ? 3 : 1,
    total: 3,
    message: null,
    createdAt: new Date(T0).toISOString(),
    finishedAt: new Date(T0).toISOString(),
  };
}
