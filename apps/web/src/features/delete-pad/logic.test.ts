import type { PadSummary } from '@ipp/contracts';
import { describe, expect, it } from 'vitest';
import { ApiRequestError } from '@/lib/api';
import { alreadyGone, type DeleteTarget, deleteCopy, withoutPad } from './logic';

const t = (over: Partial<DeleteTarget> = {}): DeleteTarget => ({
  id: 'p1',
  problemTitle: 'Two Sum',
  status: 'ended',
  role: 'owner',
  ...over,
});

describe('deleteCopy', () => {
  it('owner: names the problem and says what is lost', () => {
    const c = deleteCopy(t());
    expect(c.action).toBe('Delete interview');
    expect(c.title).toContain('Two Sum');
    expect(c.description).toMatch(/cannot be undone/);
    expect(c.lost.join(' ')).toMatch(/report/);
    expect(c.lost.join(' ')).toMatch(/playback/);
    expect(c.lost.join(' ')).toMatch(/transcript/);
    expect(c.lost.join(' ')).not.toMatch(/session in progress/);
  });

  it('owner of an active pad: deleting ends the session', () => {
    expect(deleteCopy(t({ status: 'active' })).lost[0]).toMatch(/session in progress ends/);
  });

  it('collaborator: removes from their history only', () => {
    const c = deleteCopy(t({ role: 'collaborator' }));
    expect(c.action).toBe('Remove from history');
    expect(c.title).toContain('Two Sum');
    expect(c.description).toMatch(/owner keeps it/);
    expect(c.done).toMatch(/Removed/);
    expect(deleteCopy(t({ role: 'collaborator', status: 'active' })).lost[0]).toMatch(/leave/);
  });
});

describe('deleteCopy of a staged interview', () => {
  it('says every stage it started goes with it', () => {
    const c = deleteCopy(t({ problemTitle: 'Onsite loop', interview: { stages: 3, started: 2 } }));
    expect(c.title).toBe('Delete “Onsite loop”?');
    expect(c.description).toContain('the 2 stages you started in it');
    expect(c.lost.join(' ')).toMatch(/Every stage’s report/);
    expect(c.lost.join(' ')).toMatch(/overall result/);
    expect(
      deleteCopy(t({ status: 'active', interview: { stages: 3, started: 1 } })).lost[0],
    ).toMatch(/stage in progress ends/);
  });

  it('a one-stage interview reads as the pad it is', () => {
    expect(deleteCopy(t({ interview: { stages: 1, started: 1 } }))).toEqual(deleteCopy(t()));
  });
});

describe('alreadyGone', () => {
  it('treats only a 404 as already deleted', () => {
    expect(alreadyGone(new ApiRequestError(404, 'not_found', 'Pad not found'))).toBe(true);
    expect(alreadyGone(new ApiRequestError(500, 'internal', 'boom'))).toBe(false);
    expect(alreadyGone(new ApiRequestError(0, 'network', 'offline'))).toBe(false);
    expect(alreadyGone(new Error('x'))).toBe(false);
  });
});

describe('withoutPad', () => {
  it('drops the row and leaves an absent cache absent', () => {
    const pads = [{ id: 'a' }, { id: 'b' }] as PadSummary[];
    expect(withoutPad(pads, 'a')).toEqual([{ id: 'b' }]);
    expect(withoutPad(undefined, 'a')).toBeUndefined();
  });
});
