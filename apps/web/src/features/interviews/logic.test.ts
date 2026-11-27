import { Interview, PadSummary } from '@ipp/contracts';
import { describe, expect, it } from 'vitest';
import {
  canOpenReport,
  interviewFigures,
  padLength,
  padName,
  padsInTrack,
  rowsInTrack,
  stagePad,
} from './logic';

const pad = (over: Partial<PadSummary> & Pick<PadSummary, 'id'>): PadSummary =>
  PadSummary.parse({
    title: 'Two Sum',
    kind: 'practice',
    format: 'coding',
    problemSlug: 'two-sum',
    language: 'cpp',
    status: 'ended',
    startedAt: '2026-11-01T10:00:00.000Z',
    endedAt: '2026-11-01T10:42:00.000Z',
    problemTitle: 'Two Sum',
    difficulty: 'easy',
    accepted: false,
    role: 'owner',
    ...over,
  });

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

const PADS = [
  pad({ id: id(1), status: 'active', endedAt: null }),
  pad({ id: id(2), accepted: true }),
  pad({ id: id(3), kind: 'room', problemSlug: null, problemTitle: null, title: 'Blank room' }),
  pad({
    id: id(4),
    format: 'quant',
    problemSlug: null,
    problemTitle: null,
    difficulty: null,
    title: 'Trader quant round',
    quantPath: 'trader',
  }),
  pad({
    id: id(5),
    format: 'quant',
    kind: 'room',
    problemSlug: null,
    problemTitle: null,
    difficulty: null,
    title: 'Quant interview',
    status: 'active',
    endedAt: null,
  }),
  pad({
    id: id(6),
    format: 'quant',
    kind: 'room',
    role: 'collaborator',
    problemSlug: null,
    problemTitle: null,
    difficulty: null,
    title: 'Quant interview with Casey',
  }),
];

/** A staged interview of `stages` (coding first), its pads ids 100 + index. */
function interview(o: {
  n: number;
  track: 'software' | 'quant';
  status?: 'active' | 'ended';
  startedAt: string;
  stages?: ('coding' | 'questions')[];
}): Interview {
  const kinds = o.stages ?? ['coding', 'questions'];
  return Interview.parse({
    id: id(o.n),
    title: 'Onsite loop',
    track: o.track,
    preset: null,
    status: o.status ?? 'ended',
    current: kinds.length - 1,
    interviewer: { style: 'neutral', proactivity: 'normal', voice: false },
    startedAt: o.startedAt,
    endedAt: o.status === 'active' ? null : o.startedAt,
    stages: kinds.map((kind, index) => ({
      index,
      stage:
        kind === 'coding'
          ? { kind, language: 'python', durationMin: 45 }
          : { kind, topics: ['probability'], durationMin: 20 },
      status: o.status === 'active' && index === kinds.length - 1 ? 'active' : 'done',
      pad: {
        id: id(o.n * 100 + index),
        title: kind === 'coding' ? 'LRU Cache' : 'Probability',
        problemTitle: kind === 'coding' ? 'LRU Cache' : null,
        startedAt: o.startedAt,
        endedAt: o.status === 'active' && index === kinds.length - 1 ? null : o.startedAt,
      },
      result: { report: 'ready', recommendation: 'hire' },
    })),
  });
}

describe('the pads of a track', () => {
  it('keeps coding pads and coding rooms to Software, rounds and quant rooms to Quant', () => {
    const software = padsInTrack(PADS, 'software');
    expect(software.active.map((p) => p.id)).toEqual([id(1)]);
    expect(software.ended.map((p) => p.id)).toEqual([id(2), id(3)]);
    const quant = padsInTrack(PADS, 'quant');
    expect(quant.active.map((p) => p.id)).toEqual([id(5)]);
    expect(quant.ended.map((p) => p.id)).toEqual([id(4), id(6)]);
  });

  it('never lists a stage’s pad on its own, in either track', () => {
    const stages = [
      pad({ id: id(7), interviewId: id(50) }),
      pad({ id: id(8), format: 'quant', interviewId: id(50), problemSlug: null }),
    ];
    for (const track of ['software', 'quant'] as const) {
      const { active, ended } = padsInTrack([...PADS, ...stages], track);
      expect([...active, ...ended].map((p) => p.id)).not.toContain(id(7));
      expect([...active, ...ended].map((p) => p.id)).not.toContain(id(8));
    }
  });
});

describe('the rows of a track', () => {
  const staged = interview({ n: 10, track: 'software', startedAt: '2026-11-03T10:00:00.000Z' });
  const single = interview({
    n: 11,
    track: 'software',
    startedAt: '2026-10-30T10:00:00.000Z',
    stages: ['coding'],
  });
  const quantOne = interview({ n: 12, track: 'quant', startedAt: '2026-11-02T10:00:00.000Z' });
  const live = interview({
    n: 13,
    track: 'software',
    status: 'active',
    startedAt: '2026-11-04T10:00:00.000Z',
  });
  const stagePads = [
    pad({ id: id(1000), interviewId: id(10), accepted: true }),
    pad({ id: id(1001), interviewId: id(10), format: 'quant', problemSlug: null }),
    pad({ id: id(1100), interviewId: id(11), title: 'LRU Cache', problemTitle: 'LRU Cache' }),
  ];
  const all = [...PADS, ...stagePads];

  it('lists an interview in the track it was built in, merged with pads by start, newest first', () => {
    const { active, ended } = rowsInTrack([staged, single, quantOne, live], all, 'software');
    expect(active.map((r) => r.kind)).toEqual(['interview', 'pad']);
    // 3 Nov (interview), 1 Nov (two pads, in the API's order), 30 Oct (one-stage interview).
    expect(ended.map((r) => (r.kind === 'pad' ? r.pad.id : r.interview.id))).toEqual([
      id(10),
      id(2),
      id(3),
      id(11),
    ]);
    // The quant interview has a coding stage, but it was built on Quant.
    const quant = rowsInTrack([staged, single, quantOne, live], all, 'quant');
    expect(quant.ended.map((r) => r.kind)).toEqual(['interview', 'pad', 'pad']);
  });

  it('shows a one-stage interview as its pad', () => {
    const { ended } = rowsInTrack([single], all, 'software');
    const row = ended.find((r) => r.kind === 'single');
    expect(row?.kind === 'single' && row.pad.id).toBe(id(1100));
  });

  it('makes a one-stage interview’s pad from the interview while the pads are not listed', () => {
    const p = stagePad(single, []);
    expect(p).toMatchObject({
      id: id(1100),
      format: 'coding',
      language: 'python',
      interviewId: id(11),
      problemTitle: 'LRU Cache',
      status: 'ended',
    });
  });

  it('counts each interview once, and every coding stage solved', () => {
    const rows = rowsInTrack([staged, single], all, 'software');
    expect(interviewFigures('software', rows, all)).toEqual([
      { label: 'Interviews', value: 4 },
      // LRU Cache in the staged interview, and Two Sum on its own.
      { label: 'Solved', value: 2 },
    ]);
    expect(interviewFigures('quant', rowsInTrack([quantOne], all, 'quant'), all)).toEqual([
      { label: 'Interviews', value: 3 },
    ]);
    expect(interviewFigures('quant', { ended: [] }, [])).toEqual([
      { label: 'Interviews', value: 0 },
    ]);
  });
});

describe('a pad in the lists', () => {
  it('is called by its problem, else its own title', () => {
    expect(padName(PADS[1] as PadSummary)).toBe('Two Sum');
    expect(padName(PADS[3] as PadSummary)).toBe('Trader quant round');
  });

  it("opens its report, except a room's for its candidate", () => {
    expect(canOpenReport({ kind: 'practice', role: 'collaborator' })).toBe(true);
    expect(canOpenReport({ kind: 'room', role: 'owner' })).toBe(true);
    expect(canOpenReport({ kind: 'room', role: 'collaborator' })).toBe(false);
  });

  it('has a length once it has ended', () => {
    expect(padLength(PADS[1] as PadSummary)).toBe(42 * 60);
    expect(padLength(PADS[0] as PadSummary)).toBeNull();
  });
});
