import type { Page } from '@playwright/test';
import { MockBackend } from './mock-api';

export async function setup(page: Page, configure?: (b: MockBackend) => void) {
  const backend = new MockBackend();
  configure?.(backend);
  await backend.install(page);
  return backend;
}

const SCREEN_DIR = 'e2e/.screens';

/** Screenshot in light and dark. Only used by screens.spec.ts (SCREENS=1). */
export async function shoot(page: Page, name: string, opts: { fullPage?: boolean } = {}) {
  for (const scheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' });
    await page.waitForTimeout(250);
    const vp = page.viewportSize();
    await page.screenshot({
      path: `${SCREEN_DIR}/${name}-${vp?.width}-${scheme}.png`,
      fullPage: opts.fullPage ?? false,
    });
  }
}
