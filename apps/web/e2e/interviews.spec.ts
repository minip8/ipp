/**
 * The Interviews tab, one page in both tracks: each lists only its own pads (`padTrack`: coding
 * pads and coding rooms in Software, quant rounds and quant rooms in Quant) under way and
 * finished, with its own figures and columns; the same "Practise with the AI | Interview someone"
 * switch in `?mode=host`; and the ways back from a pad and its report go to the pad's track.
 */
import { expect, type Page, test } from '@playwright/test';
import { ACTIVE_PAD_ID, ENDED_PAD_ID } from './fixtures';
import { QROOM_ENDED_PAD_ID } from './fixtures-quant-room';
import { QUANT_ENDED_PAD_ID, QUANT_PAD_ID } from './fixtures-quant-round';
import { setup } from './helpers';
import type { MockBackend } from './mock-api';

const stat = (page: Page, label: string) =>
  page.locator('main dl > div').filter({ hasText: label }).locator('dd');
const active = (page: Page) => page.getByTestId('active-pad');
const kind = (page: Page) => page.getByRole('radiogroup', { name: 'Kind of interview' });
const header = (page: Page) => page.getByRole('banner');

/** Both tracks' pads on the list: the coding fixtures, two quant rounds and a quant room. */
const withQuantPads = (b: MockBackend) => {
  b.useRoomBank();
  b.quant.listOnDashboard();
  b.quantRooms.listOnDashboard();
};

test.describe('each track lists its own pads', () => {
  test('Software: coding pads and rooms, no quant round or quant room', async ({ page }) => {
    await setup(page, withQuantPads);
    await page.goto('/software/interviews');
    await expect(page.getByRole('heading', { level: 1, name: 'Interviews' })).toBeVisible();
    await expect(active(page)).toHaveCount(1);
    await expect(active(page)).toContainText('Two Sum');
    await expect(stat(page, 'Interviews')).toHaveText('4');
    await expect(stat(page, 'Solved')).toHaveText('2');
    await expect(stat(page, 'Rounds')).toHaveCount(0);

    await page.getByRole('tab', { name: /^History/ }).click();
    await expect(page.getByRole('tab', { name: /^History/ })).toHaveText(/4/);
    const table = page.getByRole('table');
    await expect(table.getByRole('columnheader')).toHaveText([
      'Problem',
      'Language',
      'When',
      'Length',
      'Outcome',
      'Actions',
    ]);
    await expect(table.getByRole('row')).toHaveCount(5);
    await expect(table).not.toContainText('quant round');
    await expect(table.getByTestId('quant-badge')).toHaveCount(0);
  });

  test('Quant: rounds and quant rooms, with what makes sense for them', async ({ page }) => {
    await setup(page, withQuantPads);
    await page.goto('/quant/interviews');
    await expect(page.getByRole('heading', { level: 1, name: 'Interviews' })).toBeVisible();
    await expect(page.getByText('questions, games and code')).toBeVisible();
    // The round under way, not the coding pad.
    await expect(active(page)).toHaveCount(1);
    await expect(active(page)).toContainText('Trader quant round');
    await expect(active(page).getByTestId('quant-badge')).toHaveText('Quant · Trader');
    await expect(active(page).getByRole('link', { name: 'Resume' })).toHaveAttribute(
      'href',
      `/pads/${QUANT_PAD_ID}`,
    );
    await expect(stat(page, 'Interviews')).toHaveText('2');
    await expect(stat(page, 'Solved')).toHaveCount(0);

    await page.getByRole('tab', { name: /^History/ }).click();
    await expect(page).toHaveURL(/\/quant\/interviews\?view=history$/);
    await expect(page.getByRole('tab', { name: /^History/ })).toHaveText(/2/);
    const table = page.getByRole('table');
    await expect(table.getByRole('columnheader')).toHaveText([
      'Interview',
      'Kind',
      'When',
      'Length',
      'Outcome',
      'Actions',
    ]);
    const round = table.getByRole('row', { name: /Trader quant round/ });
    await expect(round.getByTestId('quant-badge')).toHaveText('Quant · Trader');
    await expect(round).toContainText('Scored in the report');
    await expect(round.getByRole('link', { name: /^Report for/ })).toHaveAttribute(
      'href',
      `/pads/${QUANT_ENDED_PAD_ID}/report`,
    );
    const room = table.getByRole('row', { name: /Quant interview with Casey/ });
    await expect(room.getByTestId('quant-badge')).toHaveText('Quant questions');
    await expect(room).toContainText('Your verdicts in the report');
    await expect(table).not.toContainText('Solved');
    await expect(table).not.toContainText('Python');
    await expect(table).not.toContainText('LRU Cache');
  });

  test('Quant with nothing yet: an empty history and no figures to speak of', async ({ page }) => {
    await setup(page);
    await page.goto('/quant/interviews?view=history');
    await expect(stat(page, 'Interviews')).toHaveText('0');
    await expect(active(page)).toHaveCount(0);
    await expect(page.getByText('No finished interviews yet')).toBeVisible();
    await expect(
      page.getByText('Interviews and quant rooms you finish show up here'),
    ).toBeVisible();
  });

  test('on a phone, the history cards are the track’s too', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await setup(page, withQuantPads);
    await page.goto('/quant/interviews?view=history');
    const cards = page.getByRole('list', { name: 'Finished interviews' }).getByRole('listitem');
    await expect(cards).toHaveCount(2);
    await expect(cards.first()).toContainText(/Trader quant round|Quant interview with Casey/);
    await page.goto('/software/interviews?view=history');
    await expect(cards).toHaveCount(4);
  });
});

test.describe('the setup', () => {
  test('Quant: the same switch, kept in ?mode=host, over the builder or the room', async ({
    page,
  }) => {
    await setup(page, (b) => b.useRoomBank());
    await page.goto('/quant/interviews');
    await expect(kind(page).getByRole('radio', { checked: true })).toHaveText(
      'Practise with the AI',
    );
    const presets = page.getByRole('radiogroup', { name: 'Presets' });
    await presets.getByRole('radio', { name: /^Researcher/ }).click();
    await expect(page.getByTestId('stage-summary').first()).toHaveText(
      'Probability, Statistics · 4 questions · 30 min',
    );

    await kind(page).getByRole('radio', { name: 'Interview someone' }).click();
    await expect(page).toHaveURL(/\/quant\/interviews\?mode=host$/);
    await expect(page.getByTestId('quant-room-setup')).toBeVisible();
    await expect(presets).toHaveCount(0);
    // Kept across a look at History and a reload.
    await page.getByRole('tab', { name: /^History/ }).click();
    await page.getByRole('tab', { name: /^New interview/ }).click();
    await expect(page.getByTestId('quant-room-setup')).toBeVisible();
    await page.reload();
    await expect(kind(page).getByRole('radio', { checked: true })).toHaveText('Interview someone');
    await expect(page.getByTestId('quant-room-setup')).toBeVisible();
  });

  test('the switch sits in the same place in both tracks and both modes', async ({ page }) => {
    // One pad under way in each track, so what is above the setup is the same height.
    await setup(page, withQuantPads);
    const boxes = [];
    for (const url of [
      '/software/interviews',
      '/software/interviews?mode=host',
      '/quant/interviews',
      '/quant/interviews?mode=host',
    ]) {
      await page.goto(url);
      await expect(kind(page)).toBeVisible();
      await page.waitForTimeout(200);
      boxes.push(await kind(page).boundingBox());
    }
    for (const b of boxes.slice(1)) expect(b).toEqual(boxes[0]);
  });

  test('the track switch keeps hosting and History, and nothing of the track’s own', async ({
    page,
  }) => {
    await setup(page, (b) => b.useRoomBank());
    await page.goto('/software/interviews?mode=host&problem=lru-cache');
    await header(page).getByRole('navigation', { name: 'Track' }).getByRole('link').click();
    await expect(page).toHaveURL(/\/quant\/interviews\?mode=host$/);
    await expect(page.getByTestId('quant-room-setup')).toBeVisible();
    await page.getByRole('tab', { name: /^History/ }).click();
    await header(page).getByRole('navigation', { name: 'Track' }).getByRole('link').click();
    await expect(page).toHaveURL(/\/software\/interviews\?mode=host&view=history$/);
    await expect(page.getByRole('region', { name: 'Finished interviews' })).toBeVisible();
  });
});

test.describe('the way back from a pad', () => {
  test("goes to the pad's track, whatever was remembered", async ({ page }) => {
    const b = await setup(page, (x) => {
      x.track = 'software';
    });
    await page.goto(`/pads/${QUANT_PAD_ID}`);
    await expect(page.getByTestId('quant-workspace')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole('link', { name: 'Back to interviews' })).toHaveAttribute(
      'href',
      '/quant/interviews',
    );
    b.track = 'quant';
    await page.goto(`/pads/${ACTIVE_PAD_ID}`);
    await expect(page.getByRole('link', { name: 'Back to interviews' }).first()).toHaveAttribute(
      'href',
      '/software/interviews',
    );
  });

  test("a report's back link and its delete go to the pad's track", async ({ page }) => {
    await setup(page, (b) => {
      b.track = 'software';
      b.useRoomBank();
    });
    await page.goto(`/pads/${QROOM_ENDED_PAD_ID}/report`);
    const back = page.getByRole('main').getByRole('link', { name: 'Interviews', exact: true });
    await expect(back).toHaveAttribute('href', '/quant/interviews');
    await page.goto(`/pads/${QUANT_ENDED_PAD_ID}/report`);
    await expect(back).toHaveAttribute('href', '/quant/interviews');

    await page.goto(`/pads/${ENDED_PAD_ID}/report`);
    await expect(back).toHaveAttribute('href', '/software/interviews');
    await page.goto(`/pads/${QUANT_ENDED_PAD_ID}/report`);
    await page.getByRole('button', { name: 'Delete interview' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Delete interview' }).click();
    await expect(page).toHaveURL(/\/quant\/interviews$/);
  });
});
