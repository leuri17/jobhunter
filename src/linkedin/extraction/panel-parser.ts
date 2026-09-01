/**
 * Search-detail-panel parser.
 *
 * `parsePanel` reads the 4 required fields (`title`, `company`,
 * `location`, `description`) from the open search-detail panel
 * the right-hand-side pane LinkedIn renders when the user clicks a
 * card on the search-results page. After the fields land, the
 * parser verifies that the panel title anchor's `href` matches the
 * selected `sourceJobId` so a swapped
 * panel ("the panel shows another job" per ) is caught
 * and surfaces a typed `PanelJobIdMismatchError` for the orchestrator
 * to fall back to the dedicated page.
 *
 * Imports `Page` and `Locator` as TYPES only — runtime Playwright
 * values flow via `BrowserSession` (`src/linkedin/playwright-session.ts`,
 * the sole runtime importer).
 *
 * Per AGENTS.md §4: strict TypeScript, no `any`, sequential async
 * work uses `await ... ; ...` rather than `await Promise.all` on
 * a `forEach` array.
 *
 * Per Oracle Finding 2 (refined): the `href` verification reads
 * `LINKEDIN_SELECTORS.panel.titleAnchor` (`.job-details-jobs-unified-top-card__job-title a`)
 * — NOT `fields.title`. The `<h1>` does NOT carry the `href`; only
 * the inner `<a>` does. The field text reads use `fields.title` (the
 * `<h1>` text equals the anchor text).
 *
 * Per : shares the `LINKEDIN_FIELDS` map with
 * `dedicated-parser.ts` (LinkedIn reuses the unified top-card DOM).
 */
import type { Locator, Page } from 'playwright';

import { JOB_ID_HREF_PATTERN, LINKEDIN_FIELDS, LINKEDIN_SELECTORS } from '../selectors.js';
import { PanelExtractionError, PanelJobIdMismatchError } from './errors.js';
import { normalizeText } from './normalize.js';
import type { ExtractionFieldSet } from './state.js';

/**
 * Bounded retry count for the panel title-anchor href verification
 * loop. Each attempt waits `PANEL_VERIFY_RETRY_MS`
 * (500ms) before re-reading the anchor; the loop returns
 * `PanelJobIdMismatchError` after the budget is exhausted.
 */
export const PANEL_VERIFY_MAX_ATTEMPTS = 3;

/**
 * Pause between href verification retries. 500ms covers the
 * LinkedIn renderer's panel-transition window (research finding:
 * the href resolution can take ~150-300ms after the click).
 */
export const PANEL_VERIFY_RETRY_MS = 500;

/**
 * Time budget for the description container to become visible after
 * the click. 10s matches the spec's `detailPanelMs` ceiling
 * ( — "the description container's visibility").
 */
export const PANEL_DESCRIPTION_WAIT_MS = 10_000;

/**
 * Per-call options.
 *
 * `sourceJobId` is REQUIRED — the parser uses it to verify the
 * panel's href matches the selected job.
 * `fields` defaults to `LINKEDIN_FIELDS`. `signal` is the
 * cancellation seam (checked between retries — ).
 */
export interface ParsePanelOptions {
  readonly sourceJobId: string;
  readonly fields?: Readonly<Record<keyof ExtractionFieldSet, string>>;
  readonly signal?: AbortSignal;
}

/**
 * Read `ExtractionFieldSet` from the panel + verify the panel
 * belongs to the selected job.
 *
 * Steps:
 *   1. Wait for the description container to be visible
 *      (`state: 'visible'`, NOT `state: 'attached'` — librarian
 *      research). On timeout → `PanelExtractionError`.
 *   2. Verify the panel title anchor's `href` matches
 *      `options.sourceJobId` via a bounded retry loop
 *      (`PANEL_VERIFY_MAX_ATTEMPTS` × `PANEL_VERIFY_RETRY_MS`).
 *      On mismatch → `PanelJobIdMismatchError`.
 *   3. Read `title`, `company`, `location`, `description` text
 *      concurrently via `Promise.all`. Each text node is normalized
 *      via `normalizeText`.
 *
 * The parser throws `PanelExtractionError` (description not visible
 * OR aborted mid-loop) and `PanelJobIdMismatchError`.
 *
 * @param page    The live `Page` whose panel is open (search page).
 * @param options Required `sourceJobId` + optional `fields` / `signal`.
 * @returns       The 4-field extraction result.
 */
export async function parsePanel(
  page: Page,
  options: ParsePanelOptions,
): Promise<ExtractionFieldSet> {
  const fields = options.fields ?? LINKEDIN_FIELDS;
  const currentUrl = safeReadUrl(page);

  if (options.signal?.aborted === true) {
    throw new PanelExtractionError({ url: currentUrl, reason: 'cancelled' });
  }

  // Step 1: wait for the description container to become visible.
  try {
    await page
      .locator(fields.description)
      .first()
      .waitFor({ state: 'visible', timeout: PANEL_DESCRIPTION_WAIT_MS });
  } catch (cause) {
    throw new PanelExtractionError(
      { url: currentUrl, reason: 'description_not_visible' },
      cause instanceof Error ? cause : undefined,
    );
  }

  // Step 2: verify the panel title anchor's href matches `expectedId`
  // ( — Oracle Finding 2: read from
  // `panel.titleAnchor`, NOT `fields.title`). Throws on mismatch /
  // cancellation / exhaustion.
  await verifyPanelHrefMatches({
    page,
    expectedId: options.sourceJobId,
    signal: options.signal,
    currentUrl,
  });

  // Step 3: read the 4 fields concurrently.
  const [title, company, location, description] = await Promise.all([
    readFieldText(page.locator(fields.title).first()),
    readFieldText(page.locator(fields.company).first()),
    readFieldText(page.locator(fields.location).first()),
    readFieldText(page.locator(fields.description).first()),
  ]);

  return {
    title: title === null ? null : normalizeText(title),
    company: company === null ? null : normalizeText(company),
    location: location === null ? null : normalizeText(location),
    description: description === null ? null : normalizeText(description),
  };
}

/**
 * Verify the panel's title anchor href matches `expectedId` (Decision
 * 7 + ). Reads from `LINKEDIN_SELECTORS.panel.titleAnchor`
 * (the inner `<a>`, NOT the `<h1>` — Oracle Finding 2).
 *
 * Retries up to `PANEL_VERIFY_MAX_ATTEMPTS` times with
 * `PANEL_VERIFY_RETRY_MS` pause between attempts. On every retry,
 * checks the `AbortSignal`; aborting throws `PanelExtractionError`
 * (cancelled) instead of a mismatch error.
 *
 * Throws on mismatch / cancellation / exhaustion. The captured
 * "actual" job ID is folded into the thrown error's metadata.
 */
async function verifyPanelHrefMatches(args: {
  readonly page: Page;
  readonly expectedId: string;
  readonly signal: AbortSignal | undefined;
  readonly currentUrl: string;
}): Promise<void> {
  const { page, expectedId, signal, currentUrl } = args;
  const anchorLocator = page.locator(LINKEDIN_SELECTORS.panel.titleAnchor).first();

  let lastCaptured: string | null = null;
  for (let attempt = 1; attempt <= PANEL_VERIFY_MAX_ATTEMPTS; attempt += 1) {
    if (signal?.aborted === true) {
      throw new PanelExtractionError({ url: currentUrl, reason: 'cancelled' });
    }
    const href = await safeGetAttribute(anchorLocator);
    if (href !== null) {
      const match = JOB_ID_HREF_PATTERN.exec(href);
      if (match !== null) {
        const captured = match[1];
        if (captured !== undefined) {
          if (captured === expectedId) {
            return;
          }
          lastCaptured = captured;
        }
      }
    }
    if (attempt < PANEL_VERIFY_MAX_ATTEMPTS) {
      await pause(PANEL_VERIFY_RETRY_MS);
    }
  }
  // Exhausted the budget — throw a typed mismatch error with the
  // latest observation. `lastCaptured === null` means
  // the href was always missing/non-matching; surface 'unknown' so
  // the orchestrator can distinguish a clean miss from a stale ID.
  throw new PanelJobIdMismatchError({
    expectedSourceJobId: expectedId,
    actualSourceJobId: lastCaptured ?? 'unknown',
    attempts: PANEL_VERIFY_MAX_ATTEMPTS,
  });
}

/**
 * Read an attribute from a Playwright locator, swallowing the
 * "no nodes" error Playwright throws when the locator resolves to
 * zero elements (we treat that as "not yet rendered").
 */
async function safeGetAttribute(locator: Locator): Promise<string | null> {
  try {
    return await locator.getAttribute('href');
  } catch {
    return null;
  }
}

/**
 * Read the page's current URL — guarded against environments where
 * `page.url()` throws (some test fakes do not implement it).
 */
function safeReadUrl(page: Page): string {
  try {
    return page.url();
  } catch {
    return '';
  }
}

/**
 * Read the locator's text content with `null`-preservation.
 * Playwright's `textContent()` returns `null` for empty / detached
 * nodes; we keep that semantic so the orchestrator can distinguish
 * "the field is empty" from "the field is missing entirely".
 */
async function readFieldText(locator: Locator): Promise<string | null> {
  const value = await locator.textContent({ timeout: PANEL_DESCRIPTION_WAIT_MS });
  return value;
}

/**
 * Pause for `ms` milliseconds. Used between the bounded retry
 * attempts in `verifyPanelHrefMatches`. Tests that want a
 * deterministic clock can override this via dependency injection
 * in  — for , the simple `setTimeout` is fine because
 * Vitest's fake timers are not in use here.
 */
function pause(ms: number): Promise<void> {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}

// Re-export the panel-specific errors so consumers don't have to
// dig into `./errors.js` for the most common case. Stays consistent
// with the plan's recommended barrel.
export { PanelExtractionError, PanelJobIdMismatchError };
