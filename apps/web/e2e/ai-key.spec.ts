/**
 * Bring-your-own Anthropic key: the settings page and every place a missing key matters
 * (starting an interview, the pad's interviewer panel, the report, quiz short answers).
 */
import { expect, type Page, test } from '@playwright/test';
import {
  ACTIVE_PAD_ID,
  aiKeyStatus,
  ENDED_PAD_ID,
  makePadDetail,
  QUIZ_ATTEMPT_ID,
  REPORT_READY,
} from './fixtures';
import { setup } from './helpers';
import type { MockBackend } from './mock-api';

const KEY = 'sk-ant-api03-e2eTESTkey-0123456789abcdefghijklmnop-Zk7Q';
const REVOKED = 'sk-ant-api03-revoked-0123456789abcdefghijklmnopqr-AAAA';

async function openPad(page: Page, configure?: (b: MockBackend) => void) {
  const backend = await setup(page, configure);
  await page.goto(`/pads/${ACTIVE_PAD_ID}`);
  await expect(page.locator('.view-lines')).toContainText('class Solution', { timeout: 20_000 });
  await expect(page.getByRole('status', { name: 'Connected' })).toBeVisible();
  return backend;
}

async function addKeyInDialog(page: Page, submit = 'Save key') {
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  const input = dialog.getByRole('textbox', { name: /API key/ });
  await expect(input).toHaveAttribute('type', 'password');
  await expect(input).toHaveValue('');
  await expect(input).toBeFocused();
  await input.fill(KEY);
  await dialog.getByRole('button', { name: submit }).click();
  await expect(dialog).toBeHidden();
}

test.describe('key management', () => {
  test('reachable from the account menu; explains itself; save, show last four, remove', async ({
    page,
    context,
  }) => {
    const backend = await setup(page, (b) => {
      b.aiKey = aiKeyStatus('missing');
    });
    await page.goto('/dashboard');
    await page.getByRole('button', { name: 'Account menu' }).click();
    const item = page.getByRole('menuitem', { name: /AI key/ });
    await expect(item).toContainText('Not set');
    await item.click();
    await expect(page).toHaveURL(/\/settings\/ai-key$/);
    await expect(page.getByRole('heading', { level: 1, name: 'AI key' })).toBeVisible();

    // The plain explanation: why, encrypted, a day without use, a dedicated key with a limit.
    await expect(page.getByText(/never pays for model usage/)).toBeVisible();
    await expect(page.getByText(/Stored encrypted on our server/).first()).toBeVisible();
    await expect(page.getByText(/Deleted after a day without use/).first()).toBeVisible();
    await expect(page.getByText(/dedicated key with a spend limit/).first()).toBeVisible();
    const consoleLink = page.getByRole('link', { name: 'Anthropic Console' }).first();
    await expect(consoleLink).toHaveAttribute('href', /^https:\/\/console\.anthropic\.com\//);
    await expect(consoleLink).toHaveAttribute('target', '_blank');

    const input = page.getByRole('textbox', { name: 'Anthropic API key' });
    await expect(input).toHaveAttribute('type', 'password');
    await expect(input).toHaveAttribute('autocomplete', 'off');
    await expect(input).toHaveValue('');

    // Local validation, without a request.
    await page.getByRole('button', { name: 'Save key' }).click();
    await expect(page.locator('form [role=alert]')).toContainText('Paste your API key.');
    await input.fill('sk-proj-abcdefghijklmnopqrstuvwxyz0123');
    await page.getByRole('button', { name: 'Save key' }).click();
    await expect(page.locator('form [role=alert]')).toContainText('another provider');
    await expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(backend.savedKeys).toEqual([]);

    // Refused by Anthropic: clear message, nothing saved, the input stays for a correction.
    await input.fill(REVOKED);
    await page.getByRole('button', { name: 'Save key' }).click();
    await expect(page.locator('form [role=alert]')).toContainText(
      'Anthropic did not accept this key',
    );
    await expect(input).toHaveValue(REVOKED);

    // Show / hide.
    await page.getByRole('button', { name: 'Show key' }).click();
    await expect(input).toHaveAttribute('type', 'text');
    await page.getByRole('button', { name: 'Hide key' }).click();
    await expect(input).toHaveAttribute('type', 'password');

    // Paste-friendly: a pasted key with a trailing newline is trimmed.
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await input.fill('');
    await page.evaluate((k) => navigator.clipboard.writeText(`  ${k}\n`), KEY);
    await input.focus();
    await page.keyboard.press('ControlOrMeta+V');
    await expect(input).toHaveValue(KEY);
    await expect(page.locator('form [role=alert]')).toHaveCount(0);
    await page.getByRole('button', { name: 'Save key' }).click();

    const saved = page.getByTestId('ai-key-saved');
    await expect(saved).toContainText('sk-ant-…Zk7Q');
    await expect(saved).toContainText(/Removed in 24 hours unless you use it/);
    await expect(page.getByRole('textbox', { name: 'Anthropic API key' })).toHaveCount(0);
    expect(backend.savedKeys.at(-1)).toBe(KEY);
    // Nothing on the page holds more than the last four characters.
    expect(await page.content()).not.toContain('e2eTESTkey');

    // Never pre-filled: after a reload, and when replacing.
    await page.reload();
    await expect(page.getByTestId('ai-key-saved')).toContainText('Zk7Q');
    await page.getByRole('button', { name: 'Replace' }).click();
    await expect(page.getByRole('textbox', { name: 'New API key' })).toHaveValue('');
    await page.getByRole('button', { name: 'Cancel' }).click();

    await page.getByRole('button', { name: 'Remove' }).click();
    await expect(page.getByRole('textbox', { name: 'Anthropic API key' })).toHaveValue('');
    expect(backend.aiKey.state).toBe('missing');
  });

  test('a rejected key says what happened', async ({ page }) => {
    await setup(page, (b) => {
      b.aiKey = aiKeyStatus('rejected', { last4: 'r3J9', problem: 'billing' });
    });
    await page.goto('/settings/ai-key');
    const notice = page.getByTestId('ai-key-rejected');
    await expect(notice).toContainText('Anthropic rejected sk-ant-…r3J9');
    await expect(notice).toContainText('ran out of credit');
    await expect(page.getByRole('textbox', { name: 'New API key' })).toHaveValue('');
  });
});

test.describe('starting an interview', () => {
  test('no key: a quiet prompt, and Start offers adding one or going without', async ({ page }) => {
    const backend = await setup(page, (b) => {
      b.aiKey = aiKeyStatus('missing');
    });
    await page.goto('/new');
    await expect(page.getByTestId('ai-key-prompt')).toContainText(
      'Runs on your own Anthropic API key',
    );
    // Turning the interviewer off removes the prompt.
    await page.getByLabel('AI interviewer').click();
    await expect(page.getByTestId('ai-key-prompt')).toHaveCount(0);
    await page.getByLabel('AI interviewer').click();

    await page.getByRole('button', { name: 'Start interview' }).click();
    const dialog = page.getByRole('dialog', { name: 'Add your API key to start' });
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'Start without the interviewer' }).click();
    await expect(page).toHaveURL(/\/pads\/[0-9a-f-]{36}$/);
    const create = backend.requests.find((r) => r.method === 'POST' && r.path === '/api/pads');
    expect(create?.body).toMatchObject({ interviewer: { enabled: false } });
  });

  test('adding the key in the start dialog starts the interview with the interviewer', async ({
    page,
  }) => {
    const backend = await setup(page, (b) => {
      b.aiKey = aiKeyStatus('missing');
    });
    await page.goto('/new');
    await page.getByRole('radio', { name: 'Tough' }).click();
    await page.getByRole('button', { name: 'Start interview' }).click();
    await addKeyInDialog(page, 'Save key and start');
    await expect(page).toHaveURL(/\/pads\/[0-9a-f-]{36}$/);
    expect(backend.savedKeys).toEqual([KEY]);
    const create = backend.requests.find((r) => r.method === 'POST' && r.path === '/api/pads');
    expect(create?.body).toMatchObject({ interviewer: { enabled: true, style: 'tough' } });
  });

  test('with a key there is no prompt and Start goes straight in', async ({ page }) => {
    await setup(page);
    await page.goto('/new');
    await expect(page.getByTestId('ai-key-prompt')).toHaveCount(0);
    await page.getByRole('button', { name: 'Start interview' }).click();
    await expect(page).toHaveURL(/\/pads\/[0-9a-f-]{36}$/);
  });
});

test.describe('pad interviewer panel', () => {
  test('owner without a key adds one in place; the interviewer joins without a reload', async ({
    page,
  }) => {
    const backend = await openPad(page, (b) => {
      b.aiKey = aiKeyStatus('missing');
    });
    const chat = page.getByRole('region', { name: 'Interviewer chat' });
    const prompt = chat.getByTestId('ai-key-prompt');
    await expect(prompt).toContainText('The interviewer runs on your Anthropic API key');
    await expect(chat.getByText('needs a key')).toBeVisible();
    // Something in progress: a half-written message.
    const composer = page.getByLabel('Message', { exact: true });
    await composer.fill('I think a hash map works here');

    await prompt.getByRole('button', { name: 'Add API key' }).click();
    await addKeyInDialog(page);
    await expect(chat.getByTestId('ai-key-prompt')).toHaveCount(0);
    await expect(composer).toHaveValue('I think a hash map works here');
    await expect(page.getByPlaceholder('Ask a question or explain your approach…')).toBeVisible();
    await expect(page.locator('.view-lines')).toContainText('class Solution');

    await composer.press('Enter');
    await expect(page.getByTestId('interviewer-message').last()).toContainText(
      'A hash map from value to index',
      { timeout: 10_000 },
    );
    expect(backend.savedKeys).toEqual([KEY]);
  });

  test('a key rejected mid-interview shows up live, with a way to update it', async ({ page }) => {
    const backend = await openPad(page);
    const chat = page.getByRole('region', { name: 'Interviewer chat' });
    await expect(chat.getByTestId('ai-key-prompt')).toHaveCount(0);
    backend.setKey(aiKeyStatus('rejected'));
    const prompt = chat.getByTestId('ai-key-prompt');
    await expect(prompt).toContainText('Anthropic rejected your API key');
    await expect(chat.getByText('key rejected')).toBeVisible();
    await prompt.getByRole('button', { name: 'Update key' }).click();
    await addKeyInDialog(page);
    await expect(chat.getByTestId('ai-key-prompt')).toHaveCount(0);
  });

  test('a collaborator is told the owner needs a key, with nothing to click', async ({ page }) => {
    await openPad(page, (b) => {
      b.pads.set(
        ACTIVE_PAD_ID,
        makePadDetail({
          pad: { id: ACTIVE_PAD_ID },
          role: 'collaborator',
          interviewerKey: 'missing',
        }),
      );
    });
    const prompt = page
      .getByRole('region', { name: 'Interviewer chat' })
      .getByTestId('ai-key-prompt');
    await expect(prompt).toContainText('joins once the pad owner adds their Anthropic API key');
    await expect(prompt.getByRole('button')).toHaveCount(0);
  });
});

test.describe('report', () => {
  const url = `/pads/${ENDED_PAD_ID}/report`;

  test('no key: a prompt where the assessment would be; adding one writes it', async ({ page }) => {
    const backend = await setup(page, (b) => {
      b.aiKey = aiKeyStatus('missing');
      b.report = { ...REPORT_READY, assessment: null, assessmentUnavailable: 'no_key' };
    });
    await page.goto(url);
    const prompt = page.getByTestId('assessment-key-prompt');
    await expect(prompt).toContainText('Get a written assessment of this interview');
    // The rest of the report is there already.
    await expect(page.getByText('Submissions')).toBeVisible();
    await prompt.getByRole('button', { name: 'Add API key' }).click();
    await addKeyInDialog(page);
    await expect(page.getByText('Writing your assessment…')).toBeVisible();
    await expect(page.getByRole('list', { name: /Recommendation scale/ })).toBeVisible({
      timeout: 10_000,
    });
    expect(
      backend.requests.some((r) => r.method === 'POST' && r.path.endsWith('/report/assessment')),
    ).toBe(true);
  });

  test('a collaborator sees why there is no assessment', async ({ page }) => {
    await setup(page, (b) => {
      b.report = { ...REPORT_READY, assessment: null, assessmentUnavailable: 'no_key' };
      const d = b.pads.get(ENDED_PAD_ID);
      if (d) b.pads.set(ENDED_PAD_ID, { ...d, role: 'collaborator' });
    });
    await page.goto(url);
    await expect(page.getByText(/runs on the pad owner’s Anthropic API key/)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Add API key' })).toHaveCount(0);
  });
});

test.describe('quiz short answers', () => {
  test('no key: a prompt on short answers only; adding a key keeps the answer and grades it with AI', async ({
    page,
  }) => {
    await setup(page, (b) => {
      b.aiKey = aiKeyStatus('missing');
    });
    await page.goto(`/quiz/${QUIZ_ATTEMPT_ID}`);
    await expect(page.getByTestId('quiz-key-prompt')).toHaveCount(0); // a choice question
    await page.getByRole('button', { name: 'Question 4: Not answered' }).click();
    const prompt = page.getByTestId('quiz-key-prompt');
    await expect(prompt).toContainText('AI grading runs on your own Anthropic API key');
    const answer = 'So the final ACK can be retransmitted if the peer resends its FIN.';
    await page.getByLabel('Your answer').fill(answer);
    await prompt.getByRole('button', { name: 'Add API key' }).click();
    await addKeyInDialog(page);
    await expect(page.getByTestId('quiz-key-prompt')).toHaveCount(0);
    await expect(page.getByLabel('Your answer')).toHaveValue(answer);
    await page.getByTestId('quiz-primary').click();
    await expect(page.getByRole('region', { name: 'Feedback' })).toContainText('Graded by the AI');
  });
});
