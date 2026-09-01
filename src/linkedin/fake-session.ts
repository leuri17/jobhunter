/**
 * In-memory `BrowserSession` for unit tests.
 *
 * `FakeBrowserSession` does NOT import Playwright. It implements the
 * `BrowserSession` interface using a `Map<FakePage, PageMeta>` to
 * track opened pages + a `RouteRecord[]` list for assertion. Tests
 * inject a `createFakePage` factory to control what each fake page
 * does.
 *
 * The fake is intentionally minimal: it does NOT simulate
 * `context.route()` (use the real-Playwright helper in
 * `tests/linkedin/helpers/playwright-route-session.ts` —  — for
 * HTTP-shape fidelity tests). It DOES enforce the
 * `BrowserCapacityExceededError` contract for the fallback page,
 * since that's a load-bearing invariant.
 *
 * Per the brief: this file goes in the Playwright allow-list as a
 * no-runtime-import carve-out (the boundaries test should NOT flag
 * it because it has zero playwright references).
 */
import type { Browser, BrowserContext, Page, Request, Route } from 'playwright';

import { BrowserCapacityExceededError } from './errors.js';
import type { BrowserSession } from './browser-session.js';
import { FakePage } from './fake-page.js';

/** Recorded call — lets tests assert the session's call sequence. */
export interface RouteRecord {
  readonly pattern: string | RegExp;
  readonly handler: (route: Route, request: Request) => Promise<void> | void;
}

/** Recorded lifecycle event. */
export type SessionEvent =
  | { readonly kind: 'launch' }
  | { readonly kind: 'close' }
  | { readonly kind: 'openPage'; readonly url: string; readonly page: FakePage }
  | { readonly kind: 'closePage'; readonly page: FakePage }
  | { readonly kind: 'openFallbackPage'; readonly url: string; readonly page: FakePage }
  | { readonly kind: 'closeFallbackPage'; readonly page: FakePage }
  | { readonly kind: 'withRoute'; readonly pattern: string | RegExp }
  | { readonly kind: 'unrouteAll' };

/** Factory for the fake page handed back to the orchestrator. */
export type CreateFakePage = (session: FakeBrowserSession, url: string) => FakePage;

export interface FakeBrowserSessionOptions {
  /**
   * Factory invoked on every `openPage` + `openFallbackPage`. Defaults
   * to `new FakePage()`. Tests inject behavior via this hook.
   */
  readonly createPage?: CreateFakePage;
}

/**
 * Pure-Node `BrowserSession` for tests. Counts pages, tracks routes,
 * and throws `BrowserCapacityExceededError` on the second concurrent
 * `openFallbackPage` (matches the real session's contract).
 *
 * The fake's `launch` / `openPage` return values are typed as
 * `Promise<{ browser: Browser; context: BrowserContext }>` /
 * `Promise<Page>` to satisfy the `BrowserSession` interface, but the
 * actual returned objects are stubs / `FakePage` instances cast to
 * the Playwright types. Tests do not exercise Playwright APIs
 * against these stubs — they rely on the fake's own methods
 * (`eventLog`, `routeRecords`, `activePageCount`, etc.).
 */
export class FakeBrowserSession implements BrowserSession {
  private readonly pages = new Map<FakePage, PageMeta>();
  private readonly routes: RouteRecord[] = [];
  private readonly events: SessionEvent[] = [];
  private launchedFlag = false;
  private readonly createPageFn: CreateFakePage;

  constructor(options: FakeBrowserSessionOptions = {}) {
    this.createPageFn = options.createPage ?? ((_session, _url) => new FakePage());
  }

  /**
   * Test-only: access the lifecycle event log. Useful for asserting
   * the order + presence of `launch` / `openPage` / `close` calls.
   */
  get eventLog(): readonly SessionEvent[] {
    return this.events;
  }

  /** Test-only: access the recorded route definitions. */
  get routeRecords(): readonly RouteRecord[] {
    return [...this.routes];
  }

  async launch(): Promise<{ browser: Browser; context: BrowserContext }> {
    this.events.push({ kind: 'launch' });
    this.launchedFlag = true;
    return {
      browser: { close: () => Promise.resolve() } as unknown as Browser,
      context: { close: () => Promise.resolve() } as unknown as BrowserContext,
    };
  }

  async close(): Promise<void> {
    this.events.push({ kind: 'close' });
    this.launchedFlag = false;
    this.pages.clear();
    return Promise.resolve();
  }

  async openPage(url: string): Promise<Page> {
    this.assertLaunched('openPage');
    const page = this.createPageFn(this, url);
    this.pages.set(page, { kind: 'primary' });
    this.events.push({ kind: 'openPage', url, page });
    return page as unknown as Page;
  }

  async closePage(page: Page): Promise<void> {
    const fake = page as unknown as FakePage;
    this.events.push({ kind: 'closePage', page: fake });
    this.pages.delete(fake);
    return Promise.resolve();
  }

  async openFallbackPage(url: string): Promise<Page> {
    this.assertLaunched('openFallbackPage');
    if (this.activeFallbackCount > 0) {
      throw new BrowserCapacityExceededError({
        reason: 'a fallback page is already open',
        activeFallbacks: this.activeFallbackCount,
      });
    }
    const page = this.createPageFn(this, url);
    this.pages.set(page, { kind: 'fallback' });
    this.events.push({ kind: 'openFallbackPage', url, page });
    return page as unknown as Page;
  }

  async closeFallbackPage(page: Page): Promise<void> {
    const fake = page as unknown as FakePage;
    this.events.push({ kind: 'closeFallbackPage', page: fake });
    if (this.pages.get(fake)?.kind === 'fallback') {
      this.pages.delete(fake);
    }
    return Promise.resolve();
  }

  async withRoute(
    pattern: string | RegExp,
    handler: (route: Route, request: Request) => Promise<void> | void,
  ): Promise<void> {
    this.assertLaunched('withRoute');
    this.routes.push({ pattern, handler });
    this.events.push({ kind: 'withRoute', pattern });
    return Promise.resolve();
  }

  async unrouteAll(): Promise<void> {
    this.events.push({ kind: 'unrouteAll' });
    this.routes.length = 0;
    return Promise.resolve();
  }

  get activePageCount(): number {
    return this.pages.size;
  }

  get activeFallbackCount(): number {
    let count = 0;
    for (const meta of this.pages.values()) {
      if (meta.kind === 'fallback') count += 1;
    }
    return count;
  }

  private assertLaunched(method: string): void {
    if (!this.launchedFlag) {
      throw new Error(`FakeBrowserSession.${method} called before launch(); call launch() first.`);
    }
  }
}

interface PageMeta {
  readonly kind: 'primary' | 'fallback';
}
