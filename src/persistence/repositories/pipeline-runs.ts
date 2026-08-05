import { eq } from 'drizzle-orm';
import { z } from 'zod';

import { pipelineRuns, searchExecutions } from '../schema.js';
import { jsonColumn } from './codecs.js';
import type { RepositoryContext } from './types.js';

const unknownJson = jsonColumn<unknown>(z.unknown());

export type PipelineRunStatus =
  | 'running' | 'cancelling' | 'completed' | 'completed_with_errors' | 'failed' | 'cancelled';
export type SearchExecutionStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';

export interface PipelineRunRow {
  readonly id: number;
  readonly status: PipelineRunStatus;
  readonly startTimestamp: string;
  readonly endTimestamp: string | null;
  readonly configSnapshotJson: unknown;
  readonly configSchemaVersion: number;
  readonly configHash: string;
  readonly applicationVersion: string;
  readonly profileVersionId: number | null;
  readonly filterConfigVersionId: number | null;
  readonly searchesPlanned: number;
  readonly searchesAttempted: number;
  readonly searchesCompleted: number;
  readonly searchErrors: readonly unknown[] | null;
  readonly jobsDiscovered: number;
  readonly newCompleteJobs: number;
  readonly existingCompleteJobsSkipped: number;
  readonly existingPartialJobsSkipped: number;
  readonly newPartialJobs: number;
  readonly failedExtractions: number;
  readonly jobsAccepted: number;
  readonly jobsRejected: number;
  readonly filterErrors: number;
  readonly jobsScored: number;
  readonly scoresReused: number;
  readonly scoringErrors: number;
  readonly scoringDeclinedByUser: boolean;
  readonly cancellationReason: string | null;
}

export interface PipelineRunInsert {
  readonly startTimestamp: string;
  readonly status?: PipelineRunStatus;
  readonly configSnapshotJson: unknown;
  readonly configSchemaVersion: number;
  readonly configHash: string;
  readonly applicationVersion: string;
  readonly profileVersionId?: number | null;
  readonly filterConfigVersionId?: number | null;
}

export interface SearchExecutionRow {
  readonly id: number;
  readonly pipelineRunId: number;
  readonly searchQuery: string;
  readonly locationName: string;
  readonly geoId: string;
  readonly generatedUrl: string;
  readonly startTimestamp: string;
  readonly endTimestamp: string | null;
  readonly finalStatus: SearchExecutionStatus;
  readonly jobsDiscovered: number;
  readonly newJobs: number;
  readonly existingJobs: number;
  readonly errors: readonly unknown[] | null;
  readonly diagnosticRefs: readonly unknown[] | null;
}

export interface SearchExecutionInsert {
  readonly pipelineRunId: number; // ignored by createRunWithSearches; filled in by the repo
  readonly searchQuery: string;
  readonly locationName: string;
  readonly geoId: string;
  readonly generatedUrl: string;
  readonly startTimestamp: string;
  readonly finalStatus?: SearchExecutionStatus;
}

function runRowFromRecord(record: typeof pipelineRuns.$inferSelect): PipelineRunRow {
  return {
    id: record.id,
    status: record.status,
    startTimestamp: record.startTimestamp,
    endTimestamp: record.endTimestamp,
    configSnapshotJson: unknownJson.decodeRequired(record.configSnapshotJson),
    configSchemaVersion: record.configSchemaVersion,
    configHash: record.configHash,
    applicationVersion: record.applicationVersion,
    profileVersionId: record.profileVersionId,
    filterConfigVersionId: record.filterConfigVersionId,
    searchesPlanned: record.searchesPlanned,
    searchesAttempted: record.searchesAttempted,
    searchesCompleted: record.searchesCompleted,
    searchErrors: unknownJson.decode(record.searchErrorsJson) as readonly unknown[] | null,
    jobsDiscovered: record.jobsDiscovered,
    newCompleteJobs: record.newCompleteJobs,
    existingCompleteJobsSkipped: record.existingCompleteJobsSkipped,
    existingPartialJobsSkipped: record.existingPartialJobsSkipped,
    newPartialJobs: record.newPartialJobs,
    failedExtractions: record.failedExtractions,
    jobsAccepted: record.jobsAccepted,
    jobsRejected: record.jobsRejected,
    filterErrors: record.filterErrors,
    jobsScored: record.jobsScored,
    scoresReused: record.scoresReused,
    scoringErrors: record.scoringErrors,
    scoringDeclinedByUser: record.scoringDeclinedByUser,
    cancellationReason: record.cancellationReason,
  };
}

function searchRowFromRecord(record: typeof searchExecutions.$inferSelect): SearchExecutionRow {
  return {
    id: record.id,
    pipelineRunId: record.pipelineRunId,
    searchQuery: record.searchQuery,
    locationName: record.locationName,
    geoId: record.geoId,
    generatedUrl: record.generatedUrl,
    startTimestamp: record.startTimestamp,
    endTimestamp: record.endTimestamp,
    finalStatus: record.finalStatus,
    jobsDiscovered: record.jobsDiscovered,
    newJobs: record.newJobs,
    existingJobs: record.existingJobs,
    errors: unknownJson.decode(record.errorsJson) as readonly unknown[] | null,
    diagnosticRefs: unknownJson.decode(record.diagnosticRefsJson) as readonly unknown[] | null,
  };
}

export interface RunStatsPatch {
  readonly status?: PipelineRunStatus;
  readonly endTimestamp?: string | null;
  readonly searchesPlanned?: number;
  readonly searchesAttempted?: number;
  readonly searchesCompleted?: number;
  readonly jobsDiscovered?: number;
  readonly newCompleteJobs?: number;
  readonly existingCompleteJobsSkipped?: number;
  readonly existingPartialJobsSkipped?: number;
  readonly newPartialJobs?: number;
  readonly failedExtractions?: number;
  readonly jobsAccepted?: number;
  readonly jobsRejected?: number;
  readonly filterErrors?: number;
  readonly jobsScored?: number;
  readonly scoresReused?: number;
  readonly scoringErrors?: number;
  readonly scoringDeclinedByUser?: boolean;
  readonly cancellationReason?: string | null;
  readonly searchErrors?: readonly unknown[] | null;
}

export interface SearchStatusPatch {
  readonly finalStatus?: SearchExecutionStatus;
  readonly endTimestamp?: string | null;
  readonly jobsDiscovered?: number;
  readonly newJobs?: number;
  readonly existingJobs?: number;
  readonly errors?: readonly unknown[] | null;
  readonly diagnosticRefs?: readonly unknown[] | null;
}

export class PipelineRunRepository {
  constructor(private readonly ctx: RepositoryContext) {}

  async createRunWithSearches(
    run: PipelineRunInsert,
    searches: readonly SearchExecutionInsert[],
  ): Promise<{ runId: number; searchIds: readonly number[] }> {
    return this.ctx.db.transaction((tx) => {
      const runResult = tx
        .insert(pipelineRuns)
        .values({
          status: run.status ?? 'running',
          startTimestamp: run.startTimestamp,
          endTimestamp: null,
          configSnapshotJson: unknownJson.encode(run.configSnapshotJson),
          configSchemaVersion: run.configSchemaVersion,
          configHash: run.configHash,
          applicationVersion: run.applicationVersion,
          profileVersionId: run.profileVersionId ?? null,
          filterConfigVersionId: run.filterConfigVersionId ?? null,
        })
        .returning({ id: pipelineRuns.id })
        .all();
      const runRow = runResult[0];
      if (runRow === undefined) throw new Error('createRunWithSearches: run insert returned no rows');
      const runId = runRow.id;

      const searchIds: number[] = [];
      for (const search of searches) {
        const sResult = tx
          .insert(searchExecutions)
          .values({
            pipelineRunId: runId,
            searchQuery: search.searchQuery,
            locationName: search.locationName,
            geoId: search.geoId,
            generatedUrl: search.generatedUrl,
            startTimestamp: search.startTimestamp,
            endTimestamp: null,
            finalStatus: search.finalStatus ?? 'pending',
            jobsDiscovered: 0,
            newJobs: 0,
            existingJobs: 0,
            errorsJson: null,
            diagnosticRefsJson: null,
          })
          .returning({ id: searchExecutions.id })
          .all();
        const sRow = sResult[0];
        if (sRow === undefined) throw new Error('createRunWithSearches: search insert returned no rows');
        searchIds.push(sRow.id);
      }

      return { runId, searchIds };
    });
  }

  async findRunById(id: number): Promise<PipelineRunRow | null> {
    const rows = this.ctx.db.select().from(pipelineRuns).where(eq(pipelineRuns.id, id)).all();
    const row = rows[0];
    return row === undefined ? null : runRowFromRecord(row);
  }

  async listRuns(opts?: { status?: PipelineRunStatus }): Promise<readonly PipelineRunRow[]> {
    const base = this.ctx.db.select().from(pipelineRuns);
    const filtered = opts?.status === undefined ? base : base.where(eq(pipelineRuns.status, opts.status));
    return filtered.all().map(runRowFromRecord);
  }

  async finalizeRunStats(id: number, stats: RunStatsPatch): Promise<void> {
    this.ctx.db.transaction((tx) => {
      const patch: Record<string, unknown> = {};
      if (stats.status !== undefined) patch.status = stats.status;
      if (stats.endTimestamp !== undefined) patch.endTimestamp = stats.endTimestamp;
      if (stats.searchesPlanned !== undefined) patch.searchesPlanned = stats.searchesPlanned;
      if (stats.searchesAttempted !== undefined) patch.searchesAttempted = stats.searchesAttempted;
      if (stats.searchesCompleted !== undefined) patch.searchesCompleted = stats.searchesCompleted;
      if (stats.jobsDiscovered !== undefined) patch.jobsDiscovered = stats.jobsDiscovered;
      if (stats.newCompleteJobs !== undefined) patch.newCompleteJobs = stats.newCompleteJobs;
      if (stats.existingCompleteJobsSkipped !== undefined) patch.existingCompleteJobsSkipped = stats.existingCompleteJobsSkipped;
      if (stats.existingPartialJobsSkipped !== undefined) patch.existingPartialJobsSkipped = stats.existingPartialJobsSkipped;
      if (stats.newPartialJobs !== undefined) patch.newPartialJobs = stats.newPartialJobs;
      if (stats.failedExtractions !== undefined) patch.failedExtractions = stats.failedExtractions;
      if (stats.jobsAccepted !== undefined) patch.jobsAccepted = stats.jobsAccepted;
      if (stats.jobsRejected !== undefined) patch.jobsRejected = stats.jobsRejected;
      if (stats.filterErrors !== undefined) patch.filterErrors = stats.filterErrors;
      if (stats.jobsScored !== undefined) patch.jobsScored = stats.jobsScored;
      if (stats.scoresReused !== undefined) patch.scoresReused = stats.scoresReused;
      if (stats.scoringErrors !== undefined) patch.scoringErrors = stats.scoringErrors;
      if (stats.scoringDeclinedByUser !== undefined) patch.scoringDeclinedByUser = stats.scoringDeclinedByUser;
      if (stats.cancellationReason !== undefined) patch.cancellationReason = stats.cancellationReason;
      if (stats.searchErrors !== undefined) {
        patch.searchErrorsJson = stats.searchErrors === null ? null : unknownJson.encode(stats.searchErrors);
      }
      tx.update(pipelineRuns).set(patch).where(eq(pipelineRuns.id, id)).run();
    });
  }

  async findSearchById(id: number): Promise<SearchExecutionRow | null> {
    const rows = this.ctx.db.select().from(searchExecutions).where(eq(searchExecutions.id, id)).all();
    const row = rows[0];
    return row === undefined ? null : searchRowFromRecord(row);
  }

  async listSearchesByRun(pipelineRunId: number): Promise<readonly SearchExecutionRow[]> {
    const rows = this.ctx.db.select().from(searchExecutions).where(eq(searchExecutions.pipelineRunId, pipelineRunId)).all();
    return rows.map(searchRowFromRecord);
  }

  async updateSearchStatus(id: number, patch: SearchStatusPatch): Promise<void> {
    this.ctx.db.transaction((tx) => {
      const update: Record<string, unknown> = {};
      if (patch.finalStatus !== undefined) update.finalStatus = patch.finalStatus;
      if (patch.endTimestamp !== undefined) update.endTimestamp = patch.endTimestamp;
      if (patch.jobsDiscovered !== undefined) update.jobsDiscovered = patch.jobsDiscovered;
      if (patch.newJobs !== undefined) update.newJobs = patch.newJobs;
      if (patch.existingJobs !== undefined) update.existingJobs = patch.existingJobs;
      if (patch.errors !== undefined) update.errorsJson = patch.errors === null ? null : unknownJson.encode(patch.errors);
      if (patch.diagnosticRefs !== undefined) update.diagnosticRefsJson = patch.diagnosticRefs === null ? null : unknownJson.encode(patch.diagnosticRefs);
      tx.update(searchExecutions).set(update).where(eq(searchExecutions.id, id)).run();
    });
  }
}
