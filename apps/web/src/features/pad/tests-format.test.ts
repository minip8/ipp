import { describe, expect, it } from 'vitest';
import { describeTest, valuesMatch } from './tests-format';

const fn = {
  className: 'Solution',
  kind: 'function' as const,
  ctorParams: [],
  methods: [
    {
      name: 'twoSum',
      params: [
        { name: 'nums', type: { array: 'int' as const } },
        { name: 'target', type: 'int' as const },
      ],
      returns: { array: 'int' as const },
      compare: 'unordered' as const,
    },
  ],
};
const design = {
  className: 'LRUCache',
  kind: 'design' as const,
  ctorParams: [{ name: 'capacity', type: 'int' as const }],
  methods: [
    {
      name: 'get',
      params: [{ name: 'key', type: 'int' as const }],
      returns: 'int' as const,
      compare: 'exact' as const,
    },
    {
      name: 'put',
      params: [
        { name: 'key', type: 'int' as const },
        { name: 'value', type: 'int' as const },
      ],
      returns: 'void' as const,
      compare: 'exact' as const,
    },
  ],
};

describe('valuesMatch', () => {
  it('compares unordered arrays as multisets', () => {
    expect(valuesMatch([0, 1], [1, 0], 'unordered')).toBe(true);
    expect(valuesMatch([0, 1], [0, 0], 'unordered')).toBe(false);
    expect(valuesMatch([[1, 2], [3]], [[3], [2, 1]], 'unordered_deep')).toBe(true);
    expect(valuesMatch([[1, 2], [3]], [[3], [2, 1]], 'unordered')).toBe(false);
  });
  it('tolerates floating point error', () => {
    expect(valuesMatch(0.1 + 0.2, 0.3)).toBe(true);
  });
});

describe('describeTest', () => {
  it('names function parameters', () => {
    const v = describeTest(
      fn,
      { ctorArgs: [], calls: [{ method: 'twoSum', args: [[3, 2, 4], 6] }] },
      [[1, 2]],
      [[0, 0]],
    );
    expect(v.kind).toBe('function');
    if (v.kind !== 'function') return;
    expect(v.params).toEqual([
      { name: 'nums', value: '[3,2,4]' },
      { name: 'target', value: '6' },
    ]);
    expect(v.call).toMatchObject({ expected: '[1,2]', actual: '[0,0]', ok: false });
  });
  it('lists design calls and hides void returns', () => {
    const v = describeTest(
      design,
      {
        ctorArgs: [2],
        calls: [
          { method: 'put', args: [1, 1] },
          { method: 'get', args: [1] },
        ],
      },
      [null, 1],
      [null, -1],
    );
    expect(v.kind).toBe('design');
    if (v.kind !== 'design') return;
    expect(v.ctor).toBe('LRUCache(2)');
    expect(v.calls[0]).toMatchObject({ label: 'put(1, 1)', expected: null });
    expect(v.calls[1]).toMatchObject({ label: 'get(1)', expected: '1', actual: '-1', ok: false });
  });
});
