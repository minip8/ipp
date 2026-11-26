import { expect, type Page, test } from '@playwright/test';
import { ACTIVE_PAD_ID, aiKeyStatus, PROBLEMS, RUNS } from './fixtures';
import { setup } from './helpers';
import type { MockBackend } from './mock-api';

async function openPad(page: Page, configure?: (b: MockBackend) => void) {
  const backend = await setup(page, configure);
  await page.goto(`/pads/${ACTIVE_PAD_ID}`);
  await expect(page.locator('.view-lines')).toContainText('class Solution', { timeout: 20_000 });
  await expect(page.getByRole('status', { name: 'Connected' })).toBeVisible();
  return backend;
}

test('create a pad from the library with the chosen settings', async ({ page }) => {
  const backend = await setup(page);
  await page.goto('/new');
  await page.getByRole('searchbox', { name: 'Search problems' }).fill('lru');
  await expect(page.getByRole('button', { name: /^Two Sum/ })).toHaveCount(0);
  await page.getByRole('button', { name: /^LRU Cache/ }).click();
  await page.getByRole('radio', { name: 'Python' }).click();
  await page.getByRole('radio', { name: '60 min' }).click();
  await page.getByRole('radio', { name: 'Tough' }).click();
  await page.getByRole('radio', { name: 'Often' }).click();
  await page.getByRole('button', { name: 'Start interview' }).click();
  await expect(page).toHaveURL(/\/pads\/[0-9a-f-]{36}$/);
  const create = backend.requests.find((r) => r.method === 'POST' && r.path === '/api/pads');
  expect(create?.body).toMatchObject({
    problemSlug: 'lru-cache',
    language: 'python',
    durationMin: 60,
    interviewer: { style: 'tough', proactivity: 'high', enabled: true },
  });
});

test('a pad without a time limit shows the time elapsed instead of a countdown', async ({
  page,
}) => {
  const backend = await setup(page);
  await page.goto('/new');
  await page.getByRole('button', { name: /^LRU Cache/ }).click();
  await expect(page.getByTestId('duration-note')).toHaveCount(0);
  await page.getByRole('radio', { name: 'No limit' }).click();
  await expect(page.getByTestId('duration-note')).toContainText('never brings up the time');
  await page.getByRole('button', { name: 'Start interview' }).click();
  await expect(page).toHaveURL(/\/pads\/[0-9a-f-]{36}$/);
  const create = backend.requests.find((r) => r.method === 'POST' && r.path === '/api/pads');
  expect(create?.body).toMatchObject({ problemSlug: 'lru-cache', durationMin: null });
  const timer = page.getByTestId('timer');
  await expect(timer).toHaveAccessibleName(/^Time elapsed: 0:0\d$/);
  await timer.hover();
  await expect(page.getByRole('tooltip')).toContainText('No time limit, started');
  // The choice is remembered for the next interview.
  await page.goto('/new');
  await expect(page.getByRole('radio', { name: 'No limit' })).toHaveAttribute(
    'aria-checked',
    'true',
  );
});

test('a link with a difficulty picks a random problem and waits for Start', async ({ page }) => {
  const backend = await setup(page);
  const medium = PROBLEMS.filter((p) => p.difficulty === 'medium');
  // The old address of the setup page still works and is sent on to the Interviews page.
  await page.goto('/new?difficulty=medium&random=1');
  // The pick lands in the setup panel (and the URL) without creating a pad.
  await expect(page).toHaveURL(/\/dashboard\?difficulty=medium&problem=[a-z0-9-]+$/);
  const first = new URL(page.url()).searchParams.get('problem');
  const title = page.getByTestId('selected-problem');
  await expect(title).toHaveText(medium.find((p) => p.slug === first)?.title ?? '?');
  expect(backend.requests.some((r) => r.method === 'POST' && r.path === '/api/pads')).toBe(false);

  // Re-roll: another medium problem.
  await page.getByRole('button', { name: 'Pick another random problem' }).click();
  await expect(title).not.toHaveText(medium.find((p) => p.slug === first)?.title ?? '?');
  const rerolledTitle = await title.textContent();
  const rerolled = medium.find((p) => p.title === rerolledTitle);
  expect(rerolled).toBeDefined();

  await page.getByRole('button', { name: 'Start interview' }).click();
  await expect(page).toHaveURL(/\/pads\/[0-9a-f-]{36}$/);
  const create = backend.requests.find((r) => r.method === 'POST' && r.path === '/api/pads');
  expect(create?.body).toMatchObject({ problemSlug: rerolled?.slug });
  expect(create?.body).not.toHaveProperty('random');
});

test('run tests: progress, then a wrong answer with a readable diff', async ({ page }) => {
  const backend = await openPad(page, (b) => {
    b.nextRun = (id) => RUNS.wrongAnswer(id);
    b.runDelayMs = 1500;
  });
  await page.getByTestId('run-tests').click();
  await expect(page.getByTestId('run-progress')).toBeVisible();
  await expect(page.getByTestId('run-tests')).toBeDisabled();
  const result = page.getByTestId('run-result');
  await expect(result).toContainText('Wrong answer');
  await expect(result).toContainText('1 / 2 tests passed');
  // The failing sample is selected first and shows input, expected and actual.
  await expect(page.getByRole('tab', { name: /Sample 2\W+Failed/ })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(result).toContainText('nums = [3,2,4]');
  await expect(result).toContainText('[1,2]');
  await expect(result).toContainText('[0,0]');
  await expect(result).toContainText('checking i=0 j=0');
  const run = backend.requests.find((r) => r.path.endsWith('/runs'));
  expect(run?.body).toMatchObject({ mode: 'samples', language: 'cpp' });
  expect((run?.body as { source?: string } | undefined)?.source).toContain('class Solution');
});

test('compile errors link to the line in the editor', async ({ page }) => {
  const backend = await openPad(page);
  backend.nextRun = (id) => RUNS.compileError(id);
  await page.keyboard.press('ControlOrMeta+Enter');
  const result = page.getByTestId('run-result');
  await expect(result).toContainText('Compile error');
  await result.getByRole('button', { name: 'solution.cpp:7:31' }).click();
  await expect(page.getByRole('contentinfo')).toContainText('Ln 7,');
  expect(backend.requests.find((r) => r.path.endsWith('/runs'))?.body).toMatchObject({
    mode: 'file',
  });
});

test('run streams stdout live and shows exit details; stdin is sent', async ({ page }) => {
  const backend = await openPad(page, (b) => {
    b.runDelayMs = 1200;
  });
  await page.getByRole('tab', { name: /Input/ }).click();
  await page.getByLabel(/Standard input/).fill('4\n2 7 11 15');
  await page.getByTestId('run-file').click();
  await expect(page.getByTestId('run-progress')).toContainText('twoSum([2,7,11,15], 9)');
  const result = page.getByTestId('run-result');
  await expect(result).toContainText('Exited normally');
  await expect(result).toContainText('Exit code0');
  expect(backend.requests.find((r) => r.path.endsWith('/runs'))?.body).toMatchObject({
    mode: 'file',
    stdin: '4\n2 7 11 15',
  });
});

test('runtime errors, timeouts and crashes are spelled out', async ({ page }) => {
  const backend = await openPad(page);
  backend.nextRun = (id) => RUNS.runtimeError(id);
  await page.getByTestId('run-tests').click();
  await expect(page.getByTestId('run-result')).toContainText('Runtime error');
  await expect(page.getByTestId('run-result')).toContainText('terminated by SIGSEGV');
  await expect(page.getByRole('tab', { name: /Sample 2\W+Skipped/ })).toBeVisible();

  backend.nextRun = (id) => RUNS.timeLimit(id);
  await page.getByTestId('run-tests').click();
  await expect(page.getByTestId('run-result')).toContainText('Time limit exceeded');
  await expect(page.getByRole('tab', { name: /Sample 2\W+Timed out/ })).toBeVisible();

  backend.nextRun = (id) => RUNS.fileCrash(id);
  await page.getByTestId('run-file').click();
  await expect(page.getByTestId('run-result')).toContainText('Crashed (SIGABRT)');
  await expect(page.getByTestId('run-result')).toContainText('std::out_of_range');

  backend.nextRun = (id) => RUNS.invalid(id);
  await page.getByTestId('run-tests').click();
  await expect(page.getByTestId('run-result')).toContainText('Invalid submission');
  await expect(page.getByTestId('run-result')).toContainText('has no method');
  // Earlier runs stay reachable.
  await page.getByRole('button', { name: 'Earlier runs' }).click();
  await expect(page.getByRole('menuitem')).toHaveCount(4);
});

test('submit summarises hidden tests without revealing them', async ({ page }) => {
  const backend = await openPad(page);
  backend.nextRun = (id) => RUNS.submitPartial(id);
  await page.keyboard.press('ControlOrMeta+Shift+Enter');
  const result = page.getByTestId('run-result');
  await expect(result).toContainText('55 / 58 tests passed');
  const hidden = page.getByRole('region', { name: 'Hidden tests' });
  await expect(hidden).toContainText('Hidden tests: 53 / 56 passed');
  await expect(hidden).toContainText('1 failed · 1 timed out · 1 crashed');
  await expect(hidden.getByLabel('Hidden test 18: Failed')).toBeVisible();

  backend.nextRun = (id) => RUNS.submitAccepted(id);
  await page.getByTestId('submit').click();
  await expect(result).toContainText('Accepted');
  await expect(result).toContainText('58 / 58 tests passed');
});

test('custom tests are validated and sent with the run', async ({ page }) => {
  const backend = await openPad(page);
  await page.getByRole('tab', { name: /Custom tests/ }).click();
  await page.getByRole('button', { name: 'Add test' }).click();
  await page.getByLabel('nums').fill('[3, 3');
  await page.getByLabel('target').fill('6');
  await expect(page.getByText('nums is not valid JSON')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Run custom tests' })).toBeDisabled();
  await page.getByLabel('nums').fill('[3, 3]');
  await page.getByRole('button', { name: 'Run custom tests' }).click();
  await expect(page.getByTestId('run-result')).toContainText('Ran custom tests');
  await expect(page.getByTestId('run-result')).toContainText('nums = [3,3]');
  expect(backend.requests.find((r) => r.path.endsWith('/runs'))?.body).toMatchObject({
    mode: 'custom',
    customTests: [{ ctorArgs: [], calls: [{ method: 'twoSum', args: [[3, 3], 6] }] }],
  });
});

test('rate-limited runs explain when to retry', async ({ page }) => {
  const backend = await openPad(page);
  backend.fail(/POST .*\/runs$/, 429, {
    error: { code: 'rate_limited', message: 'Too many runs.', retryAfter: 42 },
  });
  await page.getByTestId('run-tests').click();
  await expect(page.getByText('Run limit reached')).toBeVisible();
  await expect(page.getByText('You can run code again in 42s.')).toBeVisible();
});

test('interviewer: streamed reply with thinking indicator, then a proactive message', async ({
  page,
}) => {
  const backend = await openPad(page);
  await expect(page.getByTestId('proactive-message')).toContainText('thanks for joining');
  await page.getByLabel('Message', { exact: true }).fill('Should I use a hash map?');
  await page.keyboard.press('Enter');
  await expect(page.getByText('Should I use a hash map?')).toBeVisible();
  await expect(page.getByTestId('interviewer-thinking')).toBeVisible();
  await expect(page.getByTestId('streaming-message')).toBeVisible();
  await expect(page.getByTestId('interviewer-message').last()).toContainText(
    'What would you store as the key',
  );
  await expect(page.getByTestId('streaming-message')).toHaveCount(0);
  expect(backend.received).toContainEqual({
    type: 'chat.send',
    text: 'Should I use a hash map?',
    via: 'text',
  });

  await backend.streamReply('You have gone quiet. What happens with duplicates like [3, 3]?', {
    kind: 'proactive',
    intent: 'nudge',
  });
  const proactive = page.getByTestId('proactive-message').last();
  await expect(proactive).toContainText('Spoke up · nudge');
  await expect(proactive).toContainText('[3, 3]');
});

test('without a key the chat still works between people', async ({ page }) => {
  await setup(page, (b) => {
    b.aiKey = aiKeyStatus('missing');
    const d = b.pads.get(ACTIVE_PAD_ID);
    if (d) b.pads.set(ACTIVE_PAD_ID, { ...d, messages: [] });
  });
  await page.goto(`/pads/${ACTIVE_PAD_ID}`);
  const chat = page.getByRole('region', { name: 'Interviewer chat' });
  await expect(chat.getByText('needs a key')).toBeVisible();
  await expect(page.getByPlaceholder('Message collaborators…')).toBeVisible();
  await expect(page.getByText('unavailable on this server')).toHaveCount(0);
});

test('language switch, paste/blur telemetry, shortcuts sheet and settings', async ({ page }) => {
  const backend = await openPad(page);
  await page.getByRole('combobox', { name: 'Language' }).click();
  await page.getByRole('option', { name: 'Python' }).click();
  await expect(page.locator('.view-lines')).toContainText('class Solution:');
  expect(backend.requests.find((r) => r.method === 'PATCH')?.body).toEqual({ language: 'python' });

  // Paste and tab-away telemetry reach the event channel.
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.evaluate(() => navigator.clipboard.writeText('print(1)'));
  await page.locator('.view-lines').click();
  await page.keyboard.press('ControlOrMeta+V');
  await expect
    .poll(() => backend.received.find((e) => e.type === 'telemetry' && e.kind === 'paste'))
    .toEqual({ type: 'telemetry', kind: 'paste', chars: 8 });
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  await page.waitForTimeout(2100);
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect
    .poll(() => backend.received.find((e) => e.type === 'telemetry' && e.kind === 'blur'))
    .toMatchObject({ kind: 'blur' });

  await page.getByRole('button', { name: 'Keyboard shortcuts' }).click();
  await expect(page.getByRole('dialog', { name: 'Keyboard shortcuts' })).toContainText('Submit');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Editor settings' }).click();
  await page.getByRole('radio', { name: 'Vim' }).click();
  await page.keyboard.press('Escape');
  await expect(page.locator('footer')).toContainText('vim');
});

test('end the interview and go to the report', async ({ page }) => {
  await openPad(page);
  await page.getByRole('button', { name: 'End interview' }).click();
  const dialog = page.getByRole('dialog', { name: 'End the interview?' });
  await expect(dialog).toContainText('You have not submitted yet');
  await dialog.getByRole('button', { name: 'End and see report' }).click();
  // Generous timeout: the report route may compile on first visit in next dev.
  await expect(page).toHaveURL(/\/report$/, { timeout: 30_000 });
});

test('the event socket reconnects and the status says so', async ({ page }) => {
  const backend = await openPad(page);
  for (const ws of backend.sockets) await ws.close({ code: 1006 });
  await expect(page.getByRole('button', { name: /^Reconnecting/ })).toBeVisible();
  await expect(page.getByRole('status', { name: 'Connected' })).toBeVisible({ timeout: 15_000 });
});

test('two people in the same pad see each other’s code and drawings live', async ({ browser }) => {
  const a = await browser.newPage();
  const b = await browser.newPage();
  await openPad(a);
  await openPad(b);
  const marker = `// hello-from-a-${Date.now()}`;
  await a.locator('.view-lines').click();
  await a.keyboard.press('ControlOrMeta+End');
  await a.keyboard.type(`\n${marker}`);
  await expect(b.locator('.view-lines')).toContainText(marker);
  // A's cursor is drawn in B's editor with A's name.
  await expect(b.locator('.yRemoteSelectionHead').first()).toBeAttached();

  await a.getByRole('tab', { name: 'Whiteboard' }).click();
  await b.getByRole('tab', { name: 'Whiteboard' }).click();
  const board = a.getByRole('img', { name: /^Whiteboard/ });
  const box = await board.boundingBox();
  if (!box) throw new Error('no board');
  await a.mouse.move(box.x + 200, box.y + 200);
  await a.mouse.down();
  await a.mouse.move(box.x + 260, box.y + 240, { steps: 5 });
  await a.mouse.move(box.x + 320, box.y + 220, { steps: 5 });
  await a.mouse.up();
  await expect(b.getByRole('img', { name: /^Whiteboard with [1-9]/ })).toBeVisible();
  await a.getByRole('button', { name: 'Undo' }).click();
  await expect(b.getByRole('img', { name: /^Whiteboard with 0 shapes/ })).toBeVisible();
  await a.close();
  await b.close();
});

test('editor: undo goes through the shared history, and run shortcuts work inside the editor', async ({
  page,
}) => {
  const backend = await openPad(page);
  await page.locator('.view-lines').click();
  await page.keyboard.press('ControlOrMeta+End');
  const word = `undo_me_${Date.now()}`;
  await page.keyboard.type(word);
  await expect(page.locator('.view-lines')).toContainText(word);
  await page.waitForTimeout(500);
  await page.keyboard.press('ControlOrMeta+Z');
  await expect(page.locator('.view-lines')).not.toContainText(word);
  await page.keyboard.press('ControlOrMeta+Shift+Z');
  await expect(page.locator('.view-lines')).toContainText(word);

  await page.keyboard.press("ControlOrMeta+'");
  await expect(page.getByTestId('run-result')).toContainText('Accepted');
  expect(backend.requests.find((r) => r.path.endsWith('/runs'))?.body).toMatchObject({
    mode: 'samples',
  });
  const source = (
    backend.requests.find((r) => r.path.endsWith('/runs'))?.body as { source?: string } | undefined
  )?.source;
  expect(source).toContain(word);
});

test('editor: the caret jumps straight to where it goes and blinks normally', async ({ page }) => {
  await openPad(page);
  await page.locator('.view-lines').click();
  await page.keyboard.press('ControlOrMeta+Home');
  const layer = page.locator('.monaco-editor .cursors-layer');
  // None of the classes behind the fading blink or the gliding caret, and no transition.
  await expect(layer).not.toHaveClass(/cursor-smooth/);
  const caret = layer.locator('.cursor').first();
  expect(await caret.evaluate((el) => getComputedStyle(el).transitionDuration)).toBe('0s');
  // An ordinary blink (Monaco runs it from script): on and off, nothing in between.
  const seen = await caret.evaluate(
    (el) =>
      new Promise<string[]>((resolve) => {
        const states = new Set<string>();
        const timer = setInterval(() => {
          // The fading blink animates the layer's opacity; the plain one hides the caret.
          const layerOpacity = el.parentElement ? getComputedStyle(el.parentElement).opacity : '1';
          states.add(`${getComputedStyle(el).visibility}/${layerOpacity}`);
        }, 50);
        setTimeout(() => {
          clearInterval(timer);
          resolve([...states].sort());
        }, 1800);
      }),
  );
  // Fully shown or fully hidden: the fading blink would pass through other opacities.
  expect(seen.map((s) => s.split('/')[1])).toEqual(seen.map(() => '1'));
  expect(new Set(seen.map((s) => s.split('/')[0]))).toEqual(new Set(['hidden', 'visible']));

  // Moved by the keyboard, it is at its new place two frames later, not after an animation.
  const top = () => caret.evaluate((el) => el.getBoundingClientRect().top);
  const start = await top();
  await page.keyboard.press('ControlOrMeta+End');
  const soon = await caret.evaluate(
    (el) =>
      new Promise<number>((resolve) =>
        requestAnimationFrame(() =>
          requestAnimationFrame(() => resolve(el.getBoundingClientRect().top)),
        ),
      ),
  );
  await page.waitForTimeout(300);
  const settled = await top();
  expect(settled).toBeGreaterThan(start);
  expect(soon).toBe(settled);
});

test('voice mode: speech becomes a voice message and replies are spoken', async ({ page }) => {
  await page.addInitScript(() => {
    const w = window as unknown as Record<string, unknown>;
    w.__spoken = [] as string[];
    class FakeRecognition {
      continuous = false;
      interimResults = false;
      lang = 'en-US';
      onresult: ((e: unknown) => void) | null = null;
      onend: (() => void) | null = null;
      onstart: (() => void) | null = null;
      onerror: ((e: unknown) => void) | null = null;
      onspeechstart: (() => void) | null = null;
      start() {
        setTimeout(() => this.onstart?.(), 10);
        setTimeout(
          () =>
            this.onresult?.({
              resultIndex: 0,
              results: {
                length: 1,
                0: { isFinal: false, length: 1, 0: { transcript: 'what about' } },
              },
            }),
          60,
        );
      }
      stop() {
        this.onresult?.({
          resultIndex: 0,
          results: {
            length: 1,
            0: { isFinal: true, length: 1, 0: { transcript: 'what about negative numbers' } },
          },
        });
        this.onend?.();
      }
      abort() {
        this.onend?.();
      }
    }
    w.SpeechRecognition = FakeRecognition;
    Object.defineProperty(window, 'speechSynthesis', {
      value: {
        speaking: false,
        getVoices: () => [],
        cancel() {},
        speak(u: { text: string; onstart?: () => void; onend?: () => void }) {
          (w.__spoken as string[]).push(u.text);
          u.onstart?.();
          setTimeout(() => u.onend?.(), 50);
        },
      },
    });
  });
  const backend = await openPad(page);
  await page.getByRole('button', { name: 'Voice mode' }).click();
  await expect(page.getByTestId('voice-bar')).toBeVisible();
  const mic = page.getByRole('button', { name: 'Hold to talk' });
  await mic.hover();
  await page.mouse.down();
  await expect(page.getByTestId('voice-bar')).toContainText('what about');
  await page.mouse.up();
  await expect
    .poll(() => backend.received.find((e) => e.type === 'chat.send'))
    .toEqual({ type: 'chat.send', text: 'what about negative numbers', via: 'voice' });
  await expect(page.getByTestId('interviewer-message').last()).toContainText(
    'What would you store as the key',
  );
  await expect
    .poll(() =>
      page.evaluate(() => (window as unknown as { __spoken: string[] }).__spoken.join(' ')),
    )
    .toContain('What would you store as the key');
  expect(backend.requests.find((r) => r.method === 'PATCH')?.body).toEqual({
    interviewer: { voice: true },
  });
});

test.describe('the pad fills the window exactly', () => {
  for (const viewport of [
    { width: 1440, height: 900 },
    { width: 1280, height: 620 },
  ]) {
    test(`the page itself cannot scroll at ${viewport.width}x${viewport.height}`, async ({
      page,
    }) => {
      await page.setViewportSize(viewport);
      await setup(page);
      await page.goto(`/pads/${ACTIVE_PAD_ID}`);
      await expect(page.locator('.view-lines')).toContainText('class Solution', {
        timeout: 20_000,
      });
      // The problem panel is longer than the window and scrolls inside itself...
      const height = () =>
        page.evaluate(() => ({
          doc: document.documentElement.scrollHeight,
          win: window.innerHeight,
        }));
      const { doc, win } = await height();
      // ...but nothing (such as a visually hidden label deep in a panel) makes the document taller.
      expect(doc).toBe(win);
      await page.evaluate(() => window.scrollTo(0, 99_999));
      await page.mouse.move(120, 300);
      await page.mouse.wheel(0, 4000);
      expect(await page.evaluate(() => window.scrollY)).toBe(0);
      // The console and chat tabs must not break it either.
      await page.getByRole('button', { name: 'Run tests' }).click();
      await expect.poll(async () => (await height()).doc).toBe(win);
    });
  }
});
