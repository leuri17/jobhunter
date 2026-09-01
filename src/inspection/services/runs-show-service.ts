/**
 * RunsShowService — read-side service for `runs show <run-id>`
 *
 * Resolves the `run_<int>` identifier via `parsePrefixedId`, fetches
 * the pipeline run row + searches + per-run counts + diagnostic
 * artifacts + active score rows, and assembles the public
 * `RunShowPayload` envelope.
 *
 * Domain boundary: this service imports `src/persistence/repositories/`
 * — the only module under `src/inspection/` allowed to do so.
 */

import { InspectionNotFoundError, InspectionResourceNotFoundError } from '../errors.js';
import type { PipelineRunSearchExecutionRow, RunShowPayload } from '../state.js';
import { parsePrefixedId } from '../../persistence/identifiers.js';
import type { Repositories } from '../../persistence/repositories/index.js';
import type { SearchExecutionRow } from '../../persistence/repositories/pipeline-runs.js';

export interface RunsShowServiceOptions {
  readonly repositories: Repositories;
}

/**
 * Read-only service backing `runs show <run-id>`.
 *
 * Throws `InspectionNotFoundError` (InvalidUsage = 2) when:
 *   - The identifier is malformed (`runs_show_invalid_identifier`).
 *   - The resolved run id has no row (`runs_show_not_found`).
 */
export class RunsShowService {
  constructor(private readonly repositories: Repositories) {}

  async show(identifier: string): Promise<RunShowPayload> {
    let runId: number;
    try {
      runId = parsePrefixedId(identifier, 'run');
    } catch {
      throw new InspectionNotFoundError(
        'runs_show_invalid_identifier',
        `runs show: identifier "${identifier}" is not a valid run reference.`,
        { identifier },
      );
    }

    const details = await this.repositories.pipelineRuns.findWithDetails(runId);
    if (details === null) {
      throw new InspectionNotFoundError(
        'runs_show_not_found',
        `runs show: no run found for "${identifier}".`,
        { runId },
      );
    }

    // Fetch supporting data in parallel — score rows + diagnostic
    // artifacts + filter result rows + discovery events (for jobCounts).
    const [activeScores, diagnostics, runFilterResults, runDiscoveryEvents] = await Promise.all([
      this.repositories.scoreResults.listActiveByRun(runId),
      this.repositories.diagnostics.listByRun(runId),
      this.repositories.filterResults.listByRun(runId),
      this.repositories.jobs.listDiscoveryEventsByRun(runId),
    ]);

    // The denormalized score counts come from the pipeline-runs row
    // (the orchestrator finalises them via `finalizeRunStats`).
    const row = details.row;

    // jobCounts: count complete / partial / failed jobs by joining
    // discoveryEvents + jobs for the run. The `failed` extraction
    // status is mirrored to `discoveryEvents.currentExtractionState`
    // so we can count via either table — the JobRow is the source
    // of truth.
    const jobCounts = await this.computeJobCounts(runId, runDiscoveryEvents);

    // filterCounts: accepted / rejected / errors. We dedupe by jobId
    // (only active rows count for the current summary).
    const filterCounts = this.computeFilterCounts(runFilterResults);

    // scoreCounts: scored (active successful), reused (scoresReused
    // denormalized), errors (failed score attempts).
    const scoreErrors = activeScores.length > 0 ? 0 : row.scoringErrors;
    const scoreCounts = {
      scored: activeScores.length,
      reused: row.scoresReused,
      errors: row.scoringErrors,
    };
    void scoreErrors; // referenced for clarity; the denormalized count wins.

    const searchExecutions: PipelineRunSearchExecutionRow[] = details.searches.map(
      (s: SearchExecutionRow) => searchExecutionToListRow(s),
    );

    return {
      id: `run_${row.id}`,
      internalId: row.id,
      status: row.status,
      startTimestamp: row.startTimestamp,
      endTimestamp: row.endTimestamp,
      configuration: {
        snapshotJson: row.configSnapshotJson,
        schemaVersion: row.configSchemaVersion,
        hash: row.configHash,
        applicationVersion: row.applicationVersion,
      },
      profileVersionId: row.profileVersionId,
      filterConfigVersionId: row.filterConfigVersionId,
      searchExecutions,
      jobCounts,
      filterCounts,
      scoreCounts,
      reusedResults: {
        jobsReused: row.scoresReused,
      },
      errors: {
        searchErrors: parseSearchErrors(row.searchErrors),
        extractionFailures: row.failedExtractions,
        filterErrors: row.filterErrors,
        scoringErrors: row.scoringErrors,
      },
      cancellationState: {
        isCancelled: row.status === 'cancelled' || row.status === 'cancelling',
        reason: row.cancellationReason,
      },
      diagnosticReferences: diagnostics.map((d) => ({
        id: d.id,
        artifactType: d.artifactType,
        relativePath: d.relativePath,
        createdAt: d.createdAt,
      })),
    };
  }

  /**
   * Compute complete / partial / failed job counts for a run by
   * joining `discoveryEvents` with `jobs` (every job row's
   * `extractionStatus` is the canonical state). When the joined
   * `jobs` row is missing for an event, we count it as `partial`
   * (conservative — the orchestrator always inserts a `jobs` row
   * before any extraction attempt, so a missing row is a data
   * integrity bug we'd surface via `InspectionResourceNotFoundError`).
   */
  private async computeJobCounts(
    runId: number,
    events: readonly { readonly jobId: number }[],
  ): Promise<{
    readonly complete: number;
    readonly partial: number;
    readonly failed: number;
    readonly total: number;
  }> {
    if (events.length === 0) {
      return { complete: 0, partial: 0, failed: 0, total: 0 };
    }
    const jobIds = [...new Set(events.map((e) => e.jobId))];
    // Resolve each job's `extractionStatus` via the repository's
    // `findById`. The MVP's job volume per run is bounded (≤ a few
    // hundred) so a per-id query is acceptable; the alternative
    // would be a dedicated repository method (not in scope for ).
    const rows = await Promise.all(jobIds.map((id) => this.repositories.jobs.findById(id)));
    let completeCount = 0;
    let partialCount = 0;
    let failedCount = 0;
    let missingCount = 0;
    for (const r of rows) {
      if (r === null) {
        missingCount++;
        continue;
      }
      if (r.extractionStatus === 'complete') completeCount++;
      else if (r.extractionStatus === 'partial') partialCount++;
      else if (r.extractionStatus === 'failed') failedCount++;
    }
    if (missingCount > 0) {
      throw new InspectionResourceNotFoundError(
        'runs_show_missing_job_row',
        `runs show: ${missingCount} discovery event(s) reference a missing jobs row for run ${runId}.`,
        { runId, missingCount },
      );
    }
    return {
      complete: completeCount,
      partial: partialCount,
      failed: failedCount,
      total: completeCount + partialCount + failedCount,
    };
  }

  /** Compute accepted / rejected / errors filter counts (active rows only). */
  private computeFilterCounts(
    filterResultsAll: readonly {
      readonly active: boolean;
      readonly jobId: number;
      readonly overallOutcome: 'accepted' | 'rejected' | 'error';
    }[],
  ): { readonly accepted: number; readonly rejected: number; readonly errors: number } {
    const seenJobs = new Set<number>();
    let accepted = 0;
    let rejected = 0;
    let errors = 0;
    for (const row of filterResultsAll) {
      if (!row.active) continue;
      if (seenJobs.has(row.jobId)) continue;
      seenJobs.add(row.jobId);
      if (row.overallOutcome === 'accepted') accepted++;
      else if (row.overallOutcome === 'rejected') rejected++;
      else if (row.overallOutcome === 'error') errors++;
    }
    return { accepted, rejected, errors };
  }
}

/**
 * Pure: project the persisted `searchExecutions` row to the
 * `PipelineRunSearchExecutionRow` subset consumed by the show payload.
 */
function searchExecutionToListRow(s: SearchExecutionRow): PipelineRunSearchExecutionRow {
  return {
    id: s.id,
    pipelineRunId: s.pipelineRunId,
    searchQuery: s.searchQuery,
    locationName: s.locationName,
    geoId: s.geoId,
    generatedUrl: s.generatedUrl,
    startTimestamp: s.startTimestamp,
    endTimestamp: s.endTimestamp,
    finalStatus: s.finalStatus,
    jobsDiscovered: s.jobsDiscovered,
    newJobs: s.newJobs,
    existingJobs: s.existingJobs,
  };
}

/**
 * Pure: project the persisted `searchErrors` JSON column into the
 * typed `{ code, message }` shape. Non-object entries are skipped.
 */
function parseSearchErrors(
  raw: readonly unknown[] | null,
): readonly { readonly code: string; readonly message: string }[] {
  if (raw === null) return [];
  const out: { readonly code: string; readonly message: string }[] = [];
  for (const entry of raw) {
    if (entry === null || typeof entry !== 'object') continue;
    const e = entry as Record<string, unknown>;
    const code = typeof e['code'] === 'string' ? e['code'] : null;
    const message = typeof e['message'] === 'string' ? e['message'] : '';
    if (code === null) continue;
    out.push({ code, message });
  }
  return out;
}

// Marker for the import surface — kept here so a future refactor
// that switches `computeJobCounts` to a single IN-list query has a
// known location for the drizzle imports. The implementation uses
// the repository's `findById` for now, so the marker is a no-op.
void (null as unknown as {
  readonly and: unknown;
  readonly eq: unknown;
  readonly discoveryEvents: unknown;
  readonly filterResults: unknown;
  readonly jobsTable: unknown;
  readonly jobs: unknown;
});
