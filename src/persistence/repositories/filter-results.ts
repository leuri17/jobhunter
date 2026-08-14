import { and, eq } from 'drizzle-orm';
import { z } from 'zod';

import { filterResults } from '../schema.js';
import { jsonColumn } from './codecs.js';
import type { RepositoryContext } from './types.js';

const unknownJson = jsonColumn<unknown>(z.unknown());

export type FilterOutcome = 'accepted' | 'rejected' | 'error';

export interface FilterResultRow {
  readonly id: number;
  readonly jobId: number;
  readonly pipelineRunId: number | null;
  readonly filterConfigVersionId: number;
  readonly filterConfigHash: string;
  readonly profileVersionId: number | null;
  readonly profileHash: string | null;
  readonly filterImplementationVersion: string;
  readonly fingerprint: string;
  readonly timestamp: string;
  readonly overallOutcome: FilterOutcome;
  readonly rulesEvaluated: readonly unknown[];
  readonly rulesPassed: readonly unknown[];
  readonly rulesFailed: readonly unknown[];
  readonly rejectionReasons: readonly unknown[] | null;
  readonly active: boolean;
}

export interface FilterResultInsert {
  readonly jobId: number;
  readonly pipelineRunId?: number | null;
  readonly filterConfigVersionId: number;
  readonly filterConfigHash: string;
  readonly profileVersionId?: number | null;
  readonly profileHash?: string | null;
  readonly filterImplementationVersion: string;
  readonly fingerprint: string;
  readonly timestamp: string;
  readonly overallOutcome: FilterOutcome;
  readonly rulesEvaluated: readonly unknown[];
  readonly rulesPassed: readonly unknown[];
  readonly rulesFailed: readonly unknown[];
  readonly rejectionReasons?: readonly unknown[] | null;
}

function rowFromRecord(record: typeof filterResults.$inferSelect): FilterResultRow {
  return {
    id: record.id,
    jobId: record.jobId,
    pipelineRunId: record.pipelineRunId,
    filterConfigVersionId: record.filterConfigVersionId,
    filterConfigHash: record.filterConfigHash,
    profileVersionId: record.profileVersionId,
    profileHash: record.profileHash,
    filterImplementationVersion: record.filterImplementationVersion,
    fingerprint: record.fingerprint,
    timestamp: record.timestamp,
    overallOutcome: record.overallOutcome,
    rulesEvaluated: unknownJson.decodeRequired(record.rulesEvaluatedJson) as readonly unknown[],
    rulesPassed: unknownJson.decodeRequired(record.rulesPassedJson) as readonly unknown[],
    rulesFailed: unknownJson.decodeRequired(record.rulesFailedJson) as readonly unknown[],
    rejectionReasons: unknownJson.decode(record.rejectionReasonsJson) as readonly unknown[] | null,
    active: record.active,
  };
}

export class FilterResultRepository {
  constructor(private readonly ctx: RepositoryContext) {}

  async activateResult(input: Omit<FilterResultInsert, 'active'>): Promise<number> {
    return this.ctx.db.transaction((tx) => {
      // SPEC §23.5: deactivate the previous active row for this job, then insert
      // the new active row. The partial unique index `filter_results_active_idx`
      // guarantees at most one active row per job.
      tx.update(filterResults)
        .set({ active: false })
        .where(and(eq(filterResults.jobId, input.jobId), eq(filterResults.active, true)))
        .run();
      const result = tx
        .insert(filterResults)
        .values({
          jobId: input.jobId,
          pipelineRunId: input.pipelineRunId ?? null,
          filterConfigVersionId: input.filterConfigVersionId,
          filterConfigHash: input.filterConfigHash,
          profileVersionId: input.profileVersionId ?? null,
          profileHash: input.profileHash ?? null,
          filterImplementationVersion: input.filterImplementationVersion,
          fingerprint: input.fingerprint,
          timestamp: input.timestamp,
          overallOutcome: input.overallOutcome,
          rulesEvaluatedJson: unknownJson.encode(input.rulesEvaluated),
          rulesPassedJson: unknownJson.encode(input.rulesPassed),
          rulesFailedJson: unknownJson.encode(input.rulesFailed),
          rejectionReasonsJson:
            input.rejectionReasons === undefined || input.rejectionReasons === null
              ? null
              : unknownJson.encode(input.rejectionReasons),
          active: true,
        })
        .returning({ id: filterResults.id })
        .all();
      const row = result[0];
      if (row === undefined) throw new Error('activateResult returned no rows');
      return row.id;
    });
  }

  async findActiveByJob(jobId: number, fingerprint: string): Promise<FilterResultRow | null> {
    const rows = this.ctx.db
      .select()
      .from(filterResults)
      .where(
        and(
          eq(filterResults.jobId, jobId),
          eq(filterResults.active, true),
          eq(filterResults.fingerprint, fingerprint),
        ),
      )
      .all();
    const row = rows[0];
    return row === undefined ? null : rowFromRecord(row);
  }

  async findById(id: number): Promise<FilterResultRow | null> {
    const rows = this.ctx.db.select().from(filterResults).where(eq(filterResults.id, id)).all();
    const row = rows[0];
    return row === undefined ? null : rowFromRecord(row);
  }

  async listByJob(jobId: number): Promise<readonly FilterResultRow[]> {
    const rows = this.ctx.db
      .select()
      .from(filterResults)
      .where(eq(filterResults.jobId, jobId))
      .all();
    return rows.map(rowFromRecord);
  }

  async listByRun(pipelineRunId: number): Promise<readonly FilterResultRow[]> {
    const rows = this.ctx.db
      .select()
      .from(filterResults)
      .where(eq(filterResults.pipelineRunId, pipelineRunId))
      .all();
    return rows.map(rowFromRecord);
  }

  /**
   * Mark every active `filter_results` row tied to the supplied profile
   * version as inactive. Used by `ProfileApprovalService` after a profile
   * is approved (SPEC §16.3 step 9): filter outcomes computed against the
   * prior profile become stale and must not be used as the current result.
   *
   * Idempotent — re-running with no active rows returns 0. The method
   * returns the count of rows actually flipped so the caller can include
   * the invalidation number in its audit output.
   *
   * Score-result invalidation lives behind a separate path: `score_results`
   * does not currently carry a `profile_version_id` column (TASK-014 will
   * resolve that with its own migration). For now only filter outcomes are
   * invalidated.
   */
  async invalidateByProfileVersion(profileVersionId: number): Promise<number> {
    return this.ctx.db.transaction((tx) => {
      const before = tx
        .select({ id: filterResults.id })
        .from(filterResults)
        .where(
          and(eq(filterResults.profileVersionId, profileVersionId), eq(filterResults.active, true)),
        )
        .all();
      if (before.length === 0) return 0;
      tx.update(filterResults)
        .set({ active: false })
        .where(
          and(eq(filterResults.profileVersionId, profileVersionId), eq(filterResults.active, true)),
        )
        .run();
      return before.length;
    });
  }
}
