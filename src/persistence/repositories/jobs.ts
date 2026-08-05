import { eq } from 'drizzle-orm';
import { z } from 'zod';

import { discoveryErrors, discoveryEvents, extractionAttempts, jobs } from '../schema.js';
import { jsonColumn } from './codecs.js';
import type { RepositoryContext } from './types.js';

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

function discoveryEventRowFromRecord(record: typeof discoveryEvents.$inferSelect): DiscoveryEventRow {
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

function discoveryErrorRowFromRecord(record: typeof discoveryErrors.$inferSelect): DiscoveryErrorRow {
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

function extractionAttemptRowFromRecord(record: typeof extractionAttempts.$inferSelect): ExtractionAttemptRow {
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
      if (eventRow === undefined) throw new Error('recordNewJob: discovery event insert returned no rows');

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
        if (attemptRow === undefined) throw new Error('recordNewJob: extraction attempt insert returned no rows');
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

  async findById(id: number): Promise<JobRow | null> {
    const rows = this.ctx.db.select().from(jobs).where(eq(jobs.id, id)).all();
    const row = rows[0];
    return row === undefined ? null : jobRowFromRecord(row);
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
      if (patch.lastRediscoveryTimestamp !== undefined) update.lastRediscoveryTimestamp = patch.lastRediscoveryTimestamp;
      if (patch.lastExtractionAttemptTimestamp !== undefined) update.lastExtractionAttemptTimestamp = patch.lastExtractionAttemptTimestamp;
      if (patch.updatedTimestamp !== undefined) update.updatedTimestamp = patch.updatedTimestamp;
      tx.update(jobs).set(update).where(eq(jobs.id, id)).run();
    });
  }

  async recordDiscoveryEvent(input: Omit<DiscoveryEventRow, 'id'>): Promise<number> {
    const result = this.ctx.db.insert(discoveryEvents).values({
      jobId: input.jobId,
      pipelineRunId: input.pipelineRunId,
      searchExecutionId: input.searchExecutionId,
      timestamp: input.timestamp,
      isNew: input.isNew,
      currentExtractionState: input.currentExtractionState,
      extractionAttempted: input.extractionAttempted,
      skipReason: input.skipReason,
    }).returning({ id: discoveryEvents.id }).all();
    const row = result[0];
    if (row === undefined) throw new Error('recordDiscoveryEvent returned no rows');
    return row.id;
  }

  async listDiscoveryEventsByJob(jobId: number): Promise<readonly DiscoveryEventRow[]> {
    const rows = this.ctx.db.select().from(discoveryEvents).where(eq(discoveryEvents.jobId, jobId)).all();
    return rows.map(discoveryEventRowFromRecord);
  }

  async listDiscoveryEventsByRun(pipelineRunId: number): Promise<readonly DiscoveryEventRow[]> {
    const rows = this.ctx.db.select().from(discoveryEvents).where(eq(discoveryEvents.pipelineRunId, pipelineRunId)).all();
    return rows.map(discoveryEventRowFromRecord);
  }

  async recordDiscoveryError(input: Omit<DiscoveryErrorRow, 'id'>): Promise<number> {
    const result = this.ctx.db.insert(discoveryErrors).values({
      pipelineRunId: input.pipelineRunId,
      searchExecutionId: input.searchExecutionId,
      cardPosition: input.cardPosition,
      cardIndex: input.cardIndex,
      availableMetadataJson: input.availableMetadata === undefined || input.availableMetadata === null ? null : unknownJson.encode(input.availableMetadata),
      errorCode: input.errorCode,
      diagnosticMessage: input.diagnosticMessage,
      timestamp: input.timestamp,
      artifactRefsJson: input.artifactRefs === undefined || input.artifactRefs === null ? null : unknownJson.encode(input.artifactRefs),
    }).returning({ id: discoveryErrors.id }).all();
    const row = result[0];
    if (row === undefined) throw new Error('recordDiscoveryError returned no rows');
    return row.id;
  }

  async listDiscoveryErrorsByRun(pipelineRunId: number): Promise<readonly DiscoveryErrorRow[]> {
    const rows = this.ctx.db.select().from(discoveryErrors).where(eq(discoveryErrors.pipelineRunId, pipelineRunId)).all();
    return rows.map(discoveryErrorRowFromRecord);
  }

  async recordExtractionAttempt(input: Omit<ExtractionAttemptRow, 'id'>): Promise<number> {
    const result = this.ctx.db.insert(extractionAttempts).values({
      jobId: input.jobId,
      pipelineRunId: input.pipelineRunId,
      searchExecutionId: input.searchExecutionId,
      attemptTimestamp: input.attemptTimestamp,
      method: input.method,
      attemptNumber: input.attemptNumber,
      success: input.success,
      errorCode: input.errorCode,
      errorMessage: input.errorMessage,
    }).returning({ id: extractionAttempts.id }).all();
    const row = result[0];
    if (row === undefined) throw new Error('recordExtractionAttempt returned no rows');
    return row.id;
  }

  async listExtractionAttemptsByJob(jobId: number): Promise<readonly ExtractionAttemptRow[]> {
    const rows = this.ctx.db.select().from(extractionAttempts).where(eq(extractionAttempts.jobId, jobId)).all();
    return rows.map(extractionAttemptRowFromRecord);
  }
}
