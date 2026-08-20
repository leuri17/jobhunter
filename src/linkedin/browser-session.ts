/**
 * Browser session interface (TASK-012 Plan Task 7, SPEC §21.2).
 *
 * The `BrowserSession` interface is the seam between the LinkedIn
 * discovery orchestrator (Wave C's `discovery-service.ts`) and the
 * underlying browser implementation. Three implementations exist:
 *   - `PlaywrightBrowserSession` (`playwright-session.ts`) — sole
 *     runtime Playwright importer in `src/linkedin/`. Real Chromium
 *     + new context per run (SPEC §21.2).
 *   - `FakeBrowserSession` (`fake-session.ts`) — pure-Node test helper.
 *     No Playwright import. Used for the `BrowserSession` interface
 *     contract tests in `tests/linkedin/browser-session.test.ts`.
 *   - `tests/linkedin/helpers/playwright-route-session.ts` (Wave E) —
 *     real Playwright + `context.route()` interception against saved
 *     HTML fixtures for the integration tests.
 *
 * Per AGENTS.md §5: this file imports Playwright TYPES only. The
 * boundaries test (`tests/linkedin/boundaries.test.ts`) allows
 * `import type { ... } from 'playwright'` here.
 */
import type { Browser, BrowserContext, Page, Request, Route } from 'playwright';

/**
 * Per-Plan Decision 9 / Decision 12 / SPEC §21.7 / §29.1:
 *   - `launch()` / `close()` are owned by TASK-015's run-level orchestrator.
 *     TASK-012's `discover()` NEVER calls them.
 *   - `openPage()` / `closePage()` are the per-search page lifecycle.
 *     The orchestrator wraps each `discover()` call in a
 *     `try { ... } finally { closePage(page) }`.
 *   - `openFallbackPage()` / `closeFallbackPage()` are forward-compat
 *     for TASK-013's dedicated-page fallback (SPEC §22.7). The session
 *     enforces a single-active-fallback invariant and throws
 *     `BrowserCapacityExceededError` on the second concurrent call.
 *   - `withRoute()` registers a `context.route()` interceptor.
 *   - `unrouteAll()` clears every route (used by integration tests
 *     for hermetic fixture rotation).
 */
export interface BrowserSession {
  /** Run-level launch. Owned by TASK-015's orchestrator. */
  launch(): Promise<{ browser: Browser; context: BrowserContext }>;
  /** Run-level close. Owned by TASK-015. Idempotent. */
  close(): Promise<void>;
  /** Per-search page lifecycle. */
  openPage(url: string): Promise<Page>;
  closePage(page: Page): Promise<void>;
  /** Forward-compat for TASK-013's dedicated-page fallback (SPEC §22.7). */
  openFallbackPage(url: string): Promise<Page>;
  closeFallbackPage(page: Page): Promise<void>;
  /** Network interception (used by integration tests + future cache layer). */
  withRoute(
    pattern: string | RegExp,
    handler: (route: Route, request: Request) => Promise<void> | void,
  ): Promise<void>;
  unrouteAll(): Promise<void>;
  /** Read-only capacity state. The orchestrator MAY assert these in tests. */
  readonly activePageCount: number;
  readonly activeFallbackCount: number;
}
