/** The pad on a phone: one pane at a time, switched by the tab bar at the bottom. */
import { expect, type Page, test } from '@playwright/test';
import {
  ACTIVE_PAD_ID,
  GUEST_MEMBER,
  HOST_MEMBER,
  makeMessage,
  makeRoomDetail,
  ROOM_PAD_ID,
  RUNS,
  roomMessages,
  USER,
} from './fixtures';
import { setup } from './helpers';
import type { MockBackend } from './mock-api';

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

const paneTab = (page: Page, name: RegExp) =>
  page.getByRole('tablist', { name: 'Pad sections' }).getByRole('tab', { name });

async function openPad(page: Page, configure?: (b: MockBackend) => void, id = ACTIVE_PAD_ID) {
  const backend = await setup(page, configure);
  await page.goto(`/pads/${id}`);
  await expect(page.getByRole('status', { name: 'Connected' })).toBeVisible({ timeout: 20_000 });
  return backend;
}

async function showCode(page: Page) {
  await paneTab(page, /^Code/).tap();
  await expect(page.locator('.view-lines')).toContainText('class Solution', { timeout: 20_000 });
}

/**
 * Nothing wider than the screen: the page does not scroll sideways, and no pane's vertical
 * scroller hides content off to the right (things meant to scroll sideways, like code and
 * output, are left out).
 */
async function expectNoSidewaysOverflow(page: Page) {
  const problems = await page.evaluate(() => {
    const out: string[] = [];
    const vw = window.innerWidth;
    if (document.documentElement.scrollWidth > vw)
      out.push(`page is ${document.documentElement.scrollWidth}px wide`);
    const root = document.querySelector(
      '[role="tablist"][aria-label="Pad sections"]',
    )?.parentElement;
    if (!root) return ['no tab bar'];
    const inScroller = (el: HTMLElement) => {
      for (let a = el.parentElement; a && a !== root; a = a.parentElement) {
        const x = getComputedStyle(a).overflowX;
        if (x === 'auto' || x === 'scroll') return true;
      }
      return false;
    };
    for (const el of root.querySelectorAll<HTMLElement>('*')) {
      if (el.closest('.monaco-editor') || el.offsetParent === null) continue;
      const cls = typeof el.className === 'string' ? el.className : '';
      const what = `${el.tagName.toLowerCase()} "${(el.getAttribute('aria-label') ?? el.textContent ?? '').slice(0, 30)}"`;
      const cs = getComputedStyle(el);
      const scrolls = cs.overflowY === 'auto' || cs.overflowY === 'scroll';
      if (
        scrolls &&
        el.tagName !== 'TEXTAREA' &&
        !/overflow-(x-)?auto/.test(cls) &&
        // Touch screens give small buttons an invisible 40 px hit area (globals.css), which may
        // poke a few px past a scroller's padding without hiding anything.
        el.scrollWidth > el.clientWidth + 9
      )
        out.push(`${what} scrolls sideways (${el.scrollWidth} > ${el.clientWidth})`);
      const r = el.getBoundingClientRect();
      if (r.width > 1 && r.right > vw + 1 && !inScroller(el))
        out.push(`${what} ends at ${Math.round(r.right)}px`);
    }
    return out;
  });
  expect(problems).toEqual([]);
}

test('the tab bar switches panes, and the desktop layout is not there', async ({ page }) => {
  await openPad(page);
  // A pad with a problem opens on its statement.
  await expect(paneTab(page, /^Problem/)).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('#pane-problem')).toBeVisible();
  await expect(page.locator('#pane-code')).toBeHidden();
  await expect(page.locator('[data-panel]')).toHaveCount(0);
  await expect(page.getByRole('contentinfo')).toHaveCount(0);
  await expect(page.getByText('works best on a screen')).toHaveCount(0);

  await showCode(page);
  await expect(page.locator('#pane-problem')).toBeHidden();
  // Run and Submit are under the editor.
  await expect(page.getByTestId('run-file')).toBeVisible();
  await expect(page.getByTestId('submit')).toBeVisible();
  const submit = await page.getByTestId('submit').boundingBox();
  expect(submit?.height ?? 0).toBeGreaterThanOrEqual(40);

  await paneTab(page, /^Console/).tap();
  await expect(page.getByRole('tablist', { name: 'Console' })).toBeVisible();
  await paneTab(page, /^Chat/).tap();
  await expect(page.getByRole('region', { name: 'Interviewer chat' })).toBeVisible();
  // The composer is big enough not to make iOS zoom in.
  const size = await page
    .getByLabel('Message', { exact: true })
    .evaluate((el) => getComputedStyle(el).fontSize);
  expect(size).toBe('16px');

  // The rest of the top bar is in a menu.
  await page.getByRole('button', { name: 'More actions' }).tap();
  await page.getByRole('menuitem', { name: 'Editor settings' }).tap();
  await expect(page.getByRole('dialog', { name: 'Editor settings' })).toBeVisible();
});

test('code, a chat draft and the console survive switching panes', async ({ page }) => {
  await openPad(page);
  await showCode(page);
  const marker = `// phone_${Date.now()}`;
  await page.locator('.view-lines').click();
  await page.keyboard.press('ControlOrMeta+End');
  await page.keyboard.type(`\n${marker}`);
  await expect(page.locator('.view-lines')).toContainText(marker);

  await paneTab(page, /^Chat/).tap();
  await page.getByLabel('Message', { exact: true }).fill('half a thought');
  await paneTab(page, /^Console/).tap();
  await page.getByRole('tab', { name: /Input/ }).tap();
  await page.getByLabel(/Standard input/).fill('1 2 3');

  await paneTab(page, /^Problem/).tap();
  await paneTab(page, /^Code/).tap();
  await expect(page.locator('.view-lines')).toContainText(marker);
  await expect(page.locator('.monaco-editor')).toHaveCount(1);
  await paneTab(page, /^Chat/).tap();
  await expect(page.getByLabel('Message', { exact: true })).toHaveValue('half a thought');
  await paneTab(page, /^Console/).tap();
  await expect(page.getByLabel(/Standard input/)).toHaveValue('1 2 3');
});

test('running shows the console; a result that lands on another pane is flagged', async ({
  page,
}) => {
  const backend = await openPad(page, (b) => {
    b.runDelayMs = 1500;
  });
  await showCode(page);
  backend.nextRun = (id) => RUNS.wrongAnswer(id);
  await page.getByTestId('run-tests').tap();
  await expect(paneTab(page, /^Console/)).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByTestId('run-progress')).toBeVisible();
  // Back to the code before it finishes: the Console tab says there is something new.
  await paneTab(page, /^Code/).tap();
  await expect(page.getByTestId('console-unread')).toBeVisible({ timeout: 10_000 });
  await expect(paneTab(page, /^Console/)).toHaveAccessibleName(/new result/);
  await paneTab(page, /^Console/).tap();
  await expect(page.getByTestId('run-result')).toContainText('Wrong answer');
  await expect(page.getByTestId('console-unread')).toHaveCount(0);

  // A run from the keyboard shortcut does the same.
  backend.nextRun = (id) => RUNS.compileError(id);
  await paneTab(page, /^Code/).tap();
  await page.locator('.view-lines').click();
  await page.keyboard.press('ControlOrMeta+Enter');
  await expect(paneTab(page, /^Console/)).toHaveAttribute('aria-selected', 'true');
  // A compile error's line link goes back to the code.
  await page.getByTestId('run-result').getByRole('button', { name: 'solution.cpp:7:31' }).tap();
  await expect(paneTab(page, /^Code/)).toHaveAttribute('aria-selected', 'true');
});

test('a message while another pane is showing marks the chat tab', async ({ page }) => {
  const backend = await openPad(page);
  await expect(page.getByTestId('chat-tab-unread')).toHaveCount(0);
  await backend.streamReply('Before you code: what happens with duplicates like [3, 3]?', {
    kind: 'proactive',
    intent: 'nudge',
  });
  await expect(page.getByTestId('chat-tab-unread')).toHaveText('1');
  await paneTab(page, /^Chat/).tap();
  await expect(page.getByTestId('chat-tab-unread')).toHaveCount(0);
  await expect(page.getByTestId('proactive-message').last()).toBeInViewport();
  // While the chat is showing, nothing is marked.
  await backend.streamReply('Take your time.');
  await expect(page.getByTestId('interviewer-message').last()).toContainText('Take your time');
  await expect(page.getByTestId('chat-tab-unread')).toHaveCount(0);
});

for (const width of [360, 390]) {
  test(`nothing is wider than a ${width} px screen`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 });
    const backend = await openPad(page);
    await expectNoSidewaysOverflow(page);
    await showCode(page);
    await expectNoSidewaysOverflow(page);
    backend.nextRun = (id) => RUNS.wrongAnswer(id);
    await page.getByTestId('run-tests').tap();
    await expect(page.getByTestId('run-result')).toContainText('Wrong answer');
    await expectNoSidewaysOverflow(page);
    await page.getByRole('tab', { name: /Custom tests/ }).tap();
    await page.getByRole('button', { name: 'Add test' }).tap();
    await expectNoSidewaysOverflow(page);
    await paneTab(page, /^Chat/).tap();
    await expectNoSidewaysOverflow(page);
    await paneTab(page, /^Code/).tap();
    await page.getByRole('tab', { name: 'Whiteboard' }).tap();
    await expect(page.getByRole('toolbar', { name: 'Whiteboard tools' })).toBeVisible();
    await expectNoSidewaysOverflow(page);
  });
}

test('drawing on the whiteboard with a finger', async ({ page }) => {
  await openPad(page);
  await showCode(page);
  await page.getByRole('tab', { name: 'Whiteboard' }).tap();
  const board = page.getByRole('img', { name: /^Whiteboard/ });
  await expect(board).toHaveCSS('touch-action', 'none');
  const box = await board.boundingBox();
  if (!box) throw new Error('no board');
  // A touch pointer, as a finger makes it.
  await board.dispatchEvent('pointerdown', {
    pointerId: 7,
    pointerType: 'touch',
    isPrimary: true,
    button: 0,
    buttons: 1,
    clientX: box.x + 100,
    clientY: box.y + 200,
  });
  for (const [dx, dy] of [
    [130, 220],
    [160, 240],
    [200, 230],
  ] as const)
    await board.dispatchEvent('pointermove', {
      pointerId: 7,
      pointerType: 'touch',
      isPrimary: true,
      buttons: 1,
      clientX: box.x + dx,
      clientY: box.y + dy,
    });
  await board.dispatchEvent('pointerup', {
    pointerId: 7,
    pointerType: 'touch',
    isPrimary: true,
    button: 0,
    clientX: box.x + 200,
    clientY: box.y + 230,
  });
  await expect(page.getByRole('img', { name: 'Whiteboard with 1 shape' })).toBeVisible();
});

test.describe('interview rooms', () => {
  test('the host’s last tab holds the chat and their notes', async ({ page }) => {
    await openPad(
      page,
      (b) => {
        b.pads.set(
          ROOM_PAD_ID,
          makeRoomDetail({ members: [HOST_MEMBER, GUEST_MEMBER], messages: roomMessages() }),
        );
      },
      ROOM_PAD_ID,
    );
    await paneTab(page, /^Chat & notes/).tap();
    await expect(page.getByRole('tab', { name: 'My notes' })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Second opinion' })).toBeVisible();
    await expectNoSidewaysOverflow(page);
  });

  test('a host alone sees the invite banner, and the invite link is in the menu', async ({
    page,
  }) => {
    await openPad(
      page,
      (b) => {
        b.pads.set(ROOM_PAD_ID, makeRoomDetail());
      },
      ROOM_PAD_ID,
    );
    await expect(page.getByTestId('invite-banner')).toBeVisible();
    await expectNoSidewaysOverflow(page);
    await page.getByRole('button', { name: 'More actions' }).tap();
    await page.getByRole('menuitem', { name: 'Invite your candidate' }).tap();
    await expect(page.getByRole('dialog', { name: 'Invite your candidate' })).toBeVisible();
    await expect(page.getByLabel('Share link')).toHaveValue(/\/join\//);
  });

  test('a candidate’s chat tab is the room chat, and marks the host’s messages', async ({
    page,
  }) => {
    const backend = await openPad(
      page,
      (b) => {
        b.pads.set(
          ROOM_PAD_ID,
          makeRoomDetail({
            as: 'candidate',
            members: [
              { userId: 'user_grace', name: 'Grace Hopper', role: 'owner', guest: false },
              { userId: USER.id, name: USER.name, role: 'collaborator', guest: false },
            ],
          }),
        );
      },
      ROOM_PAD_ID,
    );
    await showCode(page);
    backend.push({
      type: 'message.created',
      message: makeMessage({
        padId: ROOM_PAD_ID,
        role: 'interviewer',
        userId: 'user_grace',
        text: 'How is it going?',
      }),
    });
    await expect(page.getByTestId('chat-tab-unread')).toHaveText('1');
    await paneTab(page, /^Chat/).tap();
    await expect(page.getByRole('region', { name: 'Chat' })).toContainText('How is it going?');
    await expect(page.getByTestId('chat-tab-unread')).toHaveCount(0);
  });
});
