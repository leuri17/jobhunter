/**
 * LinkedIn extraction structured-log seam (TASK-013 Plan Task 5,
 * SPEC §29 + §39, AGENTS.md §5 + §10).
 *
 * Mirrors TASK-012's `LinkedInScraperLogger` at `src/linkedin/log.ts`
 * but for extraction events. The orchestrator never imports `pino`
 * directly — it only sees the `LinkedInExtractionLogger` interface.
 *
 * Per AGENTS.md §5: this file imports only the `Logger` TYPE from
 * `src/logging/logger.ts` (no runtime Pino). The boundaries test
 * (added in Wave E at `tests/extraction/boundaries.test.ts`)
 * treats `pino` as banned at runtime; this file is allowed the
 * type-only import.
 *
 * Per the codebase's `LogContext` shape (`src/logging/logger.ts:29-37`),
 * every ID field is typed as `string` in the emitted log payload.
 * The adapter stringifies numeric IDs (e.g. `jobId: 42` → `jobId: '42'`)
 * at the call boundary so the structured-log shape stays consistent
 * with the rest of the codebase. Numeric types in the
 * `LinkedInExtractionLogger` interface are kept so the orchestrator
 * can pass un-stringified IDs from `JobRow.id`.
 */
import type { Logger as CodebaseLogger } from '../../logging/logger.js';
import type { ExtractionKind } from './state.js';

/**
 * Structured-log seam for the `LinkedInExtractionService`
 * orchestrator. Every method emits one event with a
 * `component: 'linkedin_extraction'` context, the numeric
 * `jobId` (stringified at the adapter), and an optional
 * `errorCode` / `expectedSourceJobId` / `actualSourceJobId`.
 *
 * Method inventory (mirrors Plan Decision 23):
 *   - `extractionStart`        — per-job extraction begins
 *   - `extractionComplete`     — per-job extraction ended (any kind)
 *   - `extractionSkip`         — per-job extraction skipped
 *                                 (complete/partial job re-encountered)
 *   - `extractionFail`         — per-job extraction failed
 *   - `panelMismatch`          — panel title anchor href mismatch
 *   - `fallbackStart`          — dedicated fallback page opened
 *   - `fallbackClose`          — dedicated fallback page closed
 */
export interface LinkedInExtractionLogger {
  extractionStart(input: { readonly jobId: number; readonly sourceJobId: string }): void;
  extractionComplete(input: { readonly jobId: number; readonly kind: ExtractionKind }): void;
  extractionSkip(input: { readonly jobId: number; readonly reason: string }): void;
  extractionFail(input: {
    readonly jobId: number;
    readonly errorCode: string;
    readonly method?: string;
  }): void;
  panelMismatch(input: {
    readonly jobId: number;
    readonly expectedSourceJobId: string;
    readonly actualSourceJobId: string;
  }): void;
  fallbackStart(input: { readonly jobId: number; readonly url: string }): void;
  fallbackClose(input: { readonly jobId: number }): void;
}

/**
 * Default no-op logger — safe for unit tests + as a default
 * constructor arg. Each method is a stub returning `undefined`.
 *
 * Per the plan sketch: exported as a FACTORY function (so the
 * signature matches `pinoLinkedInExtractionLogger` and a future
 * variant can accept a debug flag, etc.).
 */
export function noopLinkedInExtractionLogger(): LinkedInExtractionLogger {
  return {
    extractionStart: () => undefined,
    extractionComplete: () => undefined,
    extractionSkip: () => undefined,
    extractionFail: () => undefined,
    panelMismatch: () => undefined,
    fallbackStart: () => undefined,
    fallbackClose: () => undefined,
  };
}

/**
 * Default no-op logger instance. Equivalent to
 * `noopLinkedInExtractionLogger()` but as a `const` reference,
 * mirroring the TASK-012 `noopLinkedInScraperLogger` shape
 * (`src/linkedin/log.ts:61-70`) for callers that prefer the
 * const form.
 */
export const noopLinkedInExtractionLoggerInstance: LinkedInExtractionLogger = {
  extractionStart: () => undefined,
  extractionComplete: () => undefined,
  extractionSkip: () => undefined,
  extractionFail: () => undefined,
  panelMismatch: () => undefined,
  fallbackStart: () => undefined,
  fallbackClose: () => undefined,
};

/**
 * Stringify numeric IDs in a log payload so the emitted shape
 * matches the codebase's `LogContext` (`jobId: string`,
 * `searchId: string`, etc. — `src/logging/logger.ts:29-37`).
 *
 * Only top-level number values are stringified; nested objects
 * are left alone (the `LinkedInExtractionLogger` interface has
 * flat payloads, so this is sufficient).
 */
function stringifyNumericIds(args: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(args)) {
    out[key] = typeof value === 'number' ? String(value) : value;
  }
  return out;
}

/**
 * Production adapter: wraps the codebase's `Logger` interface and
 * emits structured logs. The orchestrator NEVER imports `pino`
 * directly; it only sees the `LinkedInExtractionLogger` interface.
 *
 * Mirrors `pinoLinkedInScraperLogger` at `src/linkedin/log.ts:78-120`:
 *   - info for normal lifecycle events
 *   - warn for failure / mismatch events
 *   - structured context with `component: 'linkedin_extraction'`
 *     and `event: '...'` prefix
 *   - human-readable trailing message
 */
export function pinoLinkedInExtractionLogger(logger: CodebaseLogger): LinkedInExtractionLogger {
  return {
    extractionStart: ({ jobId, sourceJobId }) =>
      logger.info(
        {
          component: 'linkedin_extraction',
          event: 'job.extraction.start',
          jobId: String(jobId),
          sourceJobId,
        },
        'extraction started',
      ),
    extractionComplete: ({ jobId, kind }) =>
      logger.info(
        {
          component: 'linkedin_extraction',
          event: 'job.extraction.complete',
          jobId: String(jobId),
          kind,
        },
        'extraction complete',
      ),
    extractionSkip: ({ jobId, reason }) =>
      logger.info(
        {
          component: 'linkedin_extraction',
          event: 'job.extraction.skip',
          jobId: String(jobId),
          reason,
        },
        'extraction skipped',
      ),
    extractionFail: ({ jobId, errorCode, method }) => {
      const context: Record<string, unknown> = {
        component: 'linkedin_extraction',
        event: 'job.extraction.fail',
        jobId: String(jobId),
        errorCode,
      };
      if (method !== undefined) {
        context['method'] = method;
      }
      logger.warn(context, 'extraction failed');
    },
    panelMismatch: ({ jobId, expectedSourceJobId, actualSourceJobId }) =>
      logger.warn(
        {
          component: 'linkedin_extraction',
          event: 'job.panel.mismatch',
          jobId: String(jobId),
          expectedSourceJobId,
          actualSourceJobId,
        },
        'panel job ID mismatch',
      ),
    fallbackStart: ({ jobId, url }) =>
      logger.info(
        {
          component: 'linkedin_extraction',
          event: 'job.fallback.start',
          jobId: String(jobId),
          url,
        },
        'fallback started',
      ),
    fallbackClose: ({ jobId }) =>
      logger.info(
        {
          component: 'linkedin_extraction',
          event: 'job.fallback.close',
          jobId: String(jobId),
        },
        'fallback closed',
      ),
  };
}

/**
 * Internal helper exported for the Wave A test suite — the test
 * asserts the adapter stringifies numeric IDs deterministically.
 * Not part of the public surface.
 */
export const __test_stringifyNumericIds = stringifyNumericIds;
