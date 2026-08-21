import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runMigrations } from '../../../src/persistence/migrations.js';
import {
  createDatabaseConnection,
  type DatabaseConnection,
} from '../../../src/persistence/connection.js';
import { PipelineRunRepository } from '../../../src/persistence/repositories/pipeline-runs.js';
import { JobRepository } from '../../../src/persistence/repositories/jobs.js';

const REPO_ROOT = resolve(import.meta.dirname, '..', '..', '..');

function ctxFrom(c: DatabaseConnection) {
  return { db: c.db };
}

describe('JobRepository', () => {
  let directory: string;
  let connection: DatabaseConnection;
  let runRepo: PipelineRunRepository;
  let jobRepo: JobRepository;
  let searchId: number;

  beforeEach(async () => {
    directory = mkdtempSync(join(tmpdir(), 'jobhunter-jobs-'));
    connection = createDatabaseConnection(join(directory, 'jobhunter.sqlite'));
    runMigrations(connection, { migrationsFolder: join(REPO_ROOT, 'drizzle') });
    runRepo = new PipelineRunRepository(ctxFrom(connection));
    jobRepo = new JobRepository(ctxFrom(connection));
    const { searchIds } = await runRepo.createRunWithSearches(
      {
        startTimestamp: '2026-08-05T10:00:00.000Z',
        configSnapshotJson: {},
        configSchemaVersion: 1,
        configHash: 'h',
        applicationVersion: '0.1.0',
      },
      [
        {
          pipelineRunId: 0,
          searchQuery: 'q',
          locationName: 'L',
          geoId: '1',
          generatedUrl: 'https://www.linkedin.com/jobs/search/?q=q',
          startTimestamp: '2026-08-05T10:00:00.000Z',
        },
      ],
    );
    searchId = searchIds[0]!;
  });

  afterEach(() => {
    connection.close();
    rmSync(directory, { recursive: true, force: true });
  });

  it('recordNewJob atomically creates a job, discovery event, and extraction attempt', async () => {
    const result = await jobRepo.recordNewJob({
      job: {
        sourceJobId: '123',
        extractionStatus: 'complete',
        firstDiscoveryTimestamp: '2026-08-05T10:00:00.000Z',
        lastRediscoveryTimestamp: '2026-08-05T10:00:00.000Z',
        title: 'Engineer',
        company: 'Acme',
        location: 'Rotterdam',
        description: 'desc',
        successfulMethod: 'search_detail_panel',
        createdTimestamp: '2026-08-05T10:00:00.000Z',
        updatedTimestamp: '2026-08-05T10:00:00.000Z',
      },
      discoveryEvent: {
        jobId: 0,
        pipelineRunId: 1,
        searchExecutionId: searchId,
        timestamp: '2026-08-05T10:00:00.000Z',
        isNew: true,
        currentExtractionState: 'complete',
        extractionAttempted: true,
        skipReason: null,
      },
      extractionAttempt: {
        jobId: 0,
        pipelineRunId: 1,
        searchExecutionId: searchId,
        attemptTimestamp: '2026-08-05T10:00:00.000Z',
        method: 'search_detail_panel',
        attemptNumber: 1,
        success: true,
        errorCode: null,
        errorMessage: null,
      },
    });
    expect(result.jobId).toBeGreaterThan(0);
    expect(result.discoveryEventId).toBeGreaterThan(0);
    expect(result.extractionAttemptId).toBeGreaterThan(0);

    const job = await jobRepo.findBySourceJobId('123');
    expect(job?.title).toBe('Engineer');
    expect(await jobRepo.listDiscoveryEventsByJob(result.jobId)).toHaveLength(1);
    expect(await jobRepo.listExtractionAttemptsByJob(result.jobId)).toHaveLength(1);
  });

  it('recordNewJob rolls back when the discovery event fails (FK violation)', async () => {
    await expect(
      jobRepo.recordNewJob({
        job: {
          sourceJobId: '456',
          extractionStatus: 'complete',
          firstDiscoveryTimestamp: '2026-08-05T10:00:00.000Z',
          lastRediscoveryTimestamp: '2026-08-05T10:00:00.000Z',
          createdTimestamp: '2026-08-05T10:00:00.000Z',
          updatedTimestamp: '2026-08-05T10:00:00.000Z',
        },
        discoveryEvent: {
          jobId: 0,
          pipelineRunId: 999999,
          searchExecutionId: searchId,
          timestamp: '2026-08-05T10:00:00.000Z',
          isNew: true,
          currentExtractionState: 'complete',
          extractionAttempted: false,
          skipReason: null,
        },
      }),
    ).rejects.toThrow();
    expect(await jobRepo.findBySourceJobId('456')).toBeNull();
  });

  it('updateExtraction preserves history and updates fields', async () => {
    const { jobId } = await jobRepo.recordNewJob({
      job: {
        sourceJobId: '789',
        extractionStatus: 'partial',
        firstDiscoveryTimestamp: '2026-08-05T10:00:00.000Z',
        lastRediscoveryTimestamp: '2026-08-05T10:00:00.000Z',
        createdTimestamp: '2026-08-05T10:00:00.000Z',
        updatedTimestamp: '2026-08-05T10:00:00.000Z',
      },
      discoveryEvent: {
        jobId: 0,
        pipelineRunId: 1,
        searchExecutionId: searchId,
        timestamp: '2026-08-05T10:00:00.000Z',
        isNew: true,
        currentExtractionState: 'partial',
        extractionAttempted: true,
        skipReason: null,
      },
    });
    await jobRepo.updateExtraction(jobId, {
      title: 'New Title',
      description: 'Full description',
      extractionStatus: 'complete',
      successfulMethod: 'search_detail_panel',
      lastExtractionAttemptTimestamp: '2026-08-05T10:05:00.000Z',
      updatedTimestamp: '2026-08-05T10:05:00.000Z',
    });
    const job = await jobRepo.findById(jobId);
    expect(job?.title).toBe('New Title');
    expect(job?.extractionStatus).toBe('complete');
    expect(job?.lastExtractionAttemptTimestamp).toBe('2026-08-05T10:05:00.000Z');
  });

  it('records discovery errors and extraction attempts independently', async () => {
    const errorId = await jobRepo.recordDiscoveryError({
      pipelineRunId: 1,
      searchExecutionId: searchId,
      cardPosition: 1,
      cardIndex: 0,
      availableMetadata: null,
      errorCode: 'card_unparseable',
      diagnosticMessage: 'No source job id',
      timestamp: '2026-08-05T10:00:00.000Z',
      artifactRefs: null,
    });
    expect(errorId).toBeGreaterThan(0);
    expect(await jobRepo.listDiscoveryErrorsByRun(1)).toHaveLength(1);
  });

  it('listComplete returns only rows with extractionStatus=complete, ordered by id ASC', async () => {
    // Three jobs in mixed extraction states; listComplete must return
    // only the two complete ones in insertion order (id ASC).
    const complete1 = await jobRepo.recordNewJob({
      job: {
        sourceJobId: 'c-1',
        extractionStatus: 'complete',
        firstDiscoveryTimestamp: '2026-08-05T10:00:00.000Z',
        lastRediscoveryTimestamp: '2026-08-05T10:00:00.000Z',
        createdTimestamp: '2026-08-05T10:00:00.000Z',
        updatedTimestamp: '2026-08-05T10:00:00.000Z',
      },
      discoveryEvent: {
        jobId: 0,
        pipelineRunId: 1,
        searchExecutionId: searchId,
        timestamp: '2026-08-05T10:00:00.000Z',
        isNew: true,
        currentExtractionState: 'complete',
        extractionAttempted: true,
        skipReason: null,
      },
    });
    await jobRepo.recordNewJob({
      job: {
        sourceJobId: 'p-1',
        extractionStatus: 'partial',
        firstDiscoveryTimestamp: '2026-08-05T10:01:00.000Z',
        lastRediscoveryTimestamp: '2026-08-05T10:01:00.000Z',
        createdTimestamp: '2026-08-05T10:01:00.000Z',
        updatedTimestamp: '2026-08-05T10:01:00.000Z',
      },
      discoveryEvent: {
        jobId: 0,
        pipelineRunId: 1,
        searchExecutionId: searchId,
        timestamp: '2026-08-05T10:01:00.000Z',
        isNew: true,
        currentExtractionState: 'partial',
        extractionAttempted: true,
        skipReason: null,
      },
    });
    const complete2 = await jobRepo.recordNewJob({
      job: {
        sourceJobId: 'c-2',
        extractionStatus: 'complete',
        firstDiscoveryTimestamp: '2026-08-05T10:02:00.000Z',
        lastRediscoveryTimestamp: '2026-08-05T10:02:00.000Z',
        createdTimestamp: '2026-08-05T10:02:00.000Z',
        updatedTimestamp: '2026-08-05T10:02:00.000Z',
      },
      discoveryEvent: {
        jobId: 0,
        pipelineRunId: 1,
        searchExecutionId: searchId,
        timestamp: '2026-08-05T10:02:00.000Z',
        isNew: true,
        currentExtractionState: 'complete',
        extractionAttempted: true,
        skipReason: null,
      },
    });
    await jobRepo.recordNewJob({
      job: {
        sourceJobId: 'f-1',
        extractionStatus: 'failed',
        firstDiscoveryTimestamp: '2026-08-05T10:03:00.000Z',
        lastRediscoveryTimestamp: '2026-08-05T10:03:00.000Z',
        createdTimestamp: '2026-08-05T10:03:00.000Z',
        updatedTimestamp: '2026-08-05T10:03:00.000Z',
      },
      discoveryEvent: {
        jobId: 0,
        pipelineRunId: 1,
        searchExecutionId: searchId,
        timestamp: '2026-08-05T10:03:00.000Z',
        isNew: true,
        currentExtractionState: 'failed',
        extractionAttempted: false,
        skipReason: 'card_unparseable',
      },
    });

    const completeRows = await jobRepo.listComplete();
    expect(completeRows).toHaveLength(2);
    expect(completeRows.map((r) => r.id)).toEqual([complete1.jobId, complete2.jobId]);
    expect(completeRows.every((r) => r.extractionStatus === 'complete')).toBe(true);
  });

  it('listComplete returns an empty array when no rows exist', async () => {
    expect(await jobRepo.listComplete()).toEqual([]);
  });
});
