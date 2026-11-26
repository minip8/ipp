/**
 * Phone-sized checks (390 x 844, touch): the shell, public and account pages and the report
 * lay out without sideways scrolling and stay usable with a finger.
 */
import { expect, type Page, test } from '@playwright/test';
import { aiKeyStatus, ENDED_PAD_ID } from './fixtures';
import { setup } from './helpers';

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

async function expectNoHorizontalOverflow(page: Page) {
  const { scrollWidth, innerWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
  }));
  expect(scrollWidth, 'page is wider than the viewport').toBeLessThanOrEqual(innerWidth);
}

test('landing page fits the phone', async ({ page }) => {
  await setup(page, (b) => {
    b.signedIn = false;
  });
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Get started' })).toBeVisible();
  await expectNoHorizontalOverflow(page);
});

test('sign-in: fields bring up the right keyboards and fit', async ({ page }) => {
  await setup(page, (b) => {
    b.signedIn = false;
  });
  await page.goto('/sign-in');
  const email = page.getByLabel('Email');
  await expect(email).toHaveAttribute('type', 'email');
  await expect(email).toHaveAttribute('inputmode', 'email');
  await expect(email).toHaveAttribute('autocapitalize', 'none');
  await expect(page.getByLabel('Password')).toHaveAttribute('autocomplete', 'current-password');
  await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible();
  await expectNoHorizontalOverflow(page);
});

test('app header: logo, the three nav links, theme and account menu on one line', async ({
  page,
}) => {
  await setup(page);
  await page.goto('/dashboard');
  await expect(page.getByRole('heading', { level: 1, name: 'Interviews' })).toBeVisible();
  const nav = page.getByRole('navigation', { name: 'Main' });
  const quizzes = nav.getByRole('link', { name: 'Quizzes' });
  await expect(nav.getByRole('link')).toHaveText(['Interviews', 'Quant', 'Quizzes']);
  const menu = page.getByRole('button', { name: 'Account menu' });
  await expect(quizzes).toBeVisible();
  await expect(menu).toBeVisible();
  // Nothing in the header overlaps or wraps: the last link ends before the theme button starts.
  const linkBox = await quizzes.boundingBox();
  const themeBox = await page.getByRole('button', { name: 'Change theme' }).boundingBox();
  const menuBox = await menu.boundingBox();
  expect(linkBox && themeBox && linkBox.x + linkBox.width <= themeBox.x).toBe(true);
  expect(
    linkBox &&
      menuBox &&
      Math.abs(linkBox.y + linkBox.height / 2 - (menuBox.y + menuBox.height / 2)) < 4,
  ).toBe(true);
  await expectNoHorizontalOverflow(page);

  await quizzes.tap();
  await expect(page).toHaveURL(/\/quiz$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Quizzes' })).toBeVisible();
  await expect(quizzes).toHaveAttribute('aria-current', 'page');
  await expectNoHorizontalOverflow(page);

  // The account menu opens by touch and stays inside the viewport.
  await menu.tap();
  const panel = page.getByRole('menu');
  await expect(panel.getByRole('menuitem', { name: /AI key/ })).toBeVisible();
  const box = await panel.boundingBox();
  expect(box && box.x >= 0 && box.x + box.width <= 390).toBe(true);
});

test('AI key settings fit, and the provider list stays on screen', async ({ page }) => {
  await setup(page, (b) => {
    b.aiKey = aiKeyStatus('missing');
  });
  await page.goto('/settings/ai-key');
  await expect(page.getByRole('heading', { level: 1, name: 'AI key' })).toBeVisible();
  const input = page.getByRole('textbox', { name: /API key/ });
  await expect(input).toBeVisible();
  // 16px on touch screens, so iOS does not zoom when it takes focus.
  expect(await input.evaluate((el) => getComputedStyle(el).fontSize)).toBe('16px');
  await expectNoHorizontalOverflow(page);

  await page.getByRole('combobox', { name: 'Provider' }).tap();
  const list = page.getByRole('listbox');
  await expect(list).toBeVisible();
  const box = await list.boundingBox();
  expect(box && box.x >= 0 && box.x + box.width <= 390).toBe(true);
});

test('report: stacked, no sideways scroll, and the timeline scrubs by touch', async ({ page }) => {
  await setup(page);
  await page.goto(`/pads/${ENDED_PAD_ID}/report`);
  await expect(page.getByRole('heading', { level: 1, name: 'LRU Cache' })).toBeVisible();
  await expect(page.getByText('Strengths')).toBeVisible();
  const code = page.getByTestId('playback-code');
  await expect(code).toContainText('popitem(last=False)');
  await expectNoHorizontalOverflow(page);

  // The code view scrolls inside its own box, not the page.
  const codeBox = await code.boundingBox();
  expect(codeBox && codeBox.x >= 0 && codeBox.x + codeBox.width <= 390).toBe(true);

  // Tapping the start of the track seeks to the beginning (pointer events, not mouse only).
  const slider = page.getByRole('slider', { name: 'Playback position' });
  await slider.scrollIntoViewIfNeeded();
  const track = await slider.boundingBox();
  if (!track) throw new Error('no track');
  await page.touchscreen.tap(track.x + 0.5, track.y + track.height / 2);
  await expect(page.getByTestId('playback-time')).toContainText(/^0:0\d/);

  // Play and step buttons have a finger-sized hit area even though they look small.
  const play = page.getByRole('button', { name: 'Play', exact: true });
  const hit = await play.evaluate((el) => {
    const r = getComputedStyle(el, '::before');
    const b = el.getBoundingClientRect();
    return {
      height: b.height - Number.parseFloat(r.top) - Number.parseFloat(r.bottom),
      width: b.width - Number.parseFloat(r.left) - Number.parseFloat(r.right),
    };
  });
  expect(hit.height).toBeGreaterThanOrEqual(40);
  expect(hit.width).toBeGreaterThanOrEqual(40);
  await expectNoHorizontalOverflow(page);
});
