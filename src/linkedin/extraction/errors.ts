import {
  ApplicationError,
  type ApplicationErrorMetadata,
  type ExitCodeValue,
  ExitCode,
} from '../../errors/application-error.js';

import { LinkedInScraperError } from '../errors.js';
import type { RequiredField } from './state.js';

/**
 * Typed error family for the LinkedIn job-detail extraction layer
 *
 * Every subclass extends `LinkedInScraperError` so the HTTP sidecar
 * boundary can map via the shared exit-code translator. Per-job failures
 * are NOT thrown across the `extractOne` boundary — they are
 * surfaced via `ExtractionOutcome.kind: 'failed'` and persisted to
 * `extractionAttempts`. The orchestrator catches
 * `LinkedInScraperError` only for hard-stop conditions
 * (e.g. browser launch failure, dedicated-page URL build failure).
 *
 * Per AGENTS.md §10: typed errors only at the domain boundary.
 *
 * All exit codes are `ExitCode.Fatal = 1` per .
 */

/**
 * Base class for every error raised by `LinkedInExtractionService`.
 * Subclasses pin a specific `code` so the HTTP boundary does not need
 * an `instanceof` cascade. Per-job errors are NOT represented here
 * they live on `ExtractionOutcome` and on the `extractionAttempts`
 * table (see `src/linkedin/extraction/state.ts`).
 */
export class LinkedInExtractionError extends LinkedInScraperError {
  constructor(
    code: string,
    message: string,
    metadata: ApplicationErrorMetadata = {},
    cause?: Error,
  ) {
    super(code, message, ExitCode.Fatal, metadata, cause);
  }
}

/**
 * Panel extraction failed (load/parse/timeout/undismissable overlay).
 * Thrown when the search-detail panel cannot be read after the
 * bounded retry loop. The orchestrator catches this and falls back to
 * the dedicated page.
 */
export class PanelExtractionError extends LinkedInExtractionError {
  constructor(metadata: ApplicationErrorMetadata = {}, cause?: Error) {
    super('panel_extraction_failed', 'Search-detail panel extraction failed.', metadata, cause);
  }
}

/**
 * Panel title anchor's `href` does not match the selected
 * `sourceJobId` after the bounded retry loop. The
 * orchestrator catches this and falls back to the dedicated page
 * ( — "The panel shows another job" is one of the
 * fallback conditions).
 *
 * `expectedSourceJobId` / `actualSourceJobId` are the canonical
 * field names used in `extractionAttempts.errorMetadata`. The
 * `attempts` counter records how many retry iterations were
 * exhausted before giving up.
 */
export class PanelJobIdMismatchError extends LinkedInExtractionError {
  constructor(
    metadata: {
      readonly expectedSourceJobId: string;
      readonly actualSourceJobId: string;
      readonly attempts: number;
    },
    cause?: Error,
  ) {
    super(
      'panel_job_id_mismatch',
      'Panel title anchor href does not match the selected source job id.',
      metadata,
      cause,
    );
  }
}

/**
 * Dedicated page extraction failed (load/parse/timeout/undismissable
 * overlay). Thrown when the fallback page cannot be read. This is a
 * hard-stop condition — there is no further fallback.
 */
export class DedicatedPageError extends LinkedInExtractionError {
  constructor(metadata: ApplicationErrorMetadata = {}, cause?: Error) {
    super('dedicated_page_failed', 'Dedicated job-page extraction failed.', metadata, cause);
  }
}

/**
 * Every required field is missing (distinct from `partial` where
 * SOME fields are present). Thrown only by `validateRequiredFields`
 * when the input has all-null fields — the orchestrator surfaces
 * this as `ExtractionOutcome.kind: 'failed'` with
 * `errorCode: 'required_field_missing'`.
 */
export class RequiredFieldMissingError extends LinkedInExtractionError {
  constructor(metadata: { readonly missing: readonly RequiredField[] }, cause?: Error) {
    super('required_field_missing', 'Extraction returned no required fields.', metadata, cause);
  }
}

/**
 * The supplied `sourceJobId` cannot be embedded into a canonical
 * LinkedIn detail URL. Thrown by `buildDetailUrl` for
 * empty / non-numeric / under-6-digit IDs.
 */
export class DetailUrlBuildError extends LinkedInExtractionError {
  constructor(metadata: { readonly sourceJobId: string }, cause?: Error) {
    super(
      'detail_url_build_failed',
      'Detail-url could not be built from the supplied source job id.',
      metadata,
      cause,
    );
  }
}

/**
 * Re-exported `ApplicationError` plumbing for consumers that need
 * the full metadata shape (e.g. `toJSON()` serialization). Avoid
 * importing `ApplicationError` directly from `src/errors/application-error.js`
 * in domain code — go through this module's typed error family.
 */
export type { ApplicationErrorMetadata, ExitCodeValue };
export { ApplicationError, ExitCode };
