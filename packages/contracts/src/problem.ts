import { z } from 'zod';
import { Identifier, Json, LANGUAGES, Language, Slug } from './common';
import { ProblemCategory } from './taxonomy';

/**
 * Language-neutral value types for method signatures.
 *
 *   JSON encoding      int/long/double -> number, bool -> boolean, string -> string,
 *                      char -> 1-char string, array/list -> array, void -> null
 *   C++                int, long long, double, bool, string, char, vector<T> (array and list)
 *   Java               int, long, double, boolean, String, char; array -> T[]; list -> List<Boxed>
 *   Python             int, int, float, bool, str, str, list[T]
 *
 * `array` vs `list` only differs in Java (T[] vs List<T>), so problems can use the idiomatic form.
 * long values in tests must stay within the JS safe-integer range.
 */
export const PRIMITIVES = ['int', 'long', 'double', 'bool', 'string', 'char', 'void'] as const;
export type Primitive = (typeof PRIMITIVES)[number];
export type Ty = Primitive | { array: Ty } | { list: Ty };
export const Ty: z.ZodType<Ty> = z.lazy(() =>
  z.union([z.enum(PRIMITIVES), z.strictObject({ array: Ty }), z.strictObject({ list: Ty })]),
);

export const Param = z.object({ name: Identifier, type: Ty });
export type Param = z.infer<typeof Param>;

/**
 * How a method's return value is compared with the expected value.
 *  exact           deep equality (doubles within 1e-6 absolute or relative)
 *  unordered       top-level array compared as a multiset
 *  unordered_deep  arrays compared as multisets at every depth (e.g. list of triplets in any order)
 */
export const Compare = z.enum(['exact', 'unordered', 'unordered_deep']);
export type Compare = z.infer<typeof Compare>;

export const Method = z.object({
  name: Identifier,
  params: z.array(Param),
  returns: Ty,
  compare: Compare.default('exact'),
});
export type Method = z.infer<typeof Method>;

/**
 * The class the candidate implements.
 *  function  one method on a default-constructed class; each test is a single call
 *  design    constructor + several methods; each test is a sequence of calls on one instance
 */
export const ProblemSignature = z
  .object({
    className: Identifier,
    kind: z.enum(['function', 'design']),
    ctorParams: z.array(Param).default([]),
    methods: z.array(Method).min(1),
  })
  .refine((s) => s.kind === 'design' || (s.methods.length === 1 && s.ctorParams.length === 0), {
    message: 'function problems have exactly one method and no constructor parameters',
  });
export type ProblemSignature = z.infer<typeof ProblemSignature>;

export const Call = z.object({ method: Identifier, args: z.array(Json) });
export type Call = z.infer<typeof Call>;

/** One test: construct the class with ctorArgs, make the calls in order, compare each result. */
export const TestCase = z.object({
  id: z.string().min(1).max(40),
  hidden: z.boolean(),
  ctorArgs: z.array(Json).default([]),
  calls: z.array(Call).min(1),
  /** One entry per call; null for void methods. */
  expected: z.array(Json),
  explanation: z.string().optional(),
});
export type TestCase = z.infer<typeof TestCase>;

export const Difficulty = z.enum(['easy', 'medium', 'hard']);
export type Difficulty = z.infer<typeof Difficulty>;

/** Per-problem limits before language multipliers (see limits.ts). */
export const ProblemLimits = z.object({
  timeMs: z.int().min(100).max(10_000).default(1000),
  memoryMb: z.int().min(64).max(1024).default(256),
});
export type ProblemLimits = z.infer<typeof ProblemLimits>;

/** Offered languages whose reference solution is required (the others' are optional). */
export const REQUIRED_SOLUTION_LANGUAGES: readonly Language[] = ['cpp', 'python'];

/** The languages a problem offers: non-empty, no repeats, normalised to LANGUAGES order. */
export const ProblemLanguages = z
  .array(Language)
  .min(1)
  .refine((ls) => new Set(ls).size === ls.length, { message: 'languages must not repeat' })
  .transform((ls) => LANGUAGES.filter((l) => ls.includes(l)));

/** Source text for some languages. */
const PerLanguage = z.partialRecord(Language, z.string());

/** Authoring format: one file per problem in packages/content. Seeded into Postgres. */
export const ProblemContent = z
  .object({
    slug: Slug,
    title: z.string().max(120),
    difficulty: Difficulty,
    /** What kind of interview this is; see CATEGORY_INFO. */
    category: ProblemCategory,
    /** Fine-grained topics; each is in a TOPIC_GROUPS group or in EXCLUDED_TAGS. */
    tags: z.array(Slug),
    /** Markdown shown to the candidate. */
    statement: z.string(),
    /**
     * The class the tests call. With a `harness` this is the harness's class, which drives the
     * candidate's own code; the candidate does not write it.
     */
    signature: ProblemSignature,
    limits: ProblemLimits.default({ timeMs: 1000, memoryMb: 256 }),
    /**
     * The languages the problem can be solved in; absent = all. A problem that cannot be stated
     * language-neutrally (a C++ template with move semantics, say) offers only the one it needs.
     */
    languages: ProblemLanguages.default([...LANGUAGES]),
    /** Editor starter code per language, instead of the scaffold generated from the signature. */
    starterCode: PerLanguage.default({}),
    /**
     * Server-only. Test code appended after the candidate's source for judged runs
     * (`composeJudgedSource`): it defines `signature.className` and exercises the candidate's
     * code. Self-contained (its own includes, qualified names) and without an entry point.
     */
    harness: PerLanguage.default({}),
    tests: z.array(TestCase).min(1),
    /**
     * Server-only. Given to the AI interviewer, never to the browser: intended approaches and
     * complexity, common wrong turns, a ladder of progressively stronger hints, follow-up questions.
     */
    interviewerNotes: z.string(),
    /**
     * Server-only. Each must pass every test; verified through the real judge in CI. Required for
     * every offered language in REQUIRED_SOLUTION_LANGUAGES, optional for the other offered ones,
     * absent for languages the problem does not offer. With a harness, a reference solution is
     * the candidate-side code only (the harness is appended as for the candidate).
     */
    referenceSolutions: PerLanguage,
    /** Where the idea came from. The statement is always in our own words. */
    source: z
      .object({ name: z.string(), url: z.url().optional(), license: z.string().optional() })
      .optional(),
  })
  .superRefine((p, ctx) => {
    const offered = new Set<Language>(p.languages);
    const missing = REQUIRED_SOLUTION_LANGUAGES.filter(
      (l) => offered.has(l) && p.referenceSolutions[l] === undefined,
    );
    if (missing.length)
      ctx.addIssue({
        code: 'custom',
        path: ['referenceSolutions'],
        message: `${missing.join(' and ')} reference solution${missing.length > 1 ? 's are' : ' is'} required`,
      });
    // The generated scaffold would be the harness class, which the candidate does not write.
    for (const l of Object.keys(p.harness) as Language[]) {
      if (p.starterCode[l] === undefined)
        ctx.addIssue({
          code: 'custom',
          path: ['starterCode', l],
          message: `a problem with a ${l} harness needs ${l} starter code`,
        });
    }
    for (const field of ['referenceSolutions', 'starterCode', 'harness'] as const) {
      for (const l of Object.keys(p[field]) as Language[]) {
        if (!offered.has(l))
          ctx.addIssue({
            code: 'custom',
            path: [field, l],
            message: `${l} is not one of the problem's languages (${p.languages.join(', ')})`,
          });
      }
    }
  });
export type ProblemContent = z.infer<typeof ProblemContent>;

export const ProblemSummary = z.object({
  slug: Slug,
  title: z.string(),
  difficulty: Difficulty,
  category: ProblemCategory,
  tags: z.array(z.string()),
  /** The languages the problem can be solved in (all unless it is restricted). */
  languages: z
    .array(Language)
    .min(1)
    .default([...LANGUAGES]),
});
export type ProblemSummary = z.infer<typeof ProblemSummary>;

/**
 * What the browser may see: no hidden tests, notes, reference solutions or harness.
 * `scaffolds` is the editor's starting code per language: the problem's starter code where it has
 * one, otherwise generated from the signature (`problemScaffolds`).
 */
export const ProblemDetail = ProblemSummary.extend({
  statement: z.string(),
  signature: ProblemSignature,
  limits: ProblemLimits,
  sampleTests: z.array(TestCase),
  hiddenTestCount: z.int(),
  scaffolds: z.record(Language, z.string()),
});
export type ProblemDetail = z.infer<typeof ProblemDetail>;
