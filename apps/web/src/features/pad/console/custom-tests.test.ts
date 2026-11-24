import { describe, expect, it } from 'vitest';
import { compileDraft, draftFromSample, emptyDraft } from './custom-tests';

const sig = {
  className: 'LRUCache',
  kind: 'design' as const,
  ctorParams: [{ name: 'capacity', type: 'int' as const }],
  methods: [
    {
      name: 'put',
      params: [
        { name: 'k', type: 'int' as const },
        { name: 'v', type: 'int' as const },
      ],
      returns: 'void' as const,
      compare: 'exact' as const,
    },
    {
      name: 'get',
      params: [{ name: 'k', type: 'int' as const }],
      returns: 'int' as const,
      compare: 'exact' as const,
    },
  ],
};

describe('custom test drafts', () => {
  it('round-trips a sample into an API custom test', () => {
    const d = draftFromSample({
      id: 's1',
      hidden: false,
      ctorArgs: [2],
      calls: [
        { method: 'put', args: [1, 1] },
        { method: 'get', args: [1] },
      ],
      expected: [null, 1],
    });
    expect(compileDraft(sig, d)).toEqual({
      test: {
        ctorArgs: [2],
        calls: [
          { method: 'put', args: [1, 1] },
          { method: 'get', args: [1] },
        ],
      },
      errors: [],
    });
  });
  it('reports which field is not JSON', () => {
    const d = emptyDraft(sig);
    d.ctorArgs = ['2'];
    d.calls[0] = { method: 'put', args: ['1', '[1,'] };
    const r = compileDraft(sig, d);
    expect(r.test).toBeNull();
    expect(r.errors).toEqual([{ path: 'call.0.1', message: 'v is not valid JSON' }]);
  });
});
