import { expect, test } from '@playwright/test';
import { setup } from './helpers';

test('signed-out visitors are sent to sign-in and come back after signing in', async ({ page }) => {
  const backend = await setup(page, (b) => {
    b.signedIn = false;
  });
  await page.goto('/dashboard');
  await expect(page).toHaveURL(/\/sign-in\?next=%2Fdashboard/);
  await expect(page.getByRole('button', { name: 'Continue with GitHub' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Continue with Google' })).toBeVisible();

  await page.getByLabel('Email').fill('ada@example.com');
  await page.getByLabel('Password').fill('nope');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(
    page.getByRole('alert').filter({ hasText: 'Invalid email or password' }),
  ).toBeVisible();
  await expect(page.getByLabel('Password')).toHaveAttribute('aria-invalid', 'true');

  await page.getByLabel('Password').fill('correct-horse');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Ada');
  expect(
    backend.requests.findLast((r) => r.path === '/api/auth/sign-in/email')?.body,
  ).toMatchObject({ email: 'ada@example.com', password: 'correct-horse' });
});

test('sign-in shows a countdown when rate limited', async ({ page }) => {
  const backend = await setup(page, (b) => {
    b.signedIn = false;
    b.githubAuth = false;
    b.googleAuth = false;
  });
  backend.fail(/sign-in\/email/, 429, {
    error: { code: 'rate_limited', message: 'Too many attempts.', retryAfter: 30 },
  });
  await page.goto('/sign-in');
  await expect(page.getByRole('button', { name: 'Continue with GitHub' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Continue with Google' })).toHaveCount(0);
  await page.getByLabel('Email').fill('ada@example.com');
  await page.getByLabel('Password').fill('correct-horse');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('button', { name: /Try again in \d+s/ })).toBeDisabled();
});

test('sign-up creates the account and opens the dashboard', async ({ page }) => {
  const backend = await setup(page, (b) => {
    b.signedIn = false;
  });
  await page.goto('/sign-up');
  await page.getByLabel('Name').fill('Ada Lovelace');
  await page.getByLabel('Email').fill('ada@example.com');
  await page.getByLabel('Password').fill('correct-horse');
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  expect(backend.requests.find((r) => r.path === '/api/auth/sign-up/email')?.body).toMatchObject({
    name: 'Ada Lovelace',
  });
});

test('Google sign-in starts the provider flow, and a linking failure is explained', async ({
  page,
}) => {
  const backend = await setup(page, (b) => {
    b.signedIn = false;
  });
  // The provider returned with an error: the email already belongs to a password account.
  await page.goto('/sign-in?error=account_not_linked');
  // Not the route announcer (also role=alert in production builds).
  await expect(page.getByRole('alert').filter({ hasText: 'already exists' })).toBeVisible();

  await page.route('**/api/auth/sign-in/social', (route) =>
    route.fulfill({ json: { url: '/sign-in?provider-visited=1', redirect: true } }),
  );
  await page.getByRole('button', { name: 'Continue with Google' }).click();
  await expect(page).toHaveURL(/provider-visited=1/);
  void backend;
});
