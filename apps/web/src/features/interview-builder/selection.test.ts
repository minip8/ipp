import {
  INTERVIEW_TEMPLATE_NAME_MAX,
  type InterviewStage,
  presetById,
  presetStages,
} from '@ipp/contracts';
import { describe, expect, it } from 'vitest';
import { ApiRequestError } from '@/lib/api';
import { defaultPlan } from './logic';
import {
  afterDelete,
  afterRename,
  afterSave,
  applyLink,
  type Builder,
  type Ctx,
  choose,
  discard,
  draftHoldsWork,
  dropEmptyPreview,
  edit,
  fitBuilder,
  fitProblems,
  initialBuilder,
  linkFromParams,
  linkKey,
  parseStoredBuilder,
  previewLabel,
  reconcile,
  type SavedPlan,
  saveOffer,
  selectionLabel,
  shownPlan,
  stageKinds,
  startPlan,
  suggestedName,
  templateProblem,
  toStored,
  uniqueName,
  withoutLink,
} from './selection';

const names = {
  problem: (s: string) => ({ 'two-sum': 'Two Sum' })[s],
  topic: (s: string) => ({ probability: 'Probability', statistics: 'Statistics' })[s],
};

const game: InterviewStage = { kind: 'game', durationMin: 15 };
const questions: InterviewStage = { kind: 'questions', topics: ['probability'], durationMin: 20 };
const twoSum: InterviewStage = {
  kind: 'coding',
  problemSlug: 'two-sum',
  language: 'cpp',
  durationMin: 45,
};

const preset = (id: string) => {
  const p = presetById(id);
  if (!p) throw new Error(id);
  return p;
};
const trader = presetStages(preset('trader'), 'cpp');

const mine: SavedPlan = { id: 't1', name: 'Mine', stages: [questions, game] };
const quant: Ctx = { track: 'quant', saved: [mine] };
const none: Ctx = { track: 'quant', saved: [] };

/** A quant builder with a draft holding work (no preset, no saved plan). */
const withWork = (): Builder => ({
  ...initialBuilder('quant', 'cpp'),
  draft: { preset: 'trader', stages: [game, game], template: null },
});

describe('the selection and the draft', () => {
  it('starts on the track’s first preset, with no draft', () => {
    const b = initialBuilder('quant', 'python');
    expect(b.selection).toEqual({ kind: 'preset', id: 'trader' });
    expect(b.draft).toBeNull();
    expect(shownPlan(b, none)).toEqual(defaultPlan('quant', 'python'));
  });

  it('shows a preset, a saved plan, the draft or a preview by what is selected', () => {
    const b = withWork();
    expect(shownPlan(b, quant).stages).toEqual(trader);
    const onSaved = choose(b, { kind: 'saved', ...mine }, quant);
    expect(shownPlan(onSaved, quant)).toEqual({ preset: null, stages: mine.stages });
    // Before the list has loaded, the copy kept with the selection.
    expect(shownPlan(onSaved, none).stages).toEqual(mine.stages);
    const onDraft = choose(onSaved, { kind: 'custom' }, quant);
    expect(shownPlan(onDraft, quant)).toEqual({ preset: 'trader', stages: [game, game] });
  });

  it('keeps the draft whatever is chosen, and Custom shows it again as it was', () => {
    const b = withWork();
    const onPreset = choose(b, { kind: 'preset', id: 'researcher' }, quant);
    expect(onPreset.draft).toBe(b.draft);
    const onSaved = choose(onPreset, { kind: 'saved', ...mine }, quant);
    expect(onSaved.draft).toBe(b.draft);
    const back = choose(onSaved, { kind: 'custom' }, quant);
    expect(back.selection).toEqual({ kind: 'custom' });
    expect(back.draft).toBe(b.draft);
  });

  it('Custom with no draft starts one from the plan shown', () => {
    const b = choose(initialBuilder('quant', 'cpp'), { kind: 'custom' }, quant);
    expect(b.draft).toEqual({ preset: 'trader', stages: trader, template: null });
    const fromSaved = choose(
      choose(initialBuilder('quant', 'cpp'), { kind: 'saved', ...mine }, quant),
      { kind: 'custom' },
      quant,
    );
    expect(fromSaved.draft).toEqual({ preset: null, stages: mine.stages, template: 't1' });
  });

  it('editing the draft changes it; editing anything else starts a draft from it', () => {
    const b = withWork();
    const onDraft = choose(b, { kind: 'custom' }, quant);
    const changed = edit(onDraft, [game], quant);
    expect(changed.ask).toBe(false);
    expect(changed.next.draft?.stages).toEqual([game]);

    const fresh = edit(initialBuilder('quant', 'cpp'), [...trader, game], quant);
    expect(fresh.ask).toBe(false);
    expect(fresh.next.selection).toEqual({ kind: 'custom' });
    expect(fresh.next.stored).toEqual({ kind: 'custom' });
    expect(fresh.next.draft).toEqual({
      preset: 'trader',
      stages: [...trader, game],
      template: null,
    });

    const fromSaved = edit(choose(b, { kind: 'saved', ...mine }, quant), [questions], quant);
    expect(fromSaved.next.draft).toEqual({ preset: null, stages: [questions], template: 't1' });
  });

  it('asks before replacing a draft that holds work, not one that is a preset or saved plan', () => {
    const b = withWork();
    expect(draftHoldsWork(b.draft, quant)).toBe(true);
    expect(edit(b, [...trader, game], quant).ask).toBe(true);
    // A draft identical to a preset (in any language), or to a saved plan, loses nothing.
    const asPreset = { ...b, draft: { preset: null, stages: trader, template: null } };
    expect(edit(asPreset, [...trader, game], quant).ask).toBe(false);
    const python = presetStages(preset('quant-developer'), 'python');
    expect(draftHoldsWork({ preset: null, stages: python, template: null }, quant)).toBe(false);
    const asSaved = { ...b, draft: { preset: null, stages: mine.stages, template: null } };
    expect(edit(asSaved, [...trader, game], quant).ask).toBe(false);
    expect(draftHoldsWork(null, quant)).toBe(false);
  });

  it('a preset’s coding stage in another language is still the preset; no change is no edit', () => {
    const b = initialBuilder('software', 'cpp');
    const ctx: Ctx = { track: 'software', saved: [] };
    const python: InterviewStage[] = [
      { kind: 'coding', difficulty: 'medium', language: 'python', durationMin: 45 },
    ];
    expect(edit(b, python, ctx).next).toBe(b);
    expect(edit(b, shownPlan(b, ctx).stages, ctx).next).toBe(b);
  });

  it('discarding the draft returns to the default preset', () => {
    const b = choose(withWork(), { kind: 'custom' }, quant);
    const d = discard(b, 'quant');
    expect(d.draft).toBeNull();
    expect(d.selection).toEqual({ kind: 'preset', id: 'trader' });
    expect(d.stored).toEqual({ kind: 'preset', id: 'trader' });
  });
});

describe('links in', () => {
  const link = (q: string, track: 'software' | 'quant' = 'software') =>
    linkFromParams(new URLSearchParams(q), track, 'python');

  it('selects a preset of the track, and maps the old paths to theirs', () => {
    expect(link('preset=onsite-loop')).toEqual({ kind: 'preset', id: 'onsite-loop' });
    expect(link('preset=trader')).toBeNull();
    expect(link('path=researcher', 'quant')).toEqual({ kind: 'preset', id: 'researcher' });
  });

  it('previews one coding stage on a problem, or a random one', () => {
    expect(link('problem=two-sum')).toEqual({
      kind: 'preview',
      preview: {
        source: { kind: 'problem', slug: 'two-sum' },
        stages: [{ kind: 'coding', problemSlug: 'two-sum', language: 'python', durationMin: 45 }],
      },
    });
    expect(link('problem=Bad Slug')).toBeNull();
    const random = link('random=1&difficulty=hard&category=dsa');
    expect(random?.kind === 'preview' && random.preview.stages).toEqual([
      { kind: 'coding', difficulty: 'hard', category: 'dsa', language: 'python', durationMin: 45 },
    ]);
    const bad = link('random=1&difficulty=impossible');
    expect(bad?.kind === 'preview' && bad.preview.stages).toEqual([
      { kind: 'coding', language: 'python', durationMin: 45 },
    ]);
    expect(link('difficulty=hard')).toBeNull();
    expect(link('')).toBeNull();
  });

  it('previews 20 minutes of questions on the topics, the default preset when none is valid', () => {
    expect(link('topics=probability,statistics,probability', 'quant')).toEqual({
      kind: 'preview',
      preview: {
        source: { kind: 'topics', topics: ['probability', 'statistics'] },
        stages: [{ kind: 'questions', topics: ['probability', 'statistics'], durationMin: 20 }],
      },
    });
    const many = link(`topics=${Array.from({ length: 12 }, (_, i) => `t${i}`).join(',')}`);
    expect(many?.kind === 'preview' && many.preview.source).toMatchObject({
      topics: ['t0', 't1', 't2', 't3', 't4', 't5', 't6', 't7'],
    });
    expect(link('topics=,Bad!', 'quant')).toEqual({ kind: 'preset', id: 'trader' });
  });

  it('a preview is shown, not the draft, and never remembered', () => {
    const b = withWork();
    const l = linkFromParams(new URLSearchParams('topics=statistics'), 'quant', 'cpp');
    if (!l) throw new Error('no link');
    const p = applyLink(b, l);
    expect(p.selection).toEqual({ kind: 'preview' });
    expect(p.draft).toBe(b.draft);
    expect(p.stored).toEqual(b.stored);
    expect(shownPlan(p, quant).stages).toEqual([
      { kind: 'questions', topics: ['statistics'], durationMin: 20 },
    ]);
    expect(toStored(p).selection).toEqual({ kind: 'preset', id: 'trader' });
    // Editing it is editing anything else: a new draft, after asking.
    const edited = edit(p, [{ kind: 'questions', topics: ['statistics'], durationMin: 30 }], quant);
    expect(edited.ask).toBe(true);
    expect(edited.next.draft).toEqual({
      preset: null,
      stages: [{ kind: 'questions', topics: ['statistics'], durationMin: 30 }],
      template: null,
    });
    // Choosing something else and coming back to it.
    const away = choose(p, { kind: 'custom' }, quant);
    expect(away.preview).toBe(p.preview);
    expect(choose(away, { kind: 'preview' }, quant).selection).toEqual({ kind: 'preview' });
    expect(choose(b, { kind: 'preview' }, quant)).toBe(b);
  });

  it('a preview of topics none of which exist gives way to the default preset', () => {
    const l = linkFromParams(new URLSearchParams('topics=gone'), 'quant', 'cpp');
    if (!l) throw new Error('no link');
    const b = applyLink(withWork(), l);
    const fixed = dropEmptyPreview(b, [{ slug: 'probability' }], 'quant');
    expect(fixed.preview).toBeNull();
    expect(fixed.selection).toEqual({ kind: 'preset', id: 'trader' });
    expect(fixed.draft).toBe(b.draft);
    expect(dropEmptyPreview(b, [{ slug: 'gone' }], 'quant')).toBe(b);
  });

  it('names a preview by its problem or topics', () => {
    const p = (q: string) => {
      const l = linkFromParams(new URLSearchParams(q), 'quant', 'cpp');
      if (l?.kind !== 'preview') throw new Error('no preview');
      return previewLabel(l.preview, names);
    };
    expect(p('problem=two-sum')).toBe('Two Sum');
    expect(p('topics=probability,statistics')).toBe('Probability, Statistics');
    expect(p('random=1&difficulty=hard')).toBe('Random hard problem');
  });

  it('knows a link’s params, and the query without them', () => {
    expect(linkKey(new URLSearchParams('mode=host&problem=two-sum'))).toBe('problem=two-sum');
    expect(linkKey(new URLSearchParams('view=history'))).toBe('');
    expect(withoutLink('?problem=two-sum&mode=host')).toBe('mode=host');
    expect(withoutLink('?topics=a,b')).toBe('');
    expect(withoutLink('?mode=host')).toBeNull();
  });
});

describe('saved plans', () => {
  it('offers Save only for a plan that is no preset and no saved plan', () => {
    const b = initialBuilder('quant', 'cpp');
    expect(saveOffer(b, quant)).toBeNull();
    expect(saveOffer(choose(b, { kind: 'saved', ...mine }, quant), quant)).toBeNull();
    const draft = edit(b, [game], quant).next;
    expect(saveOffer(draft, quant)).toEqual({ update: null });
    // A draft back to a saved plan's stages is that plan already.
    expect(
      saveOffer({ ...draft, draft: { preset: null, stages: mine.stages, template: null } }, quant),
    ).toBeNull();
    // A preview can be saved too.
    const l = linkFromParams(new URLSearchParams('problem=two-sum'), 'quant', 'cpp');
    if (!l) throw new Error('no link');
    expect(saveOffer(applyLink(b, l), quant)).toEqual({ update: null });
  });

  it('offers to update the saved plan a draft came from, while it exists', () => {
    const b = edit(
      choose(initialBuilder('quant', 'cpp'), { kind: 'saved', ...mine }, quant),
      [game],
      quant,
    ).next;
    expect(saveOffer(b, quant)).toEqual({ update: mine });
    expect(saveOffer(b, none)).toEqual({ update: null });
  });

  it('after saving, the saved plan is selected and a draft identical to it goes', () => {
    const b = choose(withWork(), { kind: 'custom' }, quant);
    const t = { id: 't2', name: 'Two games', stages: [game, game] };
    const s = afterSave(b, t);
    expect(s.selection).toEqual({ kind: 'saved', ...t });
    expect(s.stored).toEqual({ kind: 'saved', ...t });
    expect(s.draft).toBeNull();
    // A preview saved leaves the draft, which is something else.
    const other = afterSave(withWork(), { id: 't3', name: 'X', stages: [questions] });
    expect(other.draft).toEqual(withWork().draft);
  });

  it('renaming updates the selection’s copy; deleting falls back and frees the draft', () => {
    const b = choose(
      { ...withWork(), draft: { preset: null, stages: [game, game], template: 't1' } },
      { kind: 'saved', ...mine },
      quant,
    );
    const renamed = afterRename(b, { ...mine, name: 'Renamed' });
    expect(renamed.selection).toMatchObject({ kind: 'saved', name: 'Renamed' });
    expect(renamed.stored).toMatchObject({ kind: 'saved', name: 'Renamed' });
    const deleted = afterDelete(b, 't1', 'quant');
    expect(deleted.selection).toEqual({ kind: 'preset', id: 'trader' });
    expect(deleted.draft).toEqual({ preset: null, stages: [game, game], template: null });
    expect(afterDelete(withWork(), 't1', 'quant').selection).toEqual(withWork().selection);
  });

  it('takes the server’s version of the selected plan, or the default once it is gone', () => {
    const b = choose(initialBuilder('quant', 'cpp'), { kind: 'saved', ...mine }, quant);
    expect(reconcile(b, [mine], 'quant')).toBe(b);
    const changed = reconcile(b, [{ ...mine, name: 'New', stages: [game] }], 'quant');
    expect(changed.selection).toEqual({ kind: 'saved', id: 't1', name: 'New', stages: [game] });
    expect(reconcile(b, [], 'quant').selection).toEqual({ kind: 'preset', id: 'trader' });
    const other = initialBuilder('quant', 'cpp');
    expect(reconcile(other, [], 'quant')).toBe(other);
  });

  it('suggests a name from where the plan came from, numbered when it is taken', () => {
    const fromPreset = edit(initialBuilder('quant', 'cpp'), [game], quant).next;
    expect(suggestedName(fromPreset, quant, names)).toBe('Trader (custom)');
    const fromSaved = edit(
      choose(initialBuilder('quant', 'cpp'), { kind: 'saved', ...mine }, quant),
      [game],
      quant,
    ).next;
    expect(suggestedName(fromSaved, quant, names)).toBe('Mine 2');
    const l = linkFromParams(new URLSearchParams('problem=two-sum'), 'quant', 'cpp');
    if (!l) throw new Error('no link');
    expect(suggestedName(applyLink(initialBuilder('quant', 'cpp'), l), quant, names)).toBe(
      'Two Sum',
    );
    const scratch = { ...initialBuilder('quant', 'cpp'), selection: { kind: 'custom' as const } };
    expect(
      suggestedName(
        { ...scratch, draft: { preset: null, stages: [game, game], template: null } },
        quant,
        names,
      ),
    ).toBe('My interview');
  });

  it('numbers a name in any case, within the most a name may have', () => {
    expect(uniqueName('Mine', ['Other'])).toBe('Mine');
    expect(uniqueName('Mine', ['MINE', 'mine 2'])).toBe('Mine 3');
    const long = 'x'.repeat(INTERVIEW_TEMPLATE_NAME_MAX);
    const next = uniqueName(long, [long]);
    expect(next).toHaveLength(INTERVIEW_TEMPLATE_NAME_MAX);
    expect(next.endsWith(' 2')).toBe(true);
    expect(uniqueName('  ', [])).toBe('My interview');
  });

  it('describes a saved plan by its stages’ kinds', () => {
    expect(stageKinds([questions, game, twoSum])).toBe(
      'Questions, market-making game, coding problem',
    );
  });

  it('turns a coding stage on a problem that is gone into a random one', () => {
    const stages = [twoSum, { ...twoSum, problemSlug: 'gone' }, game];
    expect(fitProblems(stages, [{ slug: 'two-sum' }])).toEqual([
      twoSum,
      { kind: 'coding', language: 'cpp', durationMin: 45 },
      game,
    ]);
  });

  it('says why saving failed', () => {
    const err = (status: number, code: string) => new ApiRequestError(status, code, 'Server says');
    expect(templateProblem(err(409, 'template_name_taken'), ' Mine ')).toEqual({
      kind: 'name',
      text: 'You already have an interview called “Mine” on this track. Choose another name.',
    });
    expect(templateProblem(err(409, 'template_limit'), 'x')).toMatchObject({ kind: 'limit' });
    expect(templateProblem(err(409, 'template_limit'), 'x')).toMatchObject({
      text: expect.stringContaining('Delete one of them first'),
    });
    expect(templateProblem(err(429, 'rate_limited'), 'x')).toEqual({ kind: 'rate' });
    expect(templateProblem(err(404, 'not_found'), 'x')).toMatchObject({ kind: 'gone' });
    expect(templateProblem(err(500, 'internal'), 'x')).toEqual({ kind: 'other' });
    expect(templateProblem(new Error('boom'), 'x')).toEqual({ kind: 'other' });
    expect(templateProblem(null, 'x')).toBeNull();
  });
});

describe('starting it', () => {
  it('titles it by the preset, the saved plan’s name, or as the builder names a draft', () => {
    const b = initialBuilder('quant', 'cpp');
    expect(startPlan(b, quant, names)).toEqual({
      plan: { preset: 'trader', stages: trader },
      title: 'Trader',
    });
    const onSaved = choose(b, { kind: 'saved', ...mine }, quant);
    expect(startPlan(onSaved, quant, names)).toEqual({
      plan: { preset: null, stages: mine.stages },
      title: 'Mine',
    });
    const draft = edit(b, [game], quant).next;
    expect(startPlan(draft, quant, names)).toEqual({
      plan: { preset: 'trader', stages: [game] },
      title: 'Custom interview',
    });
    const one = { ...draft, draft: { preset: null, stages: [twoSum], template: null } };
    expect(startPlan(one, quant, names).title).toBe('Two Sum');
  });

  it('names what is selected, for the confirm', () => {
    const b = initialBuilder('quant', 'cpp');
    expect(selectionLabel(b, quant, names)).toBe('Trader');
    expect(selectionLabel(choose(b, { kind: 'saved', ...mine }, quant), quant, names)).toBe('Mine');
  });
});

describe('fitting to the content', () => {
  it('fits the draft and the preview, and keeps the builder when nothing changes', () => {
    const l = linkFromParams(new URLSearchParams('problem=two-sum'), 'quant', 'python');
    if (!l) throw new Error('no link');
    const b = applyLink(withWork(), l);
    const same = fitBuilder(b, (s) => s);
    expect(same).toBe(b);
    const fitted = fitBuilder(b, (stages) =>
      stages.map((s) => (s.kind === 'coding' ? { ...s, language: 'cpp' as const } : s)),
    );
    expect(fitted.preview?.stages).toEqual([{ ...twoSum }]);
    expect(fitted.draft).toBe(b.draft);
  });
});

describe('remembered in this browser', () => {
  it('comes back as it was stored', () => {
    const b = choose(withWork(), { kind: 'saved', ...mine }, quant);
    expect(parseStoredBuilder(JSON.parse(JSON.stringify(toStored(b))), 'quant', 'java')).toEqual({
      ...b,
      preview: null,
    });
    const custom = choose(withWork(), { kind: 'custom' }, quant);
    expect(parseStoredBuilder(toStored(custom), 'quant', 'java')).toEqual(custom);
  });

  it('falls back to the default preset and no draft when it is missing, stale or invalid', () => {
    const fallback = initialBuilder('quant', 'java');
    expect(parseStoredBuilder(null, 'quant', 'java')).toEqual(fallback);
    expect(parseStoredBuilder({ v: 3 }, 'quant', 'java')).toEqual(fallback);
    expect(
      parseStoredBuilder(
        { v: 2, language: 'cpp', selection: { kind: 'custom' }, draft: { stages: [] } },
        'quant',
        'java',
      ),
    ).toEqual(fallback);
    expect(
      parseStoredBuilder(
        {
          v: 2,
          language: 'cpp',
          selection: { kind: 'custom' },
          draft: { preset: null, stages: [{ kind: 'game', durationMin: 99 }], template: null },
        },
        'quant',
        'java',
      ),
    ).toEqual(fallback);
  });

  it('forgets a preset of another track, and Custom without a draft', () => {
    const otherTrack = parseStoredBuilder(
      {
        v: 2,
        language: 'cpp',
        selection: { kind: 'preset', id: 'coding-round' },
        draft: { preset: 'coding-round', stages: [game], template: null },
      },
      'quant',
      'cpp',
    );
    expect(otherTrack.selection).toEqual({ kind: 'preset', id: 'trader' });
    expect(otherTrack.draft).toEqual({ preset: null, stages: [game], template: null });
    expect(
      parseStoredBuilder(
        { v: 2, language: 'cpp', selection: { kind: 'custom' }, draft: null },
        'quant',
        'cpp',
      ).selection,
    ).toEqual({ kind: 'preset', id: 'trader' });
  });

  it('migrates the plan stored before: a preset it still is, else the draft', () => {
    const asPreset = parseStoredBuilder(
      {
        v: 1,
        preset: 'trader',
        stages: presetStages(preset('trader'), 'python'),
        language: 'python',
      },
      'quant',
      'cpp',
    );
    expect(asPreset).toEqual({ ...initialBuilder('quant', 'python') });
    const custom = parseStoredBuilder(
      { v: 1, preset: 'trader', stages: [questions, game, game], language: 'java' },
      'quant',
      'cpp',
    );
    expect(custom.selection).toEqual({ kind: 'custom' });
    expect(custom.stored).toEqual({ kind: 'custom' });
    expect(custom.draft).toEqual({
      preset: 'trader',
      stages: [questions, game, game],
      template: null,
    });
    expect(custom.language).toBe('java');
    // A v1 plan from a preset of the other track keeps its stages but not the preset.
    expect(
      parseStoredBuilder(
        { v: 1, preset: 'trader', stages: [game], language: 'cpp' },
        'software',
        'cpp',
      ).draft,
    ).toEqual({ preset: null, stages: [game], template: null });
    // A broken v1 plan is the default.
    expect(
      parseStoredBuilder(
        { v: 1, preset: null, stages: [{ kind: 'game', durationMin: 99 }], language: 'cpp' },
        'quant',
        'cpp',
      ),
    ).toEqual(initialBuilder('quant', 'cpp'));
  });
});
