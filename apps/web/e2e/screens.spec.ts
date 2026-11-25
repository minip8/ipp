/** Visual review screenshots. Run with SCREENS=1 pnpm test:e2e screens. */
import { test } from '@playwright/test';
import { setup, shoot } from './helpers';

test.skip(!process.env.SCREENS, 'set SCREENS=1 to capture screenshots');

const WIDTHS = (process.env.SCREEN_WIDTHS ?? '1440,390').split(',').map(Number);
const ONLY = process.env.ONLY?.split(',');
const want = (name: string) => !ONLY || ONLY.some((o) => name.includes(o));

for (const width of WIDTHS) {
  test.describe(`at ${width}px`, () => {
    test.use({ viewport: { width, height: width < 600 ? 844 : 900 } });

    test('public screens', async ({ page }) => {
      await setup(page, (b) => {
        b.signedIn = false;
      });
      if (want('landing')) {
        await page.goto('/');
        await page.getByRole('heading', { level: 1 }).waitFor();
        await shoot(page, 'landing', { fullPage: true });
      }
      if (want('signin')) {
        await page.goto('/sign-in');
        await page.getByLabel('Email').waitFor();
        await shoot(page, 'signin');
      }
    });

    test('app screens', async ({ page }) => {
      await setup(page);
      if (want('home')) {
        await page.goto('/');
        await page.getByRole('button', { name: 'Account menu' }).waitFor();
        await shoot(page, 'home-signed-in');
      }
      if (want('dashboard')) {
        await page.goto('/dashboard');
        await page.getByText('History').waitFor();
        await page.waitForTimeout(300);
        await shoot(page, 'dashboard', { fullPage: true });
      }
      if (want('new')) {
        await page.goto('/new');
        await page.getByText('Two Sum').first().click();
        await page.waitForTimeout(600);
        await shoot(page, 'new', { fullPage: true });
      }
    });
  });
}
