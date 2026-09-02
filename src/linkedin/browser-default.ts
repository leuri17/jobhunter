import { PlaywrightBrowserSession } from './playwright-session.js';
import type { BrowserSession } from './browser-session.js';

/**
 * Factory: create the default real Playwright browser session.
 * The desktop sidecar composes this at boot. Tests inject a
 * `FakeBrowserSession` via constructor injection on the orchestrator.
 */
export function createDefaultBrowserSession(config: {
  readonly navigationMs: number;
  readonly initialResultsMs: number;
  readonly overlayDismissalMs: number;
}): BrowserSession {
  return new PlaywrightBrowserSession({ config });
}
