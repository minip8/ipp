/**
 * Bring-your-own key (Anthropic, OpenAI, Google Gemini, OpenRouter): the settings page, choosing
 * the interviewer model, and every place a missing key matters (starting an interview, the pad's
 * interviewer panel, the report, quiz short answers).
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
const OPENAI_KEY = 'sk-proj-e2eOPENAIkey-0123456789abcdefghijklm-OpAi';
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
    await page.goto('/software/interviews');
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
    await expect(page.locator('form [role=alert]')).toContainText(
      'looks like an OpenAI key, but Anthropic is selected',
    );
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
    await expect(page.getByRole('textbox', { name: 'New Anthropic API key' })).toHaveValue('');
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
    await expect(page.getByRole('textbox', { name: 'New Anthropic API key' })).toHaveValue('');
  });

  test('another provider: choose it, its key shape and console; a mismatch offers to switch', async ({
    page,
  }) => {
    const backend = await setup(page, (b) => {
      b.aiKey = aiKeyStatus('missing');
    });
    await page.goto('/settings/ai-key');
    const input = page.getByRole('textbox', { name: 'Anthropic API key' });
    // An OpenAI key with Anthropic selected: refused locally, with a one-click switch.
    await input.fill(OPENAI_KEY);
    await page.getByRole('button', { name: 'Save key' }).click();
    const alert = page.locator('form [role=alert]');
    await expect(alert).toContainText('looks like an OpenAI key');
    await alert.getByRole('button', { name: 'Use OpenAI' }).click();
    await expect(page.getByRole('combobox', { name: 'Provider' })).toContainText('OpenAI');
    const openaiInput = page.getByRole('textbox', { name: 'OpenAI API key' });
    await expect(openaiInput).toHaveAttribute('placeholder', 'sk-…');
    await expect(
      page.locator('form').getByRole('link', { name: 'OpenAI Platform' }),
    ).toHaveAttribute('href', /^https:\/\/platform\.openai\.com\//);
    expect(backend.savedKeys).toEqual([]);
    await page.getByRole('button', { name: 'Save key' }).click();
    const saved = page.getByTestId('ai-key-saved');
    await expect(saved).toContainText('OpenAI key saved');
    await expect(saved).toContainText('sk-…OpAi');
    expect(backend.savedKeys).toEqual([OPENAI_KEY]);
    expect(backend.savedProviders).toEqual(['openai']);
    await expect(page.getByText('OpenAI default:')).toBeVisible();

    // Choosing Gemini by hand changes the expected shape.
    await page.getByRole('button', { name: 'Replace' }).click();
    await page.getByRole('combobox', { name: 'Provider' }).click();
    await page.getByRole('option', { name: 'Google Gemini' }).click();
    const gemini = page.getByRole('textbox', { name: 'New Google Gemini API key' });
    await gemini.fill('hello-not-a-key');
    await page.getByRole('button', { name: 'Save key' }).click();
    await expect(page.locator('form [role=alert]')).toContainText('start with “AIza” or “AQ.”');
  });

  test('the settings page lists the models of the saved key for new interviews', async ({
    page,
  }) => {
    await setup(page);
    await page.goto('/settings/ai-key');
    const picker = page.getByRole('combobox', { name: 'Model for new interviews' });
    await expect(picker).toContainText('Default: Claude Opus 5.5');
    await picker.click();
    await expect(page.getByRole('option', { name: 'Claude Fable 5.2' })).toBeVisible();
    await page.getByRole('option', { name: 'Claude Haiku 5.5' }).click();
    await expect(picker).toContainText('Claude Haiku 5.5');
    // It is the start preference: the new-interview form starts with it.
    await page.goto('/software/interviews');
    await expect(page.getByRole('combobox', { name: 'Model' })).toContainText('Claude Haiku 5.5');
  });
});

test.describe('choosing the interviewer model', () => {
  test('the model picked when starting is sent with the pad and remembered', async ({ page }) => {
    const backend = await setup(page);
    await page.goto('/software/interviews');
    const picker = page.getByRole('combobox', { name: 'Model' });
    await expect(picker).toContainText('Default: Claude Opus 5.5');
    await picker.click();
    await page.getByRole('option', { name: 'Claude Sonnet 5.5' }).click();
    await page.getByRole('button', { name: /^Two Sum/ }).click();
    await page.getByRole('button', { name: 'Start interview' }).click();
    await expect(page).toHaveURL(/\/pads\/[0-9a-f-]{36}$/);
    const create = backend.requests.find((r) => r.method === 'POST' && r.path === '/api/pads');
    expect(create?.body).toMatchObject({
      interviewer: { model: { provider: 'anthropic', id: 'claude-sonnet-5-5' } },
    });
    await page.goto('/software/interviews');
    await expect(page.getByRole('combobox', { name: 'Model' })).toContainText('Claude Sonnet 5.5');
  });

  test('a list that cannot be loaded never blocks starting', async ({ page }) => {
    const backend = await setup(page, (b) => {
      b.modelsFail = true;
    });
    await page.goto('/software/interviews');
    await expect(page.getByTestId('model-picker')).toContainText('Could not get the model list');
    await page.getByRole('button', { name: /^Two Sum/ }).click();
    await page.getByRole('button', { name: 'Start interview' }).click();
    await expect(page).toHaveURL(/\/pads\/[0-9a-f-]{36}$/);
    const create = backend.requests.find((r) => r.method === 'POST' && r.path === '/api/pads');
    const body = create?.body as { interviewer?: { model?: unknown } } | undefined;
    expect(body?.interviewer).toBeTruthy();
    expect(body?.interviewer?.model ?? null).toBeNull();
  });

  test('without a key the picker is off and says why', async ({ page }) => {
    const noKey = await setup(page, (b) => {
      b.aiKey = aiKeyStatus('missing');
    });
    await page.goto('/software/interviews');
    await expect(page.getByRole('combobox', { name: 'Model' })).toBeDisabled();
    await expect(page.getByTestId('model-picker')).toContainText(
      'Add an API key to choose a model',
    );
    expect(noKey.modelListCalls).toBe(0);
  });

  test('the owner changes the model mid-interview from the interviewer options', async ({
    page,
  }) => {
    const backend = await openPad(page);
    const chat = page.getByRole('region', { name: 'Interviewer chat' });
    await chat.getByRole('button', { name: 'Interviewer options' }).click();
    const item = page.getByTestId('interviewer-model');
    await expect(item).toContainText('claude-opus-5-5');
    await item.click();
    const dialog = page.getByRole('dialog', { name: 'Interviewer model' });
    await expect(dialog).toContainText('Now: claude-opus-5-5');
    await dialog.getByRole('combobox', { name: 'Model' }).click();
    await page.getByRole('option', { name: 'Claude Fable 5.2' }).click();
    await expect(dialog).toContainText('Now: claude-fable-5-2');
    const patch = backend.requests.find((r) => r.method === 'PATCH');
    expect(patch?.body).toEqual({
      interviewer: { model: { provider: 'anthropic', id: 'claude-fable-5-2' } },
    });
  });
});

test.describe('starting an interview', () => {
  test('no key: a quiet prompt, and Start offers adding one or going without', async ({ page }) => {
    const backend = await setup(page, (b) => {
      b.aiKey = aiKeyStatus('missing');
    });
    await page.goto('/software/interviews');
    await page.getByRole('button', { name: /^Two Sum/ }).click();
    await expect(page.getByTestId('ai-key-prompt')).toContainText('Runs on your own AI API key');
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
    await page.goto('/software/interviews');
    await page.getByRole('button', { name: /^Two Sum/ }).click();
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
    await page.goto('/software/interviews');
    await expect(page.getByTestId('ai-key-prompt')).toHaveCount(0);
    // Nothing is selected by default, so Start waits for a problem.
    await expect(page.getByRole('button', { name: 'Start interview' })).toBeDisabled();
    await page.getByRole('button', { name: /^Two Sum/ }).click();
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
    await expect(prompt).toContainText('The interviewer runs on your own AI API key');
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
    await expect(prompt).toContainText('joins once the pad owner adds their AI API key');
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
    await expect(page.getByText(/runs on the pad owner’s own AI API key/)).toBeVisible();
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
    await expect(prompt).toContainText('AI grading runs on your own AI API key');
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

test.describe('changing or removing the key where it is used', () => {
  test('from the interview setup: the saved key is named, and can be removed there', async ({
    page,
  }) => {
    const backend = await setup(page);
    await page.goto('/software/interviews');
    const line = page.getByTestId('saved-key-line');
    await expect(line).toContainText('Anthropic key');
    await line.getByRole('button', { name: 'Change or remove' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('heading', { name: 'Your AI API key' })).toBeVisible();
    await expect(dialog.getByTestId('ai-key-saved')).toBeVisible();
    await dialog.getByRole('button', { name: 'Remove' }).click();
    // Removing closes the dialog; the page now asks for a key instead of naming one.
    await expect(dialog).toHaveCount(0);
    expect(backend.aiKey.state).toBe('missing');
    await expect(page.getByTestId('saved-key-line')).toHaveCount(0);
    await expect(page.getByTestId('ai-key-prompt')).toBeVisible();
  });

  test('from the interview setup: replace with a key from another provider', async ({ page }) => {
    const backend = await setup(page);
    await page.goto('/software/interviews');
    await page.getByTestId('saved-key-line').getByRole('button').click();
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('button', { name: 'Replace' }).click();
    await dialog.getByTestId('ai-key-provider').click();
    await page.getByRole('option', { name: 'OpenAI' }).click();
    await dialog.getByLabel(/API key/).fill('sk-proj-replacement0000000000000000000000WXYZ');
    await dialog.getByRole('button', { name: 'Save key' }).click();
    await expect(dialog).toHaveCount(0);
    expect(backend.savedKeys).toHaveLength(1);
    await expect(page.getByTestId('saved-key-line')).toContainText('OpenAI key');
    await expect(page.getByTestId('saved-key-line')).toContainText('WXYZ');
  });

  test('from a pad: the interviewer options open the same dialog for the owner', async ({
    page,
  }) => {
    await setup(page);
    await page.goto(`/pads/${ACTIVE_PAD_ID}`);
    await page.getByRole('button', { name: 'Interviewer options' }).click();
    await page.getByTestId('interviewer-key').click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('heading', { name: 'Your AI API key' })).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Replace' })).toBeVisible();
    await dialog.getByRole('button', { name: 'Remove' }).click();
    await expect(dialog).toHaveCount(0);
    // Without a key the interviewer panel asks for one.
    await expect(page.getByTestId('ai-key-prompt')).toBeVisible();
  });
});
