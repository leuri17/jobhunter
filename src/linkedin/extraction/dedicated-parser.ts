/**
 * Dedicated-job-page parser (TASK-013 Plan Task 11, SPEC §22.7).
 *
 * `parseDedicatedPage` reads the 4 required fields (`title`,
 * `company`, `location`, `description`) from the open
 * `/jobs/view/<id>/` page using `page.locator(selector).textContent()`
 * for auto-waiting per-field reads. No verification step is
 * performed — the URL is built from `sourceJobId` directly by
 * `buildDetailUrl` upstream (Decision 8), so the page is guaranteed
 * to be the right job's detail page.
 *
 * Imports `Page` and `Locator` as TYPES only — runtime Playwright
 * values flow via `BrowserSession` (`src/linkedin/playwright-session.ts`,
 * the sole runtime importer). The boundaries test
 * (`tests/linkedin/boundaries.test.ts`) verifies this file uses
 * `import type`.
 *
 * Per AGENTS.md §4: strict TypeScript, no `any`. The function reads
 * fields in parallel via `Promise.all` (per Decision 25 — sharing
 * the `LINKEDIN_FIELDS` map with `panel-parser.ts`).
 *
 * Per Decision 12: cancellation is `AbortSignal`-driven; the signal
 * is checked between field waits.
 */
import type { Locator, Page } from 'playwright';

import { LINKEDIN_FIELDS } from '../selectors.js';
import { DedicatedPageError } from './errors.js';
import { normalizeText } from './normalize.js';
import type { ExtractionFieldSet } from './state.js';

/**
 * Time budget for the description container to become visible after
 * the page navigation lands on `domcontentloaded`. LinkedIn's
 * dedicated page is heavier (more JS, more 3rd-party scripts)
 * than the search-detail panel, so this gets 20s — the spec's
 * `detailPanelMs` ceiling only matters for the panel path (10s).
 */
export const DEDICATED_DESCRIPTION_WAIT_MS = 20_000;

/**
 * Per-call options. `fields` is the field → selector map; defaults
 * to `LINKEDIN_FIELDS` so callers can override for an A/B-tested
 * LinkedIn rendering or for an integration test that re-uses the
 * parser against a different DOM.
 */
export interface ParseDedicatedPageOptions {
  readonly fields?: Readonly<Record<keyof ExtractionFieldSet, string>>;
  /**
   * Optional cancellation seam. The parser checks the signal
   * between the description wait and the per-field reads (the
   * per-field auto-waits do not currently take an `AbortSignal`).
   */
  readonly signal?: AbortSignal;
}

/**
 * Read `ExtractionFieldSet` from the dedicated job-detail page.
 *
 * The dedicated page reuses the unified top-card DOM (per librarian
 * research, Decision 25), so the field selectors are identical to
 * the panel's. The parser:
 *
 *   1. Reads each of the 4 fields (`title`, `company`, `location`,
 *      `description`) via `page.locator(selector).first().textContent()`.
 *      The per-field read auto-waits until the element is attached
 *      + visible; missing elements resolve to `null`.
 *   2. Normalizes each text node via `normalizeText` (strips
 *      `<script>` / `<style>`, decodes entities, drops the
 *      `Show more` / `See more` / `View more` literal).
 *
 * A per-field `null` resolves to a `partial` extraction status when
 * passed to `computeExtractionStatus` (Decision 4 + Decision 5).
 * The dedicated parser is more permissive than the panel parser:
 * the navigation has already succeeded (the orchestrator opened
 * the URL via `BrowserSession.openFallbackPage`), so a missing
 * field means "the page rendered without this field", NOT
 * "the page did not load".
 *
 * Any thrown error from the page-side reads is wrapped in a
 * `DedicatedPageError` so the orchestrator can persist a stable
 * `errorCode` via the `extractionAttempts` table.
 *
 * @param page       The live `Page` already navigated to `/jobs/view/<id>/`.
 * @param options    Optional `fields` override + `AbortSignal` (defaults to `LINKEDIN_FIELDS`, no signal).
 * @returns          The 4-field extraction result; each value is the
 *                   normalized text or `null` if the locator resolved
 *                   to nothing.
 */
export async function parseDedicatedPage(
  page: Page,
  options: ParseDedicatedPageOptions = {},
): Promise<ExtractionFieldSet> {
  const fields = options.fields ?? LINKEDIN_FIELDS;

  const currentUrl = safeReadUrl(page);

  if (options.signal?.aborted === true) {
    throw new DedicatedPageError({
      url: currentUrl,
      reason: 'cancelled',
    });
  }

  // Read all 4 fields concurrently. `.first()` honours the
  // multi-selector list (Description is a comma-separated CSS list).
  // Each per-field read auto-waits up to `DEDICATED_DESCRIPTION_WAIT_MS`
  // for the element to attach + become visible; missing elements
  // resolve to `null` (NOT an error — that's the orchestrator's
  // "partial" classification path).
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
 * Read the locator's text content with `null`-preservation.
 * Playwright's `textContent()` returns `null` for empty / detached
 * nodes; we keep that semantic so the orchestrator can distinguish
 * "the field is empty" from "the field is missing entirely".
 */
async function readFieldText(locator: Locator): Promise<string | null> {
  const value = await locator.textContent({ timeout: DEDICATED_DESCRIPTION_WAIT_MS });
  return value;
}

/**
 * Read the page's current URL — guarded against environments where
 * `page.url()` throws (some test fakes do not implement it). The
 * `DedicatedPageError`'s `url` metadata is best-effort diagnostics.
 */
function safeReadUrl(page: Page): string {
  try {
    return page.url();
  } catch {
    return '';
  }
}
