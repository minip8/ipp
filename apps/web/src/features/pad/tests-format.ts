import type { Json, ProblemSignature } from '@ipp/contracts';

export type CallView = {
  label: string;
  expected: string | null;
  actual: string | null;
  ok: boolean | null;
};

export const fmt = (v: Json | undefined) => (v === undefined ? '' : JSON.stringify(v));

/** Deep equality with the problem's comparison mode, so the UI can highlight the mismatching call. */
export function valuesMatch(
  expected: Json,
  actual: Json,
  compare: 'exact' | 'unordered' | 'unordered_deep' = 'exact',
): boolean {
  const norm = (v: Json, deep: boolean, top: boolean): Json => {
    if (Array.isArray(v)) {
      const items = v.map((x) => norm(x, deep, false));
      if (deep || top)
        return [...items].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
      return items;
    }
    return v;
  };
  if (typeof expected === 'number' && typeof actual === 'number') {
    const diff = Math.abs(expected - actual);
    return diff <= 1e-6 || diff <= 1e-6 * Math.abs(expected);
  }
  if (compare === 'exact') return JSON.stringify(expected) === JSON.stringify(actual);
  return (
    JSON.stringify(norm(expected, compare === 'unordered_deep', true)) ===
    JSON.stringify(norm(actual, compare === 'unordered_deep', true))
  );
}

/**
 * Human-readable view of one test against the signature.
 *   function problems: named parameters and a single return value
 *   design problems:   constructor, then each call with its expected/actual return
 */
export function describeTest(
  sig: ProblemSignature,
  test: { ctorArgs: Json[]; calls: { method: string; args: Json[] }[] },
  expected: Json[] | null,
  actual: Json[] | null,
) {
  const methodOf = (name: string) => sig.methods.find((m) => m.name === name);
  const calls: CallView[] = test.calls.map((c, i) => {
    const m = methodOf(c.method);
    const exp = expected ? (expected[i] as Json) : undefined;
    const act = actual ? (actual[i] as Json | undefined) : undefined;
    const isVoid = m?.returns === 'void';
    return {
      label: `${c.method}(${c.args.map(fmt).join(', ')})`,
      expected: expected && !isVoid ? fmt(exp) : null,
      actual: actual && act !== undefined && !isVoid ? fmt(act) : null,
      ok:
        expected && actual && act !== undefined ? valuesMatch(exp ?? null, act, m?.compare) : null,
    };
  });
  if (sig.kind === 'function') {
    const m = sig.methods[0];
    const params = (m?.params ?? []).map((p, i) => ({
      name: p.name,
      value: fmt(test.calls[0]?.args[i]),
    }));
    return { kind: 'function' as const, params, call: calls[0] };
  }
  const ctor = `${sig.className}(${test.ctorArgs.map(fmt).join(', ')})`;
  return { kind: 'design' as const, ctor, calls };
}

/** Signature line like `twoSum(nums: int[], target: int) -> int[]`. */
export function tyName(t: ProblemSignature['methods'][number]['returns']): string {
  if (typeof t === 'string') return t;
  if ('array' in t) return `${tyName(t.array)}[]`;
  return `list<${tyName(t.list)}>`;
}
