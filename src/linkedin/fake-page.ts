/**
 * Minimal `Page`-shaped object for tests ( + D).
 *
 * The real Playwright `Page` interface has ~80 methods. Tests only
 * touch a handful: `url()`, `close()`, `goto()`, `locator()`, and
 * (via `BrowserSession` / `load-more.ts`) the `getAttribute` +
 * `querySelector` adapter that `parseCardJobId` consumes. `FakePage`
 * exposes exactly those, plus a few hooks tests can override.
 *
 * The class is NOT a `Page` structurally — it satisfies the read-side
 * surface we exercise. Callers that need to pass a `FakePage` to
 * real-Playwright-typed APIs cast via `as unknown as import('playwright').Page`.
 */

/**
 * Minimal `Locator`-shaped object. The `count` / `all` / `first` /
 * `elementHandle` / `click` methods cover every callsite the
 * orchestrator + helpers exercise (`load-more.ts` + `overlay.ts`).
 */
export interface FakeLocator {
  count: () => Promise<number>;
  all: () => Promise<FakeLocator[]>;
  first: () => FakeLocator;
  elementHandle: () => Promise<MinimalPageNode>;
  click: (options?: { readonly timeout?: number }) => Promise<void>;
  waitFor: (options: { readonly state: string; readonly timeout: number }) => Promise<void>;
}

export interface FakePageOptions {
  /** Initial URL (defaults to `'about:blank'`). */
  readonly url?: string;
  /** Called on `close()`. Defaults to a no-op. */
  readonly onClose?: () => void;
  /** Called on `getAttribute(name)`. Defaults to `null` for every name. */
  readonly onGetAttribute?: (name: string) => string | null;
  /** Called on `querySelector(selector)`. Defaults to `null`. */
  readonly onQuerySelector?: (selector: string) => MinimalPageNode | null;
  /**
   * Called on `goto(url, options)`. The hook receives the URL +
   * options; whatever it returns becomes the `goto` result. The
   * hook may also mutate `currentUrl` via `setUrl`. If omitted,
   * `goto` resolves with `null` (mirroring a no-navigation response).
   */
  readonly onGoto?: (
    url: string,
    options: { readonly timeout: number; readonly waitUntil: string },
  ) => Promise<unknown>;
  /**
   * Called on `locator(selector)`. If omitted, the default returns
   * a `FakeLocator` whose `count()` always returns 0 and `all()`
   * returns an empty array. Tests that exercise the card-discovery
   * loop override this to return N card-shaped locators.
   */
  readonly onLocator?: (selector: string) => FakeLocator | null;
}

export interface MinimalPageNode {
  readonly getAttribute: (name: string) => string | null;
  readonly querySelector: (selector: string) => MinimalPageNode | null;
}

const EMPTY_LOCATOR: FakeLocator = {
  count: async () => 0,
  all: async () => [],
  first: () => EMPTY_LOCATOR,
  elementHandle: async () => ({
    getAttribute: () => null,
    querySelector: () => null,
  }),
  click: async () => undefined,
  waitFor: async () => undefined,
};

export class FakePage {
  private currentUrl: string;
  private closed = false;
  private gotoCalls: Array<{ url: string; timeout: number; waitUntil: string }> = [];
  private readonly onClose: () => void;
  private readonly onGetAttribute: (name: string) => string | null;
  private readonly onQuerySelector: (selector: string) => MinimalPageNode | null;
  private readonly onGoto: (
    url: string,
    options: { readonly timeout: number; readonly waitUntil: string },
  ) => Promise<unknown>;
  private readonly onLocator: (selector: string) => FakeLocator | null;

  constructor(options: FakePageOptions = {}) {
    this.currentUrl = options.url ?? 'about:blank';
    this.onClose = options.onClose ?? (() => undefined);
    this.onGetAttribute = options.onGetAttribute ?? (() => null);
    this.onQuerySelector = options.onQuerySelector ?? (() => null);
    this.onGoto = options.onGoto ?? (async () => null);
    this.onLocator = options.onLocator ?? (() => null);
  }

  /** Read-side surface the real `Page.url()` exposes. */
  url(): string {
    return this.currentUrl;
  }

  /** Set the URL after construction (e.g. after a fake `goto`). */
  setUrl(url: string): void {
    this.currentUrl = url;
  }

  /** Test helper: is this page closed? */
  isClosed(): boolean {
    return this.closed;
  }

  /** Test helper: list every `goto()` invocation. */
  getGotoCalls(): readonly {
    readonly url: string;
    readonly timeout: number;
    readonly waitUntil: string;
  }[] {
    return this.gotoCalls;
  }

  /**
   * Playwright-compatible `goto`. Records the call + delegates to
   * the `onGoto` hook. If the hook returns a falsy value (or
   * nothing), `goto` resolves with `null` (mirroring a no-response
   * navigation).
   */
  async goto(
    url: string,
    options: { readonly timeout: number; readonly waitUntil: string },
  ): Promise<unknown> {
    this.gotoCalls.push({ url, timeout: options.timeout, waitUntil: options.waitUntil });
    return this.onGoto(url, options);
  }

  /**
   * Playwright-compatible `locator(selector)`. Returns the `onLocator`
   * hook's result, or a default `FakeLocator` (which counts as 0
   * nodes) when the hook returns null.
   */
  locator(selector: string): FakeLocator {
    return this.onLocator(selector) ?? EMPTY_LOCATOR;
  }

  /** Playwright-compatible close. */
  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.onClose();
  }

  /** Element-handle surface that `load-more.ts` + `parseCardJobId` consume. */
  async elementHandle(): Promise<{
    readonly getAttribute: (name: string) => string | null;
    readonly querySelector: (selector: string) => MinimalPageNode | null;
  }> {
    return {
      getAttribute: (name: string) => this.onGetAttribute(name),
      querySelector: (selector: string) => this.onQuerySelector(selector),
    };
  }
}
