/**
 * Reference semantics for comparing a method's return value with the expected value.
 * The Rust judge implements the same rules (crates: see apps/judge); keep them in step.
 */
import type { Compare, Json } from '@ipp/contracts';

const EPS = 1e-6;

function numbersEqual(a: number, b: number): boolean {
  if (Number.isInteger(a) && Number.isInteger(b)) return a === b;
  const diff = Math.abs(a - b);
  return diff <= EPS || diff <= EPS * Math.max(Math.abs(a), Math.abs(b));
}

function canonical(v: Json, deep: boolean): string {
  if (Array.isArray(v)) {
    const parts = v.map((x) => canonical(x, deep));
    return `[${(deep ? parts.sort() : parts).join(',')}]`;
  }
  return JSON.stringify(v);
}

function exact(a: Json, b: Json): boolean {
  if (typeof a === 'number' && typeof b === 'number') return numbersEqual(a, b);
  if (Array.isArray(a) && Array.isArray(b))
    return a.length === b.length && a.every((x, i) => exact(x, b[i] as Json));
  return a === b;
}

export function resultsEqual(actual: Json, expected: Json, mode: Compare): boolean {
  if (mode === 'exact') return exact(actual, expected);
  if (!Array.isArray(actual) || !Array.isArray(expected)) return exact(actual, expected);
  if (actual.length !== expected.length) return false;
  const deep = mode === 'unordered_deep';
  const key = (v: Json) => canonical(v, deep);
  return JSON.stringify(actual.map(key).sort()) === JSON.stringify(expected.map(key).sort());
}
