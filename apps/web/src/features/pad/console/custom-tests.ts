import {
  CAPS,
  type CustomTest,
  type Json,
  type ProblemSignature,
  type TestCase,
} from '@ipp/contracts';
import { storage } from '@/lib/storage';

/** Editable form of a custom test: raw JSON text per field so typing never loses input. */
export type DraftTest = {
  id: string;
  ctorArgs: string[];
  calls: { method: string; args: string[] }[];
};

let seq = 0;
const nextId = () => `t${Date.now().toString(36)}${(seq++).toString(36)}`;

export function emptyDraft(sig: ProblemSignature): DraftTest {
  const m = sig.methods[0];
  return {
    id: nextId(),
    ctorArgs: sig.ctorParams.map(() => ''),
    calls: m ? [{ method: m.name, args: m.params.map(() => '') }] : [],
  };
}

export function draftFromSample(t: TestCase): DraftTest {
  return {
    id: nextId(),
    ctorArgs: t.ctorArgs.map((a) => JSON.stringify(a)),
    calls: t.calls.map((c) => ({ method: c.method, args: c.args.map((a) => JSON.stringify(a)) })),
  };
}

export type DraftError = { path: string; message: string };

function parseJson(text: string): { ok: true; value: Json } | { ok: false } {
  if (text.trim() === '') return { ok: false };
  try {
    return { ok: true, value: JSON.parse(text) as Json };
  } catch {
    return { ok: false };
  }
}

/** Validates a draft against the signature (arity, JSON) and converts it to the API shape. */
export function compileDraft(
  sig: ProblemSignature,
  d: DraftTest,
): { test: CustomTest | null; errors: DraftError[] } {
  const errors: DraftError[] = [];
  const ctorArgs: Json[] = [];
  d.ctorArgs.forEach((a, i) => {
    const p = parseJson(a);
    if (p.ok) ctorArgs.push(p.value);
    else
      errors.push({
        path: `ctor.${i}`,
        message: `${sig.ctorParams[i]?.name ?? 'argument'} is not valid JSON`,
      });
  });
  const calls = d.calls.map((c, ci) => {
    const m = sig.methods.find((x) => x.name === c.method);
    if (!m) errors.push({ path: `call.${ci}`, message: `Unknown method ${c.method}` });
    const args: Json[] = [];
    c.args.forEach((a, ai) => {
      const p = parseJson(a);
      if (p.ok) args.push(p.value);
      else
        errors.push({
          path: `call.${ci}.${ai}`,
          message: `${m?.params[ai]?.name ?? 'argument'} is not valid JSON`,
        });
    });
    return { method: c.method, args };
  });
  if (calls.length === 0) errors.push({ path: 'calls', message: 'Add at least one call' });
  return { test: errors.length ? null : { ctorArgs, calls }, errors };
}

const key = (padId: string) => `ipp:custom-tests:${padId}`;
export const loadDrafts = (padId: string): DraftTest[] =>
  storage.get<DraftTest[]>(key(padId), []).slice(0, CAPS.customTests);
export const saveDrafts = (padId: string, drafts: DraftTest[]) =>
  storage.set(key(padId), drafts.slice(0, CAPS.customTests));
