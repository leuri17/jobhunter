import { describe, expect, it } from 'vitest';

/**
 * Real-Playwright smoke test for `PlaywrightRouteSession` (Wave E).
 *
 * This test launches a real headless Chromium via the route session
 * and confirms the `context.route()` interception serves the basic
 * fixture. The default test suite skips this file via the
 * `PLAYWRIGHT_SMOKE` env var so it does not run in normal CI.
 *
 * To run this smoke test:
 *   PLAYWRIGHT_SMOKE=1 pnpm test tests/linkedin/helpers/playwright-route-session.smoke.test.ts
 *
 * Prerequisites:
 *   - `pnpm exec playwright install chromium` (one-shot per machine)
 *   - No proxy / network restrictions blocking the Chromium binary
 *     download at install time (the binary itself is used offline)
 *
 * The `.smoke.test.ts` suffix is intentional — the normal `pnpm test`
 * run does NOT include this file. The CI matrix runs `pnpm test`
 * (which skips it) + the lint + format checks. A separate ad-hoc
 * run with `PLAYWRIGHT_SMOKE=1` exercises the real browser.
 */

const ENABLED = process.env.PLAYWRIGHT_SMOKE === '1';

describe.skipIf(!ENABLED)('PlaywrightRouteSession — real Chromium smoke test', () => {
  it('serves the basic fixture through context.route() interception', async () => {
    const { PlaywrightRouteSession } = await import('./playwright-route-session.js');
    const session = new PlaywrightRouteSession({
      config: {
        navigationMs: 5_000,
        initialResultsMs: 5_000,
        overlayDismissalMs: 1_000,
      },
      fixtureName: 'search-results-basic',
    });
    const { browser, context } = await session.launch();
    const page = await context.newPage();
    await page.goto('https://www.linkedin.com/jobs/search/?keywords=test', {
      timeout: 5_000,
      waitUntil: 'domcontentloaded',
    });
    const cardCount = await page.locator('li.jobs-search-results__list-item').count();
    expect(cardCount).toBe(5);
    await page.close();
    await context.close();
    await browser.close();
  });
});
