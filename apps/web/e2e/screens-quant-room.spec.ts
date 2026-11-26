/** Visual review screenshots for quant rooms. Run with SCREENS=1 playwright test screens-quant-room. */
import { expect, type Page, test } from '@playwright/test';
import { USER } from './fixtures';
import {
  QROOM_ENDED_PAD_ID,
  QROOM_GUEST,
  QROOM_HOST,
  QROOM_OTHER_HOST,
  QROOM_PAD_ID,
  QROOM_TOKEN,
} from './fixtures-quant-room';
import { setup, shoot } from './helpers';
import type { RoomScriptLine } from './mock-quant-room';

test.skip(!process.env.SCREENS, 'set SCREENS=1 to capture screenshots');

const WIDTHS = (process.env.SCREEN_WIDTHS ?? '1440,390').split(',').map(Number);
const ONLY = process.env.ONLY?.split(',');
const want = (name: string) => !ONLY || ONLY.includes(name);

const phone = (page: Page) => (page.viewportSize()?.width ?? 1440) < 1024;
const pane = (page: Page, name: RegExp) =>
  page.getByRole('tablist', { name: 'Pad sections' }).getByRole('tab', { name }).click();
const connected = (page: Page) =>
  expect(page.getByRole('status', { name: 'Connected' })).toBeVisible({ timeout: 20_000 });

/** A room under way: one question closed with a verdict, the second open with a hint given. */
const UNDER_WAY: RoomScriptLine[] = [
  { at: 20, host: 'Hi Casey, thanks for joining. We will start with some probability.' },
  { at: 30, candidate: 'Hi! Ready when you are.' },
  { at: 40, pose: 'rb-prob-dice-eight' },
  { at: 90, candidate: 'Five ordered pairs give 8, out of 36: so 5/36.' },
  { at: 120, close: { score: 1, summary: 'Counted the five ordered pairs at once.' } },
  { at: 140, pose: 'rb-teaser-ropes' },
  { at: 200, candidate: 'Can I light a rope at both ends?' },
  { at: 230, hint: 1 },
  { at: 300, candidate: 'Lit at both ends it burns in 30 minutes, whatever the unevenness.' },
];

for (const width of WIDTHS) {
  test.describe(`quant rooms at ${width}px`, () => {
    test.use({ viewport: { width, height: width < 600 ? 844 : 900 } });

    test('creating one', async ({ page }) => {
      test.skip(!want('new'));
      await setup(page, (b) => b.useRoomBank());
      await page.goto('/quant/interviews?mode=host');
      await page.getByTestId('bank-row').first().waitFor();
      await shoot(page, 'qroom-new-empty', { fullPage: true });
      for (const id of ['rb-prob-dice-eight', 'rb-teaser-ropes', 'rb-py-default-list'])
        await page.getByRole('button', { name: `Queue ${id}` }).click();
      await page.locator('[data-question="rb-teaser-ropes"] summary').first().click();
      await shoot(page, 'qroom-new-queue', { fullPage: true });
    });

    test('the host mid-question', async ({ page }) => {
      test.skip(!want('host'));
      const backend = await setup(page, (b) => {
        b.useRoomBank();
        b.quantRooms.seed({
          id: QROOM_PAD_ID,
          token: QROOM_TOKEN,
          members: [QROOM_HOST, QROOM_GUEST],
          queue: ['rb-cpp-vector-reserve', 'rb-opt-parity-holds', 'rb-stats-n-minus-one'],
          script: UNDER_WAY,
          startedAt: new Date(Date.now() - 420_000).toISOString(),
        });
      });
      await page.goto(`/pads/${QROOM_PAD_ID}`);
      await connected(page);
      await page.getByTestId('open-question').waitFor();
      await page
        .getByTestId('open-question')
        .getByRole('radio', { name: /Good|75%/ })
        .click();
      await shoot(page, 'qroom-host');
      if (phone(page)) {
        await page
          .getByTestId('open-question')
          .locator('[data-testid="hint-ladder"]')
          .scrollIntoViewIfNeeded();
        await shoot(page, 'qroom-host-hints');
        await pane(page, /^Chat/);
        await shoot(page, 'qroom-host-chat');
        await pane(page, /^Desk/);
      }
      await page.getByTestId('open-bank').click();
      await page.getByTestId('bank-sheet').getByTestId('bank-row').first().waitFor();
      await page
        .getByTestId('bank-sheet')
        .locator('[data-question="rb-mm-capped-doubling"] summary')
        .first()
        .click();
      await shoot(page, 'qroom-host-bank');
      await page.getByRole('button', { name: 'Close the bank' }).click();
      if (phone(page)) await pane(page, /^Chat/);
      await page.getByRole('tab', { name: 'Second opinion' }).click();
      await page.getByTestId('review-button').click();
      await page.getByTestId('quant-opinion').waitFor();
      await shoot(page, 'qroom-host-opinion');
      if (phone(page)) await pane(page, /^Desk/);
      await page.getByRole('tab', { name: /^Asked/ }).click();
      await page.getByTestId('asked-item').last().locator('summary').first().click();
      await shoot(page, 'qroom-host-asked');
      expect(backend.quantRooms.log.length).toBeGreaterThan(0);
    });

    test('the host between questions', async ({ page }) => {
      test.skip(!want('idle'));
      await setup(page, (b) => {
        b.useRoomBank();
        b.quantRooms.seed({
          id: QROOM_PAD_ID,
          token: QROOM_TOKEN,
          members: [QROOM_HOST],
          queue: ['rb-mm-capped-doubling', 'rb-cpp-vector-reserve'],
        });
      });
      await page.goto(`/pads/${QROOM_PAD_ID}`);
      await connected(page);
      await page.getByTestId('up-next').waitFor();
      await shoot(page, 'qroom-host-idle');
    });

    test('the candidate', async ({ page }) => {
      test.skip(!want('candidate'));
      const backend = await setup(page, (b) => {
        b.useRoomBank();
        b.quantRooms.seed({
          id: QROOM_PAD_ID,
          as: 'candidate',
          owner: QROOM_OTHER_HOST,
          members: [
            QROOM_OTHER_HOST,
            { userId: USER.id, name: USER.name, role: 'collaborator', guest: true },
          ],
        });
      });
      await page.goto(`/pads/${QROOM_PAD_ID}`);
      await connected(page);
      if (phone(page)) await pane(page, /^Question/);
      await page.getByTestId('round-waiting').waitFor();
      await shoot(page, 'qroom-candidate-waiting');
      backend.quantRooms.pose(QROOM_PAD_ID, 'rb-cpp-vector-reserve');
      await expect(page.getByTestId('round-heading')).toHaveText('Question 1');
      await shoot(page, 'qroom-candidate-output');
      backend.quantRooms.pose(QROOM_PAD_ID, 'rb-opt-parity-holds');
      await expect(page.getByTestId('round-heading')).toHaveText('Question 2');
      await shoot(page, 'qroom-candidate-choice');
      if (phone(page)) {
        await pane(page, /^Chat/);
        await shoot(page, 'qroom-candidate-chat');
      }
    });

    test('the report', async ({ page }) => {
      test.skip(!want('report'));
      await setup(page, (b) => b.useRoomBank());
      await page.goto(`/pads/${QROOM_ENDED_PAD_ID}/report`);
      await page.getByTestId('quant-review').waitFor();
      await page.getByTestId('question-review').first().waitFor();
      await shoot(page, 'qroom-report', { fullPage: true });
    });
  });
}
