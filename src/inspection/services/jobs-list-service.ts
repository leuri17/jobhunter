/**
 * JobsListService — read-side service for `jobs list`.
 *
 * Validates the request refinements (`limit`, `minScore`, `runId`), asks
 * the repository for the matching JobRows (the SQL lives there so
 * the service stays thin), maps each row to the per-state
 * `JobListRow` discriminated-union variant, applies the documented
 * sort, and truncates to `limit`.
 *
 * Domain boundary: this service imports `src/persistence/repositories/`
 * — the only module under `src/inspection/` allowed to do so. It does
 * not import Playwright, the `openai` SDK,
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
 * Read-only service backing the `jobs list` sidecar route.
 *
 * Returns the discriminated `JobListResult` envelope so
 * both the formatter and the sidecar can
 * consume the shape uniformly.
 */
export class JobsListService {
  constructor(private readonly repositories: Repositories) {}

  /**
   * Resolve the listed jobs for the requested state, applying the
   * documented refinements.
   *
   * Throws `InspectionValidationError` for invalid `limit`,
   * `minScore`, or `run` inputs (per ). The service
   * treats the input as fail-fast — every invalid refinement is
   * surfaced BEFORE any DB query so the sidecar's HTTP error
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

    // Pre-pass: build a `PageContext` with every cross-table row the
    // mappers below might need. The pre-pass issues 3 round-trips
    // total (one per repo) regardless of how many JobRows the page
    // contains; the per-row mapper is then synchronous (audit
    // B3-C.1.11).
    const jobIds = jobRows.map((r) => r.id);
    const ctx = await preloadPageData(this.repositories, jobIds);

    const rows = jobRows.map((row) => mapJobRowToListRow(stateExcludingFailed, row, ctx));
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
   * `discoveryErrors` has no `limit` parameter (the table is small
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
      // Without `runId`, the failed state is empty (the table is
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
        `limit must be a positive integer (received ${input.limit}).`,
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
        `minScore must be a number between 0 and 100 (received ${input.minScore}).`,
        { minScore: input.minScore },
      );
    }
    if (input.minScore < 0 || input.minScore > 100) {
      throw new InspectionValidationError(
        'jobs_list_invalid_min_score',
        `minScore must be between 0 and 100 (received ${input.minScore}).`,
        { minScore: input.minScore },
      );
    }
    minScore = input.minScore;
  }

  // `run` — the sidecar route resolves the `run` identifier to a
  // numeric `runId` via `parsePrefixedId(IDENTIFIER_PREFIXES.run)`.
  // The service accepts the number directly; no extra parsing here.
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
// Page context: pre-loaded cross-table rows keyed by jobId
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

/**
 * Bag of pre-loaded cross-table rows the per-row mappers read from.
 * Built once per page in `preloadPageData`; reads are O(1) `Map.get`
 * calls.
 */
interface PageContext {
  readonly filterByJobId: ReadonlyMap<number, FilterResultLite>;
  readonly successfulScoreByJobId: ReadonlyMap<number, ScoreResultLite>;
  readonly failedScoreByJobId: ReadonlyMap<number, ScoreResultLite>;
  readonly latestFailedExtractionAttemptByJobId: ReadonlyMap<number, ExtractionAttemptRow>;
}

/**
 * Fetch every cross-table row the page's mappers might need in
 * three batched round-trips. Replaces the per-row `findActiveFilter`,
 * `findActiveSuccessfulScore`, `findActiveFailedScore`, and
 * `listExtractionAttemptsByJob` N+1 (audit B3-C.1.11).
 */
async function preloadPageData(
  repositories: Repositories,
  jobIds: readonly number[],
): Promise<PageContext> {
  const [filterRows, scoreRows, attemptRows] = await Promise.all([
    repositories.filterResults.findActiveByJobIn(jobIds),
    repositories.scoreResults.findActiveByJobIn(jobIds),
    repositories.jobs.listExtractionAttemptsByJobIn(jobIds),
  ]);

  const filterByJobId = new Map<number, FilterResultLite>();
  for (const row of filterRows) {
    filterByJobId.set(row.jobId, {
      overallOutcome: row.overallOutcome,
      fingerprint: row.fingerprint,
      timestamp: row.timestamp,
      rejectionReasons: rejectionReasonsAsStrings(row.rejectionReasons),
    });
  }

  const successfulScoreByJobId = new Map<number, ScoreResultLite>();
  const failedScoreByJobId = new Map<number, ScoreResultLite>();
  for (const row of scoreRows) {
    const lite: ScoreResultLite = {
      success: row.success,
      overallScore: row.overallScore,
      timestamp: row.timestamp,
      errorCode: row.errorCode,
    };
    if (row.success) {
      successfulScoreByJobId.set(row.jobId, lite);
    } else {
      failedScoreByJobId.set(row.jobId, {
        ...lite,
        errorCode: row.errorCode ?? 'unknown',
      });
    }
  }

  // Pick the highest-`id` failed attempt per jobId. The
  // `extraction_attempts.id` autoincrement primary key reflects
  // insertion order, so the max-id is the most recent attempt.
  const latestFailedExtractionAttemptByJobId = new Map<number, ExtractionAttemptRow>();
  for (const a of attemptRows) {
    if (a.success) continue;
    const existing = latestFailedExtractionAttemptByJobId.get(a.jobId);
    if (existing === undefined || a.id > existing.id) {
      latestFailedExtractionAttemptByJobId.set(a.jobId, a);
    }
  }

  return {
    filterByJobId,
    successfulScoreByJobId,
    failedScoreByJobId,
    latestFailedExtractionAttemptByJobId,
  };
}

// ---------------------------------------------------------------------------
// Row mappers (JobRow → JobListRow variant) — all sync, read from PageContext
// ---------------------------------------------------------------------------

/**
 * Convert one `JobRow` into the per-state `JobListRow` variant. The
 * per-state shape lives in `state.ts`; this mapper pulls the
 * cross-table fields from the pre-loaded `PageContext` so the per-row
 * work is O(1) and the page as a whole issues a fixed number of
 * SELECTs regardless of N.
 */
function mapJobRowToListRow(
  state: Exclude<JobListState, 'failed'>,
  row: JobRow,
  ctx: PageContext,
): JobListRow {
  switch (state) {
    case 'all':
      return jobRowToAllRow(row, ctx);
    case 'scored':
      return jobRowToScoredRow(row, ctx);
    case 'accepted':
      return jobRowToAcceptedRow(row, ctx);
    case 'rejected':
      return jobRowToRejectedRow(row, ctx);
    case 'unscored':
      return jobRowToUnscoredRow(row);
    case 'partial':
      return jobRowToPartialRow(row, ctx);
    case 'filter-errors':
      return jobRowToFilterErrorsRow(row, ctx);
    case 'scoring-errors':
      return jobRowToScoringErrorsRow(row, ctx);
    default: {
      const exhaustive: never = state;
      void exhaustive;
      throw new Error(`unreachable state: ${String(state)}`);
    }
  }
}

function jobRowToAllRow(row: JobRow, ctx: PageContext): JobListRowAll {
  const jobId = `job_${row.id}`;
  const activeFilter = ctx.filterByJobId.get(row.id) ?? null;
  const activeScore = ctx.successfulScoreByJobId.get(row.id) ?? null;
  return {
    state: 'all',
    id: jobId,
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

function jobRowToScoredRow(row: JobRow, ctx: PageContext): JobListRowScored {
  const activeScore = ctx.successfulScoreByJobId.get(row.id) ?? null;
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

function jobRowToAcceptedRow(row: JobRow, ctx: PageContext): JobListRowAccepted {
  const activeFilter = ctx.filterByJobId.get(row.id) ?? null;
  return {
    state: 'accepted',
    id: `job_${row.id}`,
    internalId: row.id,
    sourceJobId: row.sourceJobId,
    title: row.title ?? '',
    company: row.company ?? '',
    location: row.location ?? '',
    scoreStatus: scoreStatusFromCtx(ctx, row.id),
    filteredAt: activeFilter?.timestamp ?? row.firstDiscoveryTimestamp,
  };
}

function jobRowToRejectedRow(row: JobRow, ctx: PageContext): JobListRowRejected {
  const activeFilter = ctx.filterByJobId.get(row.id) ?? null;
  const reasons = activeFilter?.rejectionReasons ?? [];
  return {
    state: 'rejected',
    id: `job_${row.id}`,
    internalId: row.id,
    sourceJobId: row.sourceJobId,
    title: row.title ?? '',
    company: row.company ?? '',
    location: row.location ?? '',
    scoreStatus: scoreStatusFromCtx(ctx, row.id),
    rejectionReason: reasons.length === 0 ? '—' : reasons.join('; '),
    filteredAt: activeFilter?.timestamp ?? row.firstDiscoveryTimestamp,
  };
}

function jobRowToUnscoredRow(row: JobRow): JobListRowUnscored {
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

function jobRowToPartialRow(row: JobRow, ctx: PageContext): JobListRowPartial {
  // The repository already filtered to `extractionStatus='partial'`.
  // The `missingFields` + `errorCode` come from the latest failed
  // extraction attempt for the job (pre-loaded into PageContext by
  // `preloadPageData`).
  const latest = ctx.latestFailedExtractionAttemptByJobId.get(row.id) ?? null;
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

function jobRowToFilterErrorsRow(row: JobRow, ctx: PageContext): JobListRowFilterErrors {
  const activeFilter = ctx.filterByJobId.get(row.id) ?? null;
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

function jobRowToScoringErrorsRow(row: JobRow, ctx: PageContext): JobListRowScoringErrors {
  const activeScore = ctx.failedScoreByJobId.get(row.id) ?? null;
  const latest = ctx.latestFailedExtractionAttemptByJobId.get(row.id) ?? null;
  const attempts = latest === null ? 0 : 1;
  return {
    state: 'scoring-errors',
    id: `job_${row.id}`,
    internalId: row.id,
    sourceJobId: row.sourceJobId,
    title: row.title ?? '',
    company: row.company ?? '',
    errorCode: activeScore?.errorCode ?? 'scoring_error',
    attempts,
    lastAttemptAt: activeScore?.timestamp ?? row.firstDiscoveryTimestamp,
  };
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
 * Pure: map the pre-loaded score row to the documented status string.
 * Mirrors the original `scoreStatusFor` helper — 'complete' for
 * active+successful, 'failed' for active+unsuccessful, '—' when no
 * active score row exists.
 */
function scoreStatusFromCtx(
  ctx: PageContext,
  jobId: number,
): 'complete' | 'reused' | 'failed' | 'skipped' | 'cancelled' | '—' {
  if (ctx.successfulScoreByJobId.has(jobId)) return 'complete';
  if (ctx.failedScoreByJobId.has(jobId)) return 'failed';
  return '—';
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
// DiscoveryError → JobListRowFailed mapper (kept async — separate N+1
// covered under the failed-state refactor; not in scope here).
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
