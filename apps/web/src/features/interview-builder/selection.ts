/**
 * What the builder shows and keeps, as pure rules: a **selection** (a built-in preset, one of the
 * user's saved plans, the custom draft, or a link's preview) and a **draft** (the user's own plan
 * in progress, or none). The two are separate: choosing a preset or a saved plan shows it and
 * leaves the draft as it was, and choosing "Custom" shows the draft again.
 *
 * Editing the plan shown while anything but the draft is selected starts a draft from it; when a
 * draft already holds work that would be lost (it is no preset and no saved plan), the builder
 * asks first (`edit` says so). A link's preview (`?problem=`, `?topics=`, `?random=1`) is what
 * Start would run but is not the draft, and is never remembered: the URL brings it back.
 *
 * The selection and the draft are remembered per track in this browser (`StoredBuilder`, v2);
 * the plan remembered by the version before (v1, one plan and the preset it came from) becomes
 * the selected preset when it still is one, else the draft.
 */
import {
  INTERVIEW_STAGES_MAX,
  INTERVIEW_TEMPLATE_NAME_MAX,
  INTERVIEW_TEMPLATES_MAX,
  InterviewStage,
  type InterviewTemplate,
  Language,
  type ProblemSummary,
  presetById,
  presetsOf,
  STAGE_KIND_INFO,
  STAGE_TOPICS_MAX,
  type Track,
} from '@ipp/contracts';
import { z } from 'zod';
import { type Names, problemLabel, topicsLabel } from '@/features/interview/logic';
import { ApiRequestError } from '@/lib/api';
import { storage } from '@/lib/storage';
import { TOPICS_PARAM } from '@/lib/track';
import {
  defaultPlan,
  interviewTitle,
  matchingPreset,
  type Plan,
  presetPlan,
  sameStages,
} from './logic';

/** A saved plan as the builder uses it (`InterviewTemplate`). */
export type SavedPlan = Pick<InterviewTemplate, 'id' | 'name' | 'stages'>;

/**
 * A selection that is remembered. A saved plan's carries a copy of the plan, shown until the
 * list of saved plans has loaded (and replaced by it then).
 */
export type Persistent =
  | { kind: 'preset'; id: string }
  | { kind: 'saved'; id: string; name: string; stages: InterviewStage[] }
  | { kind: 'custom' };
export type Selection = Persistent | { kind: 'preview' };

export type Draft = {
  /** The preset it started from, changed or not (`CreateInterviewRequest.preset`). */
  preset: string | null;
  stages: InterviewStage[];
  /** The saved plan it started from: Save offers to update it. */
  template: string | null;
};

/** What a link names that is shown without becoming the draft. */
export type LinkSource =
  | { kind: 'problem'; slug: string }
  | { kind: 'topics'; topics: string[] }
  | { kind: 'random' };
export type Preview = { source: LinkSource; stages: InterviewStage[] };

export type Builder = {
  selection: Selection;
  /** What is remembered: the selection, or the one under a preview. */
  stored: Persistent;
  draft: Draft | null;
  preview: Preview | null;
  /** The language presets and new coding stages take. */
  language: Language;
};

/** What the rules need to know besides the builder: the track, and its saved plans (as shown). */
export type Ctx = { track: Track; saved: readonly SavedPlan[] };

export const presetSelection = (id: string): Persistent => ({ kind: 'preset', id });
export const savedSelection = (t: SavedPlan): Persistent => ({
  kind: 'saved',
  id: t.id,
  name: t.name,
  stages: t.stages,
});

/** The track's default: its first preset. */
export function defaultSelection(track: Track): Persistent {
  const [first] = presetsOf(track);
  if (!first) throw new Error(`no preset for ${track}`);
  return presetSelection(first.id);
}

export function initialBuilder(track: Track, language: Language): Builder {
  const selection = defaultSelection(track);
  return { selection, stored: selection, draft: null, preview: null, language };
}

/** Whether two selections are the same choice (a saved plan's by its id). */
export function sameSelection(a: Selection, b: Selection): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === 'preset' && b.kind === 'preset') return a.id === b.id;
  if (a.kind === 'saved' && b.kind === 'saved') return a.id === b.id;
  return true;
}

// ---------------------------------------------------------------- what is shown

/** The plan the builder shows, and Start would run. */
export function shownPlan(b: Builder, ctx: Ctx): Plan {
  const s = b.selection;
  if (s.kind === 'preset') {
    const p = presetById(s.id);
    if (p && p.track === ctx.track) return presetPlan(p, b.language);
  } else if (s.kind === 'saved') {
    const t = ctx.saved.find((x) => x.id === s.id);
    return { preset: null, stages: t?.stages ?? s.stages };
  } else if (s.kind === 'custom') {
    if (b.draft) return { preset: b.draft.preset, stages: b.draft.stages };
  } else if (b.preview) return { preset: null, stages: b.preview.stages };
  return defaultPlan(ctx.track, b.language);
}

/** A preview's card title: the problem, the topics, or the random pick. */
export function previewLabel(preview: Preview, names: Names): string {
  const [stage] = preview.stages;
  if (stage?.kind === 'coding') return problemLabel(stage, names);
  if (stage?.kind === 'questions') return topicsLabel(stage.topics, names);
  return 'Your link';
}

/** What the selection is called: "Trader", a saved plan's name, a preview's, or "your custom plan". */
export function selectionLabel(b: Builder, ctx: Ctx, names: Names): string {
  const s = b.selection;
  if (s.kind === 'preset') return presetById(s.id)?.label ?? 'this preset';
  if (s.kind === 'saved') return ctx.saved.find((t) => t.id === s.id)?.name ?? s.name;
  if (s.kind === 'preview' && b.preview) return previewLabel(b.preview, names);
  return 'your custom plan';
}

/** Whether these stages are kept somewhere already: a preset of the track or a saved plan. */
export const isKept = (stages: readonly InterviewStage[], ctx: Ctx) =>
  matchingPreset(stages, ctx.track) !== null || ctx.saved.some((t) => sameStages(t.stages, stages));

/** Whether replacing the draft would lose work: it exists and is no preset and no saved plan. */
export const draftHoldsWork = (draft: Draft | null, ctx: Ctx) =>
  draft !== null && !isKept(draft.stages, ctx);

/** The saved plan a draft was started from, while it still exists. */
export const draftOrigin = (b: Builder, ctx: Ctx): SavedPlan | null =>
  (b.draft?.template && ctx.saved.find((t) => t.id === b.draft?.template)) || null;

// ---------------------------------------------------------------- choosing and editing

/**
 * Choosing a card. The draft is never touched, except that choosing Custom with no draft starts
 * one from the plan shown (so "start from Trader, then change it" is one click on either route).
 */
export function choose(b: Builder, selection: Selection, ctx: Ctx): Builder {
  if (selection.kind === 'preview' && !b.preview) return b;
  let draft = b.draft;
  if (selection.kind === 'custom' && !draft) {
    const plan = shownPlan(b, ctx);
    draft = {
      preset: plan.preset,
      stages: plan.stages,
      template: b.selection.kind === 'saved' ? b.selection.id : null,
    };
  }
  return {
    ...b,
    selection,
    stored: selection.kind === 'preview' ? b.stored : selection,
    draft,
  };
}

/**
 * The plan shown edited into `stages`. On the draft, the draft changes. On anything else a draft
 * starts from it and Custom is selected; `ask` says the draft it replaces holds work that would
 * be lost, so the user is asked first. A preset's coding stage in another language is still the
 * preset (the builder's language follows it), and an edit that changes nothing is none.
 */
export function edit(
  b: Builder,
  stages: InterviewStage[],
  ctx: Ctx,
): { next: Builder; ask: boolean } {
  if (b.selection.kind === 'custom' && b.draft)
    return { next: { ...b, draft: { ...b.draft, stages } }, ask: false };
  const plan = shownPlan(b, ctx);
  if (sameStages(plan.stages, stages)) return { next: b, ask: false };
  if (b.selection.kind === 'preset' && matchingPreset(stages, ctx.track)?.id === b.selection.id)
    return { next: b, ask: false };
  const custom: Persistent = { kind: 'custom' };
  return {
    next: {
      ...b,
      selection: custom,
      stored: custom,
      draft: {
        preset: plan.preset,
        stages,
        template: b.selection.kind === 'saved' ? b.selection.id : null,
      },
    },
    ask: draftHoldsWork(b.draft, ctx),
  };
}

/** The draft thrown away: back to the track's default preset. */
export function discard(b: Builder, track: Track): Builder {
  const selection = defaultSelection(track);
  return { ...b, selection, stored: selection, draft: null };
}

// ---------------------------------------------------------------- saved plans

/**
 * What Save offers for the plan shown: nothing when it is already a preset or a saved plan;
 * else saving it under a name, and for a draft started from a saved plan that still exists also
 * updating that one (`update`).
 */
export function saveOffer(b: Builder, ctx: Ctx): { update: SavedPlan | null } | null {
  if (isKept(shownPlan(b, ctx).stages, ctx)) return null;
  return { update: b.selection.kind === 'custom' ? draftOrigin(b, ctx) : null };
}

/** A plan was saved (or a saved plan updated): it is selected, and a draft now identical to it goes. */
export function afterSave(b: Builder, t: SavedPlan): Builder {
  const selection = savedSelection(t);
  const same = b.draft && sameStages(b.draft.stages, t.stages);
  return { ...b, selection, stored: selection, draft: same ? null : b.draft };
}

/** A saved plan was renamed: its copy in the selection takes the new name. */
export function afterRename(b: Builder, t: SavedPlan): Builder {
  const fix = (s: Persistent) => (s.kind === 'saved' && s.id === t.id ? savedSelection(t) : s);
  return {
    ...b,
    selection: b.selection.kind === 'preview' ? b.selection : fix(b.selection),
    stored: fix(b.stored),
  };
}

/**
 * A saved plan was deleted: when it was selected the track's default preset is; a draft started
 * from it stays, no longer tied to it.
 */
export function afterDelete(b: Builder, id: string, track: Track): Builder {
  const fix = (s: Persistent) => (s.kind === 'saved' && s.id === id ? defaultSelection(track) : s);
  const draft = b.draft?.template === id ? { ...b.draft, template: null } : b.draft;
  return {
    ...b,
    selection: b.selection.kind === 'preview' ? b.selection : fix(b.selection),
    stored: fix(b.stored),
    draft,
  };
}

/**
 * The saved plans as the server has them (this track's): a selected one takes its current name
 * and plan, or the default preset once it is gone. The same builder when nothing changes.
 */
export function reconcile(b: Builder, saved: readonly SavedPlan[], track: Track): Builder {
  const fix = (s: Persistent): Persistent => {
    if (s.kind !== 'saved') return s;
    const t = saved.find((x) => x.id === s.id);
    if (!t) return defaultSelection(track);
    return t.name === s.name && sameStages(t.stages, s.stages) ? s : savedSelection(t);
  };
  const selection = b.selection.kind === 'preview' ? b.selection : fix(b.selection);
  const stored = fix(b.stored);
  return selection === b.selection && stored === b.stored ? b : { ...b, selection, stored };
}

/** `base`, or with a number after it when the track already has a plan of that name (any case). */
export function uniqueName(base: string, taken: readonly string[]): string {
  const used = new Set(taken.map((n) => n.trim().toLowerCase()));
  const name = base.trim().slice(0, INTERVIEW_TEMPLATE_NAME_MAX) || 'My interview';
  if (!used.has(name.toLowerCase())) return name;
  for (let n = 2; ; n++) {
    const suffix = ` ${n}`;
    const next = `${name.slice(0, INTERVIEW_TEMPLATE_NAME_MAX - suffix.length).trimEnd()}${suffix}`;
    if (!used.has(next.toLowerCase())) return next;
  }
}

/**
 * The name the Save dialog suggests for a new saved plan: from where the plan came from (the
 * saved plan or preset it started from, a lone problem or round of questions), else "My
 * interview"; numbered when the track has one of that name already.
 */
export function suggestedName(b: Builder, ctx: Ctx, names: Names): string {
  const plan = shownPlan(b, ctx);
  const origin = b.selection.kind === 'custom' ? draftOrigin(b, ctx) : null;
  const preset = presetById(plan.preset);
  const [only, ...rest] = plan.stages;
  let base = 'My interview';
  if (origin) base = origin.name;
  else if (preset) base = `${preset.label} (custom)`;
  else if (only && rest.length === 0 && only.kind === 'coding' && only.problemSlug)
    base = problemLabel(only, names);
  else if (only && rest.length === 0 && only.kind === 'questions')
    base = topicsLabel(only.topics, names);
  return uniqueName(
    base,
    ctx.saved.map((t) => t.name),
  );
}

/**
 * Why saving or renaming failed, in words, and what it is about: the name (taken on this track:
 * the dialog stays open to change it), the limit, a rate limit (the dialog counts down), a saved
 * plan deleted meanwhile, or anything else (the server's message, shown as an error).
 */
export type TemplateProblem =
  | { kind: 'name'; text: string }
  | { kind: 'limit'; text: string }
  | { kind: 'rate' }
  | { kind: 'gone'; text: string }
  | { kind: 'other' };

export function templateProblem(e: unknown, name: string): TemplateProblem | null {
  if (!e) return null;
  if (!(e instanceof ApiRequestError)) return { kind: 'other' };
  if (e.code === 'template_name_taken')
    return {
      kind: 'name',
      text: `You already have an interview called “${name.trim()}” on this track. Choose another name.`,
    };
  if (e.code === 'template_limit')
    return {
      kind: 'limit',
      text: `You have ${INTERVIEW_TEMPLATES_MAX} saved interviews, the most you can keep. Delete one of them first, then save this one.`,
    };
  if (e.isRateLimited) return { kind: 'rate' };
  if (e.isNotFound)
    return { kind: 'gone', text: 'That saved interview no longer exists. Save this as a new one.' };
  return { kind: 'other' };
}

/** "Questions, market-making game, questions": a saved plan's stages by kind, for its card. */
export function stageKinds(stages: readonly InterviewStage[]): string {
  const words = stages.map((s, i) => {
    const label = STAGE_KIND_INFO[s.kind].label;
    return i === 0 ? label : label.toLowerCase();
  });
  return words.join(', ');
}

// ---------------------------------------------------------------- starting it

/**
 * The plan Start runs and the interview's title: the preset's label, the saved plan's name, or
 * for the draft and a preview what `interviewTitle` says.
 */
export function startPlan(b: Builder, ctx: Ctx, names: Names): { plan: Plan; title: string } {
  const plan = shownPlan(b, ctx);
  const s = b.selection;
  if (s.kind === 'preset' && plan.preset === s.id)
    return { plan, title: presetById(s.id)?.label ?? interviewTitle(plan, ctx.track, names) };
  if (s.kind === 'saved')
    return { plan, title: ctx.saved.find((t) => t.id === s.id)?.name ?? s.name };
  return { plan, title: interviewTitle(plan, ctx.track, names) };
}

// ---------------------------------------------------------------- fitting to the content

/** Each stage of the draft and of the preview through `refit`; the same builder when none changes. */
export function fitBuilder(
  b: Builder,
  refit: (stages: InterviewStage[]) => InterviewStage[],
): Builder {
  const fitted = (stages: InterviewStage[]) => {
    const next = refit(stages);
    return next.every((s, i) => s === stages[i]) ? stages : next;
  };
  const draftStages = b.draft ? fitted(b.draft.stages) : null;
  const previewStages = b.preview ? fitted(b.preview.stages) : null;
  if (draftStages === (b.draft?.stages ?? null) && previewStages === (b.preview?.stages ?? null))
    return b;
  return {
    ...b,
    draft:
      b.draft && draftStages && draftStages !== b.draft.stages
        ? { ...b.draft, stages: draftStages }
        : b.draft,
    preview:
      b.preview && previewStages && previewStages !== b.preview.stages
        ? { ...b.preview, stages: previewStages }
        : b.preview,
  };
}

/**
 * A coding stage on a problem that no longer exists becomes a random one (a saved plan may name
 * one since removed); the same stages when none does.
 */
export function fitProblems(
  stages: readonly InterviewStage[],
  problems: readonly Pick<ProblemSummary, 'slug'>[],
): InterviewStage[] {
  const known = new Set(problems.map((p) => p.slug));
  return stages.map((s) =>
    s.kind === 'coding' && s.problemSlug && !known.has(s.problemSlug)
      ? { kind: 'coding', language: s.language, durationMin: s.durationMin }
      : s,
  );
}

/**
 * A preview of questions on topics none of which exist: the track's default preset instead
 * (some known: fitting the stage drops the others).
 */
export function dropEmptyPreview(b: Builder, topics: readonly { slug: string }[], track: Track) {
  const source = b.preview?.source;
  if (source?.kind !== 'topics') return b;
  const known = new Set(topics.map((t) => t.slug));
  if (source.topics.some((t) => known.has(t))) return b;
  const preview = null;
  if (b.selection.kind !== 'preview') return { ...b, preview };
  const selection = defaultSelection(track);
  return { ...b, preview, selection, stored: selection };
}

// ---------------------------------------------------------------- links in

const SLUG = /^[a-z0-9-]+$/;

/** The search params a link into the builder may carry (`?mode=` and `?view=` are the page's). */
export const LINK_PARAMS = [
  'preset',
  'path',
  'problem',
  TOPICS_PARAM,
  'random',
  'difficulty',
  'category',
] as const;

export type Link = { kind: 'preset'; id: string } | { kind: 'preview'; preview: Preview };

/**
 * What the page's URL names, or null: `?preset=<id>` (the track's own presets) and the old
 * `?path=trader|researcher` select a preset; `?problem=<slug>` (one coding stage on it),
 * `?topics=a,b` (one 20-minute questions stage on them; none valid: the default preset) and
 * `?random=1` with an optional `difficulty` and `category` (one random coding stage) preview a
 * plan of one stage.
 */
export function linkFromParams(
  params: URLSearchParams,
  track: Track,
  language: Language,
): Link | null {
  const named = presetById(params.get('preset') ?? params.get('path'));
  if (named && named.track === track) return { kind: 'preset', id: named.id };
  const problem = params.get('problem');
  if (problem && SLUG.test(problem))
    return {
      kind: 'preview',
      preview: {
        source: { kind: 'problem', slug: problem },
        stages: [{ kind: 'coding', problemSlug: problem, language, durationMin: 45 }],
      },
    };
  const topicsParam = params.get(TOPICS_PARAM);
  if (topicsParam !== null) {
    const topics = [
      ...new Set(
        topicsParam
          .split(',')
          .map((t) => t.trim())
          .filter((t) => SLUG.test(t)),
      ),
    ].slice(0, STAGE_TOPICS_MAX);
    if (topics.length === 0) {
      const [first] = presetsOf(track);
      return first ? { kind: 'preset', id: first.id } : null;
    }
    return {
      kind: 'preview',
      preview: {
        source: { kind: 'topics', topics },
        stages: [{ kind: 'questions', topics, durationMin: 20 }],
      },
    };
  }
  if (params.has('random')) {
    const stage = InterviewStage.safeParse({
      kind: 'coding',
      difficulty: params.get('difficulty') ?? undefined,
      category: params.get('category') ?? undefined,
      language,
      durationMin: 45,
    });
    return {
      kind: 'preview',
      preview: {
        source: { kind: 'random' },
        stages: [stage.success ? stage.data : { kind: 'coding', language, durationMin: 45 }],
      },
    };
  }
  return null;
}

/** A link followed: its preset selected, or its preview shown. The draft stays as it was. */
export function applyLink(b: Builder, link: Link): Builder {
  if (link.kind === 'preset') {
    const selection = presetSelection(link.id);
    return { ...b, selection, stored: selection };
  }
  return { ...b, preview: link.preview, selection: { kind: 'preview' } };
}

/** The link params of a query, as one string (empty: none), to notice a new link. */
export function linkKey(params: URLSearchParams): string {
  const q = new URLSearchParams();
  for (const p of LINK_PARAMS) {
    const v = params.get(p);
    if (v !== null) q.set(p, v);
  }
  return q.toString();
}

/** The query without its link params, or null when it has none (nothing to replace). */
export function withoutLink(search: string): string | null {
  const q = new URLSearchParams(search);
  if (!LINK_PARAMS.some((p) => q.has(p))) return null;
  for (const p of LINK_PARAMS) q.delete(p);
  return q.toString();
}

// ---------------------------------------------------------------- remembered in this browser

const Stages = z.array(InterviewStage).min(1).max(INTERVIEW_STAGES_MAX);

/** The format before saved plans (v1): the last plan built, and the preset it came from. */
export const StoredPlan = z.object({
  v: z.literal(1),
  preset: z.string().nullable(),
  stages: Stages,
  language: Language,
});

export const StoredBuilder = z.object({
  v: z.literal(2),
  language: Language,
  selection: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('preset'), id: z.string() }),
    z.object({ kind: z.literal('saved'), id: z.string(), name: z.string(), stages: Stages }),
    z.object({ kind: z.literal('custom') }),
  ]),
  draft: z
    .object({ preset: z.string().nullable(), stages: Stages, template: z.string().nullable() })
    .nullable(),
});
export type StoredBuilder = z.infer<typeof StoredBuilder>;

const trackPreset = (id: string | null, track: Track) => {
  const p = presetById(id);
  return p?.track === track ? p.id : null;
};

/**
 * What the builder starts from: what was stored for the track when it is valid (v2, or v1
 * migrated), else the track's default preset and no draft, in `language` (the user's usual one).
 * A selected preset of another track, or Custom with no draft, is the default preset.
 */
export function parseStoredBuilder(raw: unknown, track: Track, language: Language): Builder {
  const v2 = StoredBuilder.safeParse(raw);
  if (v2.success) {
    const { draft: d, selection: s, language: l } = v2.data;
    const draft = d ? { ...d, preset: trackPreset(d.preset, track) } : null;
    const valid =
      (s.kind === 'preset' && trackPreset(s.id, track) !== null) ||
      (s.kind === 'custom' && draft !== null) ||
      s.kind === 'saved';
    const selection = valid ? s : defaultSelection(track);
    return { selection, stored: selection, draft, preview: null, language: l };
  }
  const v1 = StoredPlan.safeParse(raw);
  if (v1.success) {
    const { stages, preset, language: l } = v1.data;
    const matched = matchingPreset(stages, track);
    if (matched) {
      const selection = presetSelection(matched.id);
      return { selection, stored: selection, draft: null, preview: null, language: l };
    }
    const selection: Persistent = { kind: 'custom' };
    return {
      selection,
      stored: selection,
      draft: { preset: trackPreset(preset, track), stages, template: null },
      preview: null,
      language: l,
    };
  }
  return initialBuilder(track, language);
}

export const toStored = (b: Builder): StoredBuilder => ({
  v: 2,
  language: b.language,
  selection: b.stored,
  draft: b.draft,
});

const builderKey = (track: Track) => `ipp:interview-plan:${track}`;

export const loadBuilder = (track: Track, language: Language) =>
  parseStoredBuilder(storage.get<unknown>(builderKey(track), null), track, language);

export const saveBuilder = (track: Track, b: Builder) =>
  storage.set(builderKey(track), toStored(b));
