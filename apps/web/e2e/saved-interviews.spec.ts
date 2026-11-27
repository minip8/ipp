/**
 * Saved plans in the interview builder ("Your interviews"): saving the custom draft under a name
 * (it is then listed and selected, and the draft, identical to it, goes), starting an interview
 * from one (its stages and its name as the title), renaming and deleting one, updating the plan a
 * draft came from or saving it as new, and the server's refusals (a name taken, the limit, a rate
 * limit). Only this track's are listed; one naming content that is gone is shown fitted.
 */
import { INTERVIEW_TEMPLATES_MAX, type InterviewStage } from '@ipp/contracts';
import { expect, type Page, test } from '@playwright/test';
import { setup } from './helpers';

const presets = (page: Page) => page.getByRole('radiogroup', { name: 'Presets' });
const radio = (page: Page, name: RegExp) => presets(page).getByRole('radio', { name });
const custom = (page: Page) => radio(page, /^Custom/);
const total = (page: Page) => page.getByTestId('plan-total');
const saveDialog = (page: Page) => page.getByRole('dialog', { name: 'Save this interview' });
const nameField = (page: Page) => page.getByRole('dialog').getByRole('textbox', { name: 'Name' });
const requests = (
  b: { requests: { method: string; path: string; body: unknown }[] },
  method: string,
  path: RegExp,
) => b.requests.filter((r) => r.method === method && path.test(r.path));

const TWO_GAMES: InterviewStage[] = [
  { kind: 'questions', topics: ['probability'], durationMin: 15 },
  { kind: 'game', durationMin: 10 },
  { kind: 'game', durationMin: 15 },
];

/** On Quant: Trader with a game added (a draft of 4 stages, 70 minutes). */
async function draft(page: Page) {
  await page.goto('/quant/interviews');
  await page.getByRole('button', { name: 'Add market-making game' }).click();
  await expect(custom(page)).toBeChecked();
  await expect(total(page)).toHaveText('4 stages · 70 min');
}

test('save the draft: it is listed and selected, and the draft goes', async ({ page }) => {
  const b = await setup(page);
  await draft(page);
  await page.getByTestId('save-plan').click();
  const dialog = saveDialog(page);
  await expect(dialog).toContainText('4 stages · 70 min');
  // Named from where it came from, focused and ready to type over.
  await expect(nameField(page)).toHaveValue('Trader (custom)');
  await expect(nameField(page)).toBeFocused();
  await page.keyboard.type('Trader, long');
  await page.keyboard.press('Enter');
  await expect(dialog).toBeHidden();
  expect(requests(b, 'POST', /^\/api\/interview-templates$/)[0]?.body).toMatchObject({
    name: 'Trader, long',
    track: 'quant',
    stages: [
      { kind: 'questions' },
      { kind: 'game' },
      { kind: 'questions' },
      { kind: 'game', durationMin: 15 },
    ],
  });
  await expect(page.getByText('Your interviews', { exact: true })).toBeVisible();
  await expect(radio(page, /^Trader, long/)).toBeChecked();
  // The Save button has gone with the dialog: focus is on the card now chosen.
  await expect(radio(page, /^Trader, long/)).toBeFocused();
  await expect(radio(page, /^Trader, long/)).toContainText('4 stages · 70 min');
  // Identical to the saved plan, the draft has gone; and there is nothing more to save.
  await expect(custom(page)).not.toContainText('stages');
  await expect(page.getByTestId('save-plan')).toHaveCount(0);
  // Kept on the server: a reload finds it, still selected.
  await page.reload();
  await expect(radio(page, /^Trader, long/)).toBeChecked();
  await expect(total(page)).toHaveText('4 stages · 70 min');
});

test('start an interview from a saved plan: its stages, its name as the title', async ({
  page,
}) => {
  const b = await setup(page, (x) => {
    x.interviews.addTemplate({ name: 'Two games', track: 'quant', stages: TWO_GAMES });
    x.interviews.addTemplate({ name: 'Elsewhere', track: 'software', stages: TWO_GAMES });
  });
  await page.goto('/quant/interviews');
  // Only this track's.
  await expect(page.getByTestId('saved-plan')).toHaveCount(1);
  await expect(radio(page, /^Two games/)).toContainText('3 stages · 40 min');
  await radio(page, /^Two games/).click();
  await expect(page.getByTestId('stage-summary')).toHaveText([
    'Probability · 2 questions · 15 min',
    'One game against the interviewer · 10 min',
    'One game against the interviewer · 15 min',
  ]);
  await page.getByRole('button', { name: 'Start the interview' }).click();
  await expect(page).toHaveURL(/\/pads\/[0-9a-f-]{36}$/);
  expect(requests(b, 'POST', /^\/api\/interviews$/)[0]?.body).toMatchObject({
    track: 'quant',
    preset: null,
    title: 'Two games',
    stages: TWO_GAMES,
  });
});

test('rename a saved plan, by its menu; a name taken is refused', async ({ page }) => {
  await setup(page, (x) => {
    x.interviews.addTemplate({ name: 'Two games', track: 'quant', stages: TWO_GAMES });
    x.interviews.addTemplate({
      name: 'Other',
      track: 'quant',
      stages: [TWO_GAMES[1] as InterviewStage],
    });
  });
  await page.goto('/quant/interviews');
  await radio(page, /^Two games/).click();
  await page.getByRole('button', { name: 'Actions for Two games' }).click();
  await page.getByRole('menuitem', { name: 'Rename' }).click();
  const dialog = page.getByRole('dialog', { name: 'Rename “Two games”' });
  await expect(nameField(page)).toHaveValue('Two games');
  await nameField(page).fill('other');
  await dialog.getByRole('button', { name: 'Rename' }).click();
  await expect(dialog.getByTestId('name-error')).toHaveText(
    'You already have an interview called “other” on this track. Choose another name.',
  );
  await expect(nameField(page)).toHaveAttribute('aria-invalid', 'true');
  await nameField(page).fill('Games night');
  await expect(dialog.getByTestId('name-error')).toHaveCount(0);
  await page.keyboard.press('Enter');
  await expect(dialog).toBeHidden();
  // Still selected, under its new name, and the list in order.
  await expect(radio(page, /^Games night/)).toBeChecked();
  await expect(page.getByTestId('saved-plan')).toHaveText([/^Games night/, /^Other/]);
  // Focus is back on the menu's button.
  await expect(page.getByRole('button', { name: 'Actions for Games night' })).toBeFocused();
});

test('delete a saved plan: the default preset when it was selected, the draft untouched', async ({
  page,
}) => {
  const b = await setup(page, (x) => {
    x.interviews.addTemplate({ name: 'Two games', track: 'quant', stages: TWO_GAMES });
  });
  await draft(page);
  await radio(page, /^Two games/).click();
  await page.getByRole('button', { name: 'Actions for Two games' }).click();
  await page.getByRole('menuitem', { name: 'Delete' }).click();
  const dialog = page.getByRole('dialog', { name: 'Delete “Two games”?' });
  await expect(dialog).toContainText('Interviews you started from it are kept');
  await dialog.getByRole('button', { name: 'Delete' }).click();
  await expect(dialog).toBeHidden();
  expect(requests(b, 'DELETE', /^\/api\/interview-templates\//)).toHaveLength(1);
  await expect(page.getByTestId('saved-plan')).toHaveCount(0);
  await expect(page.getByText('Your interviews', { exact: true })).toHaveCount(0);
  await expect(radio(page, /^Trader/)).toBeChecked();
  // Focus goes to the card now chosen, its menu's button being gone.
  await expect(radio(page, /^Trader/)).toBeFocused();
  await expect(custom(page)).toContainText('4 stages · 70 min');
});

test('a draft from a saved plan: update it, or save as new', async ({ page }) => {
  const b = await setup(page, (x) => {
    x.interviews.addTemplate({ name: 'Two games', track: 'quant', stages: TWO_GAMES });
  });
  await page.goto('/quant/interviews');
  await radio(page, /^Two games/).click();
  await page.getByRole('button', { name: 'Remove stage 3' }).click();
  await expect(custom(page)).toBeChecked();
  await page.getByTestId('save-plan').click();
  const dialog = saveDialog(page);
  const how = dialog.getByRole('radiogroup', { name: 'How to save it' });
  await expect(how.getByRole('radio', { name: /^Update “Two games”/ })).toBeChecked();
  await expect(nameField(page)).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Update' }).click();
  await expect(dialog).toBeHidden();
  const put = requests(b, 'PUT', /^\/api\/interview-templates\//);
  expect(put).toHaveLength(1);
  expect(put[0]?.body).toEqual({ stages: TWO_GAMES.slice(0, 2) });
  await expect(radio(page, /^Two games/)).toBeChecked();
  await expect(radio(page, /^Two games/)).toContainText('2 stages · 25 min');
  await expect(page.getByTestId('saved-plan')).toHaveCount(1);

  // Again, as a new one this time: the original stays as it is.
  await page.getByRole('button', { name: 'Add market-making game' }).click();
  await page.getByTestId('save-plan').click();
  await how.getByRole('radio', { name: /^Save as new/ }).click();
  await expect(nameField(page)).toHaveValue('Two games 2');
  await nameField(page).fill('Three games');
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(dialog).toBeHidden();
  expect(requests(b, 'PUT', /^\/api\/interview-templates\//)).toHaveLength(1);
  await expect(page.getByTestId('saved-plan')).toHaveText([/^Three games/, /^Two games/]);
  await expect(radio(page, /^Three games/)).toBeChecked();
  await expect(radio(page, /^Three games/)).toContainText('3 stages · 40 min');
  await expect(radio(page, /^Two games/)).toContainText('2 stages · 25 min');
});

test('a name taken on the track keeps the dialog open to change it', async ({ page }) => {
  await setup(page, (x) => {
    x.interviews.addTemplate({ name: 'Mine', track: 'quant', stages: TWO_GAMES });
    // Another track's may share the name.
    x.interviews.addTemplate({ name: 'Theirs', track: 'software', stages: TWO_GAMES });
  });
  await draft(page);
  await page.getByTestId('save-plan').click();
  await nameField(page).fill('MINE');
  await saveDialog(page).getByRole('button', { name: 'Save' }).click();
  await expect(saveDialog(page).getByTestId('name-error')).toContainText(
    'You already have an interview called “MINE” on this track.',
  );
  await nameField(page).fill('Theirs');
  await saveDialog(page).getByRole('button', { name: 'Save' }).click();
  await expect(saveDialog(page)).toBeHidden();
  await expect(radio(page, /^Theirs/)).toBeChecked();
});

test('the limit: one must be deleted first', async ({ page }) => {
  await setup(page, (x) => {
    for (let i = 0; i < INTERVIEW_TEMPLATES_MAX; i++)
      x.interviews.addTemplate({
        name: `Plan ${String(i).padStart(2, '0')}`,
        track: i % 2 ? 'quant' : 'software',
        stages: TWO_GAMES,
      });
  });
  await draft(page);
  await page.getByTestId('save-plan').click();
  await saveDialog(page).getByRole('button', { name: 'Save' }).click();
  await expect(saveDialog(page).getByTestId('save-problem')).toHaveText(
    `You have ${INTERVIEW_TEMPLATES_MAX} saved interviews, the most you can keep. Delete one of them first, then save this one.`,
  );
  await expect(saveDialog(page)).toBeVisible();
});

test('a rate limit counts down in the dialog', async ({ page }) => {
  const b = await setup(page, (x) => {
    x.fail(/POST \/api\/interview-templates$/, 429, {
      error: { code: 'rate_limited', message: 'Too many', retryAfter: 90 },
    });
  });
  await draft(page);
  await page.getByTestId('save-plan').click();
  await saveDialog(page).getByRole('button', { name: 'Save' }).click();
  await expect(saveDialog(page).getByTestId('save-problem')).toHaveText(
    'You have saved a lot in a short time. You can try again in 2 min.',
  );
  await expect(saveDialog(page).getByRole('button', { name: 'Save' })).toBeDisabled();
  expect(requests(b, 'POST', /^\/api\/interview-templates$/)).toHaveLength(1);
});

test('a saved plan naming content that is gone is shown fitted, and starts', async ({ page }) => {
  const b = await setup(page, (x) => {
    x.interviews.addTemplate({
      name: 'Old one',
      track: 'software',
      stages: [
        { kind: 'coding', problemSlug: 'removed-problem', language: 'python', durationMin: 45 },
        { kind: 'questions', topics: ['removed-topic', 'networking'], durationMin: 20 },
      ],
    });
  });
  await page.goto('/software/interviews');
  await radio(page, /^Old one/).click();
  await expect(page.getByTestId('stage-summary')).toHaveText([
    'Random problem · Python · 45 min',
    'Networking · 3 questions · 20 min',
  ]);
  await page.getByRole('button', { name: 'Start the interview' }).click();
  await expect(page).toHaveURL(/\/pads\/[0-9a-f-]{36}$/);
  expect(requests(b, 'POST', /^\/api\/interviews$/)[0]?.body).toMatchObject({
    title: 'Old one',
    stages: [
      { kind: 'coding', language: 'python', durationMin: 45 },
      { kind: 'questions', topics: ['networking'], durationMin: 20 },
    ],
  });
});

test.describe('at 390 px', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

  test('build, save, choose and rename on a phone', async ({ page }) => {
    await setup(page, (x) => {
      x.interviews.addTemplate({ name: 'Two games', track: 'quant', stages: TWO_GAMES });
    });
    await page.goto('/quant/interviews');
    await page.getByRole('button', { name: 'Add market-making game' }).tap();
    await expect(custom(page)).toBeChecked();
    await page.getByTestId('save-plan').tap();
    await nameField(page).fill('Phone plan');
    await saveDialog(page).getByRole('button', { name: 'Save' }).tap();
    await expect(saveDialog(page)).toBeHidden();
    await expect(radio(page, /^Phone plan/)).toBeChecked();
    await radio(page, /^Two games/).tap();
    await expect(total(page)).toHaveText('3 stages · 40 min');
    await page.getByRole('button', { name: 'Actions for Two games' }).tap();
    await page.getByRole('menuitem', { name: 'Rename' }).tap();
    await nameField(page).fill('Games');
    await page.getByRole('dialog').getByRole('button', { name: 'Rename' }).tap();
    await expect(radio(page, /^Games/)).toBeChecked();
    // Nothing wider than the screen.
    const width = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(width).toBeLessThanOrEqual(390);
  });
});
