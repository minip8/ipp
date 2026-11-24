/** Interview rooms: the user hosts, a candidate joins by the invite link with just a name. */
import { expect, type Page, test } from '@playwright/test';
import {
  aiKeyStatus,
  GUEST_MEMBER,
  HOST_MEMBER,
  iso,
  makeRoomDetail,
  ROOM_PAD_ID,
  ROOM_TOKEN,
  roomMessages,
  USER,
} from './fixtures';
import { setup } from './helpers';
import type { MockBackend } from './mock-api';

async function editorReady(page: Page) {
  await expect(page.locator('.view-lines')).toContainText('class Solution', { timeout: 20_000 });
  await expect(page.getByRole('status', { name: 'Connected' })).toBeVisible();
}

/** The signed-in user's own room, with a candidate already in it unless `alone`. */
async function openAsHost(
  page: Page,
  opts: { alone?: boolean; configure?: (b: MockBackend) => void } = {},
) {
  const backend = await setup(page, (b) => {
    b.pads.set(
      ROOM_PAD_ID,
      makeRoomDetail({
        members: opts.alone ? [HOST_MEMBER] : [HOST_MEMBER, GUEST_MEMBER],
        messages: opts.alone ? [] : roomMessages(),
      }),
    );
    opts.configure?.(b);
  });
  await page.goto(`/pads/${ROOM_PAD_ID}`);
  await editorReady(page);
  return backend;
}

/** A room hosted by someone else, reachable only by its invite link. */
function candidateRoom(b: MockBackend, pad: Parameters<typeof makeRoomDetail>[0] = {}) {
  b.pads.set(ROOM_PAD_ID, makeRoomDetail({ as: 'candidate', ...pad }));
  b.tokens.set(ROOM_TOKEN, ROOM_PAD_ID);
}

test.describe('hosting', () => {
  test('creates a room for a problem from the dashboard', async ({ page }) => {
    const backend = await setup(page);
    await page.goto('/dashboard');
    await page.getByRole('link', { name: 'Host an interview' }).click();
    await expect(page).toHaveURL(/\/new\?mode=host$/);
    await expect(page.getByRole('heading', { name: 'Host an interview' })).toBeVisible();
    // No AI interviewer to configure: the host is the interviewer.
    await expect(page.getByText('You are the interviewer')).toBeVisible();
    await expect(page.getByLabel('AI interviewer')).toHaveCount(0);
    const create = page.getByRole('button', { name: 'Create room' });
    await expect(create).toBeDisabled();
    await page.getByRole('button', { name: /LRU Cache/ }).click();
    await page.getByRole('radio', { name: 'Python' }).click();
    await create.click();
    await expect(page).toHaveURL(/\/pads\/[0-9a-f-]{36}$/);
    const sent = backend.requests.find((r) => r.method === 'POST' && r.path === '/api/pads');
    expect(sent?.body).toEqual({
      kind: 'room',
      problemSlug: 'lru-cache',
      language: 'python',
      durationMin: 45,
    });
    await expect(page.getByTestId('room-role')).toHaveText('· you are hosting');
    // Alone in a new room: the next step is the invite link.
    await expect(page.getByTestId('invite-banner')).toContainText('Nobody has joined yet');
    await page.getByRole('button', { name: 'Invite', exact: true }).click();
    await expect(page.getByText('Invite your candidate')).toBeVisible();
    await expect(page.getByLabel('Share link')).toHaveValue(/\/join\/room_[0-9a-f]{8}$/);
  });

  test('or with a blank editor, where code only runs as a program', async ({ page }) => {
    const backend = await setup(page);
    await page.goto('/new?mode=host');
    await page.getByRole('button', { name: 'Start with a blank editor' }).click();
    await expect(page.getByTestId('selected-problem')).toHaveText('Blank editor');
    await page.getByRole('button', { name: 'Create room' }).click();
    await expect(page).toHaveURL(/\/pads\/[0-9a-f-]{36}$/);
    const sent = backend.requests.find((r) => r.method === 'POST' && r.path === '/api/pads');
    expect(sent?.body).toMatchObject({ kind: 'room', blank: true });
    expect(sent?.body).not.toHaveProperty('problemSlug');
    await expect(page.getByRole('heading', { name: 'Blank editor' })).toBeVisible();
    await expect(page.getByTestId('run-file')).toBeVisible();
    await expect(page.getByTestId('run-tests')).toHaveCount(0);
    await expect(page.getByTestId('submit')).toHaveCount(0);
    await expect(page.getByRole('tab', { name: /Custom tests/ })).toHaveCount(0);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Interview room');
  });

  test('switching back to practice restores the AI interviewer setup', async ({ page }) => {
    await setup(page);
    await page.goto('/new?mode=host');
    await page.getByRole('radio', { name: 'Practise with the AI' }).click();
    await expect(page).toHaveURL(/\/new$/);
    await expect(page.getByRole('heading', { name: 'New interview' })).toBeVisible();
    await expect(page.getByLabel('AI interviewer')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Start interview' })).toBeVisible();
  });
});

test.describe('joining by the invite link', () => {
  test('a candidate without an account types a name and is in', async ({ page }) => {
    const backend = await setup(page, (b) => {
      b.signedIn = false;
      candidateRoom(b);
    });
    await page.goto(`/join/${ROOM_TOKEN}`);
    await expect(
      page.getByRole('heading', { name: 'Grace Hopper invited you to an interview' }),
    ).toBeVisible();
    const join = page.getByRole('button', { name: 'Join the interview' });
    await expect(join).toBeDisabled();
    await page.getByLabel('Your name').fill('  Casey   Jones ');
    await join.click();
    await expect(page).toHaveURL(new RegExp(`/pads/${ROOM_PAD_ID}$`));
    const sent = backend.requests.find((r) => r.path === '/api/pads/join-guest');
    expect(sent?.body).toEqual({ shareToken: ROOM_TOKEN, name: 'Casey Jones' });
    await editorReady(page);

    // The candidate's room: the chat with the interviewer, and nothing that is the host's.
    await expect(page.getByTestId('room-role')).toHaveText('· interview with Grace Hopper');
    await expect(page.getByTestId('room-people')).toHaveText('with Grace Hopper');
    for (const name of ['Invite', 'End interview', 'Change'])
      await expect(page.getByRole('button', { name, exact: true })).toHaveCount(0);
    for (const name of ['Guide', 'My notes', 'Second opinion'])
      await expect(page.getByRole('tab', { name })).toHaveCount(0);
    await expect(page.getByRole('tab', { name: 'Shared notes' })).toBeVisible();
    await expect(page.getByTestId('invite-banner')).toHaveCount(0);
    // A guest has no dashboard to go back to.
    await expect(page.getByRole('link', { name: 'interview++ dashboard' })).toHaveCount(0);
    expect(backend.requests.some((r) => r.path.endsWith('/host'))).toBe(false);

    await page.getByPlaceholder('Message your interviewer…').fill('Hi, ready when you are.');
    await page.keyboard.press('Enter');
    await expect(page.getByText('Hi, ready when you are.')).toBeVisible();
    expect(backend.received.at(-1)).toMatchObject({ type: 'chat.send' });
    // What the host writes arrives under their name.
    backend.push({
      type: 'message.created',
      message: {
        id: '00000000-0000-4000-8000-00000000aa01',
        padId: ROOM_PAD_ID,
        role: 'interviewer',
        kind: 'chat',
        intent: null,
        text: 'Great, start with the brute force.',
        via: 'text',
        userId: 'user_grace',
        createdAt: new Date().toISOString(),
      },
    });
    await expect(page.getByText('Great, start with the brute force.')).toBeVisible();
    await expect(
      page.getByRole('region', { name: 'Chat' }).getByText('Grace Hopper', { exact: true }),
    ).toBeVisible();
  });

  test('someone with an account joins under their own name', async ({ page }) => {
    const backend = await setup(page, (b) => candidateRoom(b));
    await page.goto(`/join/${ROOM_TOKEN}`);
    await expect(page.getByText('You are signed in as Ada Lovelace')).toBeVisible();
    await expect(page.getByLabel('Your name')).toHaveCount(0);
    await page.getByRole('button', { name: 'Join the interview' }).click();
    await expect(page).toHaveURL(new RegExp(`/pads/${ROOM_PAD_ID}$`));
    const sent = backend.requests.find((r) => r.path === '/api/pads/join');
    expect(sent?.body).toEqual({ shareToken: ROOM_TOKEN });
    expect(backend.requests.some((r) => r.path === '/api/pads/join-guest')).toBe(false);
  });

  test('an ended room and a broken link say so', async ({ page }) => {
    await setup(page, (b) => {
      b.signedIn = false;
      candidateRoom(b, { pad: { status: 'ended', endedAt: iso(-60) } });
    });
    await page.goto(`/join/${ROOM_TOKEN}`);
    await expect(page.getByRole('heading', { name: 'This interview has ended' })).toBeVisible();
    await expect(page.getByLabel('Your name')).toHaveCount(0);
    await page.goto('/join/not-a-link');
    await expect(
      page.getByRole('heading', { name: 'This invite link does not work' }),
    ).toBeVisible();
  });

  test('a guest is asked to sign in for anything but the room', async ({ page }) => {
    await setup(page, (b) => {
      b.signedIn = false;
      candidateRoom(b);
    });
    await page.goto(`/join/${ROOM_TOKEN}`);
    await page.getByLabel('Your name').fill('Casey');
    await page.getByRole('button', { name: 'Join the interview' }).click();
    await expect(page).toHaveURL(new RegExp(`/pads/${ROOM_PAD_ID}$`));
    await page.goto('/dashboard');
    await expect(page).toHaveURL(/\/sign-in\?next=%2Fdashboard$/);
  });
});

test.describe('the host in the room', () => {
  test('sees who joined and talks with them', async ({ page }) => {
    const backend = await openAsHost(page, { alone: true });
    await expect(page.getByTestId('invite-banner')).toBeVisible();
    await expect(page.getByTestId('room-people')).toHaveCount(0); // tabs replace the chat header
    backend.push({ type: 'member.joined', member: GUEST_MEMBER });
    await expect(page.getByTestId('invite-banner')).toHaveCount(0);

    await page.getByPlaceholder('Message your candidate…').fill('Welcome, Casey!');
    await page.keyboard.press('Enter');
    await expect(page.getByText('Welcome, Casey!')).toBeVisible();
    await expect(page.getByText('Sending…')).toHaveCount(0);
    // No AI: nothing is thinking and nothing answers.
    await expect(page.getByTestId('interviewer-thinking')).toHaveCount(0);

    // A message that arrives while the host is in their notes is counted on the tab.
    await page.getByRole('tab', { name: 'My notes' }).click();
    backend.push({
      type: 'message.created',
      message: {
        id: '00000000-0000-4000-8000-00000000aa02',
        padId: ROOM_PAD_ID,
        role: 'candidate',
        kind: 'chat',
        intent: null,
        text: 'Can I assume one solution?',
        via: 'text',
        userId: GUEST_MEMBER.userId,
        createdAt: new Date().toISOString(),
      },
    });
    await expect(page.getByTestId('chat-unread')).toHaveText('1 new');
    await page.getByRole('tab', { name: /Chat/ }).click();
    await expect(page.getByTestId('chat-unread')).toHaveCount(0);
    await expect(
      page.getByRole('region', { name: 'Chat' }).getByText('Casey Jones', { exact: true }),
    ).toBeVisible();
  });

  test('has the interviewer notes and solution, and private notes that save', async ({ page }) => {
    const backend = await openAsHost(page);
    await page.getByRole('tab', { name: 'Guide' }).click();
    await expect(page.getByText('Only you see this tab.')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Interviewer notes' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Reference solution' })).toBeVisible();
    await expect(page.getByRole('radiogroup', { name: 'Solution language' })).toBeVisible();

    await page.getByRole('tab', { name: 'My notes' }).click();
    const notes = page.getByLabel('Your private notes');
    await notes.fill('Clear approach. Missed the duplicate case.');
    await expect(page.getByTestId('host-notes-status')).toHaveText('Saved');
    const saved = backend.requests.filter((r) => r.path.endsWith('/host/notes')).at(-1);
    expect(saved?.body).toEqual({ notes: 'Clear approach. Missed the duplicate case.' });
    // Still there after looking at the chat and coming back.
    await page.getByRole('tab', { name: /Chat/ }).click();
    await page.getByRole('tab', { name: 'My notes' }).click();
    await expect(notes).toHaveValue('Clear approach. Missed the duplicate case.');
    // The candidate's telemetry is theirs: the host pasting or looking away sends nothing.
    expect(backend.received.filter((e) => e.type === 'telemetry')).toEqual([]);
  });

  test('asks the AI for a second opinion on the code', async ({ page }) => {
    const backend = await openAsHost(page);
    await page.getByRole('tab', { name: 'Second opinion' }).click();
    await page.getByTestId('review-button').click();
    const review = page.getByTestId('review');
    await expect(review).toHaveAttribute('data-verdict', 'incorrect');
    await expect(review).toContainText('Has a problem');
    await expect(review).toContainText('for nums = [3, 2, 4] and target = 6');
    await expect(review).toContainText('You could ask');
    expect(backend.reviews).toEqual([undefined]);

    await page.getByLabel('Something specific to check').fill('Is the loop bound right?');
    await expect(page.getByTestId('review-button')).toHaveText(/Ask about the code/);
    await page.getByTestId('review-button').click();
    await expect(page.getByTestId('review')).toHaveCount(2);
    await expect(page.getByTestId('review').first()).toContainText(
      'Yes: the loop visits every index once',
    );
    expect(backend.reviews).toEqual([undefined, 'Is the loop bound right?']);
    // Nothing of it went into the chat.
    await page.getByRole('tab', { name: /Chat/ }).click();
    await expect(page.getByRole('region', { name: 'Chat' })).not.toContainText('Has a problem');
  });

  test('the second opinion needs the host’s own key', async ({ page }) => {
    const backend = await openAsHost(page, {
      configure: (b) => {
        b.aiKey = aiKeyStatus('missing');
      },
    });
    await page.getByRole('tab', { name: 'Second opinion' }).click();
    await expect(page.getByTestId('review-key-prompt')).toContainText('your own API key');
    await expect(page.getByTestId('review-button')).toBeDisabled();
    expect(backend.reviews).toEqual([]);
  });

  test('changes the problem, and can go to a blank editor', async ({ page }) => {
    const backend = await openAsHost(page);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Two Sum');
    await page.getByTestId('change-problem').click();
    const dialog = page.getByRole('dialog', { name: 'Change the problem' });
    const confirm = dialog.getByRole('button', { name: 'Change problem' });
    await expect(confirm).toBeDisabled(); // the current problem is selected
    await dialog.getByLabel('Search problems').fill('lru');
    await dialog.getByRole('radio', { name: /LRU Cache/ }).click();
    await confirm.click();
    await expect(dialog).toHaveCount(0);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('LRU Cache');
    expect(backend.requests.find((r) => r.path.endsWith('/problem'))?.body).toEqual({
      problemSlug: 'lru-cache',
    });
    // The guide follows the problem.
    await page.getByRole('tab', { name: 'Guide' }).click();
    await expect(page.getByRole('heading', { name: 'Interviewer notes' })).toBeVisible();
    expect(backend.requests.filter((r) => r.path.endsWith('/host')).length).toBeGreaterThan(0);

    await page.getByRole('tab', { name: 'Problem' }).click();
    await page.getByTestId('change-problem').click();
    await dialog.getByRole('radio', { name: /Blank editor/ }).click();
    await confirm.click();
    await expect(page.getByRole('heading', { name: 'Blank editor' })).toBeVisible();
    await expect(page.getByTestId('run-tests')).toHaveCount(0);
    await expect(page.getByTestId('change-problem')).toHaveText(/Choose a problem/);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Two Sum'); // the room's title
  });

  test('the candidate follows a change of problem', async ({ page }) => {
    const backend = await setup(page, (b) => {
      candidateRoom(b, {
        members: [
          { userId: 'user_grace', name: 'Grace Hopper', role: 'owner', guest: false },
          { userId: USER.id, name: USER.name, role: 'collaborator', guest: false },
        ],
      });
    });
    await page.goto(`/pads/${ROOM_PAD_ID}`);
    await editorReady(page);
    const detail = makeRoomDetail({ as: 'candidate', pad: { problemSlug: 'lru-cache' } });
    backend.push({ type: 'pad.problem', pad: detail.pad, problem: detail.problem });
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('LRU Cache');
    await expect(page.getByRole('heading', { level: 2, name: 'LRU Cache' })).toBeVisible();
  });
});

test.describe('after the interview', () => {
  const ended = { status: 'ended', endedAt: iso(-60), startedAt: iso(-2700) } as const;

  test('the host gets the report with their notes, and an AI assessment on request', async ({
    page,
  }) => {
    const backend = await setup(page, (b) => {
      b.pads.set(
        ROOM_PAD_ID,
        makeRoomDetail({
          pad: ended,
          members: [HOST_MEMBER, GUEST_MEMBER],
          messages: roomMessages(),
        }),
      );
    });
    await page.goto(`/pads/${ROOM_PAD_ID}/report`);
    await expect(page.getByRole('heading', { name: 'Your notes' })).toBeVisible();
    await expect(page.getByLabel('Your private notes')).toBeVisible();
    await expect(page.getByText('Want a second opinion on this interview?')).toBeVisible();
    expect(backend.requests.some((r) => r.path.endsWith('/report/assessment'))).toBe(false);
    await page.getByTestId('request-assessment').click();
    await expect(page.getByText('Writing your assessment…')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Assessment' })).toBeVisible({
      timeout: 10_000,
    });
  });

  test('the candidate keeps the read-only pad but not the report', async ({ page }) => {
    await setup(page, (b) => {
      candidateRoom(b, {
        pad: ended,
        members: [
          { userId: 'user_grace', name: 'Grace Hopper', role: 'owner', guest: false },
          { userId: USER.id, name: USER.name, role: 'collaborator', guest: false },
        ],
      });
    });
    await page.goto(`/pads/${ROOM_PAD_ID}`);
    await expect(page.getByText('This interview has ended. The pad is read-only.')).toBeVisible();
    await expect(page.getByRole('link', { name: /report/i })).toHaveCount(0);
    await page.goto(`/pads/${ROOM_PAD_ID}/report`);
    await expect(page.getByText('This report is for the interviewer')).toBeVisible();
  });
});
