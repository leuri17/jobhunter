import { DetailUrlBuildError } from './errors.js';

/**
 * Build the canonical dedicated-page URL for a LinkedIn job
 *
 * The URL is DERIVED from the `sourceJobId` (never scraped) and
 * is the input to `BrowserSession.openFallbackPage` ('s
 * orchestrator owns the lifecycle).
 *
 * Per Plan Task 4 + Open Question 5: the regex requires 6+ digits.
 * LinkedIn job IDs are typically 6+ digits; 5-digit IDs (observed
 * in some older postings) are rejected as a defensive measure.
 *
 * The function is PURE: no I/O, no logging, no side effects.
 *
 * Per the plan's self-flag: this file does NOT import
 * `LinkedInExpectedPageError` — the only error thrown here is the
 * local `DetailUrlBuildError` (a subclass of `LinkedInExtractionError`
 * defined in `./errors.ts`).
 */

/** LinkedIn job IDs are numeric and ≥ 6 digits. */
const SOURCE_JOB_ID_RE = /^\d{6,}$/;

/** Canonical LinkedIn job-detail URL host. */
const DETAIL_URL_HOST = 'https://www.linkedin.com';
const DETAIL_URL_PATH_PREFIX = '/jobs/view/';
const DETAIL_URL_PATH_SUFFIX = '/';

/**
 * Build the canonical dedicated-page URL for a LinkedIn job.
 *
 * @param sourceJobId - The numeric LinkedIn job ID (≥ 6 digits).
 * @returns The URL string `https://www.linkedin.com/jobs/view/<id>/`.
 * @throws {DetailUrlBuildError} When `sourceJobId` is empty,
 *   non-numeric, or has fewer than 6 digits.
 */
export function buildDetailUrl(sourceJobId: string): string {
  if (typeof sourceJobId !== 'string' || !SOURCE_JOB_ID_RE.test(sourceJobId)) {
    throw new DetailUrlBuildError({ sourceJobId });
  }
  return `${DETAIL_URL_HOST}${DETAIL_URL_PATH_PREFIX}${sourceJobId}${DETAIL_URL_PATH_SUFFIX}`;
}
