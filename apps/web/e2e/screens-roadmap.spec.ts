/**
 * Visual review screenshots for the quiz roadmap. Run with
 *   SCREENS=1 playwright test screens-roadmap      (ONLY=roadmap-cpp,... narrows it)
 */
import { expect, type Page, test } from '@playwright/test';
import { QUIZ_ROADMAP_FRESH } from './fixtures-quiz-roadmap';
import { shoot as rawShoot, setup } from './helpers';

test.skip(!process.env.SCREENS, 'set SCREENS=1 to capture screenshots');

const ONLY = process.env.ONLY?.split(',');
const want = (name: string) => !ONLY || ONLY.some((o) => name.includes(o));
const WIDTHS = (process.env.SCREEN_WIDTHS ?? '1440,390').split(',').map(Number);

async function shoot(page: Page, name: string) {
  await page.evaluate(() => window.scrollTo(0, 0));
  await rawShoot(page, name, { fullPage: true });
}

const TOPICS = [
  'cpp',
  'python',
  'computer-architecture',
  'operating-systems',
  'concurrency',
  'networking',
  'probability',
];

for (const width of WIDTHS) {
  test.describe(`roadmap at ${width}px`, () => {
    test.use({ viewport: { width, height: width < 600 ? 844 : 900 } });

    for (const topic of TOPICS) {
      const name = `roadmap-${topic}`;
      test(name, async ({ page }) => {
        test.skip(!want(name));
        await setup(page);
        const track = topic === 'probability' ? 'quant' : 'software';
        await page.goto(`/${track}/roadmap?view=maps&roadmap=${topic}`);
        await expect(page.getByTestId('roadmap-node').first()).toBeVisible();
        await page.waitForTimeout(300);
        await shoot(page, name);
      });
    }

    test('roadmap-fresh', async ({ page }) => {
      test.skip(!want('roadmap-fresh'));
      await setup(page, (b) => {
        b.quizRoadmap = QUIZ_ROADMAP_FRESH;
      });
      await page.goto('/software/roadmap?view=maps&roadmap=cpp');
      await expect(page.getByTestId('roadmap-node').first()).toBeVisible();
      await page.waitForTimeout(300);
      await shoot(page, 'roadmap-fresh');
    });

    test('roadmap-selected', async ({ page }) => {
      test.skip(!want('roadmap-selected'));
      await setup(page);
      await page.goto('/software/roadmap?view=maps&roadmap=cpp');
      await page.locator('[data-node="cpp-move-semantics"]').click();
      await expect(page.getByTestId('roadmap-details')).toBeVisible();
      await page.waitForTimeout(400);
      await shoot(page, 'roadmap-selected');
    });

    test('roadmap-related', async ({ page }) => {
      test.skip(!want('roadmap-related'));
      await setup(page);
      // An area with links to another topic's areas.
      await page.goto('/software/roadmap?view=maps&roadmap=cpp&node=cpp-concurrency');
      await expect(page.getByTestId('roadmap-details')).toBeVisible();
      await page.waitForTimeout(400);
      await shoot(page, 'roadmap-related');
    });

    // The study path (the Roadmap tab's default view), with its way into an interview.
    for (const track of ['software', 'quant'] as const) {
      const name = `roadmap-path-${track}`;
      test(name, async ({ page }) => {
        test.skip(!want(name));
        await setup(page);
        await page.goto(`/${track}/roadmap`);
        await expect(page.getByTestId('path-step').first()).toBeVisible();
        await page.waitForTimeout(300);
        await shoot(page, name);
      });
    }

    test('roadmap-loading', async ({ page }) => {
      test.skip(!want('roadmap-loading'));
      await setup(page);
      await page.route('**/api/quiz/roadmap', () => {
        /* never answers */
      });
      await page.goto('/software/roadmap?view=maps');
      await expect(page.getByRole('status', { name: 'Loading roadmap' })).toBeVisible();
      await shoot(page, 'roadmap-loading');
    });
  });
}
