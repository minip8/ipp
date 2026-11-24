import type { PadMember, Run } from '@ipp/contracts';
import { describe, expect, it } from 'vitest';
import {
  authorName,
  candidatesOf,
  cleanGuestName,
  nameList,
  roomSubtitle,
  runsForProblem,
} from './logic';

const host: PadMember = { userId: 'h', name: 'Hana', role: 'owner', guest: false };
const casey: PadMember = { userId: 'c', name: 'Casey', role: 'collaborator', guest: true };
const sam: PadMember = { userId: 's', name: 'Sam', role: 'collaborator', guest: false };

describe('guest names', () => {
  it('are one trimmed line within the limit', () => {
    expect(cleanGuestName('  Casey\t Jones \n')).toBe('Casey Jones');
    expect(cleanGuestName(' \n ')).toBe('');
    expect(cleanGuestName('x'.repeat(200))).toHaveLength(60);
  });
});

describe('people in the room', () => {
  it('names the author of a message, also after they left', () => {
    expect(authorName({ role: 'interviewer', userId: 'h' }, [host, casey])).toBe('Hana');
    expect(authorName({ role: 'candidate', userId: 'c' }, [host, casey])).toBe('Casey');
    expect(authorName({ role: 'candidate', userId: 'gone' }, [host])).toBe('Candidate');
    expect(authorName({ role: 'interviewer', userId: null }, [host])).toBe('Interviewer');
  });

  it('says who the other side is', () => {
    expect(candidatesOf([host, casey, sam])).toEqual([casey, sam]);
    expect(roomSubtitle([host], 'h')).toBe('waiting for your candidate');
    expect(roomSubtitle([host, casey], 'h')).toBe('with Casey');
    expect(roomSubtitle([host, casey, sam], 'h')).toBe('with Casey and Sam');
    expect(roomSubtitle([host, casey], 'c')).toBe('with Hana');
    expect(roomSubtitle([host, casey, sam], 'c')).toBe('with Hana and Sam');
    expect(nameList(['A', 'B', 'C'])).toBe('A, B and C');
    expect(nameList(['A', 'B', 'C', 'D', 'E'])).toBe('A, B and 3 others');
  });
});

describe('runs after the problem changed', () => {
  const run = (id: string, problemSlug?: string | null) => ({ id, problemSlug }) as Run;
  it('keeps the runs of the current problem and runs that predate rooms', () => {
    const runs = [run('a', 'two-sum'), run('b', 'lru-cache'), run('c', null), run('d')];
    expect(runsForProblem(runs, 'two-sum').map((r) => r.id)).toEqual(['a', 'd']);
    expect(runsForProblem(runs, null).map((r) => r.id)).toEqual(['c', 'd']);
  });
});
