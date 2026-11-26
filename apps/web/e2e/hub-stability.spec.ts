/**
 * The Interviews and Quizzes pages hold still: no sideways shift between pages, views or when an
 * overlay opens, and no focus ring left on a tab after a click or tap.
 */
import { expect, type Locator, type Page, test } from '@playwright/test';
import { setup } from './helpers';

/** Where the header logo, the page title and the tab bar start, in viewport px. */
const anchors = (page: Page) =>
  page.evaluate(() => {
    const x = (sel: string) => {
      const el = document.querySelector(sel);
      if (!el) throw new Error(`missing ${sel}`);
      return Math.round(el.getBoundingClientRect().x * 10) / 10;
    };
    return { logo: x('header a'), title: x('main h1'), tabs: x('main [role=tablist]') };
  });

const ring = (el: Locator) =>
  el.evaluate((e) => ({
    focused: document.activeElement === e,
    focusVisible: e.matches(':focus-visible'),
    outline: getComputedStyle(e).outlineStyle,
  }));

// Headless Chromium hides scrollbars by default; these take layout width, as on Windows.
test.use({ launchOptions: { ignoreDefaultArgs: ['--hide-scrollbars'] } });

test.describe('with classic scrollbars', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('nothing shifts sideways between pages, views and overlays', async ({ page }) => {
    await setup(page);
    await page.goto('/dashboard');
    await expect(page.getByRole('region', { name: 'Problem library' })).toBeVisible();
    // The start view is taller than the window, so it has a scrollbar that takes width.
    expect(
      await page.evaluate(() => window.innerWidth - document.documentElement.clientWidth),
    ).toBeGreaterThan(0);
    const at = await anchors(page);

    await page.getByRole('combobox', { name: 'Topic' }).click();
    await expect(page.getByRole('listbox')).toBeVisible();
    expect(await anchors(page), 'select open').toEqual(at);
    await page.keyboard.press('Escape');

    await page.getByRole('button', { name: 'Account menu' }).click();
    await expect(page.getByRole('menu')).toBeVisible();
    expect(await anchors(page), 'menu open').toEqual(at);
    await page.keyboard.press('Escape');

    await page.getByRole('tab', { name: /^History/ }).click();
    await expect(page.getByRole('table')).toBeVisible();
    // History fits the window: no scrollbar, and still no shift.
    expect(
      await page.evaluate(
        () => document.documentElement.scrollHeight <= document.documentElement.clientHeight,
      ),
    ).toBe(true);
    expect(await anchors(page), 'interviews history').toEqual(at);

    await page
      .getByRole('button', { name: /^Delete interview:/ })
      .first()
      .click();
    await expect(page.getByRole('dialog')).toBeVisible();
    expect(await anchors(page), 'dialog open').toEqual(at);
    await page.keyboard.press('Escape');

    await page.getByRole('link', { name: 'Quizzes' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Quizzes' })).toBeVisible();
    await expect(page.getByRole('tab', { name: /^History/ })).toBeVisible();
    expect(await anchors(page), 'quizzes start').toEqual(at);
    await page.getByRole('tab', { name: /^History/ }).click();
    expect(await anchors(page), 'quizzes history').toEqual(at);
  });
});

test.describe('page tabs focus ring', () => {
  for (const [path, first] of [
    ['/dashboard', /^New interview/],
    ['/quiz', /^Start a quiz/],
  ] as const) {
    test(`a click on ${path} leaves no ring; the keyboard still gets one`, async ({ page }) => {
      await setup(page);
      // A fresh load, with nothing focused yet, is when the ring used to show.
      await page.goto(path);
      const history = page.getByRole('tab', { name: /^History/ });
      const start = page.getByRole('tab', { name: first });
      await history.click();
      await expect(history).toHaveAttribute('aria-selected', 'true');
      expect(await ring(history)).toEqual({ focused: true, focusVisible: false, outline: 'none' });
      await start.click();
      expect(await ring(start)).toEqual({ focused: true, focusVisible: false, outline: 'none' });
      expect(await ring(page.getByRole('tabpanel'))).toMatchObject({ focusVisible: false });

      // From the first tab, ArrowLeft wraps to the last one (History) however many tabs there are.
      await page.keyboard.press('ArrowLeft');
      await expect(history).toHaveAttribute('aria-selected', 'true');
      expect(await ring(history)).toEqual({ focused: true, focusVisible: true, outline: 'solid' });
    });
  }

  test.describe('touch', () => {
    test.use({ hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 } });

    test('a tap leaves no ring', async ({ page }) => {
      await setup(page);
      await page.goto('/quiz');
      const history = page.getByRole('tab', { name: /^History/ });
      await history.tap();
      await expect(history).toHaveAttribute('aria-selected', 'true');
      expect(await ring(history)).toMatchObject({ focusVisible: false, outline: 'none' });
    });
  });
});
