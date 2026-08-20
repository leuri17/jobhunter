/**
 * `LinkedInExtractionService` — the extraction orchestrator
 * (TASK-013 Plan Task 13, SPEC §22 + §23.2 + §23.3 + §29.3 + §39 + §40).
 *
 * Walks the per-job sequence:
 *   1. Read existing job via `findBySourceJobId` (caller's
 *      responsibility — `extractOne` reads the pre-supplied job row).
 *   2. Skip if `extractionStatus === 'complete' | 'partial'` —
 *      no panel opened, no fallback opened, no DB writes (SPEC
 *      §22.9 + §22.10).
 *   3. Panel select + bounded wait + bounded retry loop on the
 *      title anchor's `href` (Decision 7 + Decision 26).
 *   4. On any panel error (`PanelExtractionError` /
 *      `PanelJobIdMismatchError`), fall back to the dedicated
 *      `/jobs/view/<id>/` page via `BrowserSession.openFallbackPage`.
 *   5. Compute status via `computeExtractionStatus`.
 *   6. Atomic update: `extractionAttempts` insert +
 *      `jobs` update + `discoveryEvents` patch — all inside a
 *      single sync `db.transaction(...)` (SPEC §23.2 / §23.3,
 *      AGENTS.md §6 + Reconciler fact on per-job atomicity).
 *   7. Close the dedicated fallback page in `try/finally`.
 *
 * The orchestrator NEVER calls `browserSession.launch()` or
 * `browserSession.close()` — that's TASK-015's run-level lifecycle
 * (mirrors TASK-012's `LinkedInDiscoveryService`).
 *
 * Per AGENTS.md §5: this file imports Playwright TYPES only; runtime
 * Playwright values flow via the `BrowserSession` seam. Drizzle is
 * imported at the module level for the schema-table references
 * (`jobs`, `discoveryEvents`, `extractionAttempts`) — the
 * `Repositories.transact` callback is sync, so the only runtime use
 * is the typed `tx.update(...)` / `tx.insert(...)` calls that drive
 * the per-job atomic transaction. The boundaries test
 * (`tests/extraction/boundaries.test.ts` in Wave E) treats the
 * type-only Playwright import as an allow-list carve-out; the
 * Drizzle imports stay at the schema-table level (NOT the
 * `drizzle-orm` runtime helpers).
 *
 * Per AGENTS.md §4: `for...of` for sequential async work, no
 * `await` inside `Array.prototype.forEach`.
 */
import type { Page } from 'playwright';

import { DiagnosticManager } from '../../diagnostics/manager.js';
import { jobs, discoveryEvents, extractionAttempts } from '../../persistence/schema.js';
import type { Repositories } from '../../persistence/repositories/index.js';
import type { SearchExecutionRow } from '../../persistence/repositories/pipeline-runs.js';
import type { BrowserSession } from '../browser-session.js';
import { navigateWithTimeout } from '../navigation.js';
import { dismissRecoverableOverlays } from '../overlay.js';
import { buildDetailUrl } from './detail-url.js';
import { PanelJobIdMismatchError, DedicatedPageError } from './errors.js';
import { noopLinkedInExtractionLogger, type LinkedInExtractionLogger } from './log.js';
import { parseDedicatedPage } from './dedicated-parser.js';
import { parsePanel } from './panel-parser.js';
import {
  LINKEDIN_EXTRACTION_SCHEMA_VERSION,
  type ExtractionFieldSet,
  type ExtractionKind,
  type ExtractionMethod,
  type ExtractionOutcome,
  type ExtractionBatchOutcome,
} from './state.js';
import { computeExtractionStatus } from './status.js';

import { eq } from 'drizzle-orm';

/**
 * Constructor options for `LinkedInExtractionService`
 * (TASK-013 Plan Task 13).
 *
 * `config` mirrors the `OperationalConfigSchema.scraper.timeouts`
 * surface (`src/config/schema.ts:49-64`) — the orchestrator does
 * not read config directly; the caller (TASK-015) supplies the
 * timeout values.
 */
export interface LinkedInExtractionServiceOptions {
  readonly repositories: Repositories;
  readonly browserSession: BrowserSession;
  readonly diagnosticManager: DiagnosticManager;
  readonly logger?: LinkedInExtractionLogger;
  readonly config: {
    readonly navigationMs: number;
    readonly detailPanelMs: number;
    readonly dedicatedPageMs: number;
    readonly overlayDismissalMs: number;
  };
  readonly now?: () => Date;
}

/**
 * Per-call input to `extractOne`.
 *
 * `run.id` is the `pipelineRuns.id` (used by `extractionAttempts`).
 * `searchExecution` carries the full row so the orchestrator can
 * resolve the `discoveryEvents.id` for the atomic update. `job` is
 * the canonical job row from `findBySourceJobId` (or any other
 * source) — `extractOne` does NOT re-fetch the job.
 */
export interface ExtractOneInput {
  readonly run: { readonly id: number };
  readonly searchExecution: SearchExecutionRow;
  readonly job: {
    readonly id: number;
    readonly sourceJobId: string;
    readonly extractionStatus: 'complete' | 'partial' | 'failed';
  };
  readonly searchPage: Page;
  readonly signal: AbortSignal;
}

/**
 * Per-call input to `extractBatch`.
 */
export interface ExtractBatchInput {
  readonly run: { readonly id: number };
  readonly searchExecution: SearchExecutionRow;
  readonly jobs: readonly ExtractOneInput['job'][];
  readonly searchPage: Page;
  readonly signal: AbortSignal;
}

const EXTRACTION_ERROR_CODE_PANEL_AND_DEDICATED_FAILED = 'panel_and_dedicated_failed';
const SKIP_REASON_COMPLETE = 'complete_job_already_exists';
const SKIP_REASON_PARTIAL = 'partial_job_already_exists';

/**
 * The orchestrator. Per-job flow: skip-if-complete → panel → fallback
 * → status → atomic update → close fallback. Mirrors TASK-012's
 * `LinkedInDiscoveryService` (`src/linkedin/discovery-service.ts:75`).
 */
export class LinkedInExtractionService {
  private readonly repositories: Repositories;
  private readonly browserSession: BrowserSession;
  // The diagnosticManager is held for future per-job typed-error
  // diagnostics (Wave E wires `recordScraperError` into the
  // `extractOne` failure path). For Wave D the orchestrator
  // surfaces per-job failures as outcomes, not typed errors that
  // cross the boundary; the diagnosticManager is accepted so the
  // constructor signature matches the plan + the Wave E tests do
  // not need to change.
  private readonly diagnosticManager: DiagnosticManager;
  private readonly logger: LinkedInExtractionLogger;
  private readonly config: LinkedInExtractionServiceOptions['config'];
  private readonly now: () => Date;

  constructor(options: LinkedInExtractionServiceOptions) {
    this.repositories = options.repositories;
    this.browserSession = options.browserSession;
    this.diagnosticManager = options.diagnosticManager;
    this.logger = options.logger ?? noopLinkedInExtractionLogger();
    this.config = options.config;
    this.now = options.now ?? (() => new Date());
    // DiagnosticManager is referenced so the typed field stays
    // available for Wave E without an "unused variable" lint.
    void this.diagnosticManager;
  }

  /**
   * Extract one job (SPEC §22 + §23).
   *
   * Steps:
   *   1. Log `extractionStart`.
   *   2. Skip if `job.extractionStatus === 'complete' | 'partial'`.
   *   3. Panel parse → on failure, open the dedicated fallback
   *      page and re-parse.
   *   4. Compute status + atomic update (3 writes inside one
   *      `db.transaction`).
   *   5. Close the fallback page in `try/finally` (best-effort).
   *
   * Returns an `ExtractionOutcome` — the orchestrator never throws
   * for per-job failures. Typed errors (`LinkedInExtractionError`)
   * only surface for hard-stop conditions (no discovery event found
   * — data integrity).
   */
  async extractOne(input: ExtractOneInput): Promise<ExtractionOutcome> {
    const { job, searchExecution, run, searchPage, signal } = input;
    this.logger.extractionStart({ jobId: job.id, sourceJobId: job.sourceJobId });

    // Step 1: skip complete/partial (SPEC §22.9 + §22.10).
    if (job.extractionStatus === 'complete' || job.extractionStatus === 'partial') {
      this.logger.extractionSkip({
        jobId: job.id,
        reason: job.extractionStatus === 'complete' ? SKIP_REASON_COMPLETE : SKIP_REASON_PARTIAL,
      });
      return {
        schemaVersion: LINKEDIN_EXTRACTION_SCHEMA_VERSION,
        jobId: job.id,
        sourceJobId: job.sourceJobId,
        kind: 'skipped',
        fields: { title: null, company: null, location: null, description: null },
        attemptedMethods: [],
        errorCode: null,
        errorMessage: null,
        artifactIds: [],
      };
    }

    // Step 2 + 3: panel → dedicated fallback. The panel path is
    // tried first; any `PanelExtractionError` /
    // `PanelJobIdMismatchError` triggers the fallback. Both methods
    // are recorded in `attemptedMethods` regardless of whether they
    // succeeded (per Plan Task 13 — 1 extractionAttempts row per
    // attempted method, with `success: false` + errorCode on
    // failure).
    type MethodOutcome = {
      readonly method: ExtractionMethod;
      readonly fields: ExtractionFieldSet;
      readonly error: Error | null;
    };
    const EMPTY_FIELDS: ExtractionFieldSet = {
      title: null,
      company: null,
      location: null,
      description: null,
    };
    const outcomes: MethodOutcome[] = [];
    let fallbackPage: Page | null = null;
    try {
      try {
        const fields = await parsePanel(searchPage, {
          sourceJobId: job.sourceJobId,
          signal,
        });
        outcomes.push({ method: 'search_detail_panel', fields, error: null });
      } catch (panelError) {
        // Record the panel attempt as a failure (Decision 16 + the
        // plan's per-method extractionAttempts invariant — every
        // attempted method gets a row regardless of success).
        outcomes.push({
          method: 'search_detail_panel',
          fields: EMPTY_FIELDS,
          error: panelError instanceof Error ? panelError : new Error(String(panelError)),
        });
        // Log the specific failure shape (Decision 26). Other
        // panel errors fall through to the dedicated-page fallback.
        if (panelError instanceof PanelJobIdMismatchError) {
          const expected = panelError.metadata['expectedSourceJobId'];
          const actual = panelError.metadata['actualSourceJobId'];
          this.logger.panelMismatch({
            jobId: job.id,
            expectedSourceJobId: typeof expected === 'string' ? expected : job.sourceJobId,
            actualSourceJobId: typeof actual === 'string' ? actual : 'unknown',
          });
        }
        // Fallback to the dedicated page.
        const detailUrl = buildDetailUrl(job.sourceJobId);
        this.logger.fallbackStart({ jobId: job.id, url: detailUrl });
        fallbackPage = await this.browserSession.openFallbackPage(detailUrl);
        const nav = await navigateWithTimeout({
          page: fallbackPage,
          url: detailUrl,
          timeoutMs: this.config.dedicatedPageMs,
        });
        if (!nav.ok) {
          outcomes.push({
            method: 'dedicated_job_page',
            fields: EMPTY_FIELDS,
            error: new DedicatedPageError(
              { url: detailUrl, reason: nav.reason },
              nav.cause instanceof Error ? nav.cause : undefined,
            ),
          });
        } else {
          await dismissRecoverableOverlays(fallbackPage, {
            overlayDismissalMs: this.config.overlayDismissalMs,
          });
          try {
            const fields = await parseDedicatedPage(fallbackPage, { signal });
            outcomes.push({ method: 'dedicated_job_page', fields, error: null });
          } catch (dedicatedError) {
            outcomes.push({
              method: 'dedicated_job_page',
              fields: EMPTY_FIELDS,
              error:
                dedicatedError instanceof Error
                  ? dedicatedError
                  : new Error(String(dedicatedError)),
            });
          }
        }
        this.logger.fallbackClose({ jobId: job.id });
      }
    } finally {
      if (fallbackPage !== null) {
        try {
          await this.browserSession.closeFallbackPage(fallbackPage);
        } catch {
          // Best-effort cleanup. The orchestrator already records
          // the outcome; we don't double-log on close failures.
        }
      }
    }

    // Step 4: compute status + atomic update (3 writes inside one
    // `db.transaction`).
    const attemptedMethods: ExtractionMethod[] = outcomes.map((o) => o.method);
    const lastSuccess = [...outcomes].reverse().find((o) => o.error === null);
    const fields: ExtractionFieldSet | null = lastSuccess === undefined ? null : lastSuccess.fields;
    const success = lastSuccess !== undefined;
    const kind: ExtractionKind =
      success && fields !== null ? computeExtractionStatus(fields) : 'failed';
    const successfulMethod: ExtractionMethod | null = success
      ? (lastSuccess?.method ?? null)
      : null;

    const event = await this.repositories.jobs.findLatestDiscoveryEventByJobAndSearch(
      job.id,
      searchExecution.id,
    );
    if (event === null) {
      // Data-integrity bug: TASK-012 always inserts a
      // discoveryEvent alongside the job row. The orchestrator
      // surfaces a typed error so TASK-015 can decide to abort
      // the run.
      throw new Error(
        `extractOne: no discovery event found for jobId=${job.id}, searchExecutionId=${searchExecution.id}`,
      );
    }

    const completedAt = this.now().toISOString();
    const errorCode: string | null = success
      ? null
      : attemptedMethods.length > 0
        ? EXTRACTION_ERROR_CODE_PANEL_AND_DEDICATED_FAILED
        : null;

    // Atomic write — must stay sync per Reconciler fact
    // (`Repositories.transact` callback MUST be sync). The
    // 3 writes share a savepoint.
    this.repositories.db.transaction((tx) => {
      // Write 1: per-method extraction attempt rows.
      for (let i = 0; i < attemptedMethods.length; i += 1) {
        const method = attemptedMethods[i]!;
        const isLast = i === attemptedMethods.length - 1;
        tx.insert(extractionAttempts)
          .values({
            jobId: job.id,
            pipelineRunId: run.id,
            searchExecutionId: searchExecution.id,
            attemptTimestamp: completedAt,
            method,
            attemptNumber: i + 1,
            success: success && isLast,
            errorCode: success && isLast ? null : errorCode,
            errorMessage: null,
          })
          .run();
      }

      // Write 2: jobs row update — extractionStatus +
      // lastExtractionAttemptTimestamp + updatedTimestamp + the
      // 4 field columns + successfulMethod (when complete or
      // partial).
      const jobUpdate: Record<string, unknown> = {
        extractionStatus: kind,
        lastExtractionAttemptTimestamp: completedAt,
        updatedTimestamp: completedAt,
      };
      if (kind === 'complete' || kind === 'partial') {
        if (fields?.title !== undefined) jobUpdate['title'] = fields.title;
        if (fields?.company !== undefined) jobUpdate['company'] = fields.company;
        if (fields?.location !== undefined) jobUpdate['location'] = fields.location;
        if (fields?.description !== undefined) jobUpdate['description'] = fields.description;
        jobUpdate['successfulMethod'] = successfulMethod;
      }
      tx.update(jobs).set(jobUpdate).where(eq(jobs.id, job.id)).run();

      // Write 3: discoveryEvents row patch.
      tx.update(discoveryEvents)
        .set({
          currentExtractionState: kind,
          extractionAttempted: true,
        })
        .where(eq(discoveryEvents.id, event.id))
        .run();
    });

    if (kind === 'failed') {
      const lastMethod = attemptedMethods[attemptedMethods.length - 1];
      const failArgs: {
        readonly jobId: number;
        readonly errorCode: string;
        readonly method?: string;
      } = {
        jobId: job.id,
        errorCode: errorCode ?? EXTRACTION_ERROR_CODE_PANEL_AND_DEDICATED_FAILED,
        ...(lastMethod !== undefined ? { method: lastMethod } : {}),
      };
      this.logger.extractionFail(failArgs);
    } else {
      this.logger.extractionComplete({ jobId: job.id, kind });
    }

    return {
      schemaVersion: LINKEDIN_EXTRACTION_SCHEMA_VERSION,
      jobId: job.id,
      sourceJobId: job.sourceJobId,
      kind,
      fields:
        fields === null
          ? { title: null, company: null, location: null, description: null }
          : fields,
      attemptedMethods,
      errorCode,
      errorMessage: null,
      artifactIds: [],
    };
  }

  /**
   * Process a batch of jobs sequentially (SPEC §22.12 + §40). The
   * orchestrator NEVER calls `browserSession.launch()` /
   * `browserSession.close()` — those belong to TASK-015's run-level
   * lifecycle (Required Finding #1).
   *
   * Cancellation is `AbortSignal`-driven: the signal is checked
   * between iterations. A failure in one job does NOT terminate the
   * batch — the failure is surfaced as `kind: 'failed'` and the
   * next job is processed.
   */
  async extractBatch(input: ExtractBatchInput): Promise<ExtractionBatchOutcome> {
    const perJob: ExtractionOutcome[] = [];
    const totals = { complete: 0, partial: 0, failed: 0, skipped: 0, cancelled: 0 };

    for (const job of input.jobs) {
      if (input.signal.aborted) {
        totals.cancelled += 1;
        perJob.push({
          schemaVersion: LINKEDIN_EXTRACTION_SCHEMA_VERSION,
          jobId: job.id,
          sourceJobId: job.sourceJobId,
          kind: 'cancelled',
          fields: { title: null, company: null, location: null, description: null },
          attemptedMethods: [],
          errorCode: null,
          errorMessage: null,
          artifactIds: [],
        });
        continue;
      }
      try {
        const outcome = await this.extractOne({
          run: input.run,
          searchExecution: input.searchExecution,
          job,
          searchPage: input.searchPage,
          signal: input.signal,
        });
        perJob.push(outcome);
        switch (outcome.kind) {
          case 'complete':
            totals.complete += 1;
            break;
          case 'partial':
            totals.partial += 1;
            break;
          case 'failed':
            totals.failed += 1;
            break;
          case 'skipped':
            totals.skipped += 1;
            break;
          case 'cancelled':
            totals.cancelled += 1;
            break;
        }
      } catch (error) {
        // Per-job typed errors (data-integrity: no discovery event)
        // are surfaced as `kind: 'failed'` so the batch continues.
        // Hard-stop errors (e.g. browser launch failure) are not
        // expected here — `extractOne` does not call
        // `browserSession.launch()`.
        totals.failed += 1;
        perJob.push({
          schemaVersion: LINKEDIN_EXTRACTION_SCHEMA_VERSION,
          jobId: job.id,
          sourceJobId: job.sourceJobId,
          kind: 'failed',
          fields: { title: null, company: null, location: null, description: null },
          attemptedMethods: [],
          errorCode: 'extract_one_threw',
          errorMessage: error instanceof Error ? error.message : String(error),
          artifactIds: [],
        });
      }
    }

    return {
      schemaVersion: LINKEDIN_EXTRACTION_SCHEMA_VERSION,
      runId: input.run.id,
      searchExecutionId: input.searchExecution.id,
      perJob,
      totals,
    };
  }
}
