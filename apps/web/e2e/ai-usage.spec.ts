/**
 * The "Daily limit" section of the AI key settings: today's usage, the defaults when nothing is
 * saved, saving each kind of cap, validation, going back to the defaults, the wording for a model
 * with no known price, and a phone-width layout.
 */
import { expect, type Page, test } from '@playwright/test';
import { aiKeyStatus } from './fixtures';
import { setup } from './helpers';
import type { MockBackend } from './mock-api';

async function open(page: Page, configure?: (b: MockBackend) => void) {
  const backend = await setup(page, configure);
  await page.goto('/settings/ai-key');
  const section = page.getByTestId('ai-daily-limit');
  await expect(section.getByRole('heading', { name: 'Daily limit' })).toBeVisible();
  await expect(section.getByTestId('ai-usage-today')).toBeVisible();
  return { backend, section };
}

const field = (section: ReturnType<Page['getByTestId']>, name: RegExp) =>
  section.getByRole('textbox', { name });

test('shows today’s usage and the defaults when nothing is saved', async ({ page }) => {
  const { section } = await open(page);
  await expect(section.getByText('Defaults', { exact: true })).toBeVisible();
  await expect(
    section.getByText(/the defaults apply: 1,500 messages, 5,000,000 input tokens/),
  ).toBeVisible();
  await expect(section.getByTestId('ai-cap-messages')).toContainText('42 of 1,500');
  await expect(section.getByTestId('ai-cap-inputTokens')).toContainText('1,250,000 of 5,000,000');
  await expect(section.getByTestId('ai-cap-outputTokens')).toContainText('38,000 of 500,000');
  // Spent today, said to be an estimate.
  await expect(section.getByText('$1.87')).toBeVisible();
  await expect(section.getByText(/estimate from list prices/)).toBeVisible();
  // The price of the key's default model.
  await expect(
    section.getByText(/claude-opus-5-5: about \$4 per million input tokens and \$20 per million/),
  ).toBeVisible();
  for (const name of [/Cost in US dollars/, /Tokens/, /Messages/])
    await expect(field(section, name)).toHaveValue('');
  await expect(section.getByRole('button', { name: 'Use the defaults' })).toHaveCount(0);
});

test('saves each kind of cap', async ({ page }) => {
  const { backend, section } = await open(page);
  const save = section.getByRole('button', { name: 'Save limits' });

  await field(section, /Cost in US dollars/).fill('$2.50');
  await save.click();
  await expect(page.getByText('Daily limit saved')).toBeVisible();
  await expect(section.getByText('Your limits', { exact: true })).toBeVisible();
  await expect(section.getByTestId('ai-cap-cost')).toContainText('$1.87 of $2.50');
  expect(backend.aiUsage.saves.at(-1)).toEqual({
    costMicros: 2_500_000,
    tokens: null,
    messages: null,
  });

  await field(section, /Cost in US dollars/).fill('');
  await field(section, /Tokens/).fill('2M');
  await save.click();
  await expect(section.getByTestId('ai-cap-tokens')).toContainText('1,288,000 of 2,000,000');
  expect(backend.aiUsage.saves.at(-1)).toEqual({
    costMicros: null,
    tokens: 2_000_000,
    messages: null,
  });
  // The form shows the saved cap the long way.
  await expect(field(section, /Tokens/)).toHaveValue('2,000,000');

  await field(section, /Tokens/).fill('');
  await field(section, /Messages/).fill('300');
  await save.click();
  await expect(section.getByTestId('ai-cap-messages')).toContainText('42 of 300');
  await expect(section.getByTestId('ai-cap-tokens')).toHaveCount(0);
  expect(backend.aiUsage.saves.at(-1)).toEqual({
    costMicros: null,
    tokens: null,
    messages: 300,
  });

  // All three at once; a reload shows them filled in.
  await field(section, /Cost in US dollars/).fill('10');
  await field(section, /Tokens/).fill('5,000,000');
  await save.click();
  await expect(section.getByTestId('ai-cap-cost')).toBeVisible();
  await page.reload();
  await expect(field(section, /Cost in US dollars/)).toHaveValue('10');
  await expect(field(section, /Tokens/)).toHaveValue('5,000,000');
  await expect(field(section, /Messages/)).toHaveValue('300');
});

test('validates before sending, and warns about a very low cap', async ({ page }) => {
  const { backend, section } = await open(page);
  const save = section.getByRole('button', { name: 'Save limits' });
  await save.click();
  await expect(section.getByRole('alert')).toHaveText(/Set at least one limit/);

  await field(section, /Cost in US dollars/).fill('2.555');
  await field(section, /Tokens/).fill('lots');
  await field(section, /Messages/).fill('0');
  await save.click();
  await expect(section.getByText(/Enter an amount in dollars/)).toBeVisible();
  await expect(section.getByText(/Enter a number of tokens/)).toBeVisible();
  await expect(section.getByText(/The smallest limit is 1\./)).toBeVisible();
  await expect(field(section, /Cost in US dollars/)).toHaveAttribute('aria-invalid', 'true');
  expect(backend.aiUsage.saves).toEqual([]);

  await field(section, /Cost in US dollars/).fill('');
  await field(section, /Tokens/).fill('');
  await field(section, /Messages/).fill('3');
  await expect(section.getByTestId('ai-limit-low')).toHaveText(
    /low enough to stop an interview in its first few minutes/,
  );
  // A warning, not a refusal.
  await save.click();
  await expect(section.getByTestId('ai-cap-messages')).toContainText('42 of 3');
  expect(backend.aiUsage.saves).toEqual([{ costMicros: null, tokens: null, messages: 3 }]);
});

test('"Use the defaults" removes the saved limits', async ({ page }) => {
  const { backend, section } = await open(page, (b) => {
    b.aiUsage.limits = { costMicros: 5_000_000, tokens: null, messages: 200 };
  });
  await expect(section.getByText('Your limits', { exact: true })).toBeVisible();
  await expect(field(section, /Cost in US dollars/)).toHaveValue('5');
  await section.getByRole('button', { name: 'Use the defaults' }).click();
  await expect(page.getByText('Back to the default limits')).toBeVisible();
  await expect(section.getByText('Defaults', { exact: true })).toBeVisible();
  await expect(field(section, /Cost in US dollars/)).toHaveValue('');
  await expect(field(section, /Messages/)).toHaveValue('');
  await expect(section.getByTestId('ai-cap-messages')).toContainText('42 of 1,500');
  expect(backend.aiUsage.saves).toEqual([null]);
});

test('says plainly when the model’s calls cannot count toward a cost limit', async ({ page }) => {
  const { section } = await open(page, (b) => {
    b.aiKey = aiKeyStatus('active', { provider: 'gemini' });
    b.aiUsage.priced = false;
    b.aiUsage.limits = { costMicros: 3_000_000, tokens: null, messages: null };
    b.aiUsage.usage = { ...b.aiUsage.usage, unpricedTokens: 12_000 };
  });
  await expect(section.getByTestId('ai-cost-untracked')).toHaveText(
    /Calls on gemini-4-hydrogen have no known price, so they will not count toward a cost limit\. If cost is your only limit, the default limit of 1,500 messages a day applies/,
  );
  // The dollar field stays usable.
  await expect(field(section, /Cost in US dollars/)).toBeEnabled();
  await expect(section.getByTestId('ai-usage-unpriced')).toHaveText(
    /12,000 tokens today were on a model with no known price/,
  );
  await expect(section.getByText('Messages (default)')).toBeVisible();
});

test.describe('on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('fits the width and stacks the fields', async ({ page }) => {
    const { section } = await open(page);
    const width = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(width).toBeLessThanOrEqual(390);
    const cost = await field(section, /Cost in US dollars/).boundingBox();
    const tokens = await field(section, /Tokens/).boundingBox();
    expect(cost && tokens && tokens.y > cost.y).toBe(true);
    await field(section, /Messages/).fill('50');
    await section.getByRole('button', { name: 'Save limits' }).click();
    await expect(section.getByTestId('ai-cap-messages')).toContainText('42 of 50');
  });
});
