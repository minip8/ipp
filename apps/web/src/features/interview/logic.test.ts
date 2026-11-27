import { Interview, type InterviewStage } from '@ipp/contracts';
import { describe, expect, it } from 'vitest';
import {
  hubAction,
  interviewHref,
  NO_NAMES,
  planTotal,
  problemLabel,
  reportsPending,
  stagePosition,
  stageSummary,
  timeSpentSec,
  topicsLabel,
} from './logic';

const names = {
  problem: (s: string) => ({ 'two-sum': 'Two Sum' })[s],
  topic: (s: string) =>
    ({ probability: 'Probability', brainteasers: 'Brainteasers', options: 'Options & finance' })[s],
};

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const at = (min: number) => new Date(Date.UTC(2026, 10, 1, 10, min)).toISOString();

describe('what a stage is called', () => {
  it('says what a coding stage draws, in its language, for its length', () => {
    const random: InterviewStage = {
      kind: 'coding',
      difficulty: 'medium',
      language: 'python',
      durationMin: 45,
    };
    expect(stageSummary(random, names)).toBe('Random medium problem · Python · 45 min');
    expect(
      stageSummary(
        { kind: 'coding', problemSlug: 'two-sum', language: 'cpp', durationMin: 45 },
        names,
      ),
    ).toBe('Two Sum · C++ · 45 min');
    expect(
      problemLabel(
        {
          kind: 'coding',
          category: 'data-structure',
          difficulty: 'hard',
          language: 'cpp',
          durationMin: 60,
        },
        names,
      ),
    ).toBe('Random hard data structure problem');
    expect(problemLabel({ kind: 'coding', language: 'cpp', durationMin: 30 }, names)).toBe(
      'Random problem',
    );
    // Once started, the problem it drew.
    expect(stageSummary(random, names, 'LRU Cache')).toBe('LRU Cache · Python · 45 min');
    // A problem whose title is not known yet reads from its slug.
    expect(
      problemLabel(
        { kind: 'coding', problemSlug: 'lru-cache', language: 'cpp', durationMin: 45 },
        NO_NAMES,
      ),
    ).toBe('Lru cache');
  });

  it('names a questions stage by its topics and question count, a game by itself', () => {
    expect(
      stageSummary(
        { kind: 'questions', topics: ['probability', 'brainteasers'], durationMin: 20 },
        names,
      ),
    ).toBe('Probability, Brainteasers · 3 questions · 20 min');
    expect(stageSummary({ kind: 'game', durationMin: 15 }, names)).toBe(
      'Market-making game · 15 min',
    );
    expect(topicsLabel(['probability', 'brainteasers', 'options', 'cpp'], names)).toBe(
      'Probability, Brainteasers and 2 more',
    );
  });

  it('totals a plan', () => {
    expect(planTotal([{ durationMin: 20 }, { durationMin: 15 }, { durationMin: 20 }])).toBe(
      '3 stages · 55 min',
    );
    expect(planTotal([{ durationMin: 45 }])).toBe('1 stage · 45 min');
  });
});

/** Three stages, the first `done` of them done, the next active when `active`. */
function interview(o: {
  done: number;
  active?: boolean;
  ended?: boolean;
  pending?: boolean;
}): Interview {
  const stages = [0, 1, 2].map((index) => {
    const done = index < o.done;
    const active = o.active && index === o.done;
    const started = done || active;
    return {
      index,
      stage: { kind: 'game', durationMin: 15 },
      status: done ? 'done' : active ? 'active' : o.ended ? 'skipped' : 'upcoming',
      pad: started
        ? {
            id: id(index + 1),
            title: 'Game',
            problemTitle: null,
            startedAt: at(index * 20),
            endedAt: done ? at(index * 20 + 15) : null,
          }
        : null,
      result: done
        ? { report: o.pending && index === 0 ? 'pending' : 'ready', recommendation: 'hire' }
        : null,
    };
  });
  return Interview.parse({
    id: id(9),
    title: 'Trader',
    track: 'quant',
    preset: 'trader',
    status: o.ended ? 'ended' : 'active',
    current: Math.max(0, o.active ? o.done : o.done - 1),
    interviewer: { style: 'neutral', proactivity: 'normal', voice: false },
    startedAt: at(0),
    endedAt: o.ended ? at(60) : null,
    stages,
  });
}

describe('where an interview is', () => {
  it('continues the stage under way', () => {
    const i = interview({ done: 1, active: true });
    expect(stagePosition(i)).toBe('Stage 2 of 3');
    expect(hubAction(i)).toMatchObject({ kind: 'continue', padId: id(2) });
    expect(interviewHref(i)).toBe(`/pads/${id(2)}`);
  });

  it('between stages, starts the next one from the stage just finished', () => {
    const i = interview({ done: 1 });
    expect(stagePosition(i)).toBe('Stage 1 of 3');
    expect(hubAction(i)).toMatchObject({ kind: 'start', from: 0, stage: { index: 1 } });
    expect(interviewHref(i)).toBe(`/interviews/${id(9)}`);
  });

  it('offers nothing once it has ended', () => {
    const i = interview({ done: 1, ended: true });
    expect(hubAction(i)).toEqual({ kind: 'none' });
    expect(interviewHref(i)).toBe(`/interviews/${id(9)}`);
  });

  it('adds up the time spent in the stages’ pads', () => {
    expect(timeSpentSec(interview({ done: 2, ended: true }))).toBe(30 * 60);
    const now = Date.parse(at(25));
    expect(timeSpentSec(interview({ done: 1, active: true }), now)).toBe(20 * 60);
  });

  it('knows when a stage’s report is still being written', () => {
    expect(reportsPending(interview({ done: 2, pending: true }))).toBe(true);
    expect(reportsPending(interview({ done: 2 }))).toBe(false);
  });
});
