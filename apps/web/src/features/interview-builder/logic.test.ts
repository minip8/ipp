import {
  INTERVIEW_STAGES_MAX,
  type InterviewStage,
  presetById,
  presetStages,
  STAGE_TOPICS_MAX,
} from '@ipp/contracts';
import { describe, expect, it } from 'vitest';
import { ApiRequestError } from '@/lib/api';
import {
  addStage,
  CUSTOM,
  createRequest,
  defaultPlan,
  defaultTopics,
  fitLanguages,
  fitTopics,
  interviewTitle,
  matchingPreset,
  moveStage,
  newStage,
  parseStoredPlan,
  planFromLink,
  planSelection,
  questionsShape,
  removeStage,
  replaceStage,
  startError,
  toggleTopic,
  topicChoices,
} from './logic';

const names = {
  problem: (s: string) => ({ 'two-sum': 'Two Sum' })[s],
  topic: (s: string) => ({ probability: 'Probability' })[s],
};

const coding: InterviewStage = {
  kind: 'coding',
  difficulty: 'medium',
  language: 'python',
  durationMin: 45,
};
const questions: InterviewStage = { kind: 'questions', topics: ['probability'], durationMin: 20 };
const game: InterviewStage = { kind: 'game', durationMin: 15 };

const TOPICS = [
  { slug: 'cpp', track: 'fundamentals', also: [] },
  { slug: 'python', track: 'fundamentals', also: ['quant'] },
  { slug: 'operating-systems', track: 'fundamentals', also: [] },
  { slug: 'probability', track: 'quant', also: [] },
  { slug: 'brainteasers', track: 'quant', also: [] },
] as const;

describe('presets and custom plans', () => {
  it('starts each track on its first preset, in the user’s language', () => {
    expect(defaultPlan('software', 'java')).toEqual({
      preset: 'coding-round',
      stages: [{ kind: 'coding', difficulty: 'medium', durationMin: 45, language: 'java' }],
    });
    expect(defaultPlan('quant', 'cpp').preset).toBe('trader');
  });

  it('still reads as the preset in any one language, and as custom once changed', () => {
    const onsite = presetById('onsite-loop');
    if (!onsite) throw new Error('no preset');
    expect(matchingPreset(presetStages(onsite, 'python'), 'software')?.id).toBe('onsite-loop');
    expect(matchingPreset(presetStages(onsite, 'java'), 'software')?.id).toBe('onsite-loop');
    const plan = { preset: 'onsite-loop', stages: presetStages(onsite, 'cpp') };
    expect(planSelection(plan, 'software')).toBe('onsite-loop');
    // A preset of the other track is not this track's.
    expect(planSelection(plan, 'quant')).toBe(CUSTOM);
    const longer = replaceStage(plan.stages, 0, { ...coding, language: 'cpp', durationMin: 60 });
    expect(planSelection({ ...plan, stages: longer }, 'software')).toBe(CUSTOM);
    // Two coding stages in different languages are no preset.
    const mixed = replaceStage(plan.stages, 2, {
      kind: 'coding',
      difficulty: 'hard',
      language: 'java',
      durationMin: 60,
    });
    expect(matchingPreset(mixed, 'software')).toBeNull();
  });

  it('compares stages by what they say, not by unset fields', () => {
    const withUnset = { ...coding, category: undefined, problemSlug: undefined };
    expect(matchingPreset([withUnset], 'software')?.id).toBe('coding-round');
  });
});

describe('editing the plan', () => {
  const d = { language: 'cpp' as const, topics: ['probability'] };

  it('adds any kind of stage at the end, up to the most an interview has', () => {
    expect(addStage([coding], 'game', d)).toEqual([coding, game]);
    expect(newStage('coding', d)).toEqual({
      kind: 'coding',
      difficulty: 'medium',
      language: 'cpp',
      durationMin: 45,
    });
    expect(newStage('questions', d)).toEqual(questions);
    const full = Array.from({ length: INTERVIEW_STAGES_MAX }, () => game);
    expect(addStage(full, 'coding', d)).toHaveLength(INTERVIEW_STAGES_MAX);
  });

  it('removes a stage, but never the last one', () => {
    expect(removeStage([coding, game], 0)).toEqual([game]);
    expect(removeStage([coding], 0)).toEqual([coding]);
  });

  it('moves a stage one place, and not past either end', () => {
    expect(moveStage([coding, questions, game], 0, 1)).toEqual([questions, coding, game]);
    expect(moveStage([coding, questions, game], 2, -1)).toEqual([coding, game, questions]);
    expect(moveStage([coding, questions], 0, -1)).toEqual([coding, questions]);
    expect(moveStage([coding, questions], 1, 1)).toEqual([coding, questions]);
  });

  it('keeps a questions stage between one topic and the most', () => {
    expect(toggleTopic(['probability'], 'brainteasers')).toEqual(['probability', 'brainteasers']);
    expect(toggleTopic(['probability', 'brainteasers'], 'probability')).toEqual(['brainteasers']);
    expect(toggleTopic(['probability'], 'probability')).toEqual(['probability']);
    const full = Array.from({ length: STAGE_TOPICS_MAX }, (_, i) => `t${i}`);
    expect(toggleTopic(full, 'more')).toEqual(full);
  });

  it('fits a chosen problem’s language, and drops topics that no longer exist', () => {
    const cppOnly = [{ slug: 'unique-ptr', languages: ['cpp' as const] }];
    const stage: InterviewStage = {
      kind: 'coding',
      problemSlug: 'unique-ptr',
      language: 'python',
      durationMin: 45,
    };
    expect(fitLanguages([stage, coding], cppOnly)).toEqual([{ ...stage, language: 'cpp' }, coding]);
    const plan = [questions, { ...questions, topics: ['gone'] }];
    expect(fitTopics(plan, TOPICS, ['cpp'])).toEqual([
      questions,
      { ...questions, topics: ['cpp'] },
    ]);
    const same = [questions];
    expect(fitTopics(same, TOPICS, ['cpp'])[0]).toBe(questions);
  });
});

describe('topics', () => {
  it('lists the track’s own topics first, then every other one', () => {
    const software = topicChoices(TOPICS, 'software');
    expect(software.mine.map((t) => t.slug)).toEqual(['cpp', 'python', 'operating-systems']);
    expect(software.more.map((t) => t.slug)).toEqual(['probability', 'brainteasers']);
    const quant = topicChoices(TOPICS, 'quant');
    expect(quant.mine.map((t) => t.slug)).toEqual(['probability', 'brainteasers', 'python']);
    expect(quant.more.map((t) => t.slug)).toEqual(['cpp', 'operating-systems']);
  });

  it('starts a new questions stage on the user’s language on Software, else the first topic', () => {
    expect(defaultTopics(TOPICS, 'software', 'python')).toEqual(['python']);
    expect(defaultTopics(TOPICS, 'software', 'java')).toEqual(['cpp']);
    expect(defaultTopics(TOPICS, 'quant', 'python')).toEqual(['probability']);
    expect(defaultTopics([], 'quant', 'cpp')).toEqual(['probability']);
  });

  it('says how a questions stage is shaped', () => {
    expect(questionsShape(20)).toBe('3 questions, about 7 minutes each');
    expect(questionsShape(15)).toBe('2 questions, about 8 minutes each');
  });
});

describe('links into the builder', () => {
  const link = (q: string, track: 'software' | 'quant' = 'software') =>
    planFromLink(new URLSearchParams(q), track, 'python');

  it('opens a problem as one coding stage on it', () => {
    expect(link('problem=two-sum')).toEqual({
      preset: null,
      stages: [{ kind: 'coding', problemSlug: 'two-sum', language: 'python', durationMin: 45 }],
    });
  });

  it('selects a preset of the track, and maps the old paths to theirs', () => {
    expect(link('preset=onsite-loop')?.preset).toBe('onsite-loop');
    expect(link('preset=trader')).toBeNull();
    expect(link('path=researcher', 'quant')?.preset).toBe('researcher');
    expect(link('path=trader', 'quant')?.stages[1]).toEqual({ kind: 'game', durationMin: 15 });
  });

  it('turns a random pick into one random coding stage, with what it names', () => {
    expect(link('random=1&difficulty=hard&category=dsa')?.stages).toEqual([
      { kind: 'coding', difficulty: 'hard', category: 'dsa', language: 'python', durationMin: 45 },
    ]);
    expect(link('random=1&difficulty=impossible')?.stages).toEqual([
      { kind: 'coding', language: 'python', durationMin: 45 },
    ]);
    expect(link('difficulty=hard')).toBeNull();
    expect(link('')).toBeNull();
  });
});

describe('the plan remembered in this browser', () => {
  it('comes back as it was stored', () => {
    const stored = { v: 1, preset: 'onsite-loop', stages: [coding, game], language: 'java' };
    expect(parseStoredPlan(stored, 'software', 'cpp')).toEqual({
      plan: { preset: 'onsite-loop', stages: [coding, game] },
      language: 'java',
    });
  });

  it('falls back to the default preset when it is missing, stale or invalid', () => {
    const fallback = { plan: defaultPlan('quant', 'cpp'), language: 'cpp' };
    expect(parseStoredPlan(null, 'quant', 'cpp')).toEqual(fallback);
    expect(parseStoredPlan({ v: 0, stages: [game] }, 'quant', 'cpp')).toEqual(fallback);
    expect(
      parseStoredPlan(
        { v: 1, preset: null, stages: [{ kind: 'game', durationMin: 99 }], language: 'cpp' },
        'quant',
        'cpp',
      ),
    ).toEqual(fallback);
    expect(
      parseStoredPlan({ v: 1, preset: null, stages: [], language: 'cpp' }, 'quant', 'cpp'),
    ).toEqual(fallback);
  });

  it('forgets a preset that is not this track’s', () => {
    const stored = { v: 1, preset: 'trader', stages: [game], language: 'cpp' };
    expect(parseStoredPlan(stored, 'software', 'cpp').plan.preset).toBeNull();
  });
});

describe('starting it', () => {
  it('names the interview by the preset it still is, a lone problem, or as custom', () => {
    expect(interviewTitle(defaultPlan('software', 'cpp'), 'software', names)).toBe('Coding round');
    const one = {
      preset: null,
      stages: [
        {
          kind: 'coding',
          problemSlug: 'two-sum',
          language: 'cpp',
          durationMin: 45,
        } as InterviewStage,
      ],
    };
    expect(interviewTitle(one, 'software', names)).toBe('Two Sum');
    expect(
      interviewTitle({ preset: 'coding-round', stages: [coding, game] }, 'software', names),
    ).toBe('Custom interview');
  });

  it('sends the track, the preset it came from, the stages and the interviewer', () => {
    const interviewer = { style: 'tough', proactivity: 'high', voice: false } as const;
    expect(
      createRequest('quant', { preset: 'trader', stages: [game] }, interviewer, names),
    ).toEqual({
      track: 'quant',
      preset: 'trader',
      title: 'Custom interview',
      stages: [game],
      interviewer,
    });
  });

  it('says why it could not start', () => {
    const err = (status: number, code: string, retryAfter?: number) =>
      new ApiRequestError(
        status,
        code,
        'Stage 2: not enough questions on Options yet.',
        retryAfter,
      );
    expect(startError(err(409, 'ai_key_missing'))).toContain('own AI API key');
    expect(startError(err(409, 'quant_unavailable'))).toBe(
      'Stage 2: not enough questions on Options yet.',
    );
    expect(startError(err(429, 'rate_limited', 30))).toBe(
      'You have started a lot of interviews in a short time. You can start another in 30s.',
    );
    expect(startError(err(429, 'rate_limited'))).toContain('Try again in a few minutes');
    expect(startError(new Error('boom'))).toBe('boom');
  });
});
