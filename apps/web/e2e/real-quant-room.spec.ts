/**
 * A quant room against the real API (no interception), with the host and two candidates in
 * separate browser contexts: a guest who joins by the invite link with only a name, and a
 * candidate with an account who also opens the quiz in another tab. See playwright.real.config.ts.
 * Skipped unless REAL_API=1 and REAL_ANTHROPIC_KEY is set: the host's second opinion and the
 * assessment run on that key, pasted into the key dialog through the clipboard (never typed, never
 * printed) and removed at the end. Screenshots go to e2e/.screens/real-quant-room-*.png.
 *
 * Every API response body and pad-socket message each context receives is recorded. The host's
 * views carry the full material of every question they looked at (solutions, explanations, key
 * points, hints, follow-ups) and their verdicts; all of it, the second opinion and each queued
 * question's prompt before it was posed must be absent from what the candidates received. The
 * same matcher is run over the host's own capture first, so a scan that could not find anything
 * fails instead of passing.
 */
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { type BrowserContext, expect, type Locator, type Page, test } from '@playwright/test';

test.skip(
  !process.env.REAL_API || !process.env.REAL_ANTHROPIC_KEY,
  'set REAL_API=1 and REAL_ANTHROPIC_KEY with the API on :4000 and next dev on :3000',
);
// Traces record typed values; this test handles a real API key.
test.use({ trace: 'off', actionTimeout: 30_000, navigationTimeout: 60_000 });

const KEY = process.env.REAL_ANTHROPIC_KEY?.trim() ?? '';
const MODEL_MS = 180_000;

/** The questions, from the seeded bank: three types queued, one picked mid-interview. */
const Q_NUMERIC = 'prob-conditional-004'; // the two-headed coin (numeric, two hints, follow-ups)
const Q_CHOICE = 'bt-invariants-001'; // the mutilated chessboard (single choice)
const Q_SHORT = 'bt-games-002'; // tigers and the sheep (open-ended); queued, never posed
const Q_PICKED = 'prob-expectation-003'; // every face of a die (numeric), from the bank
const Q_EXTRA = ['bt-geometry-005', 'prob-continuous-004']; // queued mid-interview
const QUIZ_QUESTION = 'bt-geometry-006'; // what the account candidate tries in the quiz

const LOG = 'e2e/.screens/real-quant-room.log';
const trace = (line: string) => appendFileSync(LOG, `${line}\n`);
const shot = (page: Page, name: string, fullPage = false) =>
  page.screenshot({ path: `e2e/.screens/real-quant-room-${name}.png`, fullPage });

type Rec = { seq: number; who: string; src: string; body: string };
let seq = 0;

/** Records what a page receives and flags failures; `expected` lists the refusals that are. */
function watch(
  page: Page,
  who: string,
  recs: Rec[],
  problems: string[],
  expected: (status: number, method: string, url: string) => boolean = () => false,
) {
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    // The browser's own line for a refused request; the response handler judges those.
    if (/Failed to load resource: the server responded with a status of/.test(m.text())) return;
    problems.push(`${who} console: ${m.text()}`);
  });
  page.on('pageerror', (e) => problems.push(`${who} pageerror: ${e.message}`));
  page.on('response', async (r) => {
    const url = r.url();
    if (!url.includes('/api/')) return;
    const n = seq++;
    const method = r.request().method();
    // Nobody is signed in before signing up or joining.
    const signedOut = r.status() === 401 && url.endsWith('/api/me');
    if (r.status() >= 400 && !signedOut && !expected(r.status(), method, url))
      problems.push(`${who} ${r.status()} ${method} ${url}`);
    try {
      recs.push({ seq: n, who, src: `${r.status()} ${method} ${url}`, body: await r.text() });
    } catch {
      // A redirect or an aborted response has no body.
    }
  });
  page.on('websocket', (ws) => {
    if (!ws.url().includes('/ws/pads/')) return;
    ws.on('framereceived', (f) => {
      if (typeof f.payload === 'string') recs.push({ seq: seq++, who, src: 'ws', body: f.payload });
    });
  });
}

/** Every string in a JSON body (or the raw body when it is not JSON), one per line. */
function strings(body: string): string[] {
  const out: string[] = [];
  const walk = (x: unknown) => {
    if (typeof x === 'string') out.push(x);
    else if (Array.isArray(x)) for (const y of x) walk(y);
    else if (x && typeof x === 'object') for (const y of Object.values(x)) walk(y);
  };
  try {
    walk(JSON.parse(body));
  } catch {
    out.push(body);
  }
  return out;
}

/** Every object key in a JSON body. */
function keys(body: string): Set<string> {
  const out = new Set<string>();
  const walk = (x: unknown) => {
    if (Array.isArray(x)) for (const y of x) walk(y);
    else if (x && typeof x === 'object')
      for (const [k, y] of Object.entries(x)) {
        out.add(k);
        walk(y);
      }
  };
  try {
    walk(JSON.parse(body));
  } catch {
    // not JSON
  }
  return out;
}

/** The pieces of a secret to look for: the whole of a short one, both ends of a long one. */
function needles(s: string): string[] {
  const t = s.trim();
  if (t.length < 12) return [];
  if (t.length <= 80) return [t];
  return [t.slice(0, 60), t.slice(-60)];
}

type Secret = { what: string; text: string; after?: number };

async function signUp(page: Page, name: string, email: string) {
  await page.goto('/sign-up');
  await page.getByLabel('Name').fill(name);
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill('correct-horse-battery');
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page).toHaveURL(/\/dashboard/);
}

async function pasteKey(page: Page) {
  const dialog = page.getByRole('dialog');
  const input = dialog.getByRole('textbox', { name: /API key/ });
  await expect(input).toHaveValue('');
  // With several pages open the clipboard needs this one in front.
  await page.bringToFront();
  await page.evaluate((k) => navigator.clipboard.writeText(k), KEY);
  await input.focus();
  await page.keyboard.press('ControlOrMeta+V');
  await page.evaluate(() => navigator.clipboard.writeText(''));
  // Never `fill`: a failed step's call log would print the key.
  if ((await input.evaluate((el: HTMLInputElement) => el.value.length)) !== KEY.length) {
    trace('note: the paste did not land; setting the field directly');
    await input.evaluate((el: HTMLInputElement, k: string) => {
      const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      set?.call(el, k);
      el.dispatchEvent(new Event('input', { bubbles: true }));
    }, KEY);
  }
  expect(await input.evaluate((el: HTMLInputElement) => el.value.length), 'pasted').toBe(
    KEY.length,
  );
  await dialog.getByRole('button', { name: /^Save key/ }).click();
  await expect(dialog).toBeHidden({ timeout: 30_000 });
}

const connected = (page: Page) =>
  expect(page.getByRole('status', { name: 'Connected' })).toBeVisible({ timeout: 30_000 });

async function say(page: Page, text: string) {
  const box = page.getByPlaceholder(/^Message your (candidate|interviewer)…$/);
  await box.fill(text);
  await box.press('Enter');
}

test('a quant room: host, a guest and an account candidate, through the real stack', async ({
  browser,
}) => {
  test.setTimeout(1_200_000);
  mkdirSync('e2e/.screens', { recursive: true });
  writeFileSync(LOG, '');
  const problems: string[] = [];
  const notes: string[] = [];
  const note = (n: string) => {
    notes.push(n);
    trace(`note: ${n}`);
  };
  const recs: Rec[] = [];
  const contexts: BrowserContext[] = [];
  const context = async (o?: Parameters<typeof browser.newContext>[0]) => {
    const c = await browser.newContext(o);
    contexts.push(c);
    return c;
  };

  const hostCtx = await context();
  await hostCtx.grantPermissions(['clipboard-read', 'clipboard-write']);
  const h = await hostCtx.newPage();
  watch(
    h,
    'host',
    recs,
    problems,
    (s, _m, u) => s === 409 && u.endsWith('/report/assessment'), // the empty room
  );
  const stamp = Date.now();

  // ---------------------------------------------------------------- 1. create
  await signUp(h, 'Hana Host', `qroom-host-${stamp}@example.com`);
  await h.getByRole('radio', { name: 'Interview someone' }).click();
  await h.getByRole('radio', { name: 'Quant questions' }).click();
  await expect(h).toHaveURL(/\/dashboard\?mode=host&format=quant$/);
  const setupPanel = h.getByTestId('quant-room-setup');
  await expect(setupPanel.getByTestId('setup-queue-empty')).toContainText('Nothing lined up');
  await expect(h.getByTestId('create-quant-room')).toHaveText('Create an empty room');
  const rows = h.getByTestId('bank-row');
  await expect(rows.first()).toBeVisible();
  const allCount = await h.getByTestId('bank-page').textContent();
  // Filter: quant track, probability, numeric; then search inside it.
  await h.getByRole('radio', { name: 'Quant', exact: true }).click();
  await h.getByRole('combobox', { name: 'Topic' }).click();
  await h.getByRole('option', { name: /^Probability/ }).click();
  await h.getByRole('combobox', { name: 'Type' }).click();
  await h.getByRole('option', { name: 'Numeric' }).click();
  await expect(h.getByTestId('bank-page')).not.toHaveText(allCount ?? '');
  for (const row of await rows.all()) await expect(row).toContainText(/Probability/);
  await h.getByLabel('Search the bank').fill('two-headed');
  await expect(h.locator(`[data-question="${Q_NUMERIC}"]`)).toBeVisible();
  await h.getByRole('button', { name: `Queue ${Q_NUMERIC}` }).click();
  // Across the whole bank by text, then by id.
  await h.getByRole('button', { name: 'Clear', exact: true }).click();
  await h.getByLabel('Search the bank').fill('chessboard');
  await h.getByRole('button', { name: `Queue ${Q_CHOICE}` }).click();
  await h.getByLabel('Search the bank').fill(Q_SHORT);
  await expect(rows).toHaveCount(1);
  // A row on demand: what the candidate will see (the answers wait for the room).
  await rows.first().locator('summary').first().click();
  await expect(rows.first()).toContainText('tigers');
  await h.getByRole('button', { name: `Queue ${Q_SHORT}` }).click();
  await expect(h.getByTestId('setup-queue-item')).toHaveCount(3);
  await expect(h.getByTestId('create-quant-room-note')).toHaveText(
    '3 questions lined up. Nobody sees them until you ask.',
  );
  await shot(h, 'setup', true);
  await h.getByTestId('create-quant-room').click();
  await expect(h).toHaveURL(/\/pads\/[0-9a-f-]{36}$/);
  const padUrl = h.url();
  const padId = padUrl.split('/').at(-1) as string;
  await connected(h);
  await expect(h.getByTestId('room-role')).toHaveText('· you are hosting');
  await expect(h.getByTestId('invite-banner')).toBeVisible();
  await expect(h.getByTestId('up-next')).toContainText('heads on both sides');
  await h.getByRole('tab', { name: /^Queue/ }).click();
  await expect(h.getByTestId('queue-item')).toHaveCount(3);
  await expect(h.getByTestId('queue-item').nth(0)).toHaveAttribute('data-question', Q_NUMERIC);
  await shot(h, 'host-created');

  // An empty room, in a second tab of the host's: nothing queued, nothing needed.
  const e = await hostCtx.newPage();
  watch(e, 'host-empty', recs, problems, (s, _m, u) => s === 409 && u.endsWith('/assessment'));
  await e.goto('/dashboard?mode=host&format=quant');
  await expect(e.getByTestId('create-quant-room')).toHaveText('Create an empty room');
  await e.getByTestId('create-quant-room').click();
  await expect(e).toHaveURL(/\/pads\/[0-9a-f-]{36}$/);
  const emptyUrl = e.url();
  await connected(e);
  await expect(e.getByTestId('desk-idle')).toContainText('No question asked yet');
  await expect(e.getByTestId('open-bank-idle')).toBeVisible();
  await expect(e.getByRole('heading', { level: 1 })).toHaveText('Quant interview');
  await shot(e, 'empty-room');
  await e.close();

  // The invite link.
  await h.getByRole('button', { name: 'Invite', exact: true }).click();
  const link = await h.getByLabel('Share link').inputValue();
  await h.keyboard.press('Escape');

  // ---------------------------------------------------------------- 2. the guest joins
  const guestCtx = await context();
  const g = await guestCtx.newPage();
  watch(g, 'guest', recs, problems, (s, _m, u) => {
    // The report is refused.
    if ((s === 403 || s === 401) && /\/(report|playback|host)/.test(u)) return true;
    return false;
  });
  await g.goto(link);
  await expect(
    g.getByRole('heading', { name: 'Hana Host invited you to an interview' }),
  ).toBeVisible();
  // Known: InviteInfo has no format, so a quant room's invite promises a code editor.
  const editor = g.getByText(/share a code editor/);
  if (await editor.count()) note(`a quant room's invite says: "${await editor.textContent()}"`);
  await shot(g, 'invite');
  await g.getByLabel('Your name').fill('Casey Guest');
  await g.getByRole('button', { name: 'Join the interview' }).click();
  await expect(g).toHaveURL(new RegExp(`/pads/${padId}$`));
  await connected(g);
  await expect(g.getByTestId('room-role')).toHaveText('· interview with Hana Host');
  await expect(g.getByTestId('round-waiting')).toContainText(
    'Your interviewer will post a question here',
  );
  for (const id of [
    'question-timer',
    'interviewer-thinking',
    'voice-bar',
    'ai-key-prompt',
    'host-desk',
    'question-prompt',
  ])
    await expect(g.getByTestId(id), id).toHaveCount(0);
  await expect(g.getByRole('tab', { name: 'Second opinion' })).toHaveCount(0);
  await expect(g.getByRole('tab', { name: 'My notes' })).toHaveCount(0);
  await shot(g, 'guest-waiting');
  await expect(h.getByTestId('invite-banner')).toHaveCount(0);

  // They talk before any question.
  await say(h, 'Hi Casey, welcome. We will do a few probability questions.');
  await expect(g.getByText('Hi Casey, welcome.')).toBeVisible();
  await say(g, 'Hi! Ready when you are.');
  await expect(h.getByText('Ready when you are.')).toBeVisible();

  // ---------------------------------------------------------------- 3. the interview
  const desk = h.getByTestId('host-desk');
  const open = h.getByTestId('open-question');
  const gPrompt = g.getByTestId('question-prompt');
  const poseAt: Record<string, number> = {};

  // Q1, from the queue: numeric.
  poseAt[Q_NUMERIC] = seq;
  await h.getByTestId('ask-next').click();
  await expect(open).toContainText('Question 1');
  await expect(open.getByTestId('host-answer')).toContainText('1024');
  await expect(g.getByTestId('round-heading')).toHaveText('Question 1');
  await expect(gPrompt).toContainText('two-headed');
  await expect(g.getByTestId('question-timer')).toHaveCount(0);
  await expect(g.getByTestId('question-message')).toHaveCount(1);
  await expect(g.getByText(/\bof \d+\b/)).toHaveCount(0);

  // The candidate answers in the chat and on the scratchpad; the host sees both.
  await say(g, 'Prior odds 1 to 999, ten heads multiply by 1024, so roughly a half.');
  await expect(h.getByText('Prior odds 1 to 999')).toBeVisible();
  const gScratch = g.getByRole('textbox', { name: 'Scratchpad' });
  await gScratch.click();
  await gScratch.pressSequentially('odds 1:999 x 1024:1');
  await expect(h.getByRole('textbox', { name: 'Scratchpad' })).toHaveValue(/odds 1:999 x 1024:1/);

  // No key: the second opinion says what it needs.
  await h.getByRole('tab', { name: 'Second opinion' }).click();
  await expect(h.getByTestId('review-key-prompt')).toContainText('your own API key');
  await expect(h.getByTestId('review-button')).toBeDisabled();
  await h.getByRole('tab', { name: 'Chat', exact: false }).first().click();

  // The ladder and the follow-ups; a hint and the follow-up recorded.
  const rungs = open.getByTestId('hint-rung');
  await expect(rungs).toHaveCount(2);
  await expect(rungs.nth(0)).toHaveAttribute('data-state', 'next');
  await expect(open.getByTestId('follow-ups').getByRole('listitem')).toHaveCount(2);
  await open.getByTestId('record-hint').click();
  await expect(rungs.nth(0)).toHaveAttribute('data-state', 'given');
  await expect(rungs.nth(1)).toHaveAttribute('data-state', 'next');
  await open.getByTestId('record-own-hint').click();
  await expect(open.getByTestId('hints-recorded')).toHaveText('2 hints given');
  await expect(g.getByTestId('hints-given')).toHaveText('2 hints so far');
  await open.getByTestId('record-follow-up').click();
  await expect(open.getByTestId('follow-up-asked')).toBeVisible();
  await shot(h, 'host-q1');
  // Closed with a verdict.
  await open.getByRole('radio', { name: 'Good' }).click();
  await open.getByLabel('Your note on the answer (optional)').fill('VERDICT-NOTE-ONE odds form');
  await expect(open.getByTestId('close-question')).toHaveText('Close with 75%');
  await open.getByTestId('close-question').click();
  await expect(h.getByTestId('desk-idle')).toContainText('No question is open');
  await expect(g.getByTestId('round-waiting')).toContainText('Waiting for the next question');
  await expect(g.getByTestId('earlier-questions')).toContainText('Question 1');
  await expect(h.getByTestId('up-next')).toContainText('chessboard');

  // Q2, picked from the bank (not the queue) while the queue still has two.
  await h.getByTestId('open-bank').click();
  const sheet = h.getByTestId('bank-sheet');
  await expect(sheet.getByTestId('bank-row').first()).toBeVisible();
  await sheet.getByLabel('Search the bank').fill(Q_PICKED);
  await expect(sheet.locator(`[data-question="${Q_PICKED}"]`)).toHaveAttribute(
    'data-status',
    'available',
  );
  await sheet.getByLabel('Search the bank').fill('');
  await sheet.getByLabel('Search the bank').fill(Q_NUMERIC);
  await expect(sheet.locator(`[data-question="${Q_NUMERIC}"]`)).toHaveAttribute(
    'data-status',
    'posed',
  );
  await sheet.getByLabel('Search the bank').fill(Q_CHOICE);
  await expect(sheet.locator(`[data-question="${Q_CHOICE}"]`)).toHaveAttribute(
    'data-status',
    'queued',
  );
  await sheet.getByLabel('Search the bank').fill(Q_PICKED);
  await sheet.locator(`[data-question="${Q_PICKED}"] summary`).first().click();
  await expect(
    sheet.locator(`[data-question="${Q_PICKED}"]`).getByTestId('host-answer'),
  ).toBeVisible();
  await expect(desk).toBeVisible();
  await shot(h, 'host-bank');
  poseAt[Q_PICKED] = seq;
  await sheet.getByRole('button', { name: `Ask ${Q_PICKED} now` }).click();
  await expect(sheet).toHaveCount(0);
  await expect(open).toContainText('Question 2');
  await expect(g.getByTestId('round-heading')).toHaveText('Question 2');
  await expect(gPrompt).toContainText('every face');
  await h.getByRole('tab', { name: /^Queue/ }).click();
  await expect(h.getByTestId('queue-item')).toHaveCount(2);
  await say(g, 'This is the coupon collector: 6 times the sum of 1/k, about 14.7.');
  await expect(h.getByText('coupon collector')).toBeVisible();

  // Q3 asked while Q2 is open: a choice question, after confirming.
  poseAt[Q_CHOICE] = seq;
  await h.getByRole('button', { name: 'Ask queued question 1 now' }).click();
  const confirm = h.getByRole('dialog', { name: 'Question 2 is still open' });
  await expect(confirm).toBeVisible();
  await expect(confirm).toContainText('without a verdict');
  await h.getByTestId('confirm-pose').click();
  await expect(confirm).toBeHidden();
  await expect(open).toContainText('Question 3');
  await expect(g.getByTestId('round-heading')).toHaveText('Question 3');
  await expect(gPrompt).toContainText('chessboard');
  const options = gPrompt.getByRole('listitem');
  expect(await options.count()).toBeGreaterThanOrEqual(2);
  await expect(gPrompt).toContainText('(a)');
  await expect(gPrompt).toContainText('Choose one.');
  await expect(g.getByTestId('earlier-questions').getByRole('listitem')).toHaveCount(2);
  await shot(g, 'guest-choice');
  await say(
    g,
    'Each domino covers one black and one white square. The two removed corners are the same colour, so 32 of one colour and 30 of the other remain: it cannot be done.',
  );
  await expect(h.getByText('Each domino covers one black')).toBeVisible();

  // The queue: two more from the bank, reordered, one removed.
  await h.getByTestId('open-bank').click();
  for (const id of Q_EXTRA) {
    await sheet.getByLabel('Search the bank').fill(id);
    await sheet.getByRole('button', { name: `Queue ${id}` }).click();
    await expect(sheet.locator(`[data-question="${id}"]`)).toHaveAttribute('data-status', 'queued');
  }
  await h.getByRole('button', { name: 'Close the bank' }).click();
  const queued = h.getByTestId('queue-item');
  await expect(queued).toHaveCount(3);
  await expect(queued.nth(0)).toHaveAttribute('data-question', Q_SHORT);
  await h.getByRole('button', { name: 'Move queued question 3 up' }).click();
  await expect(queued.nth(1)).toHaveAttribute('data-question', Q_EXTRA[1] as string);
  await h.getByRole('button', { name: 'Remove queued question 3' }).click();
  await expect(queued).toHaveCount(2);
  const hostView = async () =>
    (await h.evaluate(async (id) => (await fetch(`/api/pads/${id}/host`)).json(), padId)) as {
      round: {
        queue: { questionId: string }[];
        questions: { id: string; verdict: { score: number } | null; closedBy: string | null }[];
      };
    };
  expect((await hostView()).round.queue.map((q) => q.questionId)).toEqual([Q_SHORT, Q_EXTRA[1]]);

  // Verdicts: Q2 (closed by the pose, none) given one; Q1's changed.
  await h.getByRole('tab', { name: /^Asked/ }).click();
  const asked = (i: number) => h.locator(`[data-testid="asked-item"][data-index="${i}"]`);
  await expect(h.getByTestId('asked-item')).toHaveCount(3);
  await expect(asked(1).getByTestId('asked-score')).toHaveText('No verdict');
  await expect(asked(0).getByTestId('asked-score')).toHaveText('75%');
  await asked(1).locator('summary').first().click();
  await asked(1).getByRole('radio', { name: '50%' }).click();
  await asked(1).getByLabel(/note/i).fill('VERDICT-NOTE-TWO harmonic sum');
  await asked(1).getByTestId('save-verdict').click();
  await expect(asked(1).getByTestId('asked-score')).toHaveText('50%');
  await asked(0).locator('summary').first().click();
  await asked(0).getByRole('radio', { name: '100%' }).click();
  await asked(0).getByTestId('save-verdict').click();
  await expect(asked(0).getByTestId('asked-score')).toHaveText('100%');
  const verdicts = (await hostView()).round.questions.map((q) => q.verdict?.score ?? null);
  expect(verdicts).toEqual([1, 0.5, null]);
  await shot(h, 'host-asked');

  // ---------------------------------------------------------------- 5. second opinion, on the key
  await h.getByRole('tab', { name: 'Second opinion' }).click();
  await h
    .getByTestId('review-key-prompt')
    .getByRole('button', { name: /API key/ })
    .click();
  await pasteKey(h);
  await expect(h.getByTestId('review-key-prompt')).toHaveCount(0);
  await expect(h.getByTestId('review-button')).toHaveText('Second opinion on question 3');
  await h
    .getByLabel('Something specific to check (optional)')
    .fill('Did they justify why the colours must balance?');
  await h.getByTestId('review-button').click();
  const card = h.getByTestId('quant-opinion');
  await expect(card).toBeVisible({ timeout: MODEL_MS });
  const verdict = await card.getAttribute('data-verdict');
  expect(['correct', 'partly_correct', 'incorrect', 'not_yet', 'unclear']).toContain(verdict);
  // biome-ignore lint/performance/useDomNodeTextContent: the line breaks are used below
  const opinionText = (await card.innerText()).trim();
  trace(`second opinion (${verdict}): ${opinionText}`);
  expect(opinionText.length).toBeGreaterThan(40);
  // Addressed to the host about the candidate, not to the candidate.
  expect.soft(opinionText, 'speaks of the candidate').toMatch(/candidate|Casey|they|their|them/i);
  expect.soft(opinionText, 'does not address the candidate').not.toMatch(/\bCasey, /);
  await shot(h, 'host-opinion');
  await h.getByRole('tab', { name: 'Chat', exact: false }).first().click();
  await expect(g.getByRole('region', { name: 'Chat' })).not.toContainText(
    opinionText.split('\n').find((l) => l.length > 30) ?? opinionText.slice(0, 30),
  );

  // ---------------------------------------------------------------- 6. an account candidate
  const accCtx = await context();
  const a = await accCtx.newPage();
  const guarded = (s: number, _m: string, u: string) => s === 409 && u.includes('/api/quiz/');
  watch(a, 'account', recs, problems, guarded);
  await signUp(a, 'Alex Account', `qroom-cand-${stamp}@example.com`);
  await a.goto(link);
  await expect(
    a.getByText('You’ll join as Alex Account.').or(a.getByText("You'll join as Alex Account.")),
  ).toBeVisible();
  await a.getByRole('button', { name: 'Join the interview' }).click();
  await expect(a).toHaveURL(new RegExp(`/pads/${padId}$`));
  await connected(a);
  await expect(a.getByTestId('round-heading')).toHaveText('Question 3');
  // The quiz in another tab.
  const quiz = await accCtx.newPage();
  watch(quiz, 'account-quiz', recs, problems, guarded);
  await quiz.goto(`/quiz/topics/brainteasers?question=${QUIZ_QUESTION}`);
  const guard = quiz.getByTestId('quant-interview-guard');
  // Its options are 32, 31, 30 and 16.
  const radios = quiz.getByRole('radio', { name: /31/ });
  await expect(radios.first().or(guard.first())).toBeVisible();
  if ((await guard.count()) === 0) {
    await radios.first().click();
    await quiz.getByTestId('bank-primary').click();
  }
  await expect(guard.first()).toContainText('Answers are hidden during your interview');
  await expect(quiz.getByRole('region', { name: 'Feedback' })).toHaveCount(0);
  await shot(quiz, 'quiz-guard');

  // The phone pass, mid-question: the host's desk, the guest's view.
  await h.setViewportSize({ width: 390, height: 844 });
  await g.setViewportSize({ width: 390, height: 844 });
  await h.getByRole('tablist', { name: 'Pad sections' }).getByRole('tab', { name: 'Desk' }).click();
  await expect(open).toBeVisible();
  await shot(h, 'host-390');
  await open.getByTestId('hint-ladder').scrollIntoViewIfNeeded();
  await shot(h, 'host-390-hints');
  await g.getByRole('tablist', { name: 'Pad sections' }).getByRole('tab', { name: 'Chat' }).click();
  await shot(g, 'guest-390');
  await g.getByTestId('question-strip').click();
  await shot(g, 'guest-390-question');
  for (const p of [h, g])
    expect(
      await p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth),
    ).toBeLessThanOrEqual(0);
  await h.setViewportSize({ width: 1440, height: 900 });
  await g.setViewportSize({ width: 1440, height: 900 });

  // ---------------------------------------------------------------- 7. the end, with Q3 open
  const endAt = seq;
  await expect(open).toContainText('Question 3');
  await h.getByRole('button', { name: 'End interview' }).click();
  await expect(h.getByTestId('end-round-note')).toContainText('Question 3 is still open');
  await shot(h, 'end-dialog');
  await h.getByRole('button', { name: 'End and see report' }).click();
  await expect(h).toHaveURL(new RegExp(`/pads/${padId}/report$`), { timeout: 30_000 });
  await expect(g.getByText('This interview has ended. The pad is read-only.')).toBeVisible();
  await expect(g.getByTestId('round-waiting')).toContainText('The interview has ended');
  await expect(g.getByRole('link', { name: /report/i })).toHaveCount(0);
  await shot(g, 'guest-ended');
  // The guest cannot open the report.
  const gr = await guestCtx.newPage();
  watch(
    gr,
    'guest-report',
    recs,
    problems,
    (s, _m, u) => (s === 401 || s === 403) && /\/(report|playback|host|me)/.test(u),
  );
  await gr.goto(`/pads/${padId}/report`);
  await gr.waitForTimeout(5000);
  await expect(gr.getByTestId('question-review')).toHaveCount(0);
  await expect(gr.getByTestId('quant-review')).toHaveCount(0);
  note(`a guest opening the report lands on ${gr.url().replace(/^https?:\/\/[^/]+/, '')}`);
  await shot(gr, 'guest-report');
  await gr.close();

  // The guard lifts.
  await quiz.reload();
  await expect(radios.first()).toBeVisible();
  if ((await quiz.getByRole('region', { name: 'Feedback' }).count()) === 0) {
    await radios.first().click();
    await quiz.getByTestId('bank-primary').click();
  }
  await expect(quiz.getByRole('region', { name: 'Feedback' })).toBeVisible();
  await expect(guard).toHaveCount(0);

  // The host's report.
  await expect(h.getByText('Quant interview report')).toBeVisible();
  const stats = h.getByTestId('quant-stats');
  await expect(stats).toContainText('Asked');
  const reviews = h.getByTestId('question-review');
  await expect(reviews).toHaveCount(3);
  const [r1, r2, r3] = [reviews.nth(0), reviews.nth(1), reviews.nth(2)] as [
    Locator,
    Locator,
    Locator,
  ];
  await expect(r1.getByTestId('review-status')).toHaveText('Closed');
  await expect(r1.getByTestId('review-score')).toHaveText('100%');
  await expect(r1.getByTestId('review-time')).toHaveText(/^\d+:\d\d open$/);
  await expect(r1.getByTestId('review-hints')).toContainText('2 hints');
  await expect(r1.getByTestId('review-follow-up')).toBeVisible();
  await expect(r1.getByTestId('review-solution')).toContainText('1024');
  await expect(r2.getByTestId('review-score')).toHaveText('50%');
  await expect(r2).toContainText('VERDICT-NOTE-TWO');
  await expect(r3.getByTestId('review-status')).toHaveText('Open at the end');
  await expect(h.getByText(/ of \d+:\d\d/)).toHaveCount(0);
  trace(`report stats: ${((await stats.textContent()) ?? '').replace(/\s+/g, ' ')}`);
  trace(`report q1: ${((await r1.textContent()) ?? '').replace(/\s+/g, ' ').slice(0, 400)}`);
  await shot(h, 'report', true);
  // The missing verdict, given here.
  const give = r3.getByTestId('give-verdict');
  await give.getByRole('radio', { name: 'Good' }).click();
  await give.getByTestId('save-report-verdict').click();
  await expect(r3.getByTestId('review-score')).toHaveText('75%');
  // The assessment, on the key.
  await h.getByTestId('request-assessment').click();
  await expect(h.getByRole('heading', { name: 'Assessment' })).toBeVisible({ timeout: 300_000 });
  await shot(h, 'report-assessed', true);
  const assessment = ((await h.locator('main').textContent()) ?? '').slice(0, 4000);
  trace(`report after the assessment: ${assessment.replace(/\s+/g, ' ')}`);
  await h.setViewportSize({ width: 390, height: 844 });
  await shot(h, 'report-390', true);
  expect(
    await h.evaluate(() => document.documentElement.scrollWidth - window.innerWidth),
  ).toBeLessThanOrEqual(0);
  await h.setViewportSize({ width: 1440, height: 900 });

  // The empty room: ended, and nothing to assess.
  await h.goto(emptyUrl);
  await connected(h);
  await h.getByRole('button', { name: 'End interview' }).click();
  await h.getByRole('button', { name: 'End and see report' }).click();
  await expect(h).toHaveURL(/\/report$/, { timeout: 30_000 });
  await expect(h.getByTestId('quant-review-empty')).toContainText('No question was asked');
  await h.getByTestId('request-assessment').click();
  await expect(h.getByText('Nothing to assess')).toBeVisible();
  await expect(h.getByText('Could not start the assessment')).toHaveCount(0);
  await shot(h, 'empty-report', true);

  // ---------------------------------------------------------------- the key, removed before the checks below
  await h.goto('/dashboard');
  await h.getByRole('button', { name: 'Account menu' }).click();
  await h.getByRole('menuitem', { name: /AI key/ }).click();
  const saved = h.getByTestId('ai-key-saved');
  await expect(saved).toContainText(`sk-ant-…${KEY.slice(-4)}`);
  await saved.getByRole('button', { name: 'Remove' }).click();
  await expect(h.getByRole('textbox', { name: 'Anthropic API key' })).toHaveValue('');

  // ---------------------------------------------------------------- 4. host-only stays host-only
  // The capture, for reading when a check below fails (no key is in it: request bodies are not
  // recorded, and the key's status names only its last four characters).
  writeFileSync(
    'e2e/.screens/real-quant-room-recs.json',
    JSON.stringify({ padId, poseAt, endAt, recs }, null, 1),
  );
  const hostRecs = recs.filter((r) => r.who.startsWith('host'));
  const candRecs = recs.filter((r) => !r.who.startsWith('host'));
  // Room traffic (pads, the socket, joining) and the quiz while the room was active.
  const quizRecs = candRecs.filter((r) => r.src.includes('/api/quiz/') && r.seq < endAt);
  const roomRecs = candRecs.filter((r) => !r.src.includes('/api/quiz/'));

  const secrets: Secret[] = [];
  const posedPrompts: string[] = [];
  const ids = new Set<string>();
  const add = (what: string, text: unknown, after?: number) => {
    if (typeof text === 'string')
      for (const n of needles(text)) secrets.push({ what, text: n, after });
  };
  const walk = (x: unknown) => {
    if (Array.isArray(x)) return x.forEach(walk);
    if (!x || typeof x !== 'object') return;
    const o = x as Record<string, unknown>;
    // HostQuestionMaterial: the bank question in full.
    if ('solution' in o && 'explanation' in o && 'hints' in o) {
      const id = String(o.id);
      add(`${id} solution`, o.solution);
      add(`${id} explanation`, o.explanation);
      for (const k of (o.keyPoints as string[] | undefined) ?? []) add(`${id} key point`, k);
      for (const k of (o.hints as string[] | undefined) ?? []) add(`${id} hint`, k);
      for (const k of (o.followUps as string[] | undefined) ?? []) add(`${id} follow-up`, k);
      if ([Q_NUMERIC, Q_CHOICE, Q_SHORT, Q_PICKED, ...Q_EXTRA].includes(id)) {
        ids.add(id);
        // A question's prompt, before it was posed (and never, if it was not).
        add(`${id} prompt before it was posed`, o.prompt, poseAt[id] ?? Number.POSITIVE_INFINITY);
      }
    }
    // The host's verdicts.
    if (o.verdict && typeof o.verdict === 'object')
      add('verdict note', (o.verdict as { summary?: unknown }).summary);
    // The second opinion.
    if ('suggestedScore' in o && 'covered' in o) {
      add('opinion summary', o.summary);
      for (const k of [...((o.covered as string[]) ?? []), ...((o.missing as string[]) ?? [])])
        add('opinion point', k);
      for (const k of (o.followUps as string[]) ?? []) add('opinion follow-up', k);
      add('opinion answer', o.answer);
    }
    if (typeof o.text === 'string' && o.intent === 'question') posedPrompts.push(o.text);
    for (const y of Object.values(o)) walk(y);
  };
  for (const r of hostRecs) {
    try {
      walk(JSON.parse(r.body));
    } catch {
      // not JSON
    }
  }
  // What was public anyway: the posed text (a choice question's options), what people wrote.
  const publicText = [
    ...posedPrompts,
    ...(await g.getByRole('region', { name: 'Chat' }).allInnerTexts()),
  ].join('\n');
  const scanned = secrets.filter((s) => s.what.includes('prompt') || !publicText.includes(s.text));
  const kinds = (w: string) => scanned.filter((s) => s.what.endsWith(w)).length;
  trace(
    `secrets: ${scanned.length} (${['solution', 'explanation', 'key point', 'hint', 'follow-up', 'posed', 'verdict note', 'opinion summary', 'opinion point'].map((k) => `${k} ${kinds(k)}`).join(', ')})`,
  );
  // The scan can find them: every one is in the host's own capture, as the matcher reads it.
  const hostText = hostRecs.flatMap((r) => strings(r.body)).join('\n');
  expect.soft(scanned.filter((s) => !hostText.includes(s.text)).map((s) => s.what)).toEqual([]);
  for (const k of ['solution', 'explanation', 'hint', 'follow-up', 'key point', 'verdict note'])
    expect.soft(kinds(k), k).toBeGreaterThan(0);
  expect.soft(kinds('opinion summary')).toBeGreaterThan(0);
  expect.soft(ids).toEqual(new Set([Q_NUMERIC, Q_CHOICE, Q_SHORT, Q_PICKED, ...Q_EXTRA]));

  const leaks: string[] = [];
  for (const r of roomRecs) {
    const text = strings(r.body).join('\n');
    for (const s of scanned)
      if ((s.after === undefined || r.seq < s.after) && text.includes(s.text))
        leaks.push(`${r.who} ${r.src}: ${s.what}: ${s.text.slice(0, 50)}`);
    for (const id of ids) if (text.includes(id)) leaks.push(`${r.who} ${r.src}: the id ${id}`);
    // The round's own payloads (the pad, its socket, joining) carry no host-only field.
    if (!(r.src === 'ws' || r.src.includes(`/api/pads/${padId}`) || r.src.includes('/join')))
      continue;
    const k = keys(r.body);
    for (const f of ['queue', 'verdict', 'hintRungs', 'material', 'solution', 'followUps', 'hints'])
      if (k.has(f)) leaks.push(`${r.who} ${r.src}: the field ${f}`);
  }
  for (const r of quizRecs) {
    const text = strings(r.body).join('\n');
    for (const s of scanned)
      if (!s.what.includes('prompt') && text.includes(s.text))
        leaks.push(`${r.who} ${r.src} (quiz, room active): ${s.what}: ${s.text.slice(0, 50)}`);
  }
  expect.soft(roomRecs.length).toBeGreaterThan(20);
  expect.soft(quizRecs.length).toBeGreaterThan(0);
  expect
    .soft(candRecs.some((r) => /\/host(\/|$)/.test(r.src) && r.src.startsWith('200')))
    .toBe(false);
  trace(`leaks: ${leaks.length}\n${leaks.join('\n')}`);
  expect.soft(leaks, 'nothing host-only reached a candidate').toEqual([]);

  console.log(
    [
      `pad ${padId}`,
      ...notes.map((n) => `note: ${n}`),
      `recorded ${recs.length} payloads (${hostRecs.length} host, ${roomRecs.length} candidate room, ${quizRecs.length} quiz while active); ${scanned.length} secrets scanned`,
      '--- problems ---',
      problems.join('\n') || '(none)',
    ].join('\n'),
  );

  expect(problems).toEqual([]);
  for (const c of contexts) await c.close();
});
