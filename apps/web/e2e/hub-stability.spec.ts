/**
 * The track tabs hold still: no sideways shift between the tabs of a track, between the tracks
 * (by the header's switch), between views or when an overlay opens, and no focus ring left on a
 * page tab, a header tab or the switch after a click or tap.
 */
import { expect, type Locator, type Page, test } from '@playwright/test';
import { setup } from './helpers';

/**
 * Where the header logo, the track switch, the page title and the tab bar start, in viewport px.
 * A page without a tab bar (the Quant track's Interviews, for now) has null there.
 */
const anchors = (page: Page) =>
  page.evaluate(() => {
    const x = (sel: string, optional = false) => {
      const el = document.querySelector(sel);
      if (!el) {
        if (optional) return null;
        throw new Error(`missing ${sel}`);
      }
      return Math.round(el.getBoundingClientRect().x * 10) / 10;
    };
    return {
      logo: x('header a'),
      track: x('header [data-testid=track-switch]'),
      title: x('main h1'),
      tabs: x('main [role=tablist]', true),
    };
  });

const ring = (el: Locator) =>
  el.evaluate((e) => ({
    focused: document.activeElement === e,
    focusVisible: e.matches(':focus-visible'),
    outline: getComputedStyle(e).outlineStyle,
  }));

/** Nothing on the page shows a keyboard focus ring. */
const noRing = (page: Page) =>
  expect
    .poll(() => page.evaluate(() => document.querySelector(':focus-visible')?.outerHTML ?? null))
    .toBeNull();

const header = (page: Page) => page.getByRole('banner');

// Headless Chromium hides scrollbars by default; these take layout width, as on Windows.
test.use({ launchOptions: { ignoreDefaultArgs: ['--hide-scrollbars'] } });

test.describe('with classic scrollbars', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('nothing shifts sideways between tabs, tracks, views and overlays', async ({ page }) => {
    await setup(page);
    await page.goto('/software/interviews');
    await expect(page.getByRole('region', { name: 'Problem library' })).toBeVisible();
    // The start view is taller than the window, so it has a scrollbar that takes width.
    expect(
      await page.evaluate(() => window.innerWidth - document.documentElement.clientWidth),
    ).toBeGreaterThan(0);
    const at = await anchors(page);
    const same = async (what: string, tabs = true) =>
      expect(await anchors(page), what).toEqual(tabs ? at : { ...at, tabs: null });

    await page.getByRole('combobox', { name: 'Topic' }).click();
    await expect(page.getByRole('listbox')).toBeVisible();
    await same('select open');
    await page.keyboard.press('Escape');

    await page.getByRole('button', { name: 'Account menu' }).click();
    await expect(page.getByRole('menu')).toBeVisible();
    await same('menu open');
    await page.keyboard.press('Escape');

    await page.getByRole('tab', { name: /^History/ }).click();
    await expect(page.getByRole('table')).toBeVisible();
    // History fits the window: no scrollbar, and still no shift.
    expect(
      await page.evaluate(
        () => document.documentElement.scrollHeight <= document.documentElement.clientHeight,
      ),
    ).toBe(true);
    await same('interviews history');

    await page
      .getByRole('button', { name: /^Delete interview:/ })
      .first()
      .click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await same('dialog open');
    await page.keyboard.press('Escape');

    const tabs = header(page).getByRole('navigation', { name: 'Main' });
    await tabs.getByRole('link', { name: 'Practice' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Practice' })).toBeVisible();
    await expect(page.getByRole('tab', { name: /^History/ })).toBeVisible();
    await same('software practice');
    await page.getByRole('tab', { name: /^History/ }).click();
    await same('software practice history');

    await tabs.getByRole('link', { name: 'Roadmap' }).click();
    await expect(page.getByTestId('path-step').first()).toBeVisible();
    await same('software roadmap');
    await page.getByRole('tab', { name: 'Topic maps' }).click();
    await expect(page.getByTestId('roadmap-node').first()).toBeVisible();
    await same('software topic maps');

    // Across the switch: the same tab of the other track, in the same place.
    await header(page).getByRole('navigation', { name: 'Track' }).getByRole('link').click();
    await expect(page).toHaveURL(/\/quant\/roadmap\?view=maps$/);
    await expect(page.getByTestId('roadmap-node').first()).toBeVisible();
    await same('quant topic maps');
    await page.getByRole('tab', { name: 'Study path' }).click();
    await expect(page.getByTestId('path-step').first()).toBeVisible();
    await same('quant roadmap');

    await tabs.getByRole('link', { name: 'Practice' }).click();
    await expect(page.getByTestId('drill-card')).toBeVisible();
    await same('quant practice');

    await tabs.getByRole('link', { name: 'Interviews' }).click();
    await expect(page.getByTestId('round-setup')).toBeVisible();
    await same('quant interviews', false);
  });
});

test.describe('focus rings', () => {
  for (const [path, first, second] of [
    ['/software/interviews', /^New interview/, /^History/],
    ['/quant/practice', /^Start a quiz/, /^History/],
    ['/software/roadmap', /^Study path/, /^Topic maps/],
  ] as const) {
    test(`a click on ${path}'s tabs leaves no ring; the keyboard still gets one`, async ({
      page,
    }) => {
      await setup(page);
      // A fresh load, with nothing focused yet, is when the ring used to show.
      await page.goto(path);
      const other = page.getByRole('tab', { name: second });
      const start = page.getByRole('tab', { name: first });
      await other.click();
      await expect(other).toHaveAttribute('aria-selected', 'true');
      expect(await ring(other)).toEqual({ focused: true, focusVisible: false, outline: 'none' });
      await start.click();
      expect(await ring(start)).toEqual({ focused: true, focusVisible: false, outline: 'none' });
      // The page's own panel (the library has tabs of its own inside it).
      expect(await ring(page.getByRole('tabpanel', { name: first }))).toMatchObject({
        focusVisible: false,
      });

      // From the first tab, ArrowLeft wraps to the last one however many tabs there are.
      await page.keyboard.press('ArrowLeft');
      await expect(other).toHaveAttribute('aria-selected', 'true');
      expect(await ring(other)).toEqual({ focused: true, focusVisible: true, outline: 'solid' });
    });
  }

  test('a click on a header tab or the track switch leaves no ring', async ({ page }) => {
    await setup(page);
    await page.goto('/software/practice');
    const tabs = header(page).getByRole('navigation', { name: 'Main' });
    await tabs.getByRole('link', { name: 'Roadmap' }).click();
    await expect(page).toHaveURL(/\/software\/roadmap$/);
    await noRing(page);
    await header(page).getByRole('navigation', { name: 'Track' }).getByRole('link').click();
    await expect(page).toHaveURL(/\/quant\/roadmap$/);
    await noRing(page);
  });

  test.describe('touch', () => {
    test.use({ hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 } });

    test('a tap leaves no ring, on a page tab or from the track menu', async ({ page }) => {
      await setup(page);
      await page.goto('/software/practice');
      const history = page.getByRole('tab', { name: /^History/ });
      await history.tap();
      await expect(history).toHaveAttribute('aria-selected', 'true');
      expect(await ring(history)).toMatchObject({ focusVisible: false, outline: 'none' });

      await page.getByRole('button', { name: 'Track: Software' }).tap();
      await page.getByRole('menuitem', { name: /^Quant/ }).tap();
      await expect(page).toHaveURL(/\/quant\/practice\?view=history$/);
      await noRing(page);
    });
  });
});
