/**
 * Playwright-backed `BrowserSession` implementation (TASK-012 Plan Task 7,
 * SPEC §21.2, Decision 2 / Decision 9 / Decision 12).
 *
 * **This is the only file in `src/linkedin/` that imports `playwright`
 * at runtime.** The boundaries test
 * (`tests/linkedin/boundaries.test.ts:134-143`) verifies that every
 * other file in `src/linkedin/` either uses `import type` or has no
 * Playwright reference at all.
 *
 * Lifecycle ownership (per Plan Decision 2 / Required Finding #1 in
 * the bounded remediation pass):
 *   - `launch()` / `close()` are owned by TASK-015's run-level
 *     orchestrator. The session is fresh per `jobhunter run`
 *     invocation (one context, no persistent profile).
 *   - `openPage()` / `closePage()` are the per-search page lifecycle.
 *     The orchestrator (Wave C) wraps each `discover()` call in a
 *     `try { ... } finally { closePage(page) }` and NEVER calls
 *     `close()`.
 *   - `openFallbackPage()` enforces the single-active-fallback
 *     invariant from SPEC §21.7.
 */
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';

import { BrowserCapacityExceededError, BrowserLaunchError } from './errors.js';
import type { BrowserSession } from './browser-session.js';
import { noopLinkedInScraperLogger, type LinkedInScraperLogger } from './log.js';

/** Minimal subset of Playwright's `chromium` namespace we touch. */
type ChromiumLike = {
  launch: (options: { headless: boolean }) => Promise<Browser>;
};

/** Configuration the session needs at construction time. */
export interface PlaywrightBrowserSessionOptions {
  /** The timeout trio the session enforces. All values are positive integers (ms). */
  readonly config: {
    readonly navigationMs: number;
    readonly initialResultsMs: number;
    readonly overlayDismissalMs: number;
  };
  /** Optional logger seam. Defaults to `noopLinkedInScraperLogger`. */
  readonly logger?: LinkedInScraperLogger;
  /** Optional clock seam for tests (mostly for the initial-results wait). */
  readonly now?: () => number;
  /**
   * Optional `chromium` injection. Tests pass a stub; production
   * uses the default `playwright.chromium`.
   */
  readonly chromium?: ChromiumLike;
}

/**
 * Real-Playwright `BrowserSession` implementation. Pure state machine:
 * the `launched` flag + the active-page counters are the only mutable
 * state. The class never imports `pino`, `drizzle-orm`, `commander`,
 * `@inquirer/prompts`, or `openai` (per AGENTS.md §5 / §9 + the
 * `tests/linkedin/boundaries.test.ts` guard).
 */
export class PlaywrightBrowserSession implements BrowserSession {
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private launched = false;
  private activePages = 0;
  private activeFallbacks = 0;
  private readonly config: PlaywrightBrowserSessionOptions['config'];
  private readonly logger: LinkedInScraperLogger;
  private readonly chromiumImpl: ChromiumLike;

  constructor(options: PlaywrightBrowserSessionOptions) {
    this.config = options.config;
    this.logger = options.logger ?? noopLinkedInScraperLogger;
    this.chromiumImpl = options.chromium ?? chromium;
  }

  /**
   * Launch one Chromium instance + create one fresh unauthenticated
   * context. Idempotent: a second call returns the existing browser
   * + context without re-launching.
   *
   * `serviceWorkers: 'block'` matches the LinkedIn-search-page
   * assumption that no service worker is needed (and avoids the
   * Playwright default that some tests trip over with redirect
   * handlers).
   */
  async launch(): Promise<{ browser: Browser; context: BrowserContext }> {
    if (this.launched && this.browser !== null && this.context !== null) {
      return { browser: this.browser, context: this.context };
    }
    try {
      this.browser = await this.chromiumImpl.launch({ headless: true });
      this.context = await this.browser.newContext({ serviceWorkers: 'block' });
    } catch (cause) {
      throw new BrowserLaunchError(
        { chromium: 'launch_failed' },
        cause instanceof Error ? cause : undefined,
      );
    }
    this.launched = true;
    return { browser: this.browser, context: this.context };
  }

  /**
   * Close the context first, then the browser. Idempotent: a second
   * call is a no-op. The caller is TASK-015's run-level try/finally
   * — the per-search loop in `discover()` does NOT call this.
   */
  async close(): Promise<void> {
    if (!this.launched) return;
    this.launched = false;
    if (this.context !== null) {
      try {
        await this.context.close();
      } catch (cause) {
        this.logger.searchFail({
          searchId: 'session',
          errorCode: 'context_close_failed',
          message: cause instanceof Error ? cause.message : String(cause),
        });
      }
      this.context = null;
    }
    if (this.browser !== null) {
      try {
        await this.browser.close();
      } catch (cause) {
        this.logger.searchFail({
          searchId: 'session',
          errorCode: 'browser_close_failed',
          message: cause instanceof Error ? cause.message : String(cause),
        });
      }
      this.browser = null;
    }
    this.activePages = 0;
    this.activeFallbacks = 0;
  }

  /**
   * Open a new page in the active context and `goto` the search URL
   * with the bounded navigation timeout. Throws if `launch()` was
   * not called first. The orchestrator owns the matching
   * `closePage()`.
   *
   * URL validation is NOT done here — the orchestrator (Wave C)
   * is responsible for constructing search URLs via
   * `SearchMatrixEntry.generatedUrl` (TASK-006). The session's
   * contract is: "open a page and navigate to whatever URL the
   * caller passed."
   */
  async openPage(url: string): Promise<Page> {
    const context = this.requireContext();
    const page = await context.newPage();
    this.activePages += 1;
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: this.config.navigationMs });
    } catch (cause) {
      // Clean up the half-opened page so the active-page counter stays accurate.
      this.activePages = Math.max(0, this.activePages - 1);
      try {
        await page.close();
      } catch {
        // Ignore secondary close errors — the primary error is what matters.
      }
      throw cause;
    }
    return page;
  }

  async closePage(page: Page): Promise<void> {
    this.activePages = Math.max(0, this.activePages - 1);
    try {
      await page.close();
    } catch (cause) {
      this.logger.cardError({
        searchId: 'session',
        errorCode: 'page_close_failed',
        message: cause instanceof Error ? cause.message : String(cause),
      });
    }
  }

  /**
   * Open a dedicated-page fallback (SPEC §22.7). Throws
   * `BrowserCapacityExceededError` if a fallback is already open —
   * the single-active-fallback invariant is a hard contract.
   *
   * Wave B's scope: TASK-012 never calls this; TASK-013 will.
   *
   * URL validation is NOT done here — the orchestrator (TASK-013)
   * constructs `/jobs/view/<id>/` URLs from `Repositories.jobs.sourceJobId`.
   */
  async openFallbackPage(url: string): Promise<Page> {
    if (this.activeFallbacks > 0) {
      throw new BrowserCapacityExceededError({
        reason: 'a fallback page is already open',
        activeFallbacks: this.activeFallbacks,
      });
    }
    const context = this.requireContext();
    const page = await context.newPage();
    this.activeFallbacks = 1;
    this.activePages += 1;
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: this.config.navigationMs });
    } catch (cause) {
      this.activeFallbacks = 0;
      this.activePages = Math.max(0, this.activePages - 1);
      try {
        await page.close();
      } catch {
        // Ignore secondary close errors.
      }
      throw cause;
    }
    return page;
  }

  async closeFallbackPage(page: Page): Promise<void> {
    this.activeFallbacks = Math.max(0, this.activeFallbacks - 1);
    await this.closePage(page);
  }

  /** Register a `context.route()` interceptor. */
  async withRoute(
    pattern: string | RegExp,
    handler: (
      route: import('playwright').Route,
      request: import('playwright').Request,
    ) => Promise<void> | void,
  ): Promise<void> {
    const context = this.requireContext();
    await context.route(pattern, handler);
  }

  /** Remove every registered route (used by integration tests for hermetic fixture rotation). */
  async unrouteAll(): Promise<void> {
    const context = this.requireContext();
    await context.unrouteAll();
  }

  get activePageCount(): number {
    return this.activePages;
  }

  get activeFallbackCount(): number {
    return this.activeFallbacks;
  }

  private requireContext(): BrowserContext {
    if (this.context === null) {
      throw new BrowserLaunchError({
        reason: 'openPage/openFallbackPage/withRoute called before launch()',
      });
    }
    return this.context;
  }
}
