import type { Browser, BrowserContext } from 'playwright';

import { PlaywrightBrowserSession } from '../../../src/linkedin/playwright-session.js';
import { loadFixture, type FixtureName } from '../fixtures/loadFixture.js';

/**
 * Options for `PlaywrightRouteSession`. Mirrors the production
 * `PlaywrightBrowserSession` config surface plus the fixture name
 * the test wants to serve via `context.route()`.
 */
export interface PlaywrightRouteSessionOptions {
  readonly config: {
    readonly navigationMs: number;
    readonly initialResultsMs: number;
    readonly overlayDismissalMs: number;
  };
  readonly fixtureName: FixtureName;
}

/**
 * `PlaywrightBrowserSession` subclass that intercepts the LinkedIn
 * search URL via `context.route()` and serves a saved HTML fixture
 * instead of hitting the real network.
 *
 * Used by the HTTP-shape fidelity tests in `tests/linkedin/`. The
 * integration tests that exercise the orchestrator + diagnostics
 * used `FakeBrowserSession` instead — this helper is for
 * tests that need a real Playwright Chromium + `linkedom`-parity
 * fixture serving WITHOUT live network.
 *
 * The fixture is served on the first `launch()` call; subsequent
 * re-routes within the same context are not supported. Tests that
 * need a different fixture should construct a new session.
 */
export class PlaywrightRouteSession extends PlaywrightBrowserSession {
  private readonly fixtureName: FixtureName;
  private routeInstalled = false;

  constructor(options: PlaywrightRouteSessionOptions) {
    super({ config: options.config });
    this.fixtureName = options.fixtureName;
  }

  override async launch(): Promise<{ browser: Browser; context: BrowserContext }> {
    const result = await super.launch();
    if (this.routeInstalled) {
      return result;
    }
    const html = loadFixture(this.fixtureName);
    await result.context.route('https://www.linkedin.com/jobs/search/**', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'text/html; charset=utf-8',
        body: html,
      }),
    );
    this.routeInstalled = true;
    return result;
  }
}
