/**
 * State vocabulary for  — LinkedIn job-detail extraction
 * The shapes below are the typed contract
 * between `service.ts` and 's pipeline orchestrator.
 *
 * Per AGENTS.md §5 / §9: domain code does not import Playwright,
 * Drizzle directly, the `openai` SDK, or
 * Pino directly. This file is a pure vocabulary module — it has
 * no side effects and no imports beyond the single constant below.
 *
 * Per Plan : `ExtractionKind` includes `'complete' |
 * 'partial' | 'failed' | 'skipped' | 'cancelled'`. `'failed'` is
 * reserved for the no-`sourceJobId` case ( owns the
 * `discoveryErrors` row); 's orchestrator may surface it
 * for per-job hard failures (panel + dedicated both broken).
 *
 * Per Plan : `ExtractionOutcome` is the
 * per-job return shape; `ExtractionBatchOutcome` aggregates the
 * per-search totals consumed by 's run summary.
 */

/** Bumped when the shape vocabulary changes; consumers gate migrations on this. */
export const LINKEDIN_EXTRACTION_SCHEMA_VERSION = 1 as const;
export type LinkedinExtractionSchemaVersion = typeof LINKEDIN_EXTRACTION_SCHEMA_VERSION;

/**
 * The four required fields every extracted job must carry
 * `sourceJobId` is the entry-gate — its presence
 * is asserted by the orchestrator BEFORE `extractOne` is called,
 * so it is NOT part of this union.
 */
export type RequiredField = 'title' | 'company' | 'location' | 'description';

/**
 * The four required fields the parser layer fills in.
 * `null` means the field could not be read from the page
 * (panel or dedicated). The orchestrator converts `null`
 * fields to a `partial` status.
 */
export interface ExtractionFieldSet {
  readonly title: string | null;
  readonly company: string | null;
  readonly location: string | null;
  readonly description: string | null;
}

/**
 * Which extraction surface produced the per-job result.
 * `'search_detail_panel'` is the preferred (panel-first) path;
 * `'dedicated_job_page'` is the fallback.
 * Both are recorded in `extractionAttempts.method` regardless
 * of which one ultimately succeeded.
 */
export type ExtractionMethod = 'search_detail_panel' | 'dedicated_job_page';

/**
 * Per-job extraction outcome. The orchestrator never throws for a per-job failure
 * — it returns `kind: 'failed'` and the consumer
 * surfaces the aggregated batch outcome.
 */
export type ExtractionKind = 'complete' | 'partial' | 'failed' | 'skipped' | 'cancelled';

export interface ExtractionOutcome {
  readonly schemaVersion: LinkedinExtractionSchemaVersion;
  /** Job row id (primary key of the `jobs` table). */
  readonly jobId: number;
  /** LinkedIn-side numeric job ID (canonical source identifier). */
  readonly sourceJobId: string;
  readonly kind: ExtractionKind;
  readonly fields: ExtractionFieldSet;
  /** Methods attempted for this job (panel, dedicated, or both). */
  readonly attemptedMethods: readonly ExtractionMethod[];
  /**
   * Stable error code (lower_snake_case) for `kind: 'failed'`
   * outcomes; `null` otherwise. The persisted
   * `extractionAttempts.errorCode` mirrors this field.
   */
  readonly errorCode: string | null;
  /** Human-readable diagnostic message (NOT persisted by default). */
  readonly errorMessage: string | null;
  /** Diagnostic artifact IDs (HTML snapshots + screenshots) produced for this job. */
  readonly artifactIds: readonly number[];
}

/**
 * Aggregated per-search outcome. 's
 * orchestrator surfaces one of these per search execution.
 * `totals` counts per-job `kind` values for at-a-glance run
 * summary rendering.
 */
export interface ExtractionBatchOutcome {
  readonly schemaVersion: LinkedinExtractionSchemaVersion;
  readonly runId: number;
  readonly searchExecutionId: number;
  readonly perJob: readonly ExtractionOutcome[];
  readonly totals: {
    readonly complete: number;
    readonly partial: number;
    readonly failed: number;
    readonly skipped: number;
    readonly cancelled: number;
  };
}
