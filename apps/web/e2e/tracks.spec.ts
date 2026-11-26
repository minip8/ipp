/**
 * The site tracks: the first-visit question, the header's track switch and tabs, remembering the
 * track, and the old URLs (`/dashboard`, `/new`, `/quiz`, `/quant`) sending people on.
 */
import { expect, type Page, test } from '@playwright/test';
import { ENDED_PAD_ID, QUIZ_ATTEMPT_ID } from './fixtures';
import { setup } from './helpers';

const header = (page: Page) => page.getByRole('banner');
const trackSwitch = (page: Page) => header(page).getByRole('navigation', { name: 'Track' });
const tabs = (page: Page) => header(page).getByRole('navigation', { name: 'Main' });
const current = (page: Page) => trackSwitch(page).locator('[aria-current]');

test.describe('the first visit', () => {
  test('asks once at the home, saves the choice and lands in that track with the query', async ({
    page,
  }) => {
    const b = await setup(page, (b) => {
      b.track = null;
    });
    await page.goto('/dashboard?view=history');
    const chooser = page.getByTestId('track-chooser');
    await expect(page.getByRole('heading', { name: 'What are you preparing for?' })).toBeVisible();
    await expect(chooser.getByRole('button')).toHaveCount(2);
    await expect(chooser.getByRole('button', { name: /^Software/ })).toContainText(
      'Coding problems with an AI interviewer',
    );
    await chooser.getByRole('button', { name: /^Quant/ }).click();
    await expect(page).toHaveURL(/\/quant\/interviews\?view=history$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Interviews' })).toBeVisible();
    await expect(current(page)).toHaveText('Quant');
    expect(b.trackSaves).toEqual(['quant']);

    // Remembered: the home goes straight on, and never asks again.
    await page.goto('/dashboard');
    await expect(page).toHaveURL(/\/quant\/interviews$/);
    await expect(page.getByTestId('track-chooser')).toHaveCount(0);
    expect(b.trackSaves).toEqual(['quant']);
  });

  test('/new asks too, and choosing Software keeps a coding query', async ({ page }) => {
    const b = await setup(page, (b) => {
      b.track = null;
    });
    await page.goto('/new?view=history');
    await page.getByTestId('choose-software').click();
    await expect(page).toHaveURL(/\/software\/interviews\?view=history$/);
    await expect(page.getByRole('region', { name: 'Finished interviews' })).toBeVisible();
    expect(b.trackSaves).toEqual(['software']);
  });

  test('a first visit straight to a track page is not asked, and sets the track', async ({
    page,
  }) => {
    const b = await setup(page, (b) => {
      b.track = null;
    });
    await page.goto('/quant/practice');
    await expect(page.getByRole('heading', { level: 1, name: 'Practice' })).toBeVisible();
    await expect.poll(() => b.trackSaves).toEqual(['quant']);
    await expect(page.getByTestId('track-chooser')).toHaveCount(0);
    expect(b.track).toBe('quant');
  });

  test('a link with a problem goes to Software without asking', async ({ page }) => {
    await setup(page, (b) => {
      b.track = null;
    });
    await page.goto('/dashboard?problem=lru-cache');
    await expect(page).toHaveURL(/\/software\/interviews\?problem=lru-cache$/);
    await expect(page.getByTestId('track-chooser')).toHaveCount(0);
  });
});

test.describe('the switch', () => {
  test('goes to the same tab in the other track, saves it, and the leaf pages follow', async ({
    page,
  }) => {
    const b = await setup(page);
    await page.goto('/software/practice?view=history');
    await expect(current(page)).toHaveText('Software');
    await expect(tabs(page).getByRole('link', { name: 'Practice' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    await trackSwitch(page).getByRole('link', { name: 'Quant' }).click();
    await expect(page).toHaveURL(/\/quant\/practice\?view=history$/);
    await expect(current(page)).toHaveText('Quant');
    await expect(page.getByRole('tab', { name: /^History/ })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await expect.poll(() => b.trackSaves).toEqual(['quant']);
    // The tabs now lead into the Quant track.
    await expect(tabs(page).getByRole('link', { name: 'Interviews' })).toHaveAttribute(
      'href',
      '/quant/interviews',
    );
    await expect(tabs(page).getByRole('link', { name: 'Roadmap' })).toHaveAttribute(
      'href',
      '/quant/roadmap',
    );

    // A leaf page names no track: the header shows the one just used, after a reload too.
    await page.goto(`/quiz/${QUIZ_ATTEMPT_ID}`);
    await expect(current(page)).toHaveText('Quant');
    await expect(tabs(page).getByRole('link', { name: 'Practice' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    await expect(page.getByRole('link', { name: 'Practice', exact: true }).last()).toHaveAttribute(
      'href',
      '/quant/practice',
    );
    // From a leaf page the switch goes to that tab of the other track.
    await trackSwitch(page).getByRole('link', { name: 'Software' }).click();
    await expect(page).toHaveURL(/\/software\/practice$/);
    await expect.poll(() => b.trackSaves).toEqual(['quant', 'software']);

    await page.goto(`/pads/${ENDED_PAD_ID}/report`);
    await expect(current(page)).toHaveText('Software');
    await trackSwitch(page).getByRole('link', { name: 'Quant' }).click();
    await expect(page).toHaveURL(/\/quant\/interviews$/);
    await expect(page.getByTestId('round-setup')).toBeVisible();
  });

  test('keeps the Roadmap view but not the other track’s topic', async ({ page }) => {
    await setup(page);
    await page.goto('/quant/roadmap?view=maps&roadmap=probability');
    await expect(page.getByRole('heading', { name: 'Probability roadmap' })).toBeVisible();
    await trackSwitch(page).getByRole('link', { name: 'Software' }).click();
    await expect(page).toHaveURL(/\/software\/roadmap\?view=maps$/);
    await expect(page.getByRole('tab', { name: 'Topic maps' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
  });

  test('is not shown to a guest, who never sends the track', async ({ page }) => {
    const b = await setup(page, (b) => {
      b.me = { ...b.me, guest: true };
    });
    await page.goto('/software/practice');
    await expect(page).toHaveURL(/\/sign-in\?next=/);
    expect(b.trackSaves).toEqual([]);
    expect(b.requests.filter((r) => r.path === '/api/me/track')).toEqual([]);
  });

  test('the account menu follows the track', async ({ page }) => {
    await setup(page, (b) => {
      b.track = 'quant';
    });
    await page.goto('/settings/ai-key');
    await page.getByRole('button', { name: 'Account menu' }).click();
    await expect(page.getByRole('menuitem', { name: 'Interviews' })).toHaveAttribute(
      'href',
      '/quant/interviews',
    );
    await expect(page.getByRole('menuitem', { name: 'Practice' })).toHaveAttribute(
      'href',
      '/quant/practice',
    );
  });
});

test.describe('old links', () => {
  for (const [from, track, to] of [
    ['/dashboard', 'software', /\/software\/interviews$/],
    ['/dashboard?view=history', 'quant', /\/quant\/interviews\?view=history$/],
    ['/dashboard?mode=host', 'software', /\/software\/interviews\?mode=host$/],
    ['/dashboard?problem=two-sum', 'quant', /\/software\/interviews\?problem=two-sum$/],
    ['/new?difficulty=medium&random=1', 'software', /\/software\/interviews\?difficulty=medium/],
    ['/quiz', 'quant', /\/quant\/practice$/],
    ['/quiz?topic=networking', 'software', /\/software\/practice\?topic=networking$/],
    ['/quiz?view=history', 'quant', /\/quant\/practice\?view=history$/],
    ['/quiz/topics', 'software', /\/software\/practice$/],
    [
      '/quiz?view=roadmap&roadmap=cpp&node=cpp-move-semantics',
      'software',
      /\/software\/roadmap\?view=maps&roadmap=cpp&node=cpp-move-semantics$/,
    ],
    // A topic of the other track only goes on to that track.
    ['/quiz?topic=probability', 'software', /\/quant\/practice\?topic=probability$/],
    [
      '/quiz?view=roadmap&roadmap=probability',
      'software',
      /\/quant\/roadmap\?view=maps&roadmap=probability$/,
    ],
    ['/quant', 'software', /\/quant\/interviews$/],
    ['/quant?path=researcher', 'software', /\/quant\/interviews\?path=researcher$/],
    ['/quant/drill', 'software', /\/quant\/practice\/drill$/],
    ['/quant/drill?seed=8', 'software', /\/quant\/practice\/drill\?seed=8$/],
    ['/software', 'quant', /\/software\/interviews$/],
  ] as const) {
    test(`${from} (remembered ${track})`, async ({ page }) => {
      await setup(page, (b) => {
        b.track = track;
      });
      await page.goto(from);
      await expect(page).toHaveURL(to);
      await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
    });
  }
});

test.describe('the header on a phone', () => {
  test.use({ viewport: { width: 360, height: 740 }, hasTouch: true, isMobile: true });

  test('fits on one line at 360px in both tracks', async ({ page }) => {
    await setup(page);
    for (const path of ['/software/practice', '/quant/roadmap', `/quiz/${QUIZ_ATTEMPT_ID}`]) {
      await page.goto(path);
      await expect(page.getByRole('button', { name: 'Account menu' })).toBeVisible();
      const box = await header(page).evaluate((h) => {
        const row = h.firstElementChild as HTMLElement;
        const items = [...row.querySelectorAll('a, button, [aria-current]')].map((e) =>
          e.getBoundingClientRect(),
        );
        return {
          rowHeight: row.getBoundingClientRect().height,
          overflow: row.scrollWidth - row.clientWidth,
          pageOverflow: document.documentElement.scrollWidth - window.innerWidth,
          tops: [
            ...new Set(
              items.filter((r) => r.width > 0).map((r) => Math.round(r.top + r.height / 2)),
            ),
          ],
          right: Math.max(...items.map((r) => r.right)),
        };
      });
      expect(box.overflow, path).toBeLessThanOrEqual(0);
      expect(box.pageOverflow, path).toBeLessThanOrEqual(0);
      // Inside the 16px gutter.
      expect(box.right, path).toBeLessThanOrEqual(344);
      // Everything sits on the one row (centred within a pixel or two of each other).
      expect(Math.max(...box.tops) - Math.min(...box.tops), path).toBeLessThanOrEqual(2);
      for (const name of ['Interviews', 'Practice', 'Roadmap'])
        await expect(tabs(page).getByRole('link', { name })).toBeVisible();
      // The switch is a menu behind the track's icon here.
      await expect(trackSwitch(page)).toBeHidden();
      await expect(header(page).getByRole('button', { name: /^Track: / })).toBeVisible();
    }
  });

  test('switches from the menu, and the theme is in the account menu', async ({ page }) => {
    const b = await setup(page);
    await page.goto('/software/roadmap');
    await expect(page.getByRole('button', { name: 'Change theme' })).toBeHidden();
    await page.getByRole('button', { name: 'Track: Software' }).tap();
    const menu = page.getByRole('menu');
    await expect(menu.getByRole('menuitem')).toHaveCount(2);
    await expect(menu.getByRole('menuitem', { name: /^Software/ })).toHaveAttribute(
      'aria-current',
      'true',
    );
    await menu.getByRole('menuitem', { name: /^Quant/ }).tap();
    await expect(page).toHaveURL(/\/quant\/roadmap$/);
    await expect(page.getByRole('button', { name: 'Track: Quant' })).toBeVisible();
    await expect.poll(() => b.trackSaves).toEqual(['quant']);

    await page.getByRole('button', { name: 'Account menu' }).tap();
    await page.getByRole('menuitemradio', { name: 'Dark' }).tap();
    await expect(page.locator('html')).toHaveClass(/dark/);
  });
});
