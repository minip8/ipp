import { expect, test } from '@playwright/test';
import { setup } from './helpers';

test('choosing a theme with the mouse does not leave the "Theme" tooltip open', async ({
  page,
}) => {
  await setup(page);
  await page.goto('/dashboard');
  const button = page.getByRole('button', { name: 'Change theme' });
  await button.click();
  await page.getByRole('menuitemradio', { name: 'Dark' }).click();
  await expect(page.locator('html')).toHaveClass(/dark/);
  await expect(page.getByRole('menu')).toHaveCount(0);
  // Focus returns to the button when the menu closes; that must not pop the tooltip.
  await page.waitForTimeout(900);
  await expect(page.getByRole('tooltip')).toHaveCount(0);
});

test('choosing a theme with the keyboard does not leave the tooltip open either', async ({
  page,
}) => {
  await setup(page);
  await page.goto('/dashboard');
  const button = page.getByRole('button', { name: 'Change theme' });
  await button.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('menu')).toBeVisible();
  await page.getByRole('menuitemradio', { name: 'Dark' }).focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('html')).toHaveClass(/dark/);
  await expect(button).toBeFocused();
  await page.waitForTimeout(900);
  await expect(page.getByRole('tooltip')).toHaveCount(0);
  // Escape closes the menu without the label appearing.
  await page.keyboard.press('Enter');
  await expect(page.getByRole('menu')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(button).toBeFocused();
  await page.waitForTimeout(900);
  await expect(page.getByRole('tooltip')).toHaveCount(0);
});

test('the theme tooltip still shows on hover and on keyboard focus', async ({ page }) => {
  await setup(page);
  await page.goto('/dashboard');
  const button = page.getByRole('button', { name: 'Change theme' });
  await button.hover();
  await expect(page.getByRole('tooltip')).toHaveText('Theme');
  await page.mouse.move(200, 400);
  await page.mouse.move(100, 500, { steps: 5 });
  await expect(page.getByRole('tooltip')).toHaveCount(0);
  await button.focus();
  await page.keyboard.press('Shift+Tab');
  await page.keyboard.press('Tab');
  await expect(button).toBeFocused();
  await expect(page.getByRole('tooltip')).toHaveText('Theme');
});
