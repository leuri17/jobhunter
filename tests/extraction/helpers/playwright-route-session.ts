import type { Browser, BrowserContext } from 'playwright';

import { PlaywrightBrowserSession } from '../../../src/linkedin/playwright-session.js';
import { loadFixture, type FixtureName } from '../fixtures/loadFixture.js';

/**
 * Options for `PlaywrightExtractionRouteSession`. The helper
 * intercepts BOTH the search URL (panel HTML) and the dedicated
 * view URL (fallback HTML) so a single session can exercise the
 * panel-first + dedicated-fallback orchestrator path without live
 * network access.
 *
 * The `config` shape mirrors `PlaywrightBrowserSession`'s
 * `config` (the 3 timeout fields the session enforces).
 */
export interface PlaywrightExtractionRouteSessionOptions {
  readonly config: {
    readonly navigationMs: number;
    readonly initialResultsMs: number;
    readonly overlayDismissalMs: number;
  };
  readonly panelFixtureName: FixtureName;
  readonly dedicatedFixtureName: FixtureName;
}

/**
 * `PlaywrightBrowserSession` subclass that intercepts both
 * `https://www.linkedin.com/jobs/search/**` (panel fixture) AND
 * `https://www.linkedin.com/jobs/view/**` (dedicated-page fixture)
 * via `context.route()`. Used by the  extraction integration
 * tests that need a real Playwright Chromium + fixture serving
 * WITHOUT live network access.
 *
 * Mirrors the  `PlaywrightRouteSession`
 * (`tests/linkedin/helpers/playwright-route-session.ts:35`) but
 * serves two fixtures instead of one.
 *
 * The routes are installed on the first `launch()` call; subsequent
 * re-routes within the same context are not supported. Tests that
 * need different fixtures should construct a new session.
 */
export class PlaywrightExtractionRouteSession extends PlaywrightBrowserSession {
  private readonly panelFixtureName: FixtureName;
  private readonly dedicatedFixtureName: FixtureName;
  private routeInstalled = false;

  constructor(options: PlaywrightExtractionRouteSessionOptions) {
    super({ config: options.config });
    this.panelFixtureName = options.panelFixtureName;
    this.dedicatedFixtureName = options.dedicatedFixtureName;
  }

  override async launch(): Promise<{ browser: Browser; context: BrowserContext }> {
    const result = await super.launch();
    if (this.routeInstalled) {
      return result;
    }
    const panelHtml = loadFixture(this.panelFixtureName);
    const dedicatedHtml = loadFixture(this.dedicatedFixtureName);
    await result.context.route('https://www.linkedin.com/jobs/search/**', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'text/html; charset=utf-8',
        body: panelHtml,
      }),
    );
    await result.context.route('https://www.linkedin.com/jobs/view/**', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'text/html; charset=utf-8',
        body: dedicatedHtml,
      }),
    );
    this.routeInstalled = true;
    return result;
  }
}
