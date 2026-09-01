/**
 * State vocabulary for  — inspection tables and JSON output
 *
 * The shapes below are the typed contract between the inspection
 * service layer and the formatter + JSON-schema layers
 * (this wave). Pure TypeScript types — no runtime values, no I/O.
 *
 * The 9-state job-list vocabulary mirrors  exactly; the
 * `JobListRow` discriminated union captures the per-state column
 * shape documented in . The `RunListRow` /
 * `RunShowPayload` shapes mirror the same pattern for pipeline
 * runs.
 *
 * No new state vocabulary is introduced outside this module.
 */

/**
 * JSON schema version for every `--json` payload produced by the
 * inspection module. Bumped on any payload shape change
 * so consumers can detect breaking changes via `schemaVersion`.
 * Mirrors `PIPELINE_SCHEMA_VERSION` and `LINKEDIN_SCORING_SCHEMA_VERSION`.
 */
export const INSPECTION_SCHEMA_VERSION = 1 as const;
export type InspectionSchemaVersion = typeof INSPECTION_SCHEMA_VERSION;

/**
 * The 9 job-list states documented in . Each state
 * produces a `JobListRow` variant with a distinct column shape.
 *
 * - `all`            — every canonical job row (deduplicated).
 * - `scored`         — complete jobs with a current successful score (default).
 * - `accepted`       — complete jobs whose current filter result is `accepted`.
 * - `rejected`       — complete jobs whose current filter result is `rejected`.
 * - `unscored`       — complete accepted jobs without a current successful score.
 * - `partial`        — partial-extraction rows.
 * - `failed`         — failed extraction / discovery rows.
 * - `filter-errors`  — complete jobs whose current filter result is `error`.
 * - `scoring-errors` — eligible jobs whose current scoring attempt failed.
 */
export type JobListState =
  | 'all'
  | 'scored'
  | 'accepted'
  | 'rejected'
  | 'unscored'
  | 'partial'
  | 'failed'
  | 'filter-errors'
  | 'scoring-errors';

export const JOB_LIST_STATES: readonly JobListState[] = [
  'all',
  'scored',
  'accepted',
  'rejected',
  'unscored',
  'partial',
  'failed',
  'filter-errors',
  'scoring-errors',
] as const;

/**
 * Discriminated-union row shape for `jobs list`.
 * The discriminator is `state`; every variant carries the exact
 * column set documented for that state.
 */
export type JobListRow =
  | JobListRowAll
  | JobListRowScored
  | JobListRowAccepted
  | JobListRowRejected
  | JobListRowUnscored
  | JobListRowPartial
  | JobListRowFailed
  | JobListRowFilterErrors
  | JobListRowScoringErrors;

/** `jobs list --all` row. */
export interface JobListRowAll {
  readonly state: 'all';
  readonly id: string;
  readonly internalId: number;
  readonly sourceJobId: string;
  readonly extraction: 'complete' | 'partial' | 'failed';
  readonly filter: 'accepted' | 'rejected' | 'error' | '—';
  readonly scoreStatus: 'complete' | 'reused' | 'failed' | 'skipped' | 'cancelled' | '—';
  readonly score: string;
  readonly title: string;
  readonly company: string;
  readonly location: string;
  readonly firstDiscoveredAt: string;
}

/** `jobs list --scored` row. */
export interface JobListRowScored {
  readonly state: 'scored';
  readonly id: string;
  readonly internalId: number;
  readonly sourceJobId: string;
  readonly title: string;
  readonly company: string;
  readonly location: string;
  readonly overallScore: number;
  readonly displayScore: string;
  readonly firstDiscoveredAt: string;
}

/** `jobs list --accepted` row. */
export interface JobListRowAccepted {
  readonly state: 'accepted';
  readonly id: string;
  readonly internalId: number;
  readonly sourceJobId: string;
  readonly title: string;
  readonly company: string;
  readonly location: string;
  readonly scoreStatus: 'complete' | 'reused' | 'failed' | 'skipped' | 'cancelled' | '—';
  readonly filteredAt: string;
}

/** `jobs list --rejected` row. */
export interface JobListRowRejected {
  readonly state: 'rejected';
  readonly id: string;
  readonly internalId: number;
  readonly sourceJobId: string;
  readonly title: string;
  readonly company: string;
  readonly location: string;
  readonly scoreStatus: 'complete' | 'reused' | 'failed' | 'skipped' | 'cancelled' | '—';
  readonly rejectionReason: string;
  readonly filteredAt: string;
}

/** `jobs list --unscored` row. */
export interface JobListRowUnscored {
  readonly state: 'unscored';
  readonly id: string;
  readonly internalId: number;
  readonly sourceJobId: string;
  readonly title: string;
  readonly company: string;
  readonly location: string;
  readonly scoringStatus: 'pending' | 'failed' | 'cancelled' | 'skipped';
  readonly lastAttemptAt: string | null;
}

/** `jobs list --partial` row. */
export interface JobListRowPartial {
  readonly state: 'partial';
  readonly id: string;
  readonly internalId: number;
  readonly linkedinJobId: string;
  readonly availableTitle: string;
  readonly missingFields: readonly string[];
  readonly errorCode: string;
  readonly discoveredAt: string;
}

/** `jobs list --failed` row. */
export interface JobListRowFailed {
  readonly state: 'failed';
  readonly errorId: number;
  readonly searchQuery: string;
  readonly locationName: string;
  readonly cardIndex: number | null;
  readonly errorCode: string;
  readonly diagnosticMessage: string;
  readonly discoveredAt: string;
}

/** `jobs list --filter-errors` row. */
export interface JobListRowFilterErrors {
  readonly state: 'filter-errors';
  readonly id: string;
  readonly internalId: number;
  readonly sourceJobId: string;
  readonly title: string;
  readonly company: string;
  readonly errorCode: string;
  readonly lastAttemptAt: string;
}

/** `jobs list --scoring-errors` row. */
export interface JobListRowScoringErrors {
  readonly state: 'scoring-errors';
  readonly id: string;
  readonly internalId: number;
  readonly sourceJobId: string;
  readonly title: string;
  readonly company: string;
  readonly errorCode: string;
  readonly attempts: number;
  readonly lastAttemptAt: string;
}

/**
 * The result envelope returned by `JobsListService.list`
 * The pure formatter + JSON-schema layers consume this
 * shape; the service layer assembles it from the repositories.
 */
export interface JobListResult {
  readonly state: JobListState;
  readonly rows: readonly JobListRow[];
  readonly refinements: {
    readonly minimumScore: number | null;
    readonly company: string | null;
    readonly location: string | null;
    readonly runId: number | null;
  };
  readonly limit: number;
  readonly returned: number;
}

/**
 * Full payload for `jobs show <job-id>`.
 * Captures the full job row + discovery history + current filter +
 * current score + timestamps. The description and explanation are
 * NEVER truncated ( — "preserve full stored values").
 */
export interface JobShowPayload {
  readonly id: string;
  readonly internalId: number;
  readonly sourceJobId: string;
  readonly linkedinUrl: string;
  readonly title: string | null;
  readonly company: string | null;
  readonly location: string | null;
  readonly description: string | null;
  readonly extractionStatus: 'complete' | 'partial' | 'failed';
  readonly successfulMethod: 'search_detail_panel' | 'dedicated_job_page' | null;
  readonly discoveryHistory: readonly {
    readonly runId: number;
    readonly searchExecutionId: number;
    readonly timestamp: string;
    readonly isNew: boolean;
  }[];
  readonly currentFilter: {
    readonly outcome: 'accepted' | 'rejected' | 'error' | null;
    readonly fingerprint: string | null;
    readonly rejectionReasons: readonly string[];
    readonly filteredAt: string | null;
    readonly hasHistory: boolean;
  };
  readonly currentScore: {
    readonly overallScore: number | null;
    readonly displayScore: string | null;
    readonly categoryScores: readonly {
      readonly category: string;
      readonly score: number;
      readonly explanation: string;
    }[];
    readonly explanation: string | null;
    readonly matches: readonly string[];
    readonly gaps: readonly string[];
    readonly concerns: readonly string[];
    readonly inferredSeniority: string | null;
    readonly recommendationSummary: string | null;
    readonly timestamp: string | null;
    readonly hasHistory: boolean;
  };
  readonly timestamps: {
    readonly firstDiscoveredAt: string;
    readonly lastRediscoveryAt: string;
    readonly lastExtractionAttemptAt: string | null;
    readonly createdAt: string;
    readonly updatedAt: string;
  };
}

/**
 * One row in the `runs list` table. The `errorSummary`
 * is the first search error code + count, or `'none'` when the run
 * had no errors.
 */
export interface RunListRow {
  readonly id: string;
  readonly internalId: number;
  readonly startTimestamp: string;
  readonly endTimestamp: string | null;
  readonly status:
    'running' | 'cancelling' | 'completed' | 'completed_with_errors' | 'failed' | 'cancelled';
  readonly searchesAttempted: number;
  readonly jobsDiscovered: number;
  readonly jobsScored: number;
  readonly errorSummary: string;
}

/**
 * Full payload for `runs show <run-id>`. Captures the
 * full pipeline-run row + searches + denormalized job / filter /
 * score counts + errors + cancellation state + diagnostic refs.
 *
 * `searchExecutions` references `SearchExecutionRow` from
 * `src/persistence/repositories/pipeline-runs.ts` so the CLI
 * handler can render it without a second repository lookup.
 */
export interface RunShowPayload {
  readonly id: string;
  readonly internalId: number;
  readonly status:
    'running' | 'cancelling' | 'completed' | 'completed_with_errors' | 'failed' | 'cancelled';
  readonly startTimestamp: string;
  readonly endTimestamp: string | null;
  readonly configuration: {
    readonly snapshotJson: unknown;
    readonly schemaVersion: number;
    readonly hash: string;
    readonly applicationVersion: string;
  };
  readonly profileVersionId: number | null;
  readonly filterConfigVersionId: number | null;
  readonly searchExecutions: readonly PipelineRunSearchExecutionRow[];
  readonly jobCounts: {
    readonly complete: number;
    readonly partial: number;
    readonly failed: number;
    readonly total: number;
  };
  readonly filterCounts: {
    readonly accepted: number;
    readonly rejected: number;
    readonly errors: number;
  };
  readonly scoreCounts: {
    readonly scored: number;
    readonly reused: number;
    readonly errors: number;
  };
  readonly reusedResults: {
    readonly jobsReused: number;
  };
  readonly errors: {
    readonly searchErrors: readonly { readonly code: string; readonly message: string }[];
    readonly extractionFailures: number;
    readonly filterErrors: number;
    readonly scoringErrors: number;
  };
  readonly cancellationState: {
    readonly isCancelled: boolean;
    readonly reason: string | null;
  };
  readonly diagnosticReferences: readonly {
    readonly id: number;
    readonly artifactType: string;
    readonly relativePath: string;
    readonly createdAt: string;
  }[];
}

/**
 * The subset of `SearchExecutionRow` consumed by `RunShowPayload`.
 * Defined locally to avoid forcing the pure layer to import from
 * `src/persistence/repositories/` at the type level. The service
 * layer maps the repository row to this shape.
 */
export interface PipelineRunSearchExecutionRow {
  readonly id: number;
  readonly pipelineRunId: number;
  readonly searchQuery: string;
  readonly locationName: string;
  readonly geoId: string;
  readonly generatedUrl: string;
  readonly startTimestamp: string;
  readonly endTimestamp: string | null;
  readonly finalStatus: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
  readonly jobsDiscovered: number;
  readonly newJobs: number;
  readonly existingJobs: number;
}

/**
 * Column specification consumed by `selectColumns` (Task 3) and the
 * table formatters (Task 5). The pure `selectColumns` helper
 * returns an ordered list of these per state.
 *
 * - `header` — the column label printed in the header row.
 * - `priority` — drop priority (lower = more essential). The ID column is always 0.
 * - `minWidth` — the minimum width the column needs (≥ header length).
 * - `maxWidth` — the target width after adaptive resizing.
 * - `truncate` — whether text cells may be truncated with ellipsis.
 */
export interface ColumnSpec {
  readonly header: string;
  readonly priority: number;
  readonly minWidth: number;
  readonly maxWidth: number;
  readonly truncate: boolean;
}

/**
 * The sort-key tuple per state. The pure
 * `sortJobListRows` helper (service layer) consumes this
 * vocabulary. Each tuple is the (primary key, secondary key) the
 * state sorts by.
 */
export type JobListSortKey =
  | 'overallScore'
  | 'filteredAt'
  | 'firstDiscoveredAt'
  | 'discoveryErrorTimestamp'
  | 'lastFilterAttempt'
  | 'lastScoringAttempt'
  | 'sourceJobId'
  | 'discoveryErrorId';
