import { expect, test } from '@playwright/test';
import { ENDED_PAD_ID, REPORT_PENDING, REPORT_READY } from './fixtures';
import { setup } from './helpers';

const url = `/pads/${ENDED_PAD_ID}/report`;

test('report shows the scorecard, stats and transcript', async ({ page }) => {
  await setup(page);
  await page.goto(url);
  await expect(page.getByRole('heading', { level: 1, name: 'LRU Cache' })).toBeVisible();

  // Stats
  await expect(page.getByText('42 min')).toBeVisible();
  await expect(page.getByText('Solved', { exact: true })).toBeVisible();

  // Recommendation is marked in the scale (not by colour alone)
  const scale = page.getByRole('list', { name: /Recommendation scale/ });
  await expect(scale.locator('[aria-current="true"]')).toHaveText('Hire');

  // Dimension meters
  await expect(page.getByRole('meter', { name: /Testing: 2 of 4/ })).toBeAttached();
  await expect(page.getByRole('meter', { name: /Communication: 4 of 4/ })).toBeAttached();
  await expect(page.getByText('Precise complexity analysis')).toBeVisible();

  // Transcript: proactive messages are labelled, runs are interleaved
  const transcript = page.getByRole('list', { name: 'Transcript' });
  await expect(transcript.getByText('Spoke up · greeting')).toBeVisible();
  await expect(transcript.getByText('What should happen with capacity 0?')).toBeVisible();
  await expect(transcript.getByText('Wrong answer').first()).toBeVisible();
});

test('scrubbing the playback changes the code', async ({ page }) => {
  await setup(page);
  await page.goto(url);
  const code = page.getByTestId('playback-code');
  // Opens at the end of the session: the final solution.
  await expect(code).toContainText('popitem(last=False)');

  const slider = page.getByRole('slider', { name: 'Playback position' });
  await slider.focus();
  await page.keyboard.press('Home');
  await expect(page.getByTestId('playback-time')).toContainText('0:00');
  // At the start the buffer holds the generated scaffold.
  await expect(code).toContainText('pass');
  await expect(code).not.toContainText('OrderedDict');

  // Step forward through a few changes; the solution grows.
  for (let i = 0; i < 6; i++) await page.keyboard.press('ArrowRight');
  await expect(code).toContainText('OrderedDict');
  await expect(code).not.toContainText('popitem');

  // Clicking a transcript timestamp seeks there.
  await page.getByRole('button', { name: 'Seek playback to 10:40' }).click();
  await expect(page.getByTestId('playback-time')).toContainText('10:40');

  await slider.focus();
  await page.keyboard.press('End');
  await expect(code).toContainText('popitem(last=False)');
});

test('pending report polls until the assessment is ready', async ({ page }) => {
  const backend = await setup(page, (b) => {
    b.report = REPORT_PENDING;
  });
  await page.goto(url);
  await expect(page.getByText('Writing your assessment…')).toBeVisible();
  // Stats are shown while the assessment is being written.
  await expect(page.getByText('Submissions')).toBeVisible();
  backend.report = REPORT_READY;
  await expect(page.getByRole('list', { name: /Recommendation scale/ })).toBeVisible({
    timeout: 10_000,
  });
  await expect(page.getByText('Writing your assessment…')).toHaveCount(0);
});

test('missing report explains access', async ({ page }) => {
  await setup(page);
  await page.goto('/pads/00000000-0000-4000-8000-00000000dead/report');
  await expect(page.getByText("This report does not exist or you don't have access")).toBeVisible();
});
