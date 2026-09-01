/**
 * Real-Playwright smoke test for `PlaywrightBrowserSession`.
 *
 * This test launches a real headless Chromium via the
 * `PlaywrightBrowserSession` class and confirms the launch → openPage
 * → closePage → close lifecycle completes without leaking browser
 * handles. The default test suite skips this file via the
 * `PLAYWRIGHT_SMOKE` env var so it does not run in normal CI.
 *
 * To run this smoke test:
 *   PLAYWRIGHT_SMOKE=1 pnpm test -- tests/linkedin/playwright-session.smoke.test.ts
 *
 * Prerequisites:
 *   - `pnpm exec playwright install chromium` (one-shot per machine)
 *   - No proxy / network restrictions blocking the Chromium binary
 *     download at install time (the binary itself is used offline)
 */

import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import { PlaywrightBrowserSession } from '../../src/linkedin/playwright-session.js';
import { noopLinkedInScraperLogger } from '../../src/linkedin/log.js';

const ENABLED = process.env['PLAYWRIGHT_SMOKE'] === '1';

describe.skipIf(!ENABLED)('PlaywrightBrowserSession — real Chromium smoke test', () => {
  let session: PlaywrightBrowserSession | null = null;

  beforeAll(() => {
    // No-op; the session is created per test so we can isolate.
  });

  afterEach(async () => {
    if (session !== null) {
      await session.close();
      session = null;
    }
  });

  it('launch() + openPage() + closePage() + close() completes without leaks', async () => {
    session = new PlaywrightBrowserSession({
      config: {
        navigationMs: 30_000,
        initialResultsMs: 20_000,
        overlayDismissalMs: 5_000,
      },
      logger: noopLinkedInScraperLogger,
    });
    const { browser, context } = await session.launch();
    expect(browser).toBeDefined();
    expect(context).toBeDefined();
    expect(session.activePageCount).toBe(0);

    const page = await session.openPage('about:blank');
    expect(page).toBeDefined();
    expect(page.url()).toBe('about:blank');
    expect(session.activePageCount).toBe(1);

    await session.closePage(page);
    expect(session.activePageCount).toBe(0);

    await session.close();
    expect(session.activePageCount).toBe(0);
  });

  it('openFallbackPage() twice throws BrowserCapacityExceededError', async () => {
    session = new PlaywrightBrowserSession({
      config: {
        navigationMs: 30_000,
        initialResultsMs: 20_000,
        overlayDismissalMs: 5_000,
      },
      logger: noopLinkedInScraperLogger,
    });
    await session.launch();

    const first = await session.openFallbackPage('https://www.linkedin.com/jobs/view/123456/');
    expect(first).toBeDefined();
    expect(session.activeFallbackCount).toBe(1);

    await expect(
      session.openFallbackPage('https://www.linkedin.com/jobs/view/789012/'),
    ).rejects.toThrow(/capacity/i);

    await session.closeFallbackPage(first);
    expect(session.activeFallbackCount).toBe(0);
  });
});
