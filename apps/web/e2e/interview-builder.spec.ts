/**
 * The interview builder, the Interviews tab's "Practise with the AI" in both tracks: the track's
 * presets, the plan and its editing (custom once changed), the problem dialog, topics of either
 * track, the limits, the plan remembered per track, links in, and starting it (with and without
 * a key, and the server's refusals).
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
    await expect(presets(page).getByRole('radio', { name: /^Custom/ })).toBeDisabled();
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
      'Market-making game · 15 min',
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
    await expect(presets(page).getByRole('radio', { name: /^Custom/ })).toBeChecked();
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
    await expect(game.getByTestId('stage-summary')).toHaveText('Market-making game · 10 min');

    // Move it up, by keyboard.
    await page.getByRole('button', { name: 'Move stage 2 up' }).focus();
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('stage-summary')).toHaveText([
      'Market-making game · 10 min',
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

    // Back on a preset: its plan, in the language last chosen.
    await presets(page)
      .getByRole('radio', { name: /^Coding round/ })
      .click();
    await expect(page.getByTestId('stage-summary')).toHaveText([
      'Random medium problem · Python · 45 min',
    ]);
    await expect(presets(page).getByRole('radio', { name: /^Custom/ })).toBeDisabled();
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
