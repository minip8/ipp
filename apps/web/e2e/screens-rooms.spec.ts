/** Visual review screenshots for interview rooms. Run with SCREENS=1 playwright test screens-rooms. */
import { expect, type Page, test } from '@playwright/test';
import {
  GUEST_MEMBER,
  HOST_MEMBER,
  iso,
  makeRoomDetail,
  ROOM_PAD_ID,
  ROOM_TOKEN,
  roomMessages,
} from './fixtures';
import { setup, shoot } from './helpers';

test.skip(!process.env.SCREENS, 'set SCREENS=1 to capture screenshots');

const WIDTHS = (process.env.SCREEN_WIDTHS ?? '1440,390').split(',').map(Number);

/** Below 1024 px the pad shows one pane at a time; these pick one from the tab bar. */
const phone = (page: Page) => (page.viewportSize()?.width ?? 1440) < 1024;
const pane = (page: Page, name: RegExp) =>
  page.getByRole('tablist', { name: 'Pad sections' }).getByRole('tab', { name }).click();

async function ready(page: Page) {
  await expect(page.getByRole('status', { name: 'Connected' })).toBeVisible({ timeout: 20_000 });
  if (phone(page)) await pane(page, /^Code/);
  await expect(page.locator('.view-lines')).toContainText('class Solution', { timeout: 20_000 });
}

for (const width of WIDTHS) {
  test.describe(`rooms at ${width}px`, () => {
    test.use({ viewport: { width, height: width < 600 ? 844 : 900 } });

    test('setup and join', async ({ page }) => {
      await setup(page, (b) => {
        b.pads.set(ROOM_PAD_ID, makeRoomDetail({ as: 'candidate' }));
        b.tokens.set(ROOM_TOKEN, ROOM_PAD_ID);
      });
      await page.goto('/software/interviews?mode=host');
      await page.getByRole('button', { name: /^LRU Cache/ }).click();
      await shoot(page, 'room-new', { fullPage: true });
      await page.goto('/software/interviews');
      await page.getByRole('region', { name: 'In progress' }).waitFor();
      await shoot(page, 'room-dashboard');
    });

    test('join as a guest', async ({ page }) => {
      await setup(page, (b) => {
        b.signedIn = false;
        b.pads.set(ROOM_PAD_ID, makeRoomDetail({ as: 'candidate' }));
        b.tokens.set(ROOM_TOKEN, ROOM_PAD_ID);
      });
      await page.goto(`/join/${ROOM_TOKEN}`);
      await page.getByLabel('Your name').fill('Casey Jones');
      await shoot(page, 'room-join');
      await page.getByRole('button', { name: 'Join the interview' }).click();
      await ready(page);
      await shoot(page, 'room-candidate');
      if (phone(page)) {
        await pane(page, /^Problem/);
        await shoot(page, 'room-candidate-problem');
        await pane(page, /^Console/);
        await shoot(page, 'room-candidate-console');
        await pane(page, /^Chat/);
        await shoot(page, 'room-candidate-chat');
      }
    });

    test('host', async ({ page }) => {
      await setup(page, (b) => {
        b.pads.set(
          ROOM_PAD_ID,
          makeRoomDetail({ members: [HOST_MEMBER, GUEST_MEMBER], messages: roomMessages() }),
        );
      });
      await page.goto(`/pads/${ROOM_PAD_ID}`);
      await ready(page);
      if (phone(page)) {
        await shoot(page, 'room-host-code');
        await pane(page, /^Problem/);
        await page.getByRole('tab', { name: 'Guide' }).click();
        await shoot(page, 'room-host-guide');
        await pane(page, /^Chat & notes/);
        await shoot(page, 'room-host-chat');
        await page.getByRole('tab', { name: 'My notes' }).click();
        await page.getByLabel('Your private notes').fill('Clear approach.\nMissed duplicates.');
        await shoot(page, 'room-host-notes');
        await page.getByRole('tab', { name: 'Second opinion' }).click();
        await page.getByLabel('Something specific to check').fill('Is the loop bound right?');
        await page.getByTestId('review-button').click();
        await expect(page.getByTestId('review')).toBeVisible();
        await shoot(page, 'room-host-review');
        await pane(page, /^Problem/);
        await page.locator('#pane-problem').getByRole('tab', { name: 'Problem' }).click();
        await page.getByTestId('change-problem').click();
        await shoot(page, 'room-change-problem');
        return;
      }
      await shoot(page, 'room-host-chat');
      await page.getByRole('tab', { name: 'Guide' }).click();
      await page.getByRole('tab', { name: 'My notes' }).click();
      await page.getByLabel('Your private notes').fill('Clear approach.\nMissed duplicates.');
      await shoot(page, 'room-host-guide-notes');
      await page.getByRole('tab', { name: 'Second opinion' }).click();
      await shoot(page, 'room-host-review-empty');
      await page.getByLabel('Something specific to check').fill('Is the loop bound right?');
      await page.getByTestId('review-button').click();
      await expect(page.getByTestId('review')).toBeVisible();
      await shoot(page, 'room-host-review');
      await page.getByRole('tab', { name: 'Problem' }).click();
      await page.getByTestId('change-problem').click();
      await shoot(page, 'room-change-problem');
    });

    test('host alone, blank', async ({ page }) => {
      await setup(page, (b) => {
        b.pads.set(
          ROOM_PAD_ID,
          makeRoomDetail({ pad: { problemSlug: null, title: 'Interview room' } }),
        );
      });
      await page.goto(`/pads/${ROOM_PAD_ID}`);
      await ready(page);
      await shoot(page, 'room-host-blank');
    });

    test('report', async ({ page }) => {
      await setup(page, (b) => {
        b.pads.set(
          ROOM_PAD_ID,
          makeRoomDetail({
            pad: { status: 'ended', endedAt: iso(-60), startedAt: iso(-2700) },
            members: [HOST_MEMBER, GUEST_MEMBER],
            messages: roomMessages(),
          }),
        );
      });
      await page.goto(`/pads/${ROOM_PAD_ID}/report`);
      await expect(page.getByRole('heading', { name: 'Your notes' })).toBeVisible();
      await page.waitForTimeout(500);
      await shoot(page, 'room-report', { fullPage: true });
    });
  });
}
