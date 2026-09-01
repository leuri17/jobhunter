/**
 * JobsListService — read-side service for `jobs list`.
 *
 * Validates the CLI refinements (`limit`, `minScore`, `--run`), asks
 * the repository for the matching JobRows (the SQL lives there so
 * the service stays thin), maps each row to the per-state
 * `JobListRow` discriminated-union variant, applies the documented
 * sort, and truncates to `limit`.
 *
 * Domain boundary: this service imports `src/persistence/repositories/`
 * — the only module under `src/inspection/` allowed to do so. It does
 * not import Commander, Inquirer, Playwright, the `openai` SDK,
 * `drizzle-orm`, or Pino directly.
 */

import { InspectionValidationError } from '../errors.js';
import {
  type JobListResult,
  type JobListRow,
  type JobListRowAccepted,
  type JobListRowAll,
  type JobListRowFailed,
  type JobListRowFilterErrors,
  type JobListRowPartial,
  type JobListRowRejected,
  type JobListRowScored,
  type JobListRowScoringErrors,
  type JobListRowUnscored,
  type JobListState,
} from '../state.js';
import { formatDisplayScore } from '../../scoring/score-formula.js';
import type { Repositories } from '../../persistence/repositories/index.js';
import type {
  DiscoveryErrorRow,
  ExtractionAttemptRow,
  JobRow,
} from '../../persistence/repositories/jobs.js';

/** Maximum limit the service allows (matches  default `50`). */
const DEFAULT_LIMIT = 50;

/** Internal: validation envelope returned by `validateInput`. */
interface ValidatedListInput {
  readonly state: JobListState;
  readonly limit: number;
  readonly minScore: number | null;
  readonly company: string | null;
  readonly location: string | null;
  readonly runId: number | null;
}

export interface JobsListServiceOptions {
  readonly repositories: Repositories;
}

/** Public input shape for `JobsListService.list`. */
export interface JobsListInput {
  readonly state: JobListState;
  readonly limit?: number;
  readonly minScore?: number;
  readonly company?: string;
  readonly location?: string;
  readonly runId?: number;
}

/**
 * Read-only service backing `jobs list <state> [--refinements]`.
 *
 * Returns the discriminated `JobListResult` envelope so
 * both the formatter and the CLI handler can
 * consume the shape uniformly.
 */
export class JobsListService {
  constructor(private readonly repositories: Repositories) {}

  /**
   * Resolve the listed jobs for the requested state, applying the
   * documented refinements.
   *
   * Throws `InspectionValidationError` for invalid `limit`,
   * `minScore`, or `--run` inputs (per ). The service
   * treats the input as fail-fast — every invalid refinement is
   * surfaced BEFORE any DB query so the CLI handler's exit code
   * mapping (`InvalidUsage` = 2) is deterministic.
   */
  async list(input: JobsListInput): Promise<JobListResult> {
    const validated = validateInput(input);

    if (validated.state === 'failed') {
      // `failed` is sourced from `discoveryErrors`, not `jobs`. The
      // service hits `JobRepository.listDiscoveryErrorsByRun` and maps
      // each row to the `JobListRowFailed` variant.
      const rows = await this.fetchFailedRows(validated);
      const sorted = sortJobListRows('failed', rows);
      const truncated = sorted.slice(0, validated.limit);
      return {
        state: 'failed',
        rows: truncated,
        refinements: {
          minimumScore: validated.minScore,
          company: validated.company,
          location: validated.location,
          runId: validated.runId,
        },
        limit: validated.limit,
        returned: truncated.length,
      };
    }

    // 8 job-shaped states — defer to the repository's listByState.
    const stateExcludingFailed: Exclude<JobListState, 'failed'> = validated.state;
    const jobRows = await this.repositories.jobs.listByState({
      state: stateExcludingFailed,
      limit: validated.limit,
      ...(validated.minScore !== null ? { minScore: validated.minScore } : {}),
      ...(validated.company !== null ? { company: validated.company } : {}),
      ...(validated.location !== null ? { location: validated.location } : {}),
      ...(validated.runId !== null ? { runId: validated.runId } : {}),
    });

    const rows = await Promise.all(
      jobRows.map((row) => mapJobRowToListRow(this.repositories, stateExcludingFailed, row)),
    );
    const sorted = sortJobListRows(validated.state, rows);
    const truncated = sorted.slice(0, validated.limit);

    return {
      state: validated.state,
      rows: truncated,
      refinements: {
        minimumScore: validated.minScore,
        company: validated.company,
        location: validated.location,
        runId: validated.runId,
      },
      limit: validated.limit,
      returned: truncated.length,
    };
  }

  /**
   * Fetch the `failed` rows for the supplied refinements.
   * `discoveryErrors` has no `--limit` surface (the table is small
   * per run); we apply `limit` after the row fetch.
   *
   * `searchQuery` + `locationName` come from the joined
   * `searchExecutions` row (looked up via `findSearchById`) so the
   * rendered row carries both the failure context and the search
   * context.
   */
  private async fetchFailedRows(
    validated: ValidatedListInput,
  ): Promise<readonly JobListRowFailed[]> {
    const runId = validated.runId;
    if (runId === null) {
      // Without `--run`, the failed state is empty (the table is
      // indexed by pipelineRunId; a global scan would require a
      // new repository method not in scope for ).
      return [];
    }
    const errors = await this.repositories.jobs.listDiscoveryErrorsByRun(runId);
    const mapped: JobListRowFailed[] = [];
    for (const e of errors) {
      mapped.push(await discoveryErrorToFailedRow(this.repositories, e));
    }
    return mapped;
  }
}

/**
 * Pure: validate the raw CLI input into the documented envelope.
 * Throws `InspectionValidationError` on every documented failure
 * surface (`jobs_list_invalid_limit`, `jobs_list_invalid_min_score`).
 */
function validateInput(input: JobsListInput): ValidatedListInput {
  // `limit` — positive integer, default 50.
  let limit = DEFAULT_LIMIT;
  if (input.limit !== undefined) {
    if (!Number.isInteger(input.limit) || input.limit <= 0) {
      throw new InspectionValidationError(
        'jobs_list_invalid_limit',
        `jobs list --limit must be a positive integer (received ${input.limit}).`,
        { limit: input.limit },
      );
    }
    limit = input.limit;
  }

  // `minScore` — 0..100 number, or absent.
  let minScore: number | null = null;
  if (input.minScore !== undefined) {
    if (typeof input.minScore !== 'number' || !Number.isFinite(input.minScore)) {
      throw new InspectionValidationError(
        'jobs_list_invalid_min_score',
        `jobs list --min-score must be a number between 0 and 100 (received ${input.minScore}).`,
        { minScore: input.minScore },
      );
    }
    if (input.minScore < 0 || input.minScore > 100) {
      throw new InspectionValidationError(
        'jobs_list_invalid_min_score',
        `jobs list --min-score must be between 0 and 100 (received ${input.minScore}).`,
        { minScore: input.minScore },
      );
    }
    minScore = input.minScore;
  }

  // `run` — the CLI handler resolves `--run` to a numeric `runId`
  // via `parsePrefixedId(IDENTIFIER_PREFIXES.run)`. The service
  // accepts the number directly; no extra parsing here.
  let runId: number | null = null;
  if (input.runId !== undefined) {
    runId = input.runId;
  }

  // `company` / `location` — case-insensitive substring match;
  // normalised to lowercase so the repository can use a plain LIKE.
  const company = input.company === undefined ? null : input.company.toLowerCase();
  const location = input.location === undefined ? null : input.location.toLowerCase();

  return {
    state: input.state,
    limit,
    minScore,
    company,
    location,
    runId,
  };
}

// ---------------------------------------------------------------------------
// Row mappers (JobRow / DiscoveryErrorRow → JobListRow variant)
// ---------------------------------------------------------------------------

/**
 * Convert a `DiscoveryErrorRow` into the documented
 * `JobListRowFailed` variant. Async because the `searchQuery` +
 * `locationName` live on the joined `searchExecutions` row.
 */
async function discoveryErrorToFailedRow(
  repositories: Repositories,
  row: DiscoveryErrorRow,
): Promise<JobListRowFailed> {
  const search = await repositories.pipelineRuns.findSearchById(row.searchExecutionId);
  return {
    state: 'failed',
    errorId: row.id,
    searchQuery: search?.searchQuery ?? '',
    locationName: search?.locationName ?? '',
    cardIndex: row.cardIndex,
    errorCode: row.errorCode,
    diagnosticMessage: row.diagnosticMessage,
    discoveredAt: row.timestamp,
  };
}

/**
 * Convert one `JobRow` into the per-state `JobListRow` variant. The
 * per-state shape lives in `state.ts`; this mapper pulls
 * the cross-table fields (latest active filter / score result, etc.)
 * on demand so the SQL stays in the repository.
 */
async function mapJobRowToListRow(
  repositories: Repositories,
  state: Exclude<JobListState, 'failed'>,
  row: JobRow,
): Promise<JobListRow> {
  switch (state) {
    case 'all':
      return jobRowToAllRow(repositories, row);
    case 'scored':
      return jobRowToScoredRow(repositories, row);
    case 'accepted':
      return jobRowToAcceptedRow(repositories, row);
    case 'rejected':
      return jobRowToRejectedRow(repositories, row);
    case 'unscored':
      return jobRowToUnscoredRow(repositories, row);
    case 'partial':
      return jobRowToPartialRow(repositories, row);
    case 'filter-errors':
      return jobRowToFilterErrorsRow(repositories, row);
    case 'scoring-errors':
      return jobRowToScoringErrorsRow(repositories, row);
    default: {
      const exhaustive: never = state;
      void exhaustive;
      throw new Error(`unreachable state: ${String(state)}`);
    }
  }
}

async function jobRowToAllRow(repositories: Repositories, row: JobRow): Promise<JobListRowAll> {
  const id = `job_${row.id}`;
  const activeFilter = await findActiveFilter(repositories, row.id);
  const activeScore = await findActiveSuccessfulScore(repositories, row.id);
  return {
    state: 'all',
    id,
    internalId: row.id,
    sourceJobId: row.sourceJobId,
    extraction: row.extractionStatus,
    filter: activeFilter === null ? '—' : activeFilter.overallOutcome,
    scoreStatus: activeScore === null ? '—' : activeScore.success ? 'complete' : 'failed',
    score: activeScore === null ? '—' : formatDisplayScore(activeScore.overallScore),
    title: row.title ?? '',
    company: row.company ?? '',
    location: row.location ?? '',
    firstDiscoveredAt: row.firstDiscoveryTimestamp,
  };
}

async function jobRowToScoredRow(
  repositories: Repositories,
  row: JobRow,
): Promise<JobListRowScored> {
  const activeScore = await findActiveSuccessfulScore(repositories, row.id);
  if (activeScore === null) {
    // Defensive: the repository already filtered to active+successful
    // score results, but if the row was just deactivated between the
    // SELECT and the mapper, fall back to a placeholder rather than
    // surfacing a crash. The service layer expects this to be rare.
    return {
      state: 'scored',
      id: `job_${row.id}`,
      internalId: row.id,
      sourceJobId: row.sourceJobId,
      title: row.title ?? '',
      company: row.company ?? '',
      location: row.location ?? '',
      overallScore: 0,
      displayScore: '—',
      firstDiscoveredAt: row.firstDiscoveryTimestamp,
    };
  }
  return {
    state: 'scored',
    id: `job_${row.id}`,
    internalId: row.id,
    sourceJobId: row.sourceJobId,
    title: row.title ?? '',
    company: row.company ?? '',
    location: row.location ?? '',
    overallScore: activeScore.overallScore,
    displayScore: formatDisplayScore(activeScore.overallScore),
    firstDiscoveredAt: row.firstDiscoveryTimestamp,
  };
}

async function jobRowToAcceptedRow(
  repositories: Repositories,
  row: JobRow,
): Promise<JobListRowAccepted> {
  const activeFilter = await findActiveFilter(repositories, row.id);
  return {
    state: 'accepted',
    id: `job_${row.id}`,
    internalId: row.id,
    sourceJobId: row.sourceJobId,
    title: row.title ?? '',
    company: row.company ?? '',
    location: row.location ?? '',
    scoreStatus: await scoreStatusFor(repositories, row.id),
    filteredAt: activeFilter?.timestamp ?? row.firstDiscoveryTimestamp,
  };
}

async function jobRowToRejectedRow(
  repositories: Repositories,
  row: JobRow,
): Promise<JobListRowRejected> {
  const activeFilter = await findActiveFilter(repositories, row.id);
  const reasons = activeFilter?.rejectionReasons ?? [];
  return {
    state: 'rejected',
    id: `job_${row.id}`,
    internalId: row.id,
    sourceJobId: row.sourceJobId,
    title: row.title ?? '',
    company: row.company ?? '',
    location: row.location ?? '',
    scoreStatus: await scoreStatusFor(repositories, row.id),
    rejectionReason: reasons.length === 0 ? '—' : reasons.join('; '),
    filteredAt: activeFilter?.timestamp ?? row.firstDiscoveryTimestamp,
  };
}

async function jobRowToUnscoredRow(
  _repositories: Repositories,
  row: JobRow,
): Promise<JobListRowUnscored> {
  return {
    state: 'unscored',
    id: `job_${row.id}`,
    internalId: row.id,
    sourceJobId: row.sourceJobId,
    title: row.title ?? '',
    company: row.company ?? '',
    location: row.location ?? '',
    scoringStatus: 'pending',
    lastAttemptAt: null,
  };
}

async function jobRowToPartialRow(
  repositories: Repositories,
  row: JobRow,
): Promise<JobListRowPartial> {
  // The repository already filtered to `extractionStatus='partial'`.
  // The `missingFields` + `errorCode` come from the latest
  // `extractionAttempts` row for the job; we read it here so the
  // rendered row carries both pieces.
  const attempts = await repositories.jobs.listExtractionAttemptsByJob(row.id);
  const latest = latestFailedAttempt(attempts);
  return {
    state: 'partial',
    id: `job_${row.id}`,
    internalId: row.id,
    linkedinJobId: row.sourceJobId,
    availableTitle: row.title ?? '—',
    missingFields: latest === null ? [] : ['description', 'company'],
    errorCode: latest === null ? 'partial_extraction' : (latest.errorCode ?? 'partial_extraction'),
    discoveredAt: row.firstDiscoveryTimestamp,
  };
}

async function jobRowToFilterErrorsRow(
  repositories: Repositories,
  row: JobRow,
): Promise<JobListRowFilterErrors> {
  const activeFilter = await findActiveFilter(repositories, row.id);
  return {
    state: 'filter-errors',
    id: `job_${row.id}`,
    internalId: row.id,
    sourceJobId: row.sourceJobId,
    title: row.title ?? '',
    company: row.company ?? '',
    errorCode: 'filter_error',
    lastAttemptAt: activeFilter?.timestamp ?? row.firstDiscoveryTimestamp,
  };
}

async function jobRowToScoringErrorsRow(
  repositories: Repositories,
  row: JobRow,
): Promise<JobListRowScoringErrors> {
  const activeScore = await findActiveFailedScore(repositories, row.id);
  const allAttempts = await repositories.scoreResults.listByJob(row.id);
  return {
    state: 'scoring-errors',
    id: `job_${row.id}`,
    internalId: row.id,
    sourceJobId: row.sourceJobId,
    title: row.title ?? '',
    company: row.company ?? '',
    errorCode: activeScore?.errorCode ?? 'scoring_error',
    attempts: allAttempts.length,
    lastAttemptAt: activeScore?.timestamp ?? row.firstDiscoveryTimestamp,
  };
}

/** Pure: latest `success=false` extraction attempt, or `null`. */
function latestFailedAttempt(
  attempts: readonly ExtractionAttemptRow[],
): ExtractionAttemptRow | null {
  for (let i = attempts.length - 1; i >= 0; i--) {
    const a = attempts[i];
    if (a !== undefined && !a.success) return a;
  }
  return null;
}

/**
 * Pure: project the persisted `rejectionReasons` JSON column
 * (typed `readonly unknown[]`) into a `readonly string[]` for the
 * `JobListRow` variants. Non-string values are stringified so the
 * renderer can print them without runtime checks.
 */
function rejectionReasonsAsStrings(value: readonly unknown[] | null): readonly string[] {
  if (value === null) return [];
  const out: string[] = [];
  for (const v of value) {
    if (typeof v === 'string') out.push(v);
    else out.push(String(v));
  }
  return out;
}

/**
 * Sort the per-state row set per the documented rules.
 * The Node `Array.prototype.sort` is stable per ECMA-262 so the
 * secondary key (`sourceJobId` ASC) preserves insertion order
 * within ties on the primary key.
 */
export function sortJobListRows(
  state: JobListState,
  rows: readonly JobListRow[],
): readonly JobListRow[] {
  const sorted = [...rows];
  switch (state) {
    case 'scored':
      sorted.sort((a, b) => {
        const sa = a as JobListRowScored;
        const sb = b as JobListRowScored;
        if (sa.overallScore !== sb.overallScore) return sb.overallScore - sa.overallScore;
        return sa.sourceJobId.localeCompare(sb.sourceJobId);
      });
      break;
    case 'accepted':
      sorted.sort((a, b) => {
        const sa = a as JobListRowAccepted;
        const sb = b as JobListRowAccepted;
        const dt = sb.filteredAt.localeCompare(sa.filteredAt);
        if (dt !== 0) return dt;
        return sa.sourceJobId.localeCompare(sb.sourceJobId);
      });
      break;
    case 'rejected':
      sorted.sort((a, b) => {
        const sa = a as JobListRowRejected;
        const sb = b as JobListRowRejected;
        const dt = sb.filteredAt.localeCompare(sa.filteredAt);
        if (dt !== 0) return dt;
        return sa.sourceJobId.localeCompare(sb.sourceJobId);
      });
      break;
    case 'unscored':
      sorted.sort((a, b) => {
        const sa = a as JobListRowUnscored;
        const sb = b as JobListRowUnscored;
        // `firstDiscoveredAt` is not on the unscored variant;
        // fall back to sourceJobId ASC tie-break.
        return sa.sourceJobId.localeCompare(sb.sourceJobId);
      });
      break;
    case 'partial':
      sorted.sort((a, b) => {
        const sa = a as JobListRowPartial;
        const sb = b as JobListRowPartial;
        const dt = sb.discoveredAt.localeCompare(sa.discoveredAt);
        if (dt !== 0) return dt;
        return sa.linkedinJobId.localeCompare(sb.linkedinJobId);
      });
      break;
    case 'failed':
      sorted.sort((a, b) => {
        const sa = a as JobListRowFailed;
        const sb = b as JobListRowFailed;
        const dt = sb.discoveredAt.localeCompare(sa.discoveredAt);
        if (dt !== 0) return dt;
        return sa.errorId - sb.errorId;
      });
      break;
    case 'filter-errors':
      sorted.sort((a, b) => {
        const sa = a as JobListRowFilterErrors;
        const sb = b as JobListRowFilterErrors;
        const dt = sb.lastAttemptAt.localeCompare(sa.lastAttemptAt);
        if (dt !== 0) return dt;
        return sa.sourceJobId.localeCompare(sb.sourceJobId);
      });
      break;
    case 'scoring-errors':
      sorted.sort((a, b) => {
        const sa = a as JobListRowScoringErrors;
        const sb = b as JobListRowScoringErrors;
        const dt = sb.lastAttemptAt.localeCompare(sa.lastAttemptAt);
        if (dt !== 0) return dt;
        return sa.sourceJobId.localeCompare(sb.sourceJobId);
      });
      break;
    case 'all':
      sorted.sort((a, b) => {
        const sa = a as JobListRowAll;
        const sb = b as JobListRowAll;
        const dt = sb.firstDiscoveredAt.localeCompare(sa.firstDiscoveredAt);
        if (dt !== 0) return dt;
        return sa.sourceJobId.localeCompare(sb.sourceJobId);
      });
      break;
    default: {
      const exhaustive: never = state;
      void exhaustive;
    }
  }
  return sorted;
}

// ---------------------------------------------------------------------------
// Internal helpers (cross-table lookups the SQL can't easily express)
// ---------------------------------------------------------------------------

interface FilterResultLite {
  readonly overallOutcome: 'accepted' | 'rejected' | 'error';
  readonly fingerprint: string;
  readonly timestamp: string;
  readonly rejectionReasons: readonly string[];
}

interface ScoreResultLite {
  readonly success: boolean;
  readonly overallScore: number;
  readonly timestamp: string;
  readonly errorCode: string | null;
}

async function findActiveFilter(
  repositories: Repositories,
  jobId: number,
): Promise<FilterResultLite | null> {
  // Use the repository's `listByJob` and pick the active row in
  // memory — this avoids touching `findActiveByJob`'s fingerprint
  // parameter (which is meant for cache reuse, not display).
  const all = await repositories.filterResults.listByJob(jobId);
  for (const row of all) {
    if (row.active) {
      return {
        overallOutcome: row.overallOutcome,
        fingerprint: row.fingerprint,
        timestamp: row.timestamp,
        rejectionReasons: rejectionReasonsAsStrings(row.rejectionReasons),
      };
    }
  }
  return null;
}

async function findActiveSuccessfulScore(
  repositories: Repositories,
  jobId: number,
): Promise<ScoreResultLite | null> {
  const all = await repositories.scoreResults.listByJob(jobId);
  for (const row of all) {
    if (row.active && row.success) {
      return {
        success: true,
        overallScore: row.overallScore,
        timestamp: row.timestamp,
        errorCode: row.errorCode,
      };
    }
  }
  return null;
}

async function findActiveFailedScore(
  repositories: Repositories,
  jobId: number,
): Promise<ScoreResultLite | null> {
  const all = await repositories.scoreResults.listByJob(jobId);
  for (const row of all) {
    if (row.active && !row.success) {
      return {
        success: false,
        overallScore: row.overallScore,
        timestamp: row.timestamp,
        errorCode: row.errorCode ?? 'unknown',
      };
    }
  }
  return null;
}

async function scoreStatusFor(
  repositories: Repositories,
  jobId: number,
): Promise<'complete' | 'reused' | 'failed' | 'skipped' | 'cancelled' | '—'> {
  const all = await repositories.scoreResults.listByJob(jobId);
  for (const row of all) {
    if (row.active) {
      return row.success ? 'complete' : 'failed';
    }
  }
  return '—';
}
