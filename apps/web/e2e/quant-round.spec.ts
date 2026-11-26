/**
 * The live quant round: starting one from the Quant page, the quant pad (question, chat and
 * voice, scratchpad), the round played through to its report, and what keeps the two pad formats
 * apart (Monaco never loads in a quant pad, KaTeX never in a coding pad). The round is played by
 * the mock (mock-quant-round.ts) through the contract's own `advanceRound`.
 */
import { expect, type Page, test } from '@playwright/test';
import { ACTIVE_PAD_ID, aiKeyStatus, ENDED_PAD_ID, uuid } from './fixtures';
import { LINES, QUANT_ENDED_PAD_ID, QUANT_PAD_ID, ROUND_BANK } from './fixtures-quant-round';
import { setup } from './helpers';
import type { MockBackend } from './mock-api';

const heading = (page: Page) => page.getByTestId('round-heading');
const message = (page: Page) => page.getByLabel('Message', { exact: true });

async function say(page: Page, text: string) {
  await message(page).fill(text);
  await message(page).press('Enter');
}

async function openQuantPad(page: Page, configure?: (b: MockBackend) => void, id = QUANT_PAD_ID) {
  const b = await setup(page, configure);
  await page.goto(`/pads/${id}`);
  await expect(page.getByTestId('quant-workspace')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole('status', { name: 'Connected' })).toBeVisible();
  return b;
}

const quantStarts = (b: MockBackend) =>
  b.requests.filter((r) => r.method === 'POST' && r.path === '/api/pads/quant');

/** What a page loaded: KaTeX's stylesheet (by its font rule), its script, its fonts. */
const katexLoaded = (page: Page) =>
  page.evaluate(async () => {
    const css = [...document.styleSheets].some((s) => {
      try {
        return [...s.cssRules].some((r) => r.cssText.includes('KaTeX_Main'));
      } catch {
        return false;
      }
    });
    const scripts = performance
      .getEntriesByType('resource')
      .map((e) => e.name)
      .filter((n) => n.includes('/_next/') && n.endsWith('.js'));
    const texts = await Promise.all(scripts.map((s) => fetch(s).then((r) => r.text())));
    return { css, js: texts.some((t) => t.includes('KaTeX parse error')) };
  });

const PROMPT_1 = ROUND_BANK['prob-dice-eight']?.prompt ?? '';

test.describe('starting a round', () => {
  for (const path of ['trader', 'researcher'] as const) {
    test(`from the ${path} path, with its refusals`, async ({ page }) => {
      const b = await setup(page);
      await page.goto(path === 'trader' ? '/quant' : '/quant?path=researcher');
      const card = page.getByTestId('round-setup');
      await expect(card.getByRole('heading', { name: 'Live interview round' })).toBeVisible();
      // First on the path, above its topics.
      const cardBox = await card.boundingBox();
      const stepBox = await page.getByTestId('quant-step').first().boundingBox();
      expect(cardBox && stepBox && cardBox.y < stepBox.y).toBe(true);
      await expect(card).toContainText(`questions from the ${path} path`);

      // Each length, with the questions it asks.
      await expect(card.getByRole('radio', { name: / min$/ })).toHaveText([
        '20 min',
        '30 min',
        '45 min',
      ]);
      await expect(card.getByTestId('round-shape')).toContainText('4 questions, about 8 minutes');
      await card.getByRole('radio', { name: '45 min' }).click();
      await expect(card.getByTestId('round-shape')).toContainText('6 questions, about 8 minutes');
      await card.getByRole('radio', { name: '20 min' }).click();
      await expect(card.getByTestId('round-shape')).toContainText('3 questions, about 7 minutes');
      // The interviewer's options are the coding setup's.
      await card.getByRole('radio', { name: 'Tough' }).click();
      await card.getByRole('radio', { name: 'Often' }).click();
      const start = card.getByRole('button', { name: 'Start the round' });

      // The path is short of questions.
      b.quant.unavailable = path;
      await start.click();
      await expect(card.getByTestId('round-error')).toHaveText(
        'This path does not have enough questions for a 3-question round yet. Try a shorter round.',
      );
      b.quant.unavailable = false;
      // The key went missing since the page loaded.
      b.fail(/POST \/api\/pads\/quant/, 409, {
        error: { code: 'ai_key_missing', message: 'Add a key' },
      });
      await start.click();
      await expect(card.getByTestId('round-error')).toContainText(
        'The interviewer runs the round on your own AI API key',
      );
      // Too many starts: a plain message, and Start waits.
      b.fail(/POST \/api\/pads\/quant/, 429, {
        error: { code: 'rate_limited', message: 'Too many pads', retryAfter: 90 },
      });
      await start.click();
      await expect(card.getByTestId('round-error')).toHaveText(
        'You have started a lot of interviews in a short time. You can start another in 2 min.',
      );
      await expect(start).toBeDisabled();
      expect(quantStarts(b)).toHaveLength(3);
      expect(quantStarts(b)[0]?.body).toEqual({
        path,
        durationMin: 20,
        interviewer: { style: 'tough', proactivity: 'high', voice: false },
        // As the path decides: a trader round has a game, a researcher round none.
        includeGame: path === 'trader',
      });
    });
  }

  test('starts and opens the pad, where the interviewer greets and asks', async ({ page }) => {
    // The spec starts the round itself, so the state before the greeting can be looked at.
    const b = await setup(page, (x) => {
      x.quant.autoStart = false;
    });
    await page.goto('/quant?path=researcher');
    await page.getByRole('button', { name: 'Start the round' }).click();
    await expect(page).toHaveURL(/\/pads\/[0-9a-f-]{36}$/);
    await expect(page.getByTestId('round-pending')).toContainText(
      'The interviewer is about to start',
    );
    b.quant.start(new URL(page.url()).pathname.split('/').at(-1) as string);
    await expect(page.getByTestId('proactive-message').first()).toContainText(LINES.greeting);
    await expect(heading(page)).toHaveText('Question 1 of 4');
    await expect(page.getByTestId('question-message')).toContainText(PROMPT_1.slice(0, 20));
    await expect(page.getByTestId('question-topic')).toHaveText('Probability');
    // The setup is kept for next time.
    await page.goto('/quant');
    await expect(page.getByRole('radio', { name: '30 min' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    expect(quantStarts(b)).toHaveLength(1);
  });

  test('without a key: the prompt, and Start asks for one first', async ({ page }) => {
    const b = await setup(page, (x) => {
      x.aiKey = aiKeyStatus('missing');
    });
    await page.goto('/quant');
    const card = page.getByTestId('round-setup');
    await expect(card.getByTestId('round-key-prompt')).toContainText(
      'The round runs on your own AI API key',
    );
    await card.getByRole('button', { name: 'Start the round' }).click();
    const dialog = page.getByRole('dialog', { name: 'Add your API key to start' });
    await expect(dialog).toBeVisible();
    expect(quantStarts(b)).toHaveLength(0);
    await dialog
      .getByLabel(/API key/)
      .first()
      .fill('sk-ant-api03-e2eQUANTROUND-0123456789abcdefghij');
    await dialog.getByRole('button', { name: 'Save key and start' }).click();
    await expect(page).toHaveURL(/\/pads\/[0-9a-f-]{36}$/);
    expect(quantStarts(b)).toHaveLength(1);
  });
});

test.describe('the quant pad', () => {
  test('at 1440: question, conversation and scratchpad; no editor, runs or language', async ({
    page,
  }) => {
    const monaco: string[] = [];
    page.on('request', (r) => r.url().includes('/monaco/') && monaco.push(r.url()));
    const b = await openQuantPad(page);
    await expect(heading(page)).toHaveText('Question 1 of 4');
    const prompt = page.getByTestId('question-prompt');
    await expect(prompt.locator('.katex').first()).toBeVisible();
    await expect(page.getByTestId('question-timer').first()).toHaveText(/\d+:\d\d/);
    await expect(page.getByTestId('quant-badge')).toHaveText('Quant');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Trader quant round');
    // The conversation in the middle, the scratchpad on the right.
    const q = await page.getByTestId('question-panel').boundingBox();
    const chat = await page.getByRole('region', { name: 'Interviewer chat' }).boundingBox();
    const scratch = await page.getByRole('textbox', { name: 'Scratchpad' }).boundingBox();
    expect(q && chat && scratch && q.x < chat.x && chat.x < scratch.x).toBe(true);
    await expect(page.getByTestId('question-message')).toHaveCount(1);
    // The topic's title comes with the round: no topic list is fetched for it.
    await expect(page.getByTestId('question-topic')).toHaveText('Probability');
    expect(b.requests.filter((r) => r.path === '/api/quiz/topics')).toEqual([]);
    // Nothing of a coding pad.
    await expect(page.getByRole('combobox', { name: 'Language' })).toHaveCount(0);
    await expect(page.getByTestId('run-file')).toHaveCount(0);
    await expect(page.getByTestId('submit')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Editor settings' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Keyboard shortcuts' })).toHaveCount(0);
    await expect(page.locator('.monaco-editor')).toHaveCount(0);
    // The interviewer runs the round: it cannot be turned off here.
    await page.getByRole('button', { name: 'Interviewer options' }).click();
    await expect(page.getByRole('menuitemradio', { name: 'Often' })).toBeVisible();
    await expect(page.getByRole('menuitem', { name: /Turn the interviewer off/ })).toHaveCount(0);
    await page.keyboard.press('Escape');
    // The whiteboard beside the scratchpad.
    await page.getByRole('tab', { name: 'Whiteboard' }).click();
    await expect(page.getByRole('tab', { name: 'Whiteboard' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await page.getByRole('tab', { name: 'Scratchpad' }).click();
    await page.getByRole('textbox', { name: 'Scratchpad' }).fill('36 outcomes, 5 good');
    expect(monaco).toEqual([]);
    expect(b.received.some((e) => e.type === 'language')).toBe(false);
  });

  test('at 390: question, scratchpad and chat panes, the question kept above the chat', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const b = await openQuantPad(page);
    const tabs = page.getByRole('tablist', { name: 'Pad sections' });
    await expect(tabs.getByRole('tab')).toHaveText(['Question', 'Scratchpad', 'Chat']);
    await expect(tabs.getByRole('tab', { name: 'Chat' })).toHaveAttribute('aria-selected', 'true');
    const strip = page.getByTestId('question-strip');
    await expect(strip).toContainText('Question 1 of 4');
    await expect(strip.locator('.katex').first()).toBeVisible();
    await strip.click();
    await expect(tabs.getByRole('tab', { name: 'Question' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await expect(page.getByTestId('question-prompt')).toBeVisible();
    // A new question while elsewhere marks the tabs.
    await tabs.getByRole('tab', { name: 'Scratchpad' }).click();
    await expect(page.getByRole('textbox', { name: 'Scratchpad' })).toBeVisible();
    await b.quant.close(QUANT_PAD_ID);
    await expect(page.getByTestId('question-unread')).toBeVisible();
    await expect(page.getByTestId('chat-tab-unread')).toHaveText('2');
    await tabs.getByRole('tab', { name: 'Question' }).click();
    await expect(heading(page)).toHaveText('Question 2 of 4');
    await expect(page.getByTestId('question-unread')).toHaveCount(0);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth),
    ).toBeLessThanOrEqual(0);
  });

  test('a round played through: hint, close, timeout, the round finishing, the report', async ({
    page,
  }) => {
    const b = await setup(page);
    await page.goto('/quant');
    // Bank questions only (quant-game.spec.ts plays the game).
    await page.getByRole('switch', { name: 'Include a market-making game' }).click();
    await page.getByRole('button', { name: 'Start the round' }).click();
    await expect(heading(page)).toHaveText('Question 1 of 4', { timeout: 20_000 });
    const id = new URL(page.url()).pathname.split('/')[2] ?? '';
    await expect(page.getByTestId('proactive-message').first()).toContainText('thanks for joining');

    // A hint, counted in the panel, in the interviewer's words in the chat (with its math).
    await say(page, 'hint: I am not sure where to start');
    await expect(page.getByTestId('hints-given')).toHaveText('1 hint so far');
    const hint = page.getByTestId('interviewer-message').last();
    await expect(hint).toContainText('count the outcomes rather than the sums');
    await expect(hint.locator('.katex').first()).toBeVisible();
    // An ordinary turn stays on the question.
    await say(page, 'So 36 outcomes in all.');
    await expect(page.getByTestId('interviewer-message').last()).toContainText('conditioning on');
    await expect(heading(page)).toHaveText('Question 1 of 4');

    // A close: the feedback, then the next question, in the chat and the panel.
    await say(page, 'answer: 5/36');
    await expect(heading(page)).toHaveText('Question 2 of 4');
    await expect(page.getByTestId('question-message')).toHaveCount(2);
    await expect(page.getByTestId('question-message').last()).toContainText('Question 2');
    await expect(page.getByTestId('question-message').last()).toContainText('two ropes');
    await expect(page.getByTestId('hints-given')).toHaveCount(0);
    // The earlier question, collapsed to its prompt.
    const earlier = page.getByTestId('earlier-questions');
    await expect(earlier.locator('details')).toHaveCount(1);
    await expect(earlier.getByText('Two fair six-sided dice')).toBeHidden();
    await earlier.getByText('Question 1').click();
    await expect(earlier.getByText('Two fair six-sided dice')).toBeVisible();

    // Past the question's time: a quiet "over time", then closed for time.
    await b.quant.nudge(id);
    const timer = page.getByTestId('question-timer').first();
    await expect(timer).toHaveAttribute('data-over', 'true');
    await expect(timer).toContainText('over time');
    await b.quant.timeout(id);
    await expect(heading(page)).toHaveText('Question 3 of 4');
    await expect(page.getByTestId('proactive-message').last()).toContainText(LINES.timeout);
    // The pad says it timed out (newest first); the one the interviewer closed says nothing.
    await expect(earlier.locator('details')).toHaveCount(2);
    await expect(earlier.getByTestId('question-closed-by')).toHaveText(['Timed out']);
    await expect(
      earlier.locator('details').first().getByTestId('question-closed-by'),
    ).toBeVisible();
    // The follow-up, asked once.
    await say(page, 'follow me: E = 7?');
    await expect(page.getByTestId('interviewer-message').last()).toContainText('weighted');

    // The round finishes: the wrap-up, and the way to the report.
    await b.quant.finish(id);
    await expect(heading(page)).toHaveText('Round finished');
    await expect(page.getByTestId('proactive-message').last()).toContainText(
      "That's the last question",
    );
    await expect(page.getByTestId('question-timer')).toHaveCount(0);
    await page.getByRole('button', { name: 'End and see the report' }).click();
    await expect(page).toHaveURL(new RegExp(`/pads/${id}/report$`));
    const reviews = page.getByTestId('question-review');
    await expect(reviews).toHaveCount(4);
    await expect(reviews.getByTestId('review-status')).toHaveText([
      'Answered',
      'Timed out',
      'Answered',
      'Answered',
    ]);
    await expect(reviews.first().getByTestId('review-hints')).toHaveText('1 of 2 hints');
    await expect(page.getByTestId('quant-stats')).toContainText('3 of 4');
    expect(b.quant.log.filter((l) => !l.ok)).toEqual([]);
  });

  test('ending mid-round leaves the open question unfinished and the rest not reached', async ({
    page,
  }) => {
    await openQuantPad(page);
    await page.getByRole('button', { name: 'End interview' }).click();
    const dialog = page.getByRole('dialog', { name: 'End the interview?' });
    await expect(dialog).toContainText('Questions done');
    await expect(dialog).toContainText('0 of 4');
    await expect(dialog.getByTestId('end-round-note')).toContainText(
      'Question 1 is still open: ending now leaves it unfinished and the rest unasked.',
    );
    await expect(dialog).not.toContainText('Submissions');
    await dialog.getByRole('button', { name: 'End and see report' }).click();
    await expect(page).toHaveURL(new RegExp(`/pads/${QUANT_PAD_ID}/report$`));
    await expect(page.getByTestId('question-review').getByTestId('review-status')).toHaveText([
      'Unfinished',
      'Not reached',
      'Not reached',
      'Not reached',
    ]);
  });

  test('math is typeset in the question panel and in chat; candidate text stays as typed', async ({
    page,
  }) => {
    await openQuantPad(page);
    await expect(page.getByTestId('question-prompt').locator('.katex')).toHaveCount(1);
    await expect(page.getByTestId('question-message').locator('.katex')).toHaveCount(1);
    await say(page, 'Is it $5/36$ then?');
    await expect(page.getByTestId('interviewer-message').last().locator('.katex')).toHaveCount(1);
    await expect(page.getByText('Is it $5/36$ then?')).toBeVisible();
    // KaTeX's fonts came with the pad's chunk, from this origin.
    await expect
      .poll(() =>
        page.evaluate(() =>
          [...document.fonts].some((f) => f.family === 'KaTeX_Main' && f.status === 'loaded'),
        ),
      )
      .toBe(true);
  });

  test('a reconnect shows the current question, though its messages were missed', async ({
    page,
  }) => {
    const b = await openQuantPad(page);
    await expect(heading(page)).toHaveText('Question 1 of 4');
    b.quant.muted = true;
    await b.quant.close(QUANT_PAD_ID);
    await page.waitForTimeout(300);
    await expect(heading(page)).toHaveText('Question 1 of 4');
    b.quant.muted = false;
    for (const ws of b.sockets) await ws.close({ code: 4000, reason: 'dropped' });
    await expect(heading(page)).toHaveText('Question 2 of 4', { timeout: 15_000 });
    await expect(page.getByTestId('question-prompt')).toContainText('two ropes');
    // The chat never got the question's message: the panel read the round itself.
    await expect(page.getByTestId('question-message')).toHaveCount(1);
  });

  for (const order of ['after', 'before'] as const) {
    test(`round.updated ${order} its messages ends in the same place`, async ({ page }) => {
      const b = await openQuantPad(page, (x) => {
        x.quant.roundFirst = order === 'before';
      });
      await b.quant.close(QUANT_PAD_ID);
      await expect(heading(page)).toHaveText('Question 2 of 4');
      await expect(page.getByTestId('question-message')).toHaveCount(2);
      // Numbered by its id in the round, whichever came first.
      await expect(page.getByTestId('question-message').last()).toContainText('Question 2');
      await expect(page.getByTestId('earlier-questions').locator('details')).toHaveCount(1);
    });
  }

  test('an older round.updated arriving late is ignored', async ({ page }) => {
    const b = await openQuantPad(page);
    const before = b.quant.view(QUANT_PAD_ID);
    await b.quant.close(QUANT_PAD_ID);
    await expect(heading(page)).toHaveText('Question 2 of 4');
    if (!before) throw new Error('no round');
    b.push({ type: 'round.updated', round: before });
    await page.waitForTimeout(400);
    await expect(heading(page)).toHaveText('Question 2 of 4');
    await expect(page.getByTestId('earlier-questions').locator('details')).toHaveCount(1);
  });

  test('voice says where the question is instead of reading its LaTeX', async ({ page }) => {
    await page.addInitScript(() => {
      const w = window as unknown as Record<string, unknown>;
      w.__spoken = [];
      w.SpeechRecognition = class {
        continuous = false;
        interimResults = true;
        lang = 'en';
        onresult = null;
        onend = null;
        onerror = null;
        onstart = null;
        onspeechstart = null;
        start() {}
        stop() {}
        abort() {}
      };
      Object.defineProperty(window, 'speechSynthesis', {
        value: {
          speaking: false,
          getVoices: () => [],
          cancel() {},
          speak(u: { text: string; onstart?: () => void; onend?: () => void }) {
            (w.__spoken as string[]).push(u.text);
            u.onstart?.();
            setTimeout(() => u.onend?.(), 20);
          },
        },
      });
    });
    const id = uuid(1301);
    const b = await openQuantPad(
      page,
      (b) => {
        b.quant.seed({
          id,
          path: 'trader',
          durationMin: 20,
          startedAt: new Date().toISOString(),
          script: [],
          voice: true,
        });
      },
      id,
    );
    await expect(page.getByTestId('voice-bar')).toBeVisible();
    await expect(heading(page)).toHaveText('Question 1 of 3');
    const spoken = () =>
      page.evaluate(() => (window as unknown as { __spoken: string[] }).__spoken);
    await expect.poll(spoken).toEqual([LINES.greeting, 'Question 1 is on your screen.']);
    // The interviewer's own LaTeX and markup are said in words; the chat shows them typeset.
    await b.quant.hint(id, 'Try $P(A \\mid B) = \\frac{1}{6}$ first; **each** win pays \\$10.');
    await expect
      .poll(spoken)
      .toEqual([
        LINES.greeting,
        'Question 1 is on your screen.',
        'Try the probability of A given B equals 1 over 6 first; each win pays 10 dollars.',
      ]);
    await expect(page.getByTestId('proactive-message').last().locator('.katex')).toHaveCount(1);

    // Streamed text is never spoken: a discarded stream says nothing, a posted one is said once.
    const dropped = uuid(1302);
    await b.quant.streamDeltas(dropped, 'Let me think about');
    await expect(page.getByTestId('streaming-message')).toContainText('Let me think about');
    b.quant.discard(dropped);
    await expect(page.getByTestId('streaming-message')).toHaveCount(0);
    const posted = uuid(1303);
    await b.quant.streamDeltas(posted, 'Good. Is that $\\frac{1}{6}$ final?');
    await b.quant.hint(id, 'Good. Is that $\\frac{1}{6}$ final?', posted);
    await expect.poll(async () => (await spoken()).length).toBe(4);
    await page.waitForTimeout(300);
    expect((await spoken()).slice(3)).toEqual(['Good. Is that 1 over 6 final?']);
  });

  test('a streamed message appears as it is written, half-written math held back, and the posted one replaces it', async ({
    page,
  }) => {
    const b = await openQuantPad(page);
    const streaming = page.getByTestId('streaming-message');
    const id = uuid(1310);
    await b.quant.streamDeltas(id, 'Think about $\\frac{5}{');
    await expect(streaming).toContainText('Think about');
    // The formula is not shown until it closes: no raw source, no KaTeX error.
    await expect(streaming).not.toContainText('frac');
    await expect(streaming.locator('.katex, .katex-error')).toHaveCount(0);
    await b.quant.streamDeltas(id, '36}$ first, then');
    await expect(streaming.locator('.katex')).toHaveCount(1);
    await expect(streaming).toContainText('first, then');
    const text = 'Think about $\\frac{5}{36}$ first, then the complement.';
    await b.quant.hint(QUANT_PAD_ID, text, id);
    await expect(streaming).toHaveCount(0);
    const posted = page.getByTestId('proactive-message').filter({ hasText: 'the complement' });
    await expect(posted).toHaveCount(1);
    await expect(posted.locator('.katex')).toHaveCount(1);
    // One message, not the stream and the post side by side.
    await expect(page.getByText(/Think about/)).toHaveCount(1);
  });

  test('a streamed message that is discarded disappears, and a reply streams in its place', async ({
    page,
  }) => {
    const b = await openQuantPad(page);
    const streaming = page.getByTestId('streaming-message');
    const id = uuid(1320);
    await b.quant.streamDeltas(id, 'Before you answer, what is');
    await expect(streaming).toContainText('Before you answer');
    b.quant.discard(id);
    await expect(streaming).toHaveCount(0);
    await expect(page.getByText('Before you answer')).toHaveCount(0);

    // A scripted reply streamed by the mock as the API does, then posted under the same id.
    b.quant.streamMessages = true;
    b.quant.streamChunkMs = 60;
    await say(page, 'hint please');
    await expect(streaming).toBeVisible();
    await expect(streaming).toHaveCount(0, { timeout: 10_000 });
    await expect(
      page
        .getByTestId('interviewer-message')
        .filter({ hasText: 'count the outcomes rather than the sums' }),
    ).toHaveCount(1);
  });

  test('runs and language changes are refused for a quant pad', async ({ page }) => {
    await openQuantPad(page);
    const status = (path: string, body: unknown, method = 'POST') =>
      page.evaluate(
        async ([p, b, m]) =>
          (
            await fetch(p as string, {
              method: m as string,
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify(b),
            })
          ).json(),
        [path, body, method] as const,
      );
    expect(
      await status(`/api/pads/${QUANT_PAD_ID}/runs`, {
        mode: 'file',
        language: 'python',
        source: 'print(1)',
      }),
    ).toMatchObject({ error: { code: 'wrong_format' } });
    expect(await status(`/api/pads/${QUANT_PAD_ID}`, { language: 'cpp' }, 'PATCH')).toMatchObject({
      error: { code: 'wrong_format' },
    });
  });
});

test.describe('the quant report', () => {
  test('scores the round and reviews every question, with its status and solution', async ({
    page,
  }) => {
    const b = await setup(page);
    await page.goto(`/pads/${QUANT_ENDED_PAD_ID}/report`);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Trader quant round');
    await expect(page.getByTestId('quant-badge')).toHaveText('Quant');
    const header = page.locator('header').filter({ hasText: 'Quant round report' });
    await expect(header).not.toContainText('Python');

    const stats = page.getByTestId('quant-stats');
    await expect(stats).toContainText('Answered');
    await expect(stats).toContainText('1 of 4');
    await expect(stats).toContainText('3 asked · 1 timed out · 1 not reached');
    await expect(stats).toContainText('Mean score');
    await expect(stats).toContainText('Hints used');
    // A quant pad has no runs: no run figures, not even zeros.
    for (const label of ['Runs', 'Submissions', 'Result'])
      await expect(page.getByText(label, { exact: true })).toHaveCount(0);

    // The five quant dimensions, in order, with their labels.
    const assessment = page.getByRole('region', { name: 'Assessment' });
    await expect(assessment.locator('meter')).toHaveCount(5);
    await expect(assessment.locator('li .text-sm.font-medium')).toHaveText([
      'Structuring',
      'Correctness',
      'Communication',
      'Speed',
      'Independence',
    ]);
    await expect(assessment.locator('.katex').first()).toBeVisible();
    // The math the assessment writes is typeset everywhere in it, not only in the summary.
    for (const text of ['The one finished answer', 'Counts outcomes', 'Say the answer']) {
      const item = page.locator('li', { hasText: text });
      await expect(item.locator('.katex')).toHaveCount(1);
      await expect(item).not.toContainText('$');
    }

    const reviews = page.getByTestId('question-review');
    await expect(reviews.getByTestId('review-status')).toHaveText([
      'Answered',
      'Timed out',
      'Unfinished',
      'Not reached',
    ]);
    const [first, second, third, fourth] = [0, 1, 2, 3].map((i) => reviews.nth(i));
    if (!first || !second || !third || !fourth) throw new Error('four reviews');
    await expect(first.getByTestId('review-score')).toHaveText('85%');
    await expect(first.getByTestId('review-hints')).toHaveText('0 of 2 hints');
    await expect(first.getByTestId('review-time')).toHaveText('1:09 of 7:13');
    await expect(first.getByTestId('review-prompt').locator('.katex')).toHaveCount(1);
    await expect(first.getByTestId('review-solution').locator('.katex')).toHaveCount(1);
    await expect(first.getByTestId('review-verdict').locator('.katex').first()).toBeVisible();
    await expect(second.getByTestId('review-hints')).toHaveText('2 of 3 hints');
    await expect(second.getByTestId('review-time')).toContainText('(over time)');
    await expect(second).toContainText('Key points');
    // Judged by the assessment after the round.
    await expect(third.getByTestId('review-score')).toHaveText('20%');
    await expect(third.getByTestId('review-solution')).toContainText('7 (dollars)');
    // Never asked: collapsed, its question and solution there to read.
    await expect(fourth).toContainText('The round ended before this one');
    await expect(fourth.getByText('Put-call parity')).toBeHidden();
    await fourth.getByText('Question 4').click();
    await expect(fourth.getByText(/Put-call parity/)).toBeVisible();
    // Topic titles come with the report, not from a topic list.
    await expect(first).toContainText('· Probability');
    await expect(fourth).toContainText('· Options & finance');
    expect(b.requests.filter((r) => r.path === '/api/quiz/topics')).toEqual([]);

    // The playback is the scratchpad's; the transcript shows the questions, typeset.
    const playback = page.getByRole('region', { name: 'Playback' });
    await expect(playback.getByRole('tablist', { name: 'Buffer' })).toHaveCount(0);
    await expect(playback.getByText('Follow active language')).toHaveCount(0);
    await expect(page.getByTestId('playback-code')).toContainText('Q1: pairs summing to 8');
    await expect(playback.getByTestId('question-event')).toHaveText([
      'Question 1 of 4',
      'Question 2 of 4',
      'Question 3 of 4',
    ]);
    await expect(playback.getByRole('list').locator('.katex').first()).toBeVisible();
  });
});

test.describe('formats kept apart', () => {
  test('a coding pad and its report load no KaTeX; a quant pad loads no Monaco', async ({
    page,
  }) => {
    const requests: string[] = [];
    page.on('request', (r) => requests.push(r.url()));
    await setup(page);

    await page.goto(`/pads/${ACTIVE_PAD_ID}`);
    await expect(page.locator('.view-lines')).toContainText('class Solution', { timeout: 20_000 });
    expect(await katexLoaded(page)).toEqual({ css: false, js: false });
    expect(requests.some((u) => u.includes('/monaco/'))).toBe(true);

    await page.goto(`/pads/${ENDED_PAD_ID}/report`);
    await expect(page.getByText('Strengths')).toBeVisible();
    await expect(page.getByTestId('playback-code')).toContainText('LRUCache');
    expect(await katexLoaded(page)).toEqual({ css: false, js: false });

    requests.length = 0;
    await page.goto(`/pads/${QUANT_PAD_ID}`);
    await expect(page.getByTestId('question-prompt').locator('.katex')).toHaveCount(1);
    await page.getByRole('tab', { name: 'Whiteboard' }).click();
    await page.waitForTimeout(500);
    expect(await katexLoaded(page)).toEqual({ css: true, js: true });
    expect(requests.filter((u) => u.includes('/monaco/'))).toEqual([]);
    await expect(page.locator('.monaco-editor')).toHaveCount(0);

    await page.goto(`/pads/${QUANT_ENDED_PAD_ID}/report`);
    await expect(page.getByTestId('quant-review').locator('.katex').first()).toBeVisible();
  });

  test('the dashboard shows a quant pad as Quant with its path, never as a language', async ({
    page,
  }) => {
    await setup(page, (b) => b.quant.listOnDashboard());
    await page.goto('/dashboard');
    const active = page.getByRole('region', { name: 'In progress' });
    const row = active.getByRole('listitem').filter({ hasText: 'Trader quant round' });
    await expect(row.getByTestId('quant-badge')).toHaveText('Quant · Trader');
    await expect(row).not.toContainText('Python');
    await page.goto('/dashboard?view=history');
    const table = page.getByRole('table');
    const ended = table.getByRole('row').filter({ hasText: 'Trader quant round' });
    await expect(ended.getByTestId('quant-badge')).toHaveText('Quant · Trader');
    await expect(ended).not.toContainText('Python');
    await expect(ended).toContainText('Scored in the report');
    // A coding pad keeps its language.
    await expect(table.getByRole('row').filter({ hasText: 'LRU Cache' })).toContainText('Python');
  });
});
