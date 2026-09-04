import { and, asc, desc, eq, gte, inArray, like } from 'drizzle-orm';
import { z } from 'zod';

import {
  discoveryErrors,
  discoveryEvents,
  extractionAttempts,
  filterResults,
  jobs,
  scoreResults,
} from '../schema.js';
import { jsonColumn } from './codecs.js';
import type { RepositoryContext } from './types.js';
import { JOB_PREFIX, NUMERIC_JOB_PATTERN } from '../identifiers.js';
import type { JobListState } from '../../inspection/state.js';

const unknownJson = jsonColumn<unknown>(z.unknown());

export type ExtractionStatus = 'complete' | 'partial' | 'failed';
export type ExtractionMethod = 'search_detail_panel' | 'dedicated_job_page';

export interface JobRow {
  readonly id: number;
  readonly sourceJobId: string;
  readonly title: string | null;
  readonly company: string | null;
  readonly location: string | null;
  readonly description: string | null;
  readonly extractionStatus: ExtractionStatus;
  readonly successfulMethod: ExtractionMethod | null;
  readonly firstDiscoveryTimestamp: string;
  readonly lastRediscoveryTimestamp: string;
  readonly lastExtractionAttemptTimestamp: string | null;
  readonly createdTimestamp: string;
  readonly updatedTimestamp: string;
}

export interface JobInsert {
  readonly sourceJobId: string;
  readonly extractionStatus: ExtractionStatus;
  readonly firstDiscoveryTimestamp: string;
  readonly lastRediscoveryTimestamp: string;
  readonly title?: string | null;
  readonly company?: string | null;
  readonly location?: string | null;
  readonly description?: string | null;
  readonly successfulMethod?: ExtractionMethod | null;
  readonly createdTimestamp: string;
  readonly updatedTimestamp: string;
}

export interface JobPatch {
  readonly title?: string | null;
  readonly company?: string | null;
  readonly location?: string | null;
  readonly description?: string | null;
  readonly extractionStatus?: ExtractionStatus;
  readonly successfulMethod?: ExtractionMethod | null;
  readonly lastRediscoveryTimestamp?: string;
  readonly lastExtractionAttemptTimestamp?: string | null;
  readonly updatedTimestamp?: string;
}

export interface DiscoveryEventRow {
  readonly id: number;
  readonly jobId: number;
  readonly pipelineRunId: number;
  readonly searchExecutionId: number;
  readonly timestamp: string;
  readonly isNew: boolean;
  readonly currentExtractionState: ExtractionStatus;
  readonly extractionAttempted: boolean;
  readonly skipReason: string | null;
}

/**
 * Patch shape for `updateDiscoveryEvent`.
 * Every field is optional — the repository only writes the keys
 * that are defined. `skipReason: null` is honored as an explicit
 * reset (distinct from `undefined`, which means "leave alone").
 */
export interface DiscoveryEventPatch {
  readonly currentExtractionState?: ExtractionStatus;
  readonly extractionAttempted?: boolean;
  readonly skipReason?: string | null;
}

export interface DiscoveryErrorRow {
  readonly id: number;
  readonly pipelineRunId: number;
  readonly searchExecutionId: number;
  readonly cardPosition: number | null;
  readonly cardIndex: number | null;
  readonly availableMetadata: unknown | null;
  readonly errorCode: string;
  readonly diagnosticMessage: string;
  readonly timestamp: string;
  readonly artifactRefs: readonly unknown[] | null;
}

export interface ExtractionAttemptRow {
  readonly id: number;
  readonly jobId: number;
  readonly pipelineRunId: number;
  readonly searchExecutionId: number;
  readonly attemptTimestamp: string;
  readonly method: ExtractionMethod;
  readonly attemptNumber: number;
  readonly success: boolean;
  readonly errorCode: string | null;
  readonly errorMessage: string | null;
}

function jobRowFromRecord(record: typeof jobs.$inferSelect): JobRow {
  return {
    id: record.id,
    sourceJobId: record.sourceJobId,
    title: record.title,
    company: record.company,
    location: record.location,
    description: record.description,
    extractionStatus: record.extractionStatus,
    successfulMethod: record.successfulMethod,
    firstDiscoveryTimestamp: record.firstDiscoveryTimestamp,
    lastRediscoveryTimestamp: record.lastRediscoveryTimestamp,
    lastExtractionAttemptTimestamp: record.lastExtractionAttemptTimestamp,
    createdTimestamp: record.createdTimestamp,
    updatedTimestamp: record.updatedTimestamp,
  };
}

function discoveryEventRowFromRecord(
  record: typeof discoveryEvents.$inferSelect,
): DiscoveryEventRow {
  return {
    id: record.id,
    jobId: record.jobId,
    pipelineRunId: record.pipelineRunId,
    searchExecutionId: record.searchExecutionId,
    timestamp: record.timestamp,
    isNew: record.isNew,
    currentExtractionState: record.currentExtractionState,
    extractionAttempted: record.extractionAttempted,
    skipReason: record.skipReason,
  };
}

function discoveryErrorRowFromRecord(
  record: typeof discoveryErrors.$inferSelect,
): DiscoveryErrorRow {
  return {
    id: record.id,
    pipelineRunId: record.pipelineRunId,
    searchExecutionId: record.searchExecutionId,
    cardPosition: record.cardPosition,
    cardIndex: record.cardIndex,
    availableMetadata: unknownJson.decode(record.availableMetadataJson),
    errorCode: record.errorCode,
    diagnosticMessage: record.diagnosticMessage,
    timestamp: record.timestamp,
    artifactRefs: unknownJson.decode(record.artifactRefsJson) as readonly unknown[] | null,
  };
}

function extractionAttemptRowFromRecord(
  record: typeof extractionAttempts.$inferSelect,
): ExtractionAttemptRow {
  return {
    id: record.id,
    jobId: record.jobId,
    pipelineRunId: record.pipelineRunId,
    searchExecutionId: record.searchExecutionId,
    attemptTimestamp: record.attemptTimestamp,
    method: record.method,
    attemptNumber: record.attemptNumber,
    success: record.success,
    errorCode: record.errorCode,
    errorMessage: record.errorMessage,
  };
}

export interface RecordNewJobInput {
  readonly job: JobInsert;
  readonly discoveryEvent: Omit<DiscoveryEventRow, 'id'>;
  readonly extractionAttempt?: Omit<ExtractionAttemptRow, 'id'>;
}

export class JobRepository {
  constructor(private readonly ctx: RepositoryContext) {}

  async recordNewJob(input: RecordNewJobInput): Promise<{
    jobId: number;
    discoveryEventId: number;
    extractionAttemptId?: number | undefined;
  }> {
    return this.ctx.db.transaction((tx) => {
      const jobResult = tx
        .insert(jobs)
        .values({
          sourceJobId: input.job.sourceJobId,
          extractionStatus: input.job.extractionStatus,
          firstDiscoveryTimestamp: input.job.firstDiscoveryTimestamp,
          lastRediscoveryTimestamp: input.job.lastRediscoveryTimestamp,
          title: input.job.title ?? null,
          company: input.job.company ?? null,
          location: input.job.location ?? null,
          description: input.job.description ?? null,
          successfulMethod: input.job.successfulMethod ?? null,
          lastExtractionAttemptTimestamp: null,
          createdTimestamp: input.job.createdTimestamp,
          updatedTimestamp: input.job.updatedTimestamp,
        })
        .returning({ id: jobs.id })
        .all();
      const jobRow = jobResult[0];
      if (jobRow === undefined) throw new Error('recordNewJob: job insert returned no rows');
      const jobId = jobRow.id;

      const eventResult = tx
        .insert(discoveryEvents)
        .values({
          jobId,
          pipelineRunId: input.discoveryEvent.pipelineRunId,
          searchExecutionId: input.discoveryEvent.searchExecutionId,
          timestamp: input.discoveryEvent.timestamp,
          isNew: input.discoveryEvent.isNew,
          currentExtractionState: input.discoveryEvent.currentExtractionState,
          extractionAttempted: input.discoveryEvent.extractionAttempted,
          skipReason: input.discoveryEvent.skipReason,
        })
        .returning({ id: discoveryEvents.id })
        .all();
      const eventRow = eventResult[0];
      if (eventRow === undefined)
        throw new Error('recordNewJob: discovery event insert returned no rows');

      let extractionAttemptId: number | undefined;
      if (input.extractionAttempt !== undefined) {
        const attemptResult = tx
          .insert(extractionAttempts)
          .values({
            jobId,
            pipelineRunId: input.extractionAttempt.pipelineRunId,
            searchExecutionId: input.extractionAttempt.searchExecutionId,
            attemptTimestamp: input.extractionAttempt.attemptTimestamp,
            method: input.extractionAttempt.method,
            attemptNumber: input.extractionAttempt.attemptNumber,
            success: input.extractionAttempt.success,
            errorCode: input.extractionAttempt.errorCode,
            errorMessage: input.extractionAttempt.errorMessage,
          })
          .returning({ id: extractionAttempts.id })
          .all();
        const attemptRow = attemptResult[0];
        if (attemptRow === undefined)
          throw new Error('recordNewJob: extraction attempt insert returned no rows');
        extractionAttemptId = attemptRow.id;
      }

      return { jobId, discoveryEventId: eventRow.id, extractionAttemptId };
    });
  }

  async findBySourceJobId(sourceJobId: string): Promise<JobRow | null> {
    const rows = this.ctx.db.select().from(jobs).where(eq(jobs.sourceJobId, sourceJobId)).all();
    const row = rows[0];
    return row === undefined ? null : jobRowFromRecord(row);
  }

  /**
   * Batch lookup: every job row whose `sourceJobId` is in the supplied
   * set. Used by `LinkedInDiscoveryService` to replace N per-card
   * `findBySourceJobId` round-trips with a single `inArray` SELECT +
   * in-memory `Map` lookup (Closes #24).
   *
   * Returns an empty array without a DB round-trip when
   * `sourceJobIds` is empty (Drizzle's `inArray` rejects empty inputs,
   * and there is nothing to look up anyway).
   *
   * Ordering is not guaranteed; the caller keys by `sourceJobId`. The
   * `jobs_source_job_id_idx` UNIQUE constraint guarantees at most one
   * row per key, so a `Map<string, JobRow>` is the natural consumer.
   */
  async findBySourceJobIds(sourceJobIds: readonly string[]): Promise<JobRow[]> {
    if (sourceJobIds.length === 0) return [];
    const rows = this.ctx.db
      .select()
      .from(jobs)
      .where(inArray(jobs.sourceJobId, sourceJobIds))
      .all();
    return rows.map(jobRowFromRecord);
  }

  async findById(id: number): Promise<JobRow | null> {
    const rows = this.ctx.db.select().from(jobs).where(eq(jobs.id, id)).all();
    const row = rows[0];
    return row === undefined ? null : jobRowFromRecord(row);
  }

  /**
   * Read-only: every job row whose `extractionStatus === 'complete'`
   * Used by `jobs reevaluate`
   * selection — partial / failed rows are excluded because their
   * filter + score state cannot be trusted.
   *
   * Order is `id ASC` to match the documented tie-breaker (SPEC
   * §34.4) and the deterministic selection order documented in
   * `src/reevaluation/plan.ts`.
   */
  async listComplete(): Promise<readonly JobRow[]> {
    const rows = this.ctx.db
      .select()
      .from(jobs)
      .where(eq(jobs.extractionStatus, 'complete'))
      .orderBy(asc(jobs.id))
      .all();
    return rows.map(jobRowFromRecord);
  }

  async updateExtraction(id: number, patch: JobPatch): Promise<void> {
    this.ctx.db.transaction((tx) => {
      const update: Record<string, unknown> = {};
      if (patch.title !== undefined) update.title = patch.title;
      if (patch.company !== undefined) update.company = patch.company;
      if (patch.location !== undefined) update.location = patch.location;
      if (patch.description !== undefined) update.description = patch.description;
      if (patch.extractionStatus !== undefined) update.extractionStatus = patch.extractionStatus;
      if (patch.successfulMethod !== undefined) update.successfulMethod = patch.successfulMethod;
      if (patch.lastRediscoveryTimestamp !== undefined)
        update.lastRediscoveryTimestamp = patch.lastRediscoveryTimestamp;
      if (patch.lastExtractionAttemptTimestamp !== undefined)
        update.lastExtractionAttemptTimestamp = patch.lastExtractionAttemptTimestamp;
      if (patch.updatedTimestamp !== undefined) update.updatedTimestamp = patch.updatedTimestamp;
      tx.update(jobs).set(update).where(eq(jobs.id, id)).run();
    });
  }

  async recordDiscoveryEvent(input: Omit<DiscoveryEventRow, 'id'>): Promise<number> {
    const result = this.ctx.db
      .insert(discoveryEvents)
      .values({
        jobId: input.jobId,
        pipelineRunId: input.pipelineRunId,
        searchExecutionId: input.searchExecutionId,
        timestamp: input.timestamp,
        isNew: input.isNew,
        currentExtractionState: input.currentExtractionState,
        extractionAttempted: input.extractionAttempted,
        skipReason: input.skipReason,
      })
      .returning({ id: discoveryEvents.id })
      .all();
    const row = result[0];
    if (row === undefined) throw new Error('recordDiscoveryEvent returned no rows');
    return row.id;
  }

  /**
   * Patch an existing `discoveryEvents` row in place ( Plan
   * Task 12, , AGENTS.md §6). Only the fields
   * present in `patch` are written — the existing row is preserved
   * otherwise (no cascading delete, no row replacement).
   *
   * Mirrors the sync `db.transaction(...)` wrapper used by
   * `updateExtraction` at `jobs.ts:255-271`. The method signature
   * is `async` (matches the `JobsRepository` interface contract);
   * the callback is sync because better-sqlite3 rejects Promise
   * returns (`src/persistence/repositories/index.ts:54-58`).
   *
   * The orchestrator (`LinkedInExtractionService`) calls
   * this method inside its own atomic transaction so the
   * `extractionAttempts` insert, the `jobs` update, and this row
   * patch all commit together — see `service.ts`.
   */
  async updateDiscoveryEvent(id: number, patch: DiscoveryEventPatch): Promise<void> {
    this.ctx.db.transaction((tx) => {
      const update: Record<string, unknown> = {};
      if (patch.currentExtractionState !== undefined) {
        update['currentExtractionState'] = patch.currentExtractionState;
      }
      if (patch.extractionAttempted !== undefined) {
        update['extractionAttempted'] = patch.extractionAttempted;
      }
      if (patch.skipReason !== undefined) {
        update['skipReason'] = patch.skipReason;
      }
      // Empty patch → no-op (Drizzle rejects `set({})` with
      // "No values to set"). The orchestrator only calls this
      // method with a populated patch, but the guard keeps the
      // method total.
      if (Object.keys(update).length === 0) {
        return;
      }
      tx.update(discoveryEvents).set(update).where(eq(discoveryEvents.id, id)).run();
    });
  }

  /**
   * Look up the most recent `discoveryEvents` row for the supplied
   * `(jobId, searchExecutionId)` pair.
   *
   * Used by `LinkedInExtractionService.extractOne` to resolve the
   * `discoveryEvents.id` that the per-job atomic update must patch
   * (via `updateDiscoveryEvent`). Returns `null` when no event
   * exists — callers (the orchestrator) treat that as a
   * data-integrity bug because task-012's discovery flow always inserts
   * an event alongside every job row.
   *
   * "Most recent" is defined as the highest `id` (monotonically
   * increasing via the SQLite auto-increment primary key). The
   * query is bounded by `LIMIT 1` so it's O(1) on the indexed
   * `(pipelineRunId, searchExecutionId)` composite + the auto-id.
   */
  async findLatestDiscoveryEventByJobAndSearch(
    jobId: number,
    searchExecutionId: number,
  ): Promise<DiscoveryEventRow | null> {
    const rows = this.ctx.db
      .select()
      .from(discoveryEvents)
      .where(
        and(
          eq(discoveryEvents.jobId, jobId),
          eq(discoveryEvents.searchExecutionId, searchExecutionId),
        ),
      )
      .orderBy(desc(discoveryEvents.id))
      .limit(1)
      .all();
    const row = rows[0];
    return row === undefined ? null : discoveryEventRowFromRecord(row);
  }

  async listDiscoveryEventsByJob(jobId: number): Promise<readonly DiscoveryEventRow[]> {
    const rows = this.ctx.db
      .select()
      .from(discoveryEvents)
      .where(eq(discoveryEvents.jobId, jobId))
      .all();
    return rows.map(discoveryEventRowFromRecord);
  }

  async listDiscoveryEventsByRun(pipelineRunId: number): Promise<readonly DiscoveryEventRow[]> {
    const rows = this.ctx.db
      .select()
      .from(discoveryEvents)
      .where(eq(discoveryEvents.pipelineRunId, pipelineRunId))
      .all();
    return rows.map(discoveryEventRowFromRecord);
  }

  /**
   * Read-only: fetch every discovery event for a given pipeline run
   * (  + Task 13). Used by the pipeline
   * orchestrator to enumerate the jobs discovered during the run.
   *
   * Functionally equivalent to `listDiscoveryEventsByRun`. Kept as
   * a distinct method to preserve the discoverability + matching
   * unit-test contract documented in the  plan.
   */
  async findEventsByRun(pipelineRunId: number): Promise<readonly DiscoveryEventRow[]> {
    return this.listDiscoveryEventsByRun(pipelineRunId);
  }

  async recordDiscoveryError(input: Omit<DiscoveryErrorRow, 'id'>): Promise<number> {
    const result = this.ctx.db
      .insert(discoveryErrors)
      .values({
        pipelineRunId: input.pipelineRunId,
        searchExecutionId: input.searchExecutionId,
        cardPosition: input.cardPosition,
        cardIndex: input.cardIndex,
        availableMetadataJson:
          input.availableMetadata === undefined || input.availableMetadata === null
            ? null
            : unknownJson.encode(input.availableMetadata),
        errorCode: input.errorCode,
        diagnosticMessage: input.diagnosticMessage,
        timestamp: input.timestamp,
        artifactRefsJson:
          input.artifactRefs === undefined || input.artifactRefs === null
            ? null
            : unknownJson.encode(input.artifactRefs),
      })
      .returning({ id: discoveryErrors.id })
      .all();
    const row = result[0];
    if (row === undefined) throw new Error('recordDiscoveryError returned no rows');
    return row.id;
  }

  async listDiscoveryErrorsByRun(pipelineRunId: number): Promise<readonly DiscoveryErrorRow[]> {
    const rows = this.ctx.db
      .select()
      .from(discoveryErrors)
      .where(eq(discoveryErrors.pipelineRunId, pipelineRunId))
      .all();
    return rows.map(discoveryErrorRowFromRecord);
  }

  async recordExtractionAttempt(input: Omit<ExtractionAttemptRow, 'id'>): Promise<number> {
    const result = this.ctx.db
      .insert(extractionAttempts)
      .values({
        jobId: input.jobId,
        pipelineRunId: input.pipelineRunId,
        searchExecutionId: input.searchExecutionId,
        attemptTimestamp: input.attemptTimestamp,
        method: input.method,
        attemptNumber: input.attemptNumber,
        success: input.success,
        errorCode: input.errorCode,
        errorMessage: input.errorMessage,
      })
      .returning({ id: extractionAttempts.id })
      .all();
    const row = result[0];
    if (row === undefined) throw new Error('recordExtractionAttempt returned no rows');
    return row.id;
  }

  async listExtractionAttemptsByJob(jobId: number): Promise<readonly ExtractionAttemptRow[]> {
    const rows = this.ctx.db
      .select()
      .from(extractionAttempts)
      .where(eq(extractionAttempts.jobId, jobId))
      .all();
    return rows.map(extractionAttemptRowFromRecord);
  }

  // -------------------------------------------------------------------------
  // Inspection queries
  //
  // The queries below back `JobsListService.list`. Each `state` selects the
  // job rows that match the documented per-state semantics; the service
  // layer applies refinements (limit / minScore / company / location / runId)
  // on top. The `failed` state does NOT return JobRows (it returns rows from
  // `discoveryErrors`); the service layer queries that shape directly via
  // `listDiscoveryErrorsByRun`.
  // -------------------------------------------------------------------------

  /**
   * Resolve a `JobListState` to the matching JobRows, applying the
   * supplied refinements (company / location substring match +
   * runId scoping).
   *
   * `minScore` is applied at the SQL layer only for states backed by
   * score results (`scored`, plus `all` when supplied). Other states
   * ignore `minScore` — the service layer guards the same surface.
   *
   * For the `failed` state the method returns an empty array; the
   * service layer queries `discoveryErrors` directly.
   */
  async listByState(filter: JobListRowFilter): Promise<readonly JobRow[]> {
    if (filter.state === 'failed') {
      // `failed` is sourced from `discoveryErrors`, not `jobs`.
      return [];
    }

    const jobIdFilter = await this.jobIdsForState(filter.state, filter);
    if (jobIdFilter === null) {
      // No state-specific ID filter; honour `minScore` for `all`.
      if (filter.state === 'all' && filter.minScore !== undefined) {
        const scoredIds = this.activeSuccessfulScoreJobIds(filter.minScore);
        if (scoredIds.length === 0) return [];
        const conditions = [inArray(jobs.id, scoredIds)];
        this.pushTextRefinements(conditions, filter);
        const rows = this.ctx.db
          .select()
          .from(jobs)
          .where(and(...conditions))
          .orderBy(desc(jobs.firstDiscoveryTimestamp), asc(jobs.sourceJobId))
          .limit(filter.limit)
          .all();
        return rows.map(jobRowFromRecord);
      }
      // `all` without minScore: every job is a candidate (subject to
      // company / location / runId).
      const conditions: ReturnType<typeof eq>[] = [];
      this.pushTextRefinements(conditions, filter);
      const runScope = await this.jobIdsForRun(filter.runId);
      if (runScope !== null) conditions.push(inArray(jobs.id, runScope));
      const rows = this.ctx.db
        .select()
        .from(jobs)
        .where(conditions.length === 0 ? undefined : and(...conditions))
        .orderBy(desc(jobs.firstDiscoveryTimestamp), asc(jobs.sourceJobId))
        .limit(filter.limit)
        .all();
      return rows.map(jobRowFromRecord);
    }

    if (jobIdFilter.length === 0) {
      return [];
    }

    const conditions = [inArray(jobs.id, jobIdFilter)];
    this.pushTextRefinements(conditions, filter);
    const rows = this.ctx.db
      .select()
      .from(jobs)
      .where(and(...conditions))
      .orderBy(desc(jobs.firstDiscoveryTimestamp), asc(jobs.sourceJobId))
      .limit(filter.limit)
      .all();
    return rows.map(jobRowFromRecord);
  }

  /**
   * Resolve a job identifier to its JobRow.
   *
   * Accepts:
   *   - `job_<int>`           → looked up via `findById` (canonical).
   *   - numeric `<digits>`    → looked up via `findBySourceJobId`
   *                              (the LinkedIn sourceJobId form).
   *
   * Anything else returns `null`; the service layer wraps that into
   * a typed `InspectionNotFoundError` with code
   * `jobs_show_invalid_identifier`.
   */
  async findBySourceJobIdOrId(identifier: string): Promise<JobRow | null> {
    if (typeof identifier !== 'string' || identifier.trim() === '') {
      return null;
    }
    if (identifier.startsWith(JOB_PREFIX)) {
      const tail = identifier.slice(JOB_PREFIX.length);
      if (!/^[0-9]+$/.test(tail)) return null;
      const id = Number(tail);
      if (!Number.isInteger(id) || id <= 0) return null;
      return this.findById(id);
    }
    if (NUMERIC_JOB_PATTERN.test(identifier)) {
      return this.findBySourceJobId(identifier);
    }
    return null;
  }

  /**
   * Count of `discoveryErrors` rows for a single run. Used by the
   * the `all` state (with `runId`) to surface a "this run had <n>
   * discovery errors" hint without materialising every error row.
   */
  async discoveryErrorCountByRun(runId: number): Promise<number> {
    const rows = this.ctx.db
      .select({ id: discoveryErrors.id })
      .from(discoveryErrors)
      .where(eq(discoveryErrors.pipelineRunId, runId))
      .all();
    return rows.length;
  }

  // -------------------------------------------------------------------------
  // Private helpers — back `listByState`. Kept small + focused so each
  // per-state case stays one statement.
  // -------------------------------------------------------------------------

  /**
   * Push the company / location refinements onto a Drizzle `conditions`
   * accumulator. SQLite's `LIKE` is ASCII case-insensitive by default
   * (the runtime configuration enables this); the service layer
   * normalises the input to lowercase before reaching us.
   */
  private pushTextRefinements(
    conditions: Array<ReturnType<typeof eq>>,
    filter: JobListRowFilter,
  ): void {
    if (filter.company !== undefined && filter.company.length > 0) {
      conditions.push(like(jobs.company, `%${filter.company}%`));
    }
    if (filter.location !== undefined && filter.location.length > 0) {
      conditions.push(like(jobs.location, `%${filter.location}%`));
    }
  }

  /**
   * Collect the set of job IDs that match the per-state semantics.
   *
   * Returns `null` when no ID filter is needed (the `all` state, which
   * wants every job), `[]` when no job matches the state
   * (short-circuit), or a concrete list otherwise.
   */
  private async jobIdsForState(
    state: Exclude<JobListState, 'failed'>,
    filter: JobListRowFilter,
  ): Promise<readonly number[] | null> {
    const runScope = await this.jobIdsForRun(filter.runId);

    switch (state) {
      case 'all':
        return null;
      case 'scored':
        return this.applyRunScope(this.activeSuccessfulScoreJobIds(filter.minScore), runScope);
      case 'accepted':
        return this.applyRunScope(this.activeFilterOutcomeJobIds('accepted'), runScope);
      case 'rejected':
        return this.applyRunScope(this.activeFilterOutcomeJobIds('rejected'), runScope);
      case 'unscored': {
        const acceptedIds = new Set(this.activeFilterOutcomeJobIds('accepted'));
        const scoredIds = new Set(this.activeSuccessfulScoreJobIds(undefined));
        const result: number[] = [];
        for (const id of acceptedIds) {
          if (!scoredIds.has(id)) result.push(id);
        }
        return this.applyRunScope(result, runScope);
      }
      case 'partial':
        return this.applyRunScope(this.jobsByExtractionStatus('partial'), runScope);
      case 'filter-errors':
        return this.applyRunScope(this.activeFilterOutcomeJobIds('error'), runScope);
      case 'scoring-errors':
        return this.applyRunScope(this.activeFailedScoreJobIds(), runScope);
      default: {
        const exhaustive: never = state;
        void exhaustive;
        return [];
      }
    }
  }

  /** Job IDs discovered in `runId`, or `null` when no scope is set. */
  private async jobIdsForRun(runId: number | undefined): Promise<readonly number[] | null> {
    if (runId === undefined) return null;
    const rows = this.ctx.db
      .selectDistinct({ jobId: discoveryEvents.jobId })
      .from(discoveryEvents)
      .where(eq(discoveryEvents.pipelineRunId, runId))
      .all();
    return rows.map((r) => r.jobId);
  }

  private applyRunScope(
    ids: readonly number[],
    runScope: readonly number[] | null,
  ): readonly number[] {
    if (runScope === null) return [...ids];
    if (ids.length === 0) return [...ids];
    const scope = new Set(runScope);
    return ids.filter((id) => scope.has(id));
  }

  /** Job IDs whose latest active score result succeeded, optionally >= `minScore`. */
  private activeSuccessfulScoreJobIds(minScore: number | undefined): readonly number[] {
    const baseConditions = [eq(scoreResults.active, true), eq(scoreResults.success, true)];
    const where =
      minScore === undefined
        ? and(...baseConditions)
        : and(...baseConditions, gte(scoreResults.overallScore, minScore));
    const rows = this.ctx.db
      .select({ jobId: scoreResults.jobId })
      .from(scoreResults)
      .where(where)
      .all();
    return rows.map((r) => r.jobId);
  }

  /** Job IDs whose latest active filter result has the supplied outcome. */
  private activeFilterOutcomeJobIds(outcome: 'accepted' | 'rejected' | 'error'): readonly number[] {
    const rows = this.ctx.db
      .select({ jobId: filterResults.jobId })
      .from(filterResults)
      .where(and(eq(filterResults.active, true), eq(filterResults.overallOutcome, outcome)))
      .all();
    return rows.map((r) => r.jobId);
  }

  /** Job IDs whose canonical row carries the supplied extraction status. */
  private jobsByExtractionStatus(status: ExtractionStatus): readonly number[] {
    const rows = this.ctx.db
      .select({ id: jobs.id })
      .from(jobs)
      .where(eq(jobs.extractionStatus, status))
      .all();
    return rows.map((r) => r.id);
  }

  /** Job IDs whose latest active score result failed (success=false). */
  private activeFailedScoreJobIds(): readonly number[] {
    const rows = this.ctx.db
      .select({ jobId: scoreResults.jobId })
      .from(scoreResults)
      .where(and(eq(scoreResults.active, true), eq(scoreResults.success, false)))
      .all();
    return rows.map((r) => r.jobId);
  }
}

/**
 * Filter shape consumed by `JobRepository.listByState`. Lives next to the repository method so the SQL layer
 * can read + apply refinements without the service layer re-marshalling.
 *
 * `company` and `location` are expected to be already lowercased by the
 * service layer (case-insensitive substring match). `minScore` only
 * applies to states that filter against the score table (`scored`,
 * plus `all` when supplied).
 */
export interface JobListRowFilter {
  readonly state: JobListState;
  readonly limit: number;
  readonly minScore?: number;
  readonly company?: string;
  readonly location?: string;
  readonly runId?: number;
}
