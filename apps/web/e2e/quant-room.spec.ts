/**
 * Quant rooms (ARCHITECTURE §8.4): a host interviews a candidate on questions of the bank. The
 * mock (mock-quant-room.ts) runs the round through the contract's own `advanceRound`; where it
 * matters, the host and the candidate are two browser contexts in the same room.
 */
import { type Browser, type BrowserContext, expect, type Page, test } from '@playwright/test';
import { aiKeyStatus, GUEST, USER, uuid } from './fixtures';
import {
  QROOM_EMPTY_PAD_ID,
  QROOM_ENDED_PAD_ID,
  QROOM_GUEST,
  QROOM_HOST,
  QROOM_OTHER_HOST,
  QROOM_PAD_ID,
  QROOM_TOKEN,
} from './fixtures-quant-room';
import { setup } from './helpers';
import type { MockBackend } from './mock-api';
import type { RoomScriptLine } from './mock-quant-room';

/** What only the host may ever see, in the fixtures' words: none of it may reach a candidate. */
const HOST_ONLY = [
  // answers and solutions
  '5}{36} \\\\approx',
  'five add up to',
  'Light rope A at both ends',
  // hints, follow-ups and key points
  'List the pairs that add up to',
  'Why is it the most likely sum',
  'When the first rope burns out',
  'How would you measure',
  'Lighting both ends halves the time',
  // a queued question never asked
  'largest eigenvalue',
  // the host's verdict note
  'Counted the pairs without help',
  // bank ids, the queue
  'rb-prob-dice-eight',
  'rb-la-eigen-symmetric',
  '"queue"',
  '"verdict"',
  '"hintRungs"',
];

const connected = (page: Page) =>
  expect(page.getByRole('status', { name: 'Connected' })).toBeVisible({ timeout: 20_000 });

/** The host's own room, set up by `seed`. */
async function openAsHost(
  page: Page,
  o: {
    queue?: string[];
    script?: RoomScriptLine[];
    alone?: boolean;
    configure?: (b: MockBackend) => void;
  } = {},
) {
  const backend = await setup(page, (b) => {
    b.useRoomBank();
    b.quantRooms.seed({
      id: QROOM_PAD_ID,
      token: QROOM_TOKEN,
      members: o.alone ? [QROOM_HOST] : [QROOM_HOST, QROOM_GUEST],
      queue: o.queue,
      script: o.script,
    });
    o.configure?.(b);
  });
  await page.goto(`/pads/${QROOM_PAD_ID}`);
  await connected(page);
  await expect(page.getByTestId('host-desk')).toBeVisible();
  return backend;
}

/** A room hosted by someone else, the signed-in user (an account) a candidate in it. */
async function openAsCandidate(page: Page, script: RoomScriptLine[] = []) {
  const backend = await setup(page, (b) => {
    b.useRoomBank();
    b.quantRooms.seed({
      id: QROOM_PAD_ID,
      as: 'candidate',
      owner: QROOM_OTHER_HOST,
      members: [
        QROOM_OTHER_HOST,
        { userId: USER.id, name: USER.name, role: 'collaborator', guest: false },
      ],
      script,
    });
  });
  return backend;
}

/**
 * The host (an account) and a guest candidate in two browser contexts, sharing one room. The
 * candidate has not joined yet: they open the invite link. Everything the candidate's page is
 * sent (HTTP bodies and socket events) is kept in `received` for the leak scan.
 */
async function twoPeople(browser: Browser, queue: string[]) {
  const contexts: BrowserContext[] = [];
  const hostCtx = await browser.newContext();
  contexts.push(hostCtx);
  const hostPage = await hostCtx.newPage();
  const host = await setup(hostPage, (b) => {
    b.useRoomBank();
    b.quantRooms.seed({ id: QROOM_PAD_ID, token: QROOM_TOKEN, members: [QROOM_HOST], queue });
  });
  const candCtx = await browser.newContext();
  contexts.push(candCtx);
  const candPage = await candCtx.newPage();
  const cand = await setup(candPage, (b) => {
    b.signedIn = false;
  });
  host.quantRooms.share(cand, QROOM_PAD_ID, QROOM_TOKEN);
  cand.quantRooms = host.quantRooms;
  const received: string[] = [];
  const push = cand.push.bind(cand);
  cand.push = (e) => {
    received.push(JSON.stringify(e));
    push(e);
  };
  candPage.on('response', async (r) => {
    if (!r.url().includes('/api/')) return;
    try {
      received.push(await r.text());
    } catch {
      /* a body that is gone */
    }
  });
  return {
    host,
    hostPage,
    cand,
    candPage,
    received,
    close: async () => {
      for (const c of contexts) await c.close();
    },
  };
}

test.describe('creating a quant room', () => {
  test('lines questions up from the bank: filtered, searched, reordered and removed', async ({
    page,
  }) => {
    const backend = await setup(page, (b) => {
      b.useRoomBank();
      // No AI key is needed to host.
      b.aiKey = aiKeyStatus('missing');
    });
    await page.goto('/dashboard');
    await page.getByRole('radio', { name: 'Interview someone' }).click();
    await page.getByRole('radio', { name: 'Quant questions' }).click();
    await expect(page).toHaveURL(/\/dashboard\?mode=host&format=quant$/);
    const setupPanel = page.getByTestId('quant-room-setup');
    await expect(setupPanel.getByTestId('setup-queue-empty')).toContainText('Nothing lined up');
    await expect(page.getByTestId('create-quant-room')).toHaveText('Create an empty room');
    await expect(page.getByTestId('create-quant-room')).toBeEnabled();

    const rows = page.getByTestId('bank-row');
    // Both tracks, quant first.
    await expect(rows.first()).toHaveAttribute('data-question', 'rb-prob-dice-eight');
    await expect(page.getByTestId('bank-page')).toHaveText('1–11 of 11');
    // By type.
    await page.getByRole('combobox', { name: 'Type' }).click();
    await page.getByRole('option', { name: 'Program output' }).click();
    await expect(rows).toHaveCount(2);
    await page.getByRole('button', { name: 'Queue rb-py-default-list' }).click();
    // A row shows what the candidate will see: the program, composed into the prompt.
    await rows
      .filter({ hasText: 'What does this program print?' })
      .first()
      .locator('summary')
      .click();
    await expect(rows.first().locator('pre').first()).toBeVisible();
    // By text, across every topic.
    await page.getByRole('button', { name: 'Clear', exact: true }).click();
    await page.getByLabel('Search the bank').fill('ropes');
    await expect(rows).toHaveCount(1);
    await page.getByRole('button', { name: 'Queue rb-teaser-ropes' }).click();
    // By track and topic.
    await page.getByLabel('Search the bank').fill('');
    await page.getByRole('radio', { name: 'Quant', exact: true }).click();
    await page.getByRole('combobox', { name: 'Topic' }).click();
    await page.getByRole('option', { name: /^Probability/ }).click();
    await expect(rows).toHaveCount(3);
    await page.getByRole('combobox', { name: 'Subtopic' }).click();
    await page.getByRole('option', { name: 'Dice and counting' }).click();
    await expect(rows).toHaveCount(1);
    await page.getByRole('button', { name: 'Queue rb-prob-dice-eight' }).click();
    await expect(
      page.getByRole('button', { name: 'Remove rb-prob-dice-eight from the queue' }),
    ).toBeVisible();

    const items = page.getByTestId('setup-queue-item');
    await expect(items).toHaveCount(3);
    await page.getByRole('button', { name: 'Move question 3 up' }).click();
    await page.getByRole('button', { name: 'Move question 2 up' }).click();
    await page.getByRole('button', { name: 'Remove question 3' }).click();
    await expect(items).toHaveCount(2);
    await expect(page.getByTestId('create-quant-room')).toHaveText('Create room');
    await expect(page.getByTestId('create-quant-room-note')).toHaveText(
      '2 questions lined up. Nobody sees them until you ask.',
    );
    await page.getByTestId('create-quant-room').click();
    await expect(page).toHaveURL(/\/pads\/[0-9a-f-]{36}$/);
    const sent = backend.requests.find((r) => r.method === 'POST' && r.path === '/api/pads');
    expect(sent?.body).toEqual({
      kind: 'room',
      format: 'quant',
      durationMin: 45,
      queue: ['rb-prob-dice-eight', 'rb-py-default-list'],
    });
    // The room: the host's desk, the first queued question up next, and the invite to send.
    await connected(page);
    await expect(page.getByTestId('room-role')).toHaveText('· you are hosting');
    await expect(page.getByTestId('invite-banner')).toContainText('Nobody has joined yet');
    await expect(page.getByTestId('up-next')).toContainText('Two fair six-sided dice');
    await page.getByRole('tab', { name: /^Queue/ }).click();
    await expect(page.getByTestId('queue-item')).toHaveCount(2);
  });

  test('or an empty room, with nothing to pick', async ({ page }) => {
    const backend = await setup(page, (b) => b.useRoomBank());
    await page.goto('/dashboard?mode=host&format=quant');
    await page.getByTestId('create-quant-room').click();
    await expect(page).toHaveURL(/\/pads\/[0-9a-f-]{36}$/);
    const sent = backend.requests.find((r) => r.method === 'POST' && r.path === '/api/pads');
    expect(sent?.body).toEqual({ kind: 'room', format: 'quant', durationMin: 45 });
    await connected(page);
    await expect(page.getByTestId('desk-idle')).toContainText('No question asked yet');
    await expect(page.getByTestId('open-bank-idle')).toBeVisible();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Quant interview');
  });

  test('switching back to a coding problem keeps the coding setup', async ({ page }) => {
    await setup(page, (b) => b.useRoomBank());
    await page.goto('/dashboard?mode=host&format=quant');
    await expect(page.getByTestId('quant-room-setup')).toBeVisible();
    await page.getByRole('radio', { name: 'A coding problem' }).click();
    await expect(page).toHaveURL(/\/dashboard\?mode=host$/);
    await expect(page.getByRole('button', { name: 'Create room' })).toBeDisabled();
    await expect(page.getByText('You are the interviewer')).toBeVisible();
  });
});

test.describe('the host and a guest candidate in one room', () => {
  test.setTimeout(150_000);

  test('the whole interview: join, questions of each kind, hints, follow-up, verdicts, the end', async ({
    browser,
  }) => {
    const room = await twoPeople(browser, [
      'rb-prob-dice-eight',
      'rb-teaser-ropes',
      'rb-la-eigen-symmetric',
    ]);
    const { host, hostPage: h, candPage: c } = room;

    // The guest joins with a name and lands in the quant room, waiting.
    await c.goto(`/join/${QROOM_TOKEN}`);
    // The invite names what they will work in: no code editor in a quant room.
    await expect(c.getByText(/share a scratchpad, a whiteboard and a chat/)).toBeVisible();
    await c.getByLabel('Your name').fill('Casey Jones');
    await c.getByRole('button', { name: 'Join the interview' }).click();
    await expect(c).toHaveURL(new RegExp(`/pads/${QROOM_PAD_ID}$`));
    await connected(c);
    await expect(c.getByTestId('round-waiting')).toContainText(
      'Your interviewer will post a question here',
    );
    await expect(c.getByTestId('room-role')).toHaveText('· interview with Ada Lovelace');
    // Nothing of an AI interviewer or a clock.
    for (const id of ['question-timer', 'interviewer-thinking', 'voice-bar', 'ai-key-prompt'])
      await expect(c.getByTestId(id)).toHaveCount(0);
    await expect(c.getByTestId('host-desk')).toHaveCount(0);

    await h.goto(`/pads/${QROOM_PAD_ID}`);
    await connected(h);
    await expect(h.getByTestId('invite-banner')).toHaveCount(0);

    // 1. Asked from the queue: a numeric question.
    await h.getByTestId('ask-next').click();
    const open = h.getByTestId('open-question');
    await expect(open).toContainText('Question 1');
    await expect(open.getByTestId('host-answer')).toContainText('5');
    await expect(c.getByTestId('round-heading')).toHaveText('Question 1');
    await expect(c.getByTestId('question-prompt')).toContainText('Two fair six-sided dice');
    await expect(c.getByTestId('question-timer')).toHaveCount(0);
    await expect(c.getByTestId('question-message')).toHaveCount(1);

    // Hints: the next rung is obvious, each recorded in one click; then one of the host's own.
    const rungs = open.getByTestId('hint-rung');
    await expect(rungs.nth(0)).toHaveAttribute('data-state', 'next');
    await open.getByTestId('record-hint').click();
    await expect(rungs.nth(0)).toHaveAttribute('data-state', 'given');
    await expect(rungs.nth(1)).toHaveAttribute('data-state', 'next');
    await open.getByTestId('record-own-hint').click();
    await expect(open.getByTestId('hints-recorded')).toHaveText('2 hints given');
    await expect(open.getByTestId('own-hints')).toHaveText('1 hint of your own');
    await expect(c.getByTestId('hints-given')).toHaveText('2 hints so far');
    // The follow-up, once.
    await open.getByTestId('record-follow-up').click();
    await expect(open.getByTestId('follow-up-asked')).toBeVisible();
    // None of it went into the chat.
    await expect(c.getByRole('region', { name: 'Chat' })).not.toContainText('List the pairs');

    // Closed with a verdict.
    await open.getByRole('radio', { name: 'Good' }).click();
    await open
      .getByLabel('Your note on the answer (optional)')
      .fill('Counted the pairs without help');
    await expect(open.getByTestId('close-question')).toHaveText('Close with 75%');
    await open.getByTestId('close-question').click();
    await expect(h.getByTestId('desk-idle')).toContainText('No question is open');
    await expect(c.getByTestId('round-waiting')).toContainText('Waiting for the next question');
    await expect(c.getByTestId('earlier-questions')).toContainText('Question 1');

    // 2. Picked from the bank mid-interview: a program to read.
    await h.getByTestId('open-bank').click();
    const sheet = h.getByTestId('bank-sheet');
    await expect(sheet.getByTestId('bank-row').first()).toBeVisible();
    // What was asked and what is queued are marked.
    await expect(sheet.locator('[data-question="rb-prob-dice-eight"]')).toHaveAttribute(
      'data-status',
      'posed',
    );
    await expect(sheet.locator('[data-question="rb-teaser-ropes"]')).toHaveAttribute(
      'data-status',
      'queued',
    );
    // With its solution on demand.
    const reserve = sheet.locator('[data-question="rb-cpp-vector-reserve"]');
    await reserve.locator('summary').first().click();
    await expect(reserve.getByTestId('host-answer')).toContainText('It prints');
    // The desk stays usable beside the bank.
    await expect(h.getByTestId('host-desk')).toBeVisible();
    await sheet.getByRole('button', { name: 'Ask rb-cpp-vector-reserve now' }).click();
    await expect(sheet).toHaveCount(0);
    await expect(open).toContainText('Question 2');
    await expect(c.getByTestId('round-heading')).toHaveText('Question 2');
    await expect(c.getByTestId('question-prompt').locator('pre')).toContainText('v.reserve(10);');
    await expect(c.getByTestId('question-prompt')).toContainText('C++, C++20.');

    // 3. Asked while 2 is open: a choice question; the host confirms closing 2 without a verdict.
    await h.getByTestId('open-bank').click();
    await sheet.getByRole('button', { name: 'Ask rb-opt-parity-holds now' }).click();
    await expect(h.getByRole('dialog', { name: 'Question 2 is still open' })).toBeVisible();
    await h.getByTestId('confirm-pose').click();
    await expect(open).toContainText('Question 3');
    await expect(c.getByTestId('round-heading')).toHaveText('Question 3');
    await expect(c.getByTestId('question-prompt').getByRole('listitem')).toHaveCount(4);
    await expect(c.getByTestId('question-prompt')).toContainText(
      'Choose every option that applies.',
    );

    // Closed without a verdict, then given one from the Asked list.
    await open.getByTestId('close-question').click();
    await expect(open).toHaveCount(0);
    await h.getByRole('tab', { name: /^Asked/ }).click();
    const asked = h.getByTestId('asked-item');
    await expect(asked).toHaveCount(3);
    await expect(asked.nth(2).getByTestId('asked-score')).toHaveText('75%');
    await expect(asked.nth(0).getByTestId('asked-score')).toHaveText('No verdict');
    await asked.nth(0).locator('summary').first().click();
    await asked.nth(0).getByRole('radio', { name: '50%' }).click();
    await asked.nth(0).getByTestId('save-verdict').click();
    await expect(asked.nth(0).getByTestId('asked-score')).toHaveText('50%');
    const put = host.requests.filter((r) => r.path.endsWith('/host/round/verdict')).at(-1);
    expect(put?.body).toEqual({ index: 2, verdict: { score: 0.5, summary: '' } });
    // The queue kept what was not asked.
    await h.getByRole('tab', { name: /^Queue/ }).click();
    await expect(h.getByTestId('queue-item')).toHaveCount(2);

    // The end: the host to the report, the candidate to a read-only room.
    await h.getByRole('button', { name: 'End interview' }).click();
    await expect(h.getByTestId('end-round-note')).toContainText('3 questions asked');
    await h.getByRole('button', { name: 'End and see report' }).click();
    await expect(h).toHaveURL(new RegExp(`/pads/${QROOM_PAD_ID}/report$`));
    await expect(c.getByText('This interview has ended. The pad is read-only.')).toBeVisible();
    await expect(c.getByTestId('round-waiting')).toContainText('The interview has ended');
    await expect(c.getByRole('link', { name: /report/i })).toHaveCount(0);

    // Nothing host-only ever reached the candidate: not in what was sent, not on the page.
    const all = room.received.join('\n');
    for (const secret of HOST_ONLY) expect(all, secret).not.toContain(secret);
    const text = (await c.locator('body').textContent()) ?? '';
    for (const secret of [
      'Light rope A',
      'List the pairs',
      'largest eigenvalue',
      'Counted the pairs',
    ])
      expect(text).not.toContain(secret);
    expect(room.cand.requests.some((r) => r.path.includes('/host'))).toBe(false);
    await room.close();
  });
});

test.describe('the candidate', () => {
  test('reads each kind of question as posed', async ({ page }) => {
    const backend = await openAsCandidate(page);
    await page.goto(`/pads/${QROOM_PAD_ID}`);
    await connected(page);
    await expect(page.getByTestId('round-waiting')).toContainText(
      'Your interviewer will post a question here',
    );
    const prompt = page.getByTestId('question-prompt');
    // Single choice: the options as a list.
    backend.quantRooms.pose(QROOM_PAD_ID, 'rb-prob-two-children');
    await expect(page.getByTestId('round-heading')).toHaveText('Question 1');
    await expect(prompt.getByRole('listitem')).toHaveCount(4);
    await expect(prompt).toContainText('(a)');
    await expect(prompt).toContainText('Choose one.');
    // Output (Python).
    backend.quantRooms.pose(QROOM_PAD_ID, 'rb-py-default-list');
    await expect(page.getByTestId('round-heading')).toHaveText('Question 2');
    await expect(prompt.locator('pre')).toContainText('xs.append(x)');
    await expect(prompt).toContainText('Python, Python 3.12.');
    // Short.
    backend.quantRooms.pose(QROOM_PAD_ID, 'rb-teaser-ropes');
    await expect(prompt).toContainText('measure exactly');
    // Numeric, with a unit.
    backend.quantRooms.pose(QROOM_PAD_ID, 'rb-mm-capped-doubling');
    await expect(page.getByTestId('question-unit')).toHaveText('Answer in dollars');
    await expect(page.getByTestId('earlier-questions').getByRole('listitem')).toHaveCount(3);
    // Each is a card in the chat, numbered, with no "of N".
    await expect(page.getByTestId('question-message')).toHaveCount(4);
    await expect(page.getByTestId('question-message').last()).toContainText('Question 4');
    await expect(page.getByText(/of \d+/)).toHaveCount(0);
    await expect(page.getByPlaceholder('Message your interviewer…')).toBeVisible();
  });

  test('a candidate with an account sees the quiz explain why answers are hidden', async ({
    page,
  }) => {
    await openAsCandidate(page);
    // Answering in the question bank would show the answer and its explanation.
    await page.goto('/quiz/topics/operating-systems?question=rb-os-fork-child');
    await page.getByRole('radio', { name: /child's PID/ }).click();
    await page.getByTestId('bank-primary').click();
    await expect(page.getByTestId('quant-interview-guard')).toContainText(
      'Answers are hidden during your interview',
    );
    // An attempt.
    await page.goto(`/quiz/${uuid(9001)}`);
    await expect(page.getByTestId('quant-interview-guard')).toContainText(
      'Answers are hidden during your interview',
    );
  });
});

test.describe('the host’s desk', () => {
  test('the second opinion: a verdict to use, and its states', async ({ page }) => {
    const backend = await openAsHost(page, { script: [{ at: 30, pose: 'rb-prob-dice-eight' }] });
    await page.getByRole('tab', { name: 'Second opinion' }).click();
    await page.getByLabel('Something specific to check').fill('Is (4,4) counted once?');
    await page.getByTestId('review-button').click();
    const card = page.getByTestId('quant-opinion');
    await expect(card).toHaveAttribute('data-verdict', 'partly_correct');
    await expect(card).toContainText('Partly correct');
    await expect(card).toContainText('Counted ordered pairs');
    await expect(card).toContainText('You could ask');
    await expect(card).toContainText('is a single outcome');
    await expect(card.getByTestId('opinion-score')).toContainText('55%');
    expect(backend.quantRooms.opinions.at(-1)).toEqual({
      index: 0,
      question: 'Is (4,4) counted once?',
    });
    // Its score, into the verdict being written, in one click.
    await card.getByTestId('use-opinion-score').click();
    await expect(page.getByTestId('close-question')).toHaveText('Close with 50%');
    // Nothing of it in the chat.
    await page.getByRole('tab', { name: /Chat/ }).click();
    await expect(page.getByRole('region', { name: 'Chat' })).not.toContainText('Partly correct');

    // The daily budget, and a failed call.
    await page.getByRole('tab', { name: 'Second opinion' }).click();
    backend.quantRooms.opinion = 'budget';
    await page.getByTestId('review-button').click();
    const panel = page.getByTestId('quant-second-opinion');
    await expect(panel.getByRole('alert')).toContainText('AI allowance');
    backend.quantRooms.opinion = 'failed';
    await page.getByTestId('review-button').click();
    await expect(panel.getByRole('alert')).toContainText('could not look at the question');
  });

  test('the second opinion needs the host’s own key, and a question asked', async ({ page }) => {
    const backend = await openAsHost(page, {
      configure: (b) => {
        b.aiKey = aiKeyStatus('missing');
      },
    });
    await page.getByRole('tab', { name: 'Second opinion' }).click();
    await expect(page.getByTestId('review-key-prompt')).toContainText('your own API key');
    await expect(page.getByTestId('review-button')).toBeDisabled();
    await expect(page.getByTestId('review-button')).toHaveText('No question asked yet');
    expect(backend.quantRooms.opinions).toEqual([]);
  });

  test('reorders, removes and asks from the queue; a hint ladder runs out', async ({ page }) => {
    const backend = await openAsHost(page, {
      queue: ['rb-prob-wait-six', 'rb-stats-n-minus-one', 'rb-la-eigen-symmetric'],
    });
    await page.getByRole('tab', { name: /^Queue/ }).click();
    const items = page.getByTestId('queue-item');
    await expect(items).toHaveCount(3);
    await page.getByRole('button', { name: 'Move queued question 3 up' }).click();
    await expect(items.nth(1)).toHaveAttribute('data-question', 'rb-la-eigen-symmetric');
    await page.getByRole('button', { name: 'Remove queued question 1' }).click();
    await expect(items).toHaveCount(2);
    const puts = backend.requests.filter((r) => r.path.endsWith('/host/round/queue'));
    expect(puts.map((r) => r.body)).toEqual([
      { questionIds: ['rb-prob-wait-six', 'rb-la-eigen-symmetric', 'rb-stats-n-minus-one'] },
      { questionIds: ['rb-la-eigen-symmetric', 'rb-stats-n-minus-one'] },
    ]);
    // A queued question's material on demand.
    await items.nth(1).locator('summary').first().click();
    await expect(items.nth(1).getByTestId('host-answer')).toContainText('Deviations are measured');
    // Ask the second one: it leaves the queue.
    await page.getByRole('button', { name: 'Ask queued question 2 now' }).click();
    const open = page.getByTestId('open-question');
    await expect(open).toContainText('Question 1');
    await expect(items).toHaveCount(1);
    // One written hint, then only the host's own.
    await open.getByTestId('record-hint').click();
    await expect(open.getByTestId('record-hint')).toHaveCount(0);
    await open.getByTestId('record-own-hint').click();
    await expect(open.getByTestId('hints-recorded')).toHaveText('2 hints given');
    const hints = backend.requests.filter((r) => r.path.endsWith('/host/round/hint'));
    expect(hints.map((r) => r.body)).toEqual([
      { index: 0, rung: 1 },
      { index: 0, rung: 0 },
    ]);
    // A refusal is said plainly (here: the room ended elsewhere).
    backend.fail(/\/host\/round\/follow-up$/, 409, {
      error: { code: 'pad_ended', message: 'This interview has ended' },
    });
    await open.getByTestId('record-follow-up').click();
    await expect(page.getByText('Could not record the follow-up')).toBeVisible();
  });
});

test.describe('the report', () => {
  test('the questions asked with their solutions, times, hints and the host’s verdicts', async ({
    page,
  }) => {
    const backend = await setup(page, (b) => b.useRoomBank());
    await page.goto(`/pads/${QROOM_ENDED_PAD_ID}/report`);
    await expect(page.getByText('Quant interview report')).toBeVisible();
    const stats = page.getByTestId('quant-stats');
    await expect(stats).toContainText('Asked');
    await expect(stats).toContainText('2 closed · 1 open at the end');
    await expect(stats).toContainText('3 candidate · 1 you');
    // No budgets.
    await expect(page.getByText(/ of \d+:\d\d/)).toHaveCount(0);
    const reviews = page.getByTestId('question-review');
    await expect(reviews).toHaveCount(3);
    const first = reviews.nth(0);
    await expect(first.getByTestId('review-status')).toHaveText('Closed');
    await expect(first.getByTestId('review-score')).toHaveText('100%');
    await expect(first.getByTestId('review-time')).toHaveText('1:50 open');
    await expect(first.getByTestId('review-follow-up')).toBeVisible();
    await expect(first.getByTestId('review-verdict')).toContainText('Your verdict');
    await expect(first.getByTestId('review-solution')).toContainText('0.139');
    const second = reviews.nth(1);
    await expect(second.getByTestId('review-hints')).toHaveText(
      '3 hints: rungs 1 and 2, and one in your own words',
    );
    await expect(second).toContainText('Lighting both ends halves the time');
    await expect(reviews.nth(2).getByTestId('review-status')).toHaveText('Open at the end');
    // A missing verdict can still be given.
    const give = second.getByTestId('give-verdict');
    await give.getByRole('radio', { name: 'Good' }).click();
    await give.getByTestId('save-report-verdict').click();
    await expect(second.getByTestId('review-score')).toHaveText('75%');
    expect(backend.requests.find((r) => r.path.endsWith('/host/round/verdict'))?.body).toEqual({
      index: 1,
      verdict: { score: 0.75, summary: '' },
    });

    // The assessment when asked for.
    await page.getByTestId('request-assessment').click();
    await expect(page.getByText('Writing your assessment…')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Assessment' })).toBeVisible({
      timeout: 10_000,
    });
  });

  test('an empty room has nothing to assess', async ({ page }) => {
    await setup(page, (b) => b.useRoomBank());
    await page.goto(`/pads/${QROOM_EMPTY_PAD_ID}/report`);
    await expect(page.getByTestId('quant-review-empty')).toContainText('No question was asked');
    await expect(page.getByTestId('quant-stats')).toContainText('no question was asked');
    await page.getByTestId('request-assessment').click();
    await expect(page.getByText('Nothing to assess')).toBeVisible();
    await expect(page.getByText('Could not start the assessment')).toHaveCount(0);
  });

  test('the dashboard lists a quant room as one, without coding things', async ({ page }) => {
    await setup(page, (b) => {
      b.useRoomBank();
      b.quantRooms.listOnDashboard();
    });
    await page.goto('/dashboard?view=history');
    const row = page.getByRole('row', { name: /Quant interview with Casey/ });
    await expect(row.getByTestId('quant-badge')).toHaveText('Quant questions');
    await expect(row).toContainText('Hosting');
    await expect(row).toContainText('Your verdicts in the report');
    await expect(row).not.toContainText('Solved');
    await expect(row).not.toContainText('Python');
  });
});

test.describe('on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('the host opens on the desk; the candidate on the chat, with the question above it', async ({
    browser,
  }) => {
    const hostCtx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const h = await hostCtx.newPage();
    const host = await setup(h, (b) => {
      b.useRoomBank();
      b.quantRooms.seed({
        id: QROOM_PAD_ID,
        token: QROOM_TOKEN,
        members: [QROOM_HOST, { ...QROOM_GUEST, userId: GUEST.id }],
        queue: ['rb-teaser-ropes'],
      });
    });
    await h.goto(`/pads/${QROOM_PAD_ID}`);
    await connected(h);
    await expect(h.getByRole('tab', { name: 'Desk' })).toHaveAttribute('aria-selected', 'true');
    await h.getByTestId('ask-next').click();
    const open = h.getByTestId('open-question');
    await expect(open.getByTestId('host-answer')).toBeVisible();
    await expect(open.getByTestId('record-hint')).toBeInViewport();
    await expect(open.getByTestId('close-question')).toBeVisible();
    await h.getByRole('tab', { name: 'Chat & notes' }).click();
    await expect(h.getByRole('tab', { name: 'Second opinion' })).toBeVisible();

    const candCtx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const c = await candCtx.newPage();
    const cand = await setup(c, (b) => {
      b.me = { ...GUEST, guest: true };
    });
    host.quantRooms.share(cand, QROOM_PAD_ID, QROOM_TOKEN);
    cand.quantRooms = host.quantRooms;
    await c.goto(`/pads/${QROOM_PAD_ID}`);
    await connected(c);
    await expect(c.getByRole('tab', { name: 'Chat' })).toHaveAttribute('aria-selected', 'true');
    const strip = c.getByTestId('question-strip');
    await expect(strip).toContainText('Question 1');
    await expect(strip.getByTestId('question-timer')).toHaveCount(0);
    await strip.click();
    await expect(c.getByTestId('question-prompt')).toContainText('measure exactly');
    // No horizontal scroll on either.
    for (const p of [h, c])
      expect(await p.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    await hostCtx.close();
    await candCtx.close();
  });
});
