/**
 * `LinkedInDiscoveryService` — the discovery orchestrator
 *
 * Walks the per-search sequence:
 *   1. Mark `searchExecutions.finalStatus = 'running'`.
 *   2. `browserSession.openPage(searchExecution.generatedUrl)`.
 *   3. `navigateWithTimeout` (bounded; detects LinkedIn auth-wall redirect).
 *   4. `dismissRecoverableOverlays` (bounded; throws on undismissable).
 *   5. `loadMoreResults` (bounded; returns `{ cards, outcome }`).
 *   6. Per-card dedup via `findBySourceJobId`; insert via
 *      `recordNewJob` (new) or `recordDiscoveryEvent` (existing). No-ID
 *      cards write a `recordDiscoveryError` row.
 *   7. `browserSession.closePage` in `try/finally`.
 *   8. `updateSearchStatus` with the final status.
 *
 * The orchestrator NEVER calls `browserSession.launch()` or
 * `browserSession.close()` — that's 's run-level lifecycle
 * (per Plan Required Finding #1).
 *
 * On typed `LinkedInScraperError`: `diagnosticManager.recordScraperError`
 * is called BEFORE `closePage` (so the screenshot captures the live
 * state). The error is then re-thrown for the orchestrator boundary
 *
 */
import type { Page } from 'playwright';

import { DiagnosticManager } from '../diagnostics/manager.js';

import type { Repositories } from '../persistence/repositories/index.js';
import type { SearchExecutionRow } from '../persistence/repositories/pipeline-runs.js';
import type { SearchDiscoveryOutcome } from './state.js';
import {
  LinkedInAccessBlockedError,
  LinkedInExpectedPageError,
  LoadMoreLoopExhaustedError,
  LinkedInScraperError,
  NavigationTimeoutError,
  OverlayUndismissableError,
  BrowserLaunchError,
} from './errors.js';
import { dismissRecoverableOverlays } from './overlay.js';
import { loadMoreResults } from './load-more.js';
import { navigateWithTimeout } from './navigation.js';
import { truncateAvailableMetadata } from './truncate-metadata.js';
import type { BrowserSession } from './browser-session.js';
import { noopLinkedInScraperLogger, type LinkedInScraperLogger } from './log.js';

export interface LinkedInDiscoveryServiceOptions {
  readonly repositories: Repositories;
  readonly browserSession: BrowserSession;
  readonly diagnosticManager: DiagnosticManager;
  readonly logger?: LinkedInScraperLogger;
  readonly config: {
    readonly navigationMs: number;
    readonly initialResultsMs: number;
    readonly overlayDismissalMs: number;
    readonly maxNoProgressAttempts: number;
    readonly maxIterations: number;
  };
  readonly now?: () => Date;
}

export interface DiscoverInput {
  readonly run: { readonly id: number };
  readonly searchExecution: SearchExecutionRow;
  readonly signal: AbortSignal;
}

const DISCOVERY_ERROR_CODE_NO_ID = 'card_id_not_found';
const DISCOVERY_ERROR_CODE_ALREADY_COMPLETE = 'complete_job_already_exists';
const DISCOVERY_ERROR_CODE_ALREADY_PARTIAL = 'partial_job_already_exists';
const DISCOVERY_ERROR_CODE_REDISCOVERED_FAILED = 'failed_job_rediscovered';

export class LinkedInDiscoveryService {
  private readonly repositories: Repositories;
  private readonly browserSession: BrowserSession;
  private readonly diagnosticManager: DiagnosticManager;
  private readonly logger: LinkedInScraperLogger;
  private readonly config: LinkedInDiscoveryServiceOptions['config'];
  private readonly now: () => Date;

  constructor(options: LinkedInDiscoveryServiceOptions) {
    this.repositories = options.repositories;
    this.browserSession = options.browserSession;
    this.diagnosticManager = options.diagnosticManager;
    this.logger = options.logger ?? noopLinkedInScraperLogger;
    this.config = options.config;
    this.now = options.now ?? (() => new Date());
  }

  /**
   * Execute the per-search sequence. Returns a
   * typed `SearchDiscoveryOutcome` on success / cancellation /
   * per-card errors. Throws `LinkedInScraperError` on unrecoverable
   * per-search conditions; the caller catches + maps to
   * exit codes.
   */
  async discover(input: DiscoverInput): Promise<SearchDiscoveryOutcome> {
    const { run, searchExecution, signal } = input;
    const startedAt = this.now().toISOString();
    this.logger.searchStart({
      searchId: String(searchExecution.id),
      url: searchExecution.generatedUrl,
    });

    // Step 1: mark the search as 'running'.
    await this.repositories.pipelineRuns.updateSearchStatus(searchExecution.id, {
      finalStatus: 'running',
    });

    let page: Page | null = null;
    try {
      // Step 2: open a fresh page + navigate to the search URL.
      page = await this.openPageSafe(searchExecution.generatedUrl);

      // Step 3: bounded navigation with block detection.
      const nav = await navigateWithTimeout({
        page,
        url: searchExecution.generatedUrl,
        timeoutMs: this.config.navigationMs,
      });
      if (!nav.ok) {
        if (nav.reason === 'timeout') {
          throw new NavigationTimeoutError(
            { url: searchExecution.generatedUrl, ms: this.config.navigationMs },
            nav.cause,
          );
        }
        if (nav.reason === 'blocked') {
          throw new LinkedInAccessBlockedError(
            { url: searchExecution.generatedUrl, finalUrl: page.url() },
            nav.cause,
          );
        }
        throw new LinkedInExpectedPageError(
          { url: searchExecution.generatedUrl, reason: nav.reason },
          nav.cause,
        );
      }

      // Step 4: dismiss recoverable overlays.
      const { undismissed } = await dismissRecoverableOverlays(page, {
        overlayDismissalMs: this.config.overlayDismissalMs,
      });
      if (undismissed.length > 0) {
        const first = undismissed[0]!;
        throw new OverlayUndismissableError({
          selector: first.selector,
          strategy: first.strategy,
          undismissedCount: undismissed.length,
        });
      }

      // Step 5: bounded load-more loop.
      const { cards, outcome } = await loadMoreResults(page, {
        initialResultsMs: this.config.initialResultsMs,
        maxNoProgressAttempts: this.config.maxNoProgressAttempts,
        maxIterations: this.config.maxIterations,
        signal,
      });

      // Step 6: per-card dedup + persistence.
      let newJobs = 0;
      let existingJobs = 0;
      const errors: SearchDiscoveryOutcome['errors'][number][] = [];
      const now = this.now().toISOString();

      for (const card of cards) {
        if (signal.aborted) break;

        if (card.sourceJobId === null || card.sourceJobId === '') {
          const truncation = truncateAvailableMetadata({
            metadata: card.availableMetadata,
            logger: this.logger,
          });
          const errorId = await this.repositories.jobs.recordDiscoveryError({
            pipelineRunId: run.id,
            searchExecutionId: searchExecution.id,
            cardPosition: card.cardPosition,
            cardIndex: card.cardIndex,
            availableMetadata: truncation.result,
            errorCode: DISCOVERY_ERROR_CODE_NO_ID,
            diagnosticMessage:
              'Card found in search results but no canonical job ID could be parsed (data-occludable-job-id + href fallback both failed).',
            timestamp: now,
            artifactRefs: null,
          });
          errors.push({
            cardPosition: card.cardPosition,
            cardIndex: card.cardIndex,
            errorCode: DISCOVERY_ERROR_CODE_NO_ID,
            diagnosticMessage: 'No canonical job ID parsed.',
            discoveryErrorId: errorId,
          });
          continue;
        }

        const existing = await this.repositories.jobs.findBySourceJobId(card.sourceJobId);
        if (existing !== null) {
          existingJobs += 1;
          const skipReason = this.skipReasonForExisting(existing.extractionStatus);
          await this.repositories.jobs.recordDiscoveryEvent({
            jobId: existing.id,
            pipelineRunId: run.id,
            searchExecutionId: searchExecution.id,
            timestamp: now,
            isNew: false,
            currentExtractionState: existing.extractionStatus,
            extractionAttempted: false,
            skipReason,
          });
          continue;
        }

        // New job: atomic insert (jobs + discovery event) with
        // `currentExtractionState: 'failed'` placeholder.
        // promotes this to 'complete' / 'partial' via
        // `Repositories.jobs.updateExtraction`.
        const newJobId = await this.repositories.jobs.recordNewJob({
          job: {
            sourceJobId: card.sourceJobId,
            extractionStatus: 'failed',
            firstDiscoveryTimestamp: now,
            lastRediscoveryTimestamp: now,
            createdTimestamp: now,
            updatedTimestamp: now,
          },
          discoveryEvent: {
            jobId: 0, // placeholder; recordNewJob returns the real id
            pipelineRunId: run.id,
            searchExecutionId: searchExecution.id,
            timestamp: now,
            isNew: true,
            currentExtractionState: 'failed',
            extractionAttempted: false,
            skipReason: null,
          },
        });
        newJobs += 1;
        // The discovery event's `jobId` is set by `recordNewJob`
        // the atomic transaction ensures both rows share the same id.
        // We don't re-insert the event here (the newJobId round-trip
        // is encapsulated in the repository).
        void newJobId;
      }

      // Step 8: finalize the search execution.
      const finalStatus = outcome.kind === 'cancelled' ? 'cancelled' : 'completed';
      const completedAt = this.now().toISOString();
      await this.repositories.pipelineRuns.updateSearchStatus(searchExecution.id, {
        finalStatus,
        endTimestamp: completedAt,
        jobsDiscovered: cards.length,
        newJobs,
        existingJobs,
        errors: errors.map((e) => ({ code: e.errorCode, message: e.diagnosticMessage })),
        diagnosticRefs: null,
      });
      this.logger.finalStatusApplied({ searchId: String(searchExecution.id), finalStatus });
      this.logger.searchComplete({
        searchId: String(searchExecution.id),
        jobsDiscovered: cards.length,
      });

      return {
        schemaVersion: 1 as const,
        searchExecutionId: searchExecution.id,
        finalStatus,
        jobsDiscovered: cards.length,
        newJobs,
        existingJobs,
        errors,
        artifactIds: [],
      };
    } catch (error) {
      await this.handleFailure(input, page, error, startedAt);
      throw error;
    } finally {
      if (page !== null) {
        try {
          await this.browserSession.closePage(page);
        } catch {
          // Best-effort cleanup. The orchestrator's failure path
          // already records a diagnostic; we don't double-log.
        }
      }
    }
  }

  /**
   * Open a page via the browser session, mapping internal errors to
   * the orchestrator's typed error vocabulary.
   */
  private async openPageSafe(url: string): Promise<Page> {
    try {
      return await this.browserSession.openPage(url);
    } catch (cause) {
      if (cause instanceof BrowserLaunchError) {
        throw cause;
      }
      throw new LinkedInExpectedPageError(
        { url, reason: 'open_page_failed' },
        cause instanceof Error ? cause : undefined,
      );
    }
  }

  /**
   * Pick a stable `skipReason` value for the dedup path. The
   * existing extraction status drives the label so the run summary
   * can group re-discoveries.
   */
  private skipReasonForExisting(status: 'complete' | 'partial' | 'failed'): string {
    if (status === 'complete') return DISCOVERY_ERROR_CODE_ALREADY_COMPLETE;
    if (status === 'partial') return DISCOVERY_ERROR_CODE_ALREADY_PARTIAL;
    return DISCOVERY_ERROR_CODE_REDISCOVERED_FAILED;
  }

  /**
   * Handle a typed `LinkedInScraperError` (or unexpected error) by:
   *   1. Capturing diagnostics via `recordScraperError` (BEFORE
   *      closing the page so the screenshot sees the live state).
   *   2. Updating the search execution row to `finalStatus: 'failed'`.
   *   3. Surfacing the error to the orchestrator boundary.
   *
   * The actual page close happens in the outer `finally` block.
   */
  private async handleFailure(
    input: DiscoverInput,
    page: Page | null,
    error: unknown,
    startedAt: string,
  ): Promise<void> {
    const typed = this.asTypedScraperError(error);
    const currentUrl = page?.url() ?? input.searchExecution.generatedUrl;
    const completedAt = this.now().toISOString();

    // Capture diagnostics first. The manager catches the page/context
    // via `DiagnosticInput` (extended in ). The screenshot +
    // trace strategies need the live page; the no-op strategies
    // (stack-trace, current-url) need only the scope + currentUrl.
    try {
      await this.diagnosticManager.recordScraperError({
        scope: {
          pipelineRunId: input.run.id,
          searchExecutionId: input.searchExecution.id,
        },
        error,
        currentUrl,
        timestamp: completedAt,
        ...(page !== null ? { page } : {}),
      });
    } catch (cause) {
      // Never let the diagnostic path crash the orchestrator.
      this.logger.searchFail({
        searchId: String(input.searchExecution.id),
        errorCode: 'diagnostic_capture_failed',
        message: cause instanceof Error ? cause.message : String(cause),
      });
    }

    const finalStatus: SearchDiscoveryOutcome['finalStatus'] = 'failed';
    void startedAt;
    void finalStatus;
    await this.repositories.pipelineRuns.updateSearchStatus(input.searchExecution.id, {
      finalStatus,
      endTimestamp: completedAt,
      errors: [
        {
          code: typed.code,
          message: typed.message,
          exitCode: typed.exitCode,
        },
      ],
    });
    this.logger.finalStatusApplied({ searchId: String(input.searchExecution.id), finalStatus });
    this.logger.searchFail({
      searchId: String(input.searchExecution.id),
      errorCode: typed.code,
      message: typed.message,
    });
  }

  /**
   * Coerce an arbitrary error into a `LinkedInScraperError`. Unknown
   * errors become `LinkedInExpectedPageError` with a generic message.
   */
  private asTypedScraperError(error: unknown): LinkedInScraperError {
    if (error instanceof LinkedInScraperError) return error;
    if (error instanceof LoadMoreLoopExhaustedError) return error;
    if (error instanceof BrowserLaunchError) return error;
    return new LinkedInExpectedPageError(
      { reason: 'unexpected_error' },
      error instanceof Error ? error : undefined,
    );
  }
}
