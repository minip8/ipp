/**
 * The interview builder, the Interviews tab's "Practise with the AI" in both tracks: the track's
 * presets, the plan and its editing (a custom draft once changed, kept while other cards are
 * chosen, replaced only after asking, discarded), the problem dialog, topics of either track, the
 * limits, what is remembered per track (and the format stored before), links in (a preset, or a
 * preview that leaves the draft alone), and starting it (with and without a key, and the
 * server's refusals). Saved plans are saved-interviews.spec.ts.
 */
import { expect, type Page, test } from '@playwright/test';
import { aiKeyStatus } from './fixtures';
import { setup } from './helpers';

const presets = (page: Page) => page.getByRole('radiogroup', { name: 'Presets' });
const stages = (page: Page) => page.getByTestId('plan-stage');
const total = (page: Page) => page.getByTestId('plan-total');
const start = (page: Page) => page.getByRole('button', { name: 'Start the interview' });
const created = (b: { requests: { method: string; path: string; body: unknown }[] }) =>
  b.requests.filter((r) => r.method === 'POST' && r.path === '/api/interviews');

test.describe('presets', () => {
  test('Software starts on its first preset, and a preset replaces the plan', async ({ page }) => {
    await setup(page);
    await page.goto('/software/interviews');
    await expect(presets(page).getByRole('radio')).toHaveText([
      /^Coding round/,
      /^Technical screen/,
      /^Onsite loop/,
      /^Custom/,
    ]);
    await expect(presets(page).getByRole('radio', { name: /^Coding round/ })).toBeChecked();
    // Custom is always there to choose; with no draft it invites one.
    await expect(presets(page).getByRole('radio', { name: /^Custom/ })).toBeEnabled();
    await expect(presets(page).getByRole('radio', { name: /^Custom/ })).not.toBeChecked();
    await expect(page.getByTestId('save-plan')).toHaveCount(0);
    await expect(stages(page)).toHaveCount(1);
    await expect(stages(page).first()).toContainText('Random medium problem · C++ · 45 min');
    await expect(total(page)).toHaveText('1 stage · 45 min');

    await presets(page)
      .getByRole('radio', { name: /^Onsite loop/ })
      .click();
    await expect(stages(page)).toHaveCount(3);
    await expect(page.getByTestId('stage-summary')).toHaveText([
      'Random medium problem · C++ · 45 min',
      'C++, Operating systems and 3 more · 4 questions · 30 min',
      'Random hard problem · C++ · 60 min',
    ]);
    await expect(total(page)).toHaveText('3 stages · 135 min');
  });

  test('Quant has its own presets, Trader first', async ({ page }) => {
    await setup(page);
    await page.goto('/quant/interviews');
    await expect(presets(page).getByRole('radio')).toHaveText([
      /^Trader/,
      /^Researcher/,
      /^Quant developer/,
      /^Single round/,
      /^Custom/,
    ]);
    await expect(presets(page).getByRole('radio', { name: /^Trader/ })).toBeChecked();
    await expect(page.getByTestId('stage-summary')).toHaveText([
      'Probability, Brainteasers · 3 questions · 20 min',
      'One game against the interviewer · 15 min',
      'Betting & market making, Options & finance · 3 questions · 20 min',
    ]);
    await expect(total(page)).toHaveText('3 stages · 55 min');
  });

  test('links choose the plan: a preset, the old paths, a problem, a random pick', async ({
    page,
  }) => {
    await setup(page);
    await page.goto('/software/interviews?preset=technical-screen');
    await expect(presets(page).getByRole('radio', { name: /^Technical screen/ })).toBeChecked();
    await page.goto('/quant/interviews?path=researcher');
    await expect(presets(page).getByRole('radio', { name: /^Researcher/ })).toBeChecked();
    await page.goto('/software/interviews?problem=lru-cache');
    // A preview of its own, first among the cards.
    await expect(presets(page).getByRole('radio').first()).toHaveText(/^LRU Cache/);
    await expect(presets(page).getByRole('radio', { name: /^LRU Cache/ })).toBeChecked();
    await expect(page.getByTestId('stage-summary')).toHaveText(['LRU Cache · C++ · 45 min']);
    await page.goto('/software/interviews?random=1&difficulty=hard');
    await expect(page.getByTestId('stage-summary')).toHaveText([
      'Random hard problem · C++ · 45 min',
    ]);
  });
});

test.describe('editing the plan', () => {
  test('add, edit, reorder and remove stages; custom until a preset is picked again', async ({
    page,
  }) => {
    await setup(page);
    await page.goto('/software/interviews');
    await page.getByRole('button', { name: 'Add market-making game' }).click();
    await expect(stages(page)).toHaveCount(2);
    await expect(presets(page).getByRole('radio', { name: /^Custom/ })).toBeChecked();
    await expect(presets(page).getByRole('radio', { name: /^Custom/ })).toContainText(
      '2 stages · 60 min',
    );
    await expect(total(page)).toHaveText('2 stages · 60 min');
    // The new stage opens for editing.
    const game = stages(page).nth(1);
    await expect(game.getByTestId('stage-editor')).toBeVisible();
    await game.getByRole('radio', { name: '10 min' }).click();
    await expect(game.getByTestId('stage-summary')).toHaveText(
      'One game against the interviewer · 10 min',
    );

    // Move it up, by keyboard.
    await page.getByRole('button', { name: 'Move stage 2 up' }).focus();
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('stage-summary')).toHaveText([
      'One game against the interviewer · 10 min',
      'Random medium problem · C++ · 45 min',
    ]);
    await expect(page.getByRole('button', { name: 'Move stage 1 up' })).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Move stage 2 down' })).toBeDisabled();

    // Edit the coding stage: hard, Python, 60 minutes.
    await page.getByRole('button', { name: 'Edit stage 2' }).click();
    const coding = stages(page).nth(1);
    await coding.getByRole('radio', { name: 'Hard' }).click();
    await coding.getByRole('radio', { name: 'Python' }).click();
    await coding.getByRole('radio', { name: '60 min' }).click();
    await expect(coding.getByTestId('stage-summary')).toHaveText(
      'Random hard problem · Python · 60 min',
    );

    await page.getByRole('button', { name: 'Remove stage 1' }).click();
    await expect(stages(page)).toHaveCount(1);
    await expect(page.getByRole('button', { name: 'Remove stage 1' })).toBeDisabled();

    // Back on a preset: its plan, in the language last chosen; the draft stays on its card.
    await presets(page)
      .getByRole('radio', { name: /^Coding round/ })
      .click();
    await expect(page.getByTestId('stage-summary')).toHaveText([
      'Random medium problem · Python · 45 min',
    ]);
    await expect(presets(page).getByRole('radio', { name: /^Custom/ })).not.toBeChecked();
    await expect(presets(page).getByRole('radio', { name: /^Custom/ })).toContainText(
      '1 stage · 60 min',
    );
  });

  test('a coding stage on a problem chosen from the library, in a language it offers', async ({
    page,
  }) => {
    await setup(page);
    await page.goto('/software/interviews');
    await page.getByRole('button', { name: 'Edit stage 1' }).click();
    await page.getByRole('radio', { name: 'Choose a problem' }).click();
    const dialog = page.getByRole('dialog', { name: 'Choose a problem for stage 1' });
    await expect(dialog).toBeVisible();
    await dialog.getByRole('searchbox', { name: 'Search problems' }).fill('unique');
    await dialog.getByRole('button', { name: /^Unique Pointer/ }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByTestId('stage-problem')).toHaveText('Unique Pointer');
    await expect(page.getByTestId('stage-summary')).toHaveText('Unique Pointer · C++ · 45 min');
    await expect(
      page.getByRole('radiogroup', { name: 'Stage 1 language' }).getByRole('radio'),
    ).toHaveText(['C++']);
    // Back to a random pick.
    await page.getByRole('radio', { name: 'Random' }).click();
    await expect(page.getByTestId('stage-summary')).toHaveText(
      /^Random .*problem · C\+\+ · 45 min$/,
    );
  });

  test('a questions stage takes topics of either track, between one and eight', async ({
    page,
  }) => {
    await setup(page);
    await page.goto('/software/interviews?preset=technical-screen');
    await page.getByRole('button', { name: 'Edit stage 1' }).click();
    const picker = page.getByTestId('topic-picker');
    // The track's own topics first, then the others after a plain divider.
    await expect(picker.getByText('More topics')).toBeVisible();
    await expect(picker.getByRole('list', { name: 'More topics' })).toContainText('Probability');
    await picker.getByRole('checkbox', { name: 'Probability' }).check();
    await expect(page.getByTestId('stage-summary').first()).toHaveText(
      'C++, Operating systems and 4 more · 3 questions · 20 min',
    );
    // Uncheck down to one: the last stays.
    for (const t of [
      'C++',
      'Operating systems',
      'Concurrency',
      'Networking',
      'Computer architecture',
    ])
      await picker.getByRole('checkbox', { name: t }).uncheck();
    await expect(picker.getByRole('checkbox', { name: 'Probability' })).toBeDisabled();
    await expect(page.getByTestId('stage-summary').first()).toHaveText(
      'Probability · 3 questions · 20 min',
    );
    await page
      .getByRole('radiogroup', { name: 'Stage 1 length' })
      .getByRole('radio', { name: '45 min' })
      .click();
    await expect(page.getByTestId('stage-summary').first()).toHaveText(
      'Probability · 6 questions · 45 min',
    );
    // Eight at most.
    for (const t of [
      'C++',
      'Python',
      'Operating systems',
      'Concurrency',
      'Networking',
      'Computer architecture',
      'Brainteasers',
    ])
      await picker.getByRole('checkbox', { name: t }).check();
    await expect(picker).toContainText('8 topics chosen, the most one stage takes.');
    await expect(picker.getByRole('checkbox', { name: 'Statistics' })).toBeDisabled();
  });

  test('at most six stages, and at least one', async ({ page }) => {
    await setup(page);
    await page.goto('/quant/interviews');
    for (let i = 0; i < 3; i++)
      await page.getByRole('button', { name: 'Add coding problem' }).click();
    await expect(stages(page)).toHaveCount(6);
    await expect(page.getByRole('button', { name: 'Add questions' })).toBeDisabled();
    await expect(page.getByTestId('stages-full')).toContainText('at most 6 stages');
    for (let i = 0; i < 5; i++) await page.getByRole('button', { name: 'Remove stage 1' }).click();
    await expect(stages(page)).toHaveCount(1);
    await expect(page.getByRole('button', { name: 'Remove stage 1' })).toBeDisabled();
  });

  test('the plan is remembered per track; a broken stored plan falls back to the default', async ({
    page,
  }) => {
    await setup(page);
    await page.goto('/quant/interviews');
    await presets(page)
      .getByRole('radio', { name: /^Researcher/ })
      .click();
    await page.getByRole('button', { name: 'Add market-making game' }).click();
    await page.goto('/software/interviews');
    await presets(page)
      .getByRole('radio', { name: /^Onsite loop/ })
      .click();
    await page.goto('/quant/interviews');
    await expect(presets(page).getByRole('radio', { name: /^Custom/ })).toBeChecked();
    await expect(stages(page)).toHaveCount(3);
    await page.goto('/software/interviews');
    await expect(presets(page).getByRole('radio', { name: /^Onsite loop/ })).toBeChecked();

    await page.evaluate(() =>
      localStorage.setItem(
        'ipp:interview-plan:software',
        JSON.stringify({
          v: 1,
          preset: null,
          stages: [{ kind: 'game', durationMin: 99 }],
          language: 'cpp',
        }),
      ),
    );
    await page.reload();
    await expect(presets(page).getByRole('radio', { name: /^Coding round/ })).toBeChecked();
  });
});

const radio = (page: Page, name: RegExp) => presets(page).getByRole('radio', { name });
const custom = (page: Page) => radio(page, /^Custom/);
const replaceDialog = (page: Page) =>
  page.getByRole('dialog', { name: 'Replace your custom plan?' });

/** On Quant: Trader with a game added, then its first stage at 30 minutes (a draft of real work). */
async function buildDraft(page: Page) {
  await page.goto('/quant/interviews');
  await page.getByRole('button', { name: 'Add market-making game' }).click();
  await page.getByRole('button', { name: 'Edit stage 1' }).click();
  await page
    .getByRole('radiogroup', { name: 'Stage 1 length' })
    .getByRole('radio', { name: '30 min' })
    .click();
  await expect(custom(page)).toBeChecked();
  await expect(total(page)).toHaveText('4 stages · 80 min');
}

test.describe('the custom draft', () => {
  test('kept while a preset is chosen, and found intact on Custom', async ({ page }) => {
    await setup(page);
    await buildDraft(page);
    await expect(custom(page)).toContainText('4 stages · 80 min');
    await radio(page, /^Researcher/).click();
    await expect(stages(page)).toHaveCount(2);
    await expect(total(page)).toHaveText('2 stages · 50 min');
    // The card still says what the draft is.
    await expect(custom(page)).toContainText('4 stages · 80 min');
    await custom(page).click();
    await expect(page.getByTestId('stage-summary')).toHaveText([
      'Probability, Brainteasers · 4 questions · 30 min',
      'One game against the interviewer · 15 min',
      'Betting & market making, Options & finance · 3 questions · 20 min',
      'One game against the interviewer · 15 min',
    ]);
    // Still editable.
    await page.getByRole('button', { name: 'Remove stage 4' }).click();
    await expect(total(page)).toHaveText('3 stages · 65 min');
    await expect(custom(page)).toContainText('3 stages · 65 min');
  });

  test('Custom with no draft starts one from the plan shown', async ({ page }) => {
    await setup(page);
    await page.goto('/quant/interviews');
    await radio(page, /^Researcher/).click();
    await custom(page).click();
    await expect(custom(page)).toBeChecked();
    await expect(custom(page)).toContainText('2 stages · 50 min');
    await expect(stages(page)).toHaveCount(2);
    // Identical to Researcher: nothing to save yet, and changing it asks nothing.
    await expect(page.getByTestId('save-plan')).toHaveCount(0);
    await radio(page, /^Trader/).click();
    await page.getByRole('button', { name: 'Add market-making game' }).click();
    await expect(replaceDialog(page)).toHaveCount(0);
    await expect(custom(page)).toContainText('4 stages · 70 min');
  });

  test('editing a preset while the draft holds work asks first: keep it, or replace it', async ({
    page,
  }) => {
    await setup(page);
    await buildDraft(page);
    await radio(page, /^Researcher/).click();
    await page.getByRole('button', { name: 'Add market-making game' }).click();
    const dialog = replaceDialog(page);
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText('Your custom plan (4 stages · 80 min) is not saved.');
    await expect(dialog).toContainText('Changing Researcher starts a new custom plan');
    // Keep it: nothing changes.
    await dialog.getByRole('button', { name: 'Keep my custom plan' }).click();
    await expect(dialog).toBeHidden();
    await expect(radio(page, /^Researcher/)).toBeChecked();
    await expect(stages(page)).toHaveCount(2);
    await expect(custom(page)).toContainText('4 stages · 80 min');
    // Escape is keeping it too.
    await page.getByRole('button', { name: 'Add coding problem' }).click();
    await expect(dialog).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(stages(page)).toHaveCount(2);
    // Replace it: the edit becomes the draft.
    await page.getByRole('button', { name: 'Add market-making game' }).click();
    await dialog.getByRole('button', { name: 'Replace it' }).click();
    await expect(custom(page)).toBeChecked();
    await expect(total(page)).toHaveText('3 stages · 65 min');
    await expect(custom(page)).toContainText('3 stages · 65 min');
    await expect(stages(page).nth(2).getByTestId('stage-editor')).toBeVisible();
  });

  test('discarding the draft returns to the default preset', async ({ page }) => {
    await setup(page);
    await buildDraft(page);
    await page.getByRole('button', { name: 'Discard custom plan' }).click();
    const dialog = page.getByRole('dialog', { name: 'Discard your custom plan?' });
    await expect(dialog).toContainText('Its 4 stages · 80 min are gone for good');
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(custom(page)).toBeChecked();
    await page.getByRole('button', { name: 'Discard custom plan' }).click();
    await dialog.getByRole('button', { name: 'Discard' }).click();
    await expect(radio(page, /^Trader/)).toBeChecked();
    await expect(total(page)).toHaveText('3 stages · 55 min');
    await expect(custom(page)).not.toContainText('stages');
    await expect(page.getByRole('button', { name: 'Discard custom plan' })).toHaveCount(0);
    await page.reload();
    await expect(radio(page, /^Trader/)).toBeChecked();
    await expect(custom(page)).not.toContainText('stages');
  });

  test('a reload shows what was shown: the selection and the draft', async ({ page }) => {
    await setup(page);
    await buildDraft(page);
    await page.reload();
    await expect(custom(page)).toBeChecked();
    await expect(total(page)).toHaveText('4 stages · 80 min');
    await radio(page, /^Quant developer/).click();
    await page.reload();
    await expect(radio(page, /^Quant developer/)).toBeChecked();
    await expect(custom(page)).toContainText('4 stages · 80 min');
  });

  test('a plan remembered by the version before comes back as the draft', async ({ page }) => {
    await setup(page);
    await page.addInitScript(() => {
      localStorage.setItem(
        'ipp:interview-plan:quant',
        JSON.stringify({
          v: 1,
          preset: 'researcher',
          stages: [
            { kind: 'questions', topics: ['probability', 'statistics'], durationMin: 30 },
            { kind: 'game', durationMin: 10 },
          ],
          language: 'python',
        }),
      );
    });
    await page.goto('/quant/interviews');
    await expect(custom(page)).toBeChecked();
    await expect(page.getByTestId('stage-summary')).toHaveText([
      'Probability, Statistics · 4 questions · 30 min',
      'One game against the interviewer · 10 min',
    ]);
  });

  test('a link’s preview leaves the draft alone: ?problem= and ?topics=', async ({ page }) => {
    await setup(page);
    await page.goto('/software/interviews');
    await page.getByRole('button', { name: 'Add questions' }).click();
    await expect(custom(page)).toContainText('2 stages · 65 min');

    await page.goto('/software/interviews?problem=word-ladder');
    await expect(radio(page, /^Word Ladder/)).toBeChecked();
    await expect(page.getByTestId('stage-summary')).toHaveText(['Word Ladder · C++ · 45 min']);
    await expect(custom(page)).toContainText('2 stages · 65 min');
    // Back to the draft, and to the preview again: neither is lost.
    await custom(page).click();
    await expect(total(page)).toHaveText('2 stages · 65 min');
    await expect(page).toHaveURL(/\/software\/interviews$/);
    await radio(page, /^Word Ladder/).click();
    await expect(page.getByTestId('stage-summary')).toHaveText(['Word Ladder · C++ · 45 min']);

    await page.goto('/quant/interviews');
    await buildDraft(page);
    await page.goto('/quant/interviews?topics=statistics,nonsense,options');
    await expect(radio(page, /^Statistics, Options/)).toBeChecked();
    await expect(page.getByTestId('stage-summary')).toHaveText([
      'Statistics, Options & finance · 3 questions · 20 min',
    ]);
    // Editing the preview is editing: the draft holds work, so it asks.
    await page.getByRole('button', { name: 'Edit stage 1' }).click();
    await page
      .getByRole('radiogroup', { name: 'Stage 1 length' })
      .getByRole('radio', { name: '30 min' })
      .click();
    await replaceDialog(page).getByRole('button', { name: 'Keep my custom plan' }).click();
    await expect(radio(page, /^Statistics, Options/)).toBeChecked();
    await custom(page).click();
    await expect(total(page)).toHaveText('4 stages · 80 min');

    // Topics none of which exist: the default preset, the draft untouched.
    await page.goto('/quant/interviews?topics=nonsense');
    await expect(radio(page, /^Trader/)).toBeChecked();
    await expect(custom(page)).toContainText('4 stages · 80 min');
  });

  test('starting from a preview sends its stage and names it by the problem', async ({ page }) => {
    const b = await setup(page);
    await page.goto('/software/interviews?problem=lru-cache');
    await start(page).click();
    await expect(page).toHaveURL(/\/pads\/[0-9a-f-]{36}$/);
    expect(created(b)[0]?.body).toMatchObject({
      preset: null,
      title: 'LRU Cache',
      stages: [{ kind: 'coding', problemSlug: 'lru-cache' }],
    });
  });
});

test.describe('starting it', () => {
  test('creates the interview and opens the first stage’s pad', async ({ page }) => {
    const b = await setup(page);
    await page.goto('/quant/interviews');
    await page.getByRole('radio', { name: 'Tough' }).click();
    await start(page).click();
    await expect(page).toHaveURL(/\/pads\/[0-9a-f-]{36}$/);
    expect(created(b)[0]?.body).toMatchObject({
      track: 'quant',
      preset: 'trader',
      title: 'Trader',
      stages: [
        { kind: 'questions', topics: ['probability', 'brainteasers'], durationMin: 20 },
        { kind: 'game', durationMin: 15 },
        { kind: 'questions', topics: ['betting-market-making', 'options'], durationMin: 20 },
      ],
      interviewer: { style: 'tough', proactivity: 'normal', voice: false },
    });
    await expect(page.getByTestId('quant-workspace')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId('stage-chip')).toHaveText('Stage 1 of 3');
  });

  test('without a key, the key dialog first, then it starts', async ({ page }) => {
    const b = await setup(page, (x) => {
      x.aiKey = aiKeyStatus('missing');
    });
    await page.goto('/software/interviews');
    await expect(page.getByTestId('interview-key-prompt')).toBeVisible();
    await start(page).click();
    const dialog = page.getByRole('dialog', { name: 'Add your API key to start' });
    await expect(dialog).toBeVisible();
    await dialog
      .getByRole('textbox', { name: /API key/ })
      .fill('sk-ant-api03-test-key-0123456789abcdefghijklmnop-AAAA');
    await dialog.getByRole('button', { name: 'Save key and start' }).click();
    await expect(page).toHaveURL(/\/pads\/[0-9a-f-]{36}$/);
    expect(created(b)).toHaveLength(1);
  });

  test('the server’s refusals: a stage short of questions, too many starts', async ({ page }) => {
    const b = await setup(page, (x) => {
      x.fail(/POST \/api\/interviews$/, 429, {
        error: { code: 'rate_limited', message: 'Too many', retryAfter: 90 },
      });
      x.interviews.unavailable.add(0);
    });
    await page.goto('/quant/interviews');
    await start(page).click();
    await expect(page.getByTestId('start-error')).toHaveText(
      'You have started a lot of interviews in a short time. You can start another in 2 min.',
    );
    await expect(start(page)).toBeDisabled();
    b.failures = [];
    // Editing the plan clears the error (it was about the plan it was started with).
    await page.getByRole('button', { name: 'Edit stage 2' }).click();
    await page
      .getByRole('radiogroup', { name: 'Stage 2 length' })
      .getByRole('radio', { name: '10 min' })
      .click();
    await expect(page.getByTestId('start-error')).toHaveCount(0);
    await start(page).click();
    await expect(page.getByTestId('start-error')).toContainText(
      'Stage 1 cannot start: there are not enough questions on Probability, Brainteasers yet.',
    );
    await expect(page).toHaveURL(/\/quant\/interviews$/);
  });
});
