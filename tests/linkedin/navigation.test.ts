import { describe, expect, it } from 'vitest';

import { navigateWithTimeout } from '../../src/linkedin/navigation.js';

/**
 * Minimal `Page`-shaped stub for the navigation tests. The strategy
 * under test calls only `page.goto()` + `page.url()`, so we model
 * just that surface. The stub records every `goto` invocation for
 * post-test assertions.
 */
interface NavFakePage {
  goto: (
    url: string,
    options: { timeout: number; waitUntil: string },
  ) => Promise<NavFakeResponse | null>;
  url: () => string;
  setFinalUrl: (url: string) => void;
}

interface NavFakeResponse {
  status: () => number;
  url: () => string;
}

interface GotoCall {
  readonly url: string;
  readonly timeout: number;
  readonly waitUntil: string;
}

function makeNavPage(
  opts: {
    readonly finalUrl: string;
    readonly gotoResult?: NavFakeResponse | null | (() => Promise<NavFakeResponse | null>);
  } = { finalUrl: 'about:blank' },
): { page: NavFakePage; gotoCalls: GotoCall[] } {
  const gotoCalls: GotoCall[] = [];
  // The `finalUrl` is the source of truth for `page.url()`. It is
  // NOT auto-updated by `goto` — tests set it explicitly via the
  // constructor or `setFinalUrl` to simulate a redirect.
  const finalUrlRef = { value: opts.finalUrl };
  const page: NavFakePage = {
    goto: async (url, options) => {
      gotoCalls.push({ url, timeout: options.timeout, waitUntil: options.waitUntil });
      const result =
        typeof opts.gotoResult === 'function' ? await opts.gotoResult() : opts.gotoResult;
      return result ?? null;
    },
    url: () => finalUrlRef.value,
    setFinalUrl: (u: string) => {
      finalUrlRef.value = u;
    },
  };
  // The exposed `page` uses a closure over `finalUrlRef` so callers
  // can still read the final URL after a navigation.
  return { page, gotoCalls };
}

describe('navigateWithTimeout (Wave D)', () => {
  it('returns ok: true with the response status on a successful navigation', async () => {
    const { page, gotoCalls } = makeNavPage({
      finalUrl: 'https://www.linkedin.com/jobs/search/?q=engineer',
      gotoResult: {
        status: () => 200,
        url: () => 'https://www.linkedin.com/jobs/search/?q=engineer',
      },
    });
    const result = await navigateWithTimeout({
      page: page as never,
      url: 'https://www.linkedin.com/jobs/search/?q=engineer',
      timeoutMs: 30_000,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.status).toBe(200);
      expect(result.responseUrl).toBe('https://www.linkedin.com/jobs/search/?q=engineer');
      expect(result.redirected).toBe(false);
    }
    expect(gotoCalls).toHaveLength(1);
    expect(gotoCalls[0]).toEqual({
      url: 'https://www.linkedin.com/jobs/search/?q=engineer',
      timeout: 30_000,
      waitUntil: 'domcontentloaded',
    });
  });

  it('returns reason: "timeout" when page.goto throws a Playwright TimeoutError', async () => {
    const { page } = makeNavPage({
      finalUrl: 'about:blank',
      gotoResult: () => {
        const err = new Error('Timeout exceeded');
        err.name = 'TimeoutError';
        return Promise.reject(err);
      },
    });
    const result = await navigateWithTimeout({
      page: page as never,
      url: 'https://www.linkedin.com/jobs/search/?q=engineer',
      timeoutMs: 1,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('timeout');
      // The timeout result intentionally omits `cause` — the
      // orchestrator maps this to a clean `NavigationTimeoutError`
      // without preserving the underlying Playwright error.
      expect(result.cause).toBeUndefined();
    }
  });

  it('returns reason: "timeout" when page.goto throws a Playwright TimeoutError subclass', async () => {
    const { page } = makeNavPage({
      finalUrl: 'about:blank',
      gotoResult: () => {
        // Playwright's TimeoutError has `name: 'TimeoutError'`. The
        // exact class identity is irrelevant — the strategy matches
        // by the `Timeout` substring in the name.
        const err = new Error('Timeout 10000ms exceeded');
        err.name = 'TimeoutError';
        return Promise.reject(err);
      },
    });
    const result = await navigateWithTimeout({
      page: page as never,
      url: 'https://www.linkedin.com/jobs/search/?q=engineer',
      timeoutMs: 10_000,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('timeout');
  });

  it('returns reason: "unexpected" with cause for non-timeout errors', async () => {
    const boom = new Error('DNS failure');
    const { page } = makeNavPage({
      finalUrl: 'about:blank',
      gotoResult: () => Promise.reject(boom),
    });
    const result = await navigateWithTimeout({
      page: page as never,
      url: 'https://www.linkedin.com/jobs/search/?q=engineer',
      timeoutMs: 30_000,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('unexpected');
      expect(result.cause).toBe(boom);
    }
  });

  it('returns reason: "blocked" when the post-navigation URL matches the default block detector', async () => {
    const blockedUrl = 'https://www.linkedin.com/login?from=jobs';
    const { page } = makeNavPage({
      finalUrl: blockedUrl,
      gotoResult: { status: () => 200, url: () => blockedUrl },
    });
    const result = await navigateWithTimeout({
      page: page as never,
      url: 'https://www.linkedin.com/jobs/search/?q=engineer',
      timeoutMs: 30_000,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('blocked');
  });

  it('uses the custom blockDetector when provided', async () => {
    const customBlockedUrl = 'https://www.linkedin.com/uas/consumer-email-otp';
    const { page } = makeNavPage({
      finalUrl: customBlockedUrl,
      gotoResult: { status: () => 200, url: () => customBlockedUrl },
    });
    const result = await navigateWithTimeout({
      page: page as never,
      url: 'https://www.linkedin.com/jobs/search/?q=engineer',
      timeoutMs: 30_000,
      blockDetector: (u) => u.includes('/uas/'),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('blocked');
  });

  it('returns redirected: true when the response URL differs from the requested URL', async () => {
    const requested = 'https://www.linkedin.com/jobs/view/12345/';
    const finalUrl = 'https://www.linkedin.com/jobs/view/redirected/';
    const { page } = makeNavPage({
      finalUrl,
      gotoResult: { status: () => 302, url: () => finalUrl },
    });
    const result = await navigateWithTimeout({
      page: page as never,
      url: requested,
      timeoutMs: 30_000,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.redirected).toBe(true);
      expect(result.status).toBe(302);
      expect(result.responseUrl).toBe(finalUrl);
    }
  });

  it('defaults status to 200 when page.goto resolves with null', async () => {
    const { page } = makeNavPage({
      finalUrl: 'https://www.linkedin.com/jobs/search/?q=engineer',
      gotoResult: null,
    });
    const result = await navigateWithTimeout({
      page: page as never,
      url: 'https://www.linkedin.com/jobs/search/?q=engineer',
      timeoutMs: 30_000,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.status).toBe(200);
      expect(result.responseUrl).toBe('https://www.linkedin.com/jobs/search/?q=engineer');
    }
  });
});
