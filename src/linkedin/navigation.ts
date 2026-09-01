import type { Page } from 'playwright';

/**
 * Outcome of `navigateWithTimeout`. Discriminated union so the orchestrator can branch
 * without inspecting thrown errors. `kind: 'blocked'` carries the
 * LinkedIn auth-wall detection (exit 4 path); the orchestrator
 * converts that to a thrown `LinkedInAccessBlockedError`.
 */
export type NavigationResult =
  | {
      readonly ok: true;
      readonly status: number;
      readonly redirected: boolean;
      readonly responseUrl: string;
    }
  | {
      readonly ok: false;
      readonly reason: 'timeout' | 'blocked' | 'unexpected';
      readonly cause?: Error;
    };

export interface NavigateWithTimeoutOptions {
  readonly page: Page;
  readonly url: string;
  readonly timeoutMs: number;
  /**
   * Optional override for the "blocked" detector. Defaults to a
   * detector that matches LinkedIn's auth-wall / login / consent
   * redirects. The detector receives the final URL after redirects
   * (`page.url()` post-`goto`).
   */
  readonly blockDetector?: (finalUrl: string) => boolean;
}

const DEFAULT_BLOCK_PATTERNS: ReadonlyArray<RegExp> = [
  /linkedin\.com\/login/i,
  /linkedin\.com\/authwall/i,
  /linkedin\.com\/uas/i,
  /checkpoint\.linkedin\.com/i,
];

function defaultBlockDetector(finalUrl: string): boolean {
  return DEFAULT_BLOCK_PATTERNS.some((re) => re.test(finalUrl));
}

/**
 * Bounded `page.goto` with post-navigation blocked-URL detection.
 * Pure on its inputs (no I/O outside Playwright).
 *
 * Behavior:
 *   - `page.goto(url, { timeout, waitUntil: 'domcontentloaded' })`.
 *   - `playwright.TimeoutError` → `{ ok: false, reason: 'timeout' }`.
 *   - Any other throw → `{ ok: false, reason: 'unexpected', cause }`.
 *   - On success: read `page.url()`; if `blockDetector(finalUrl)` is
 *     true → `{ ok: false, reason: 'blocked' }`. Else
 *     `{ ok: true, status, redirected, responseUrl }`.
 *   - `status` defaults to `200` when Playwright's `goto` returns
 *     `null` (Playwright returns `Response | null` — handle null).
 */
export async function navigateWithTimeout(
  options: NavigateWithTimeoutOptions,
): Promise<NavigationResult> {
  const { page, url, timeoutMs } = options;
  const blockDetector = options.blockDetector ?? defaultBlockDetector;
  let response: Awaited<ReturnType<Page['goto']>>;
  try {
    response = await page.goto(url, { timeout: timeoutMs, waitUntil: 'domcontentloaded' });
  } catch (cause) {
    if (cause instanceof Error && /Timeout/i.test(cause.name)) {
      return { ok: false, reason: 'timeout' };
    }
    return {
      ok: false,
      reason: 'unexpected',
      cause: cause instanceof Error ? cause : new Error(String(cause)),
    };
  }
  const finalUrl = page.url();
  if (blockDetector(finalUrl)) {
    return { ok: false, reason: 'blocked' };
  }
  const status = response?.status() ?? 200;
  const redirected = response !== null && response.url() !== url;
  return {
    ok: true,
    status,
    redirected,
    responseUrl: finalUrl,
  };
}
