import { PadSummary } from '@ipp/contracts';
import { describe, expect, it } from 'vitest';
import { canOpenReport, interviewFigures, padLength, padName, padsInTrack } from './logic';

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

describe('the pads of a track', () => {
  it('keeps coding pads and coding rooms to Software, rounds and quant rooms to Quant', () => {
    const software = padsInTrack(PADS, 'software');
    expect(software.active.map((p) => p.id)).toEqual([id(1)]);
    expect(software.ended.map((p) => p.id)).toEqual([id(2), id(3)]);
    const quant = padsInTrack(PADS, 'quant');
    expect(quant.active.map((p) => p.id)).toEqual([id(5)]);
    expect(quant.ended.map((p) => p.id)).toEqual([id(4), id(6)]);
  });

  it('gives each track its own figures, over its own pads', () => {
    expect(interviewFigures('software', padsInTrack(PADS, 'software'))).toEqual([
      { label: 'Interviews', value: 2 },
      { label: 'Solved', value: 1 },
    ]);
    expect(interviewFigures('quant', padsInTrack(PADS, 'quant'))).toEqual([
      { label: 'Rounds', value: 2 },
    ]);
    expect(interviewFigures('quant', { ended: [] })).toEqual([{ label: 'Rounds', value: 0 }]);
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
