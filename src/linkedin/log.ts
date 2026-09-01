/**
 * LinkedIn scraper structured-log seam.
 *
 *  ships a minimal placeholder: the `LinkedInScraperLogger`
 * interface + a `noopLinkedInScraperLogger` default + the production
 * `pinoLinkedInScraperLogger` adapter. 's Task 10 may extend
 * this module with additional events (e.g. `page.lifecycle`,
 * `cancel.received`); the public surface stays backward-compatible.
 *
 * Per AGENTS.md §5: this file imports only the `Logger` TYPE from
 * `src/logging/logger.ts` (no runtime Pino). The boundaries test
 * (`tests/linkedin/boundaries.test.ts`) treats `pino` as banned at
 * runtime; this file is allowed the type-only import.
 *
 * All IDs (`searchId`, `sourceJobId`) are typed as `string` to match
 * the codebase's `LogContext` shape (`src/logging/logger.ts:29-37`).
 * The orchestrator stringifies numeric IDs at the call site.
 */
import type { Logger as CodebaseLogger } from '../logging/logger.js';
import type { SearchExecutionStatus } from '../persistence/repositories/pipeline-runs.js';

/**
 * Structured-log seam for the LinkedIn discovery orchestrator. Mirrors
 * `src/init/log.ts:12-21` (init's `InitLogger`). Every method emits
 * one event with a `component: 'linkedin_scraper'` context, the
 * `searchId`, and an optional `errorCode`. The orchestrator NEVER
 * imports `pino` directly; it only sees the `LinkedInScraperLogger`
 * interface.
 */
export interface LinkedInScraperLogger {
  searchStart(input: { readonly searchId: string; readonly url: string }): void;
  searchComplete(input: { readonly searchId: string; readonly jobsDiscovered: number }): void;
  searchFail(input: {
    readonly searchId: string;
    readonly errorCode: string;
    readonly message: string;
  }): void;
  searchCancel(input: { readonly searchId: string }): void;
  cardDiscovered(input: {
    readonly searchId: string;
    readonly sourceJobId: string;
    readonly isNew: boolean;
  }): void;
  cardSkip(input: {
    readonly searchId: string;
    readonly sourceJobId: string;
    readonly reason: string;
  }): void;
  cardError(input: {
    readonly searchId: string;
    readonly errorCode: string;
    readonly message: string;
  }): void;
  finalStatusApplied(input: {
    readonly searchId: string;
    readonly finalStatus: SearchExecutionStatus;
  }): void;
}

/** Default no-op logger — safe for unit tests + as a default constructor arg. */
export const noopLinkedInScraperLogger: LinkedInScraperLogger = {
  searchStart: () => undefined,
  searchComplete: () => undefined,
  searchFail: () => undefined,
  searchCancel: () => undefined,
  cardDiscovered: () => undefined,
  cardSkip: () => undefined,
  cardError: () => undefined,
  finalStatusApplied: () => undefined,
};

/**
 * Production adapter: wraps the codebase's `Logger` interface
 * (`src/logging/logger.ts`) and emits structured logs. The orchestrator
 * NEVER imports `pino` directly; it only sees the
 * `LinkedInScraperLogger` interface.
 */
export function pinoLinkedInScraperLogger(logger: CodebaseLogger): LinkedInScraperLogger {
  return {
    searchStart: ({ searchId, url }) =>
      logger.info(
        { component: 'linkedin_scraper', event: 'search.start', searchId, url },
        'search started',
      ),
    searchComplete: ({ searchId, jobsDiscovered }) =>
      logger.info(
        { component: 'linkedin_scraper', event: 'search.complete', searchId, jobsDiscovered },
        'search complete',
      ),
    searchFail: ({ searchId, errorCode, message }) =>
      logger.warn(
        { component: 'linkedin_scraper', event: 'search.fail', searchId, errorCode },
        message,
      ),
    searchCancel: ({ searchId }) =>
      logger.info(
        { component: 'linkedin_scraper', event: 'search.cancel', searchId },
        'search cancelled',
      ),
    cardDiscovered: ({ searchId, sourceJobId, isNew }) =>
      logger.info(
        { component: 'linkedin_scraper', event: 'card.discovered', searchId, sourceJobId, isNew },
        'card discovered',
      ),
    cardSkip: ({ searchId, sourceJobId, reason }) =>
      logger.info(
        { component: 'linkedin_scraper', event: 'card.skip', searchId, sourceJobId, reason },
        'card skipped',
      ),
    cardError: ({ searchId, errorCode, message }) =>
      logger.warn(
        { component: 'linkedin_scraper', event: 'card.error', searchId, errorCode },
        message,
      ),
    finalStatusApplied: ({ searchId, finalStatus }) =>
      logger.info(
        { component: 'linkedin_scraper', event: 'search.final_status', searchId, finalStatus },
        'final status applied',
      ),
  };
}
