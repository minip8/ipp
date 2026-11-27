import { describe, expect, it } from 'vitest';
import {
  CreateInterviewRequest,
  createQuantRound,
  INTERVIEW_PRESETS,
  INTERVIEW_STAGES_MAX,
  InterviewStage,
  type InterviewStageView,
  interviewMinutes,
  overallRecommendation,
  Pad,
  PadDetail,
  presetById,
  presetStages,
  presetsOf,
  publicRound,
  QuantRoundState,
  quantSubject,
  type Recommendation,
  roundSubject,
  stageQuestionCount,
  stageStatuses,
  TRACKS,
} from '../src';

const coding = { kind: 'coding', language: 'python', durationMin: 45 } as const;
const questions = { kind: 'questions', topics: ['probability'], durationMin: 20 } as const;
const game = { kind: 'game', durationMin: 10 } as const;

describe('InterviewStage', () => {
  it('accepts each kind', () => {
    for (const s of [coding, questions, game]) expect(InterviewStage.parse(s)).toEqual(s);
  });

  it('refuses a length the kind does not offer', () => {
    expect(InterviewStage.safeParse({ ...coding, durationMin: 20 }).success).toBe(false);
    expect(InterviewStage.safeParse({ ...questions, durationMin: 60 }).success).toBe(false);
    expect(InterviewStage.safeParse({ ...game, durationMin: 30 }).success).toBe(false);
  });

  it('refuses a questions stage with no topic or a topic twice', () => {
    expect(InterviewStage.safeParse({ ...questions, topics: [] }).success).toBe(false);
    expect(InterviewStage.safeParse({ ...questions, topics: ['cpp', 'cpp'] }).success).toBe(false);
  });

  it('counts the questions of a stage', () => {
    expect(stageQuestionCount({ ...questions, topics: ['cpp'], durationMin: 15 })).toBe(2);
    expect(stageQuestionCount({ ...questions, topics: ['cpp'], durationMin: 45 })).toBe(6);
    expect(stageQuestionCount(game)).toBe(1);
    expect(stageQuestionCount(coding)).toBeNull();
  });
});

describe('CreateInterviewRequest', () => {
  it('needs between one stage and the maximum', () => {
    const base = { track: 'quant' };
    expect(CreateInterviewRequest.safeParse({ ...base, stages: [] }).success).toBe(false);
    expect(CreateInterviewRequest.safeParse({ ...base, stages: [questions] }).success).toBe(true);
    const many = Array.from({ length: INTERVIEW_STAGES_MAX + 1 }, () => game);
    expect(CreateInterviewRequest.safeParse({ ...base, stages: many }).success).toBe(false);
  });

  it('defaults the preset and the interviewer, and has no `enabled`', () => {
    const r = CreateInterviewRequest.parse({ track: 'software', stages: [coding] });
    expect(r.preset).toBeNull();
    expect(r.interviewer).toEqual({ style: 'neutral', proactivity: 'normal', voice: false });
  });
});

describe('stageStatuses', () => {
  const pads =
    (m: Record<number, 'active' | 'ended'>) =>
    (i: number): 'active' | 'ended' | undefined =>
      m[i];

  it('a new interview: the first stage active, the rest upcoming', () => {
    expect(
      stageStatuses({ count: 3, current: 0, ended: false, pad: pads({ 0: 'active' }) }),
    ).toEqual(['active', 'upcoming', 'upcoming']);
  });

  it('between stages: the ended one done, the next still upcoming', () => {
    expect(
      stageStatuses({ count: 3, current: 0, ended: false, pad: pads({ 0: 'ended' }) }),
    ).toEqual(['done', 'upcoming', 'upcoming']);
  });

  it('ended early: stages never started are skipped', () => {
    expect(
      stageStatuses({ count: 3, current: 1, ended: true, pad: pads({ 0: 'ended', 1: 'ended' }) }),
    ).toEqual(['done', 'done', 'skipped']);
  });

  it('a stage behind the current one with no pad is skipped', () => {
    expect(
      stageStatuses({ count: 3, current: 2, ended: false, pad: pads({ 0: 'ended', 2: 'active' }) }),
    ).toEqual(['done', 'skipped', 'active']);
  });
});

describe('overallRecommendation', () => {
  const stage = (
    durationMin: 15 | 20 | 30 | 45,
    recommendation: Recommendation | null,
  ): Pick<InterviewStageView, 'stage' | 'result'> => ({
    stage: { kind: 'questions', topics: ['probability'], durationMin },
    result: recommendation === null ? null : { report: 'ready', recommendation },
  });

  it('is null with nothing assessed', () => {
    expect(overallRecommendation([stage(20, null)])).toBeNull();
    expect(
      overallRecommendation([
        { ...stage(20, null), result: { report: 'pending', recommendation: null } },
      ]),
    ).toBeNull();
  });

  it('is the one stage when only one is assessed', () => {
    expect(overallRecommendation([stage(20, 'hire'), stage(30, null)])).toBe('hire');
  });

  it('weights stages by their length', () => {
    // (45 * strong_hire(4) + 15 * no_hire(0)) / 60 = 3 -> hire
    expect(overallRecommendation([stage(45, 'strong_hire'), stage(15, 'no_hire')])).toBe('hire');
  });

  it('rounds a tie down', () => {
    expect(overallRecommendation([stage(20, 'hire'), stage(20, 'lean_hire')])).toBe('lean_hire');
  });
});

describe('presets', () => {
  it('every track has presets, each with a unique id and a valid plan', () => {
    const ids = INTERVIEW_PRESETS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const track of TRACKS) expect(presetsOf(track).length).toBeGreaterThan(0);
    for (const preset of INTERVIEW_PRESETS) {
      for (const language of ['cpp', 'python', 'java'] as const) {
        const stages = presetStages(preset, language);
        expect(
          CreateInterviewRequest.safeParse({ track: preset.track, preset: preset.id, stages })
            .success,
          `${preset.id} in ${language}`,
        ).toBe(true);
      }
    }
  });

  it('a coding stage takes the language, and a questions stage its topic when asked', () => {
    const preset = presetById('technical-screen');
    if (!preset) throw new Error('missing preset');
    const [asked, code] = presetStages(preset, 'cpp');
    expect(asked?.kind === 'questions' && asked.topics[0]).toBe('cpp');
    expect(code).toMatchObject({ kind: 'coding', language: 'cpp' });
    // Java has no topic of its own: the stage keeps the preset's topics.
    const [java] = presetStages(preset, 'java');
    expect(java?.kind === 'questions' && java.topics).not.toContain('java');
  });

  it('does not share topic arrays with the preset', () => {
    const preset = presetById('trader');
    if (!preset) throw new Error('missing preset');
    const [first] = presetStages(preset, 'python');
    if (first?.kind !== 'questions') throw new Error('expected a questions stage');
    first.topics.push('statistics');
    const [again] = presetStages(preset, 'python');
    expect(again?.kind === 'questions' && again.topics).toEqual(['probability', 'brainteasers']);
  });

  it('adds up the planned length', () => {
    const preset = presetById('trader');
    if (!preset) throw new Error('missing preset');
    expect(interviewMinutes(presetStages(preset, 'python'))).toBe(55);
  });
});

describe('a round assembled from topics', () => {
  it('names its subject from the topics homes', () => {
    expect(quantSubject([])).toBe('quant');
    expect(quantSubject(['quant', 'quant'])).toBe('quant');
    expect(quantSubject(['fundamentals'])).toBe('technical');
    expect(quantSubject(['quant', 'fundamentals'])).toBe('mixed');
  });

  it('stores a subject only when it is not quant, and shows it either way', () => {
    const quant = createQuantRound(null, 20, []);
    expect('subject' in quant).toBe(false);
    expect(roundSubject(quant)).toBe('quant');
    expect(publicRound(quant, 0)).toMatchObject({ path: null, subject: 'quant', mode: 'ai' });

    const technical = createQuantRound(null, 20, [], 'technical');
    expect(QuantRoundState.parse(technical).subject).toBe('technical');
    expect(publicRound(technical, 0).subject).toBe('technical');
  });
});

describe('a pad of an interview', () => {
  it('defaults to no interview', () => {
    expect(Pad.shape.interviewId.parse(undefined)).toBeNull();
    expect(PadDetail.shape.interview.parse(undefined)).toBeNull();
  });
});
