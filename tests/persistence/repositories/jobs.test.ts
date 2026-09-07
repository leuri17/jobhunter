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

  it('throws a UNIQUE constraint error when inserting a second job with the same sourceJobId', async () => {
    const first = await jobRepo.recordNewJob({
      job: {
        sourceJobId: 'dup-1',
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
    expect(first.jobId).toBeGreaterThan(0);

    // Second insert with the same sourceJobId must be rejected by the
    // `jobs_source_job_id_idx` UNIQUE constraint. Mirrors the
    // `DuplicateSha256Error` pattern in `profile-sources.test.ts`.
    await expect(
      jobRepo.recordNewJob({
        job: {
          sourceJobId: 'dup-1',
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
      }),
    ).rejects.toThrow(/UNIQUE constraint failed/i);

    // The original row is still present and untouched.
    expect(await jobRepo.findBySourceJobId('dup-1')).not.toBeNull();
  });

  it('findBySourceJobIds returns the same rows as per-card findBySourceJobId calls', async () => {
    // Insert three jobs with distinct `sourceJobId` values. The
    // batched path must yield exactly the same set (and content) as
    // the per-card PK lookups — Closes #24.
    const ids = ['batch-1', 'batch-2', 'batch-3'];
    for (const sourceJobId of ids) {
      await jobRepo.recordNewJob({
        job: {
          sourceJobId,
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
    }

    // Per-card baseline: one `findBySourceJobId` per id.
    const perCard = new Map<string, Awaited<ReturnType<typeof jobRepo.findBySourceJobId>>>();
    for (const sourceJobId of ids) {
      perCard.set(sourceJobId, await jobRepo.findBySourceJobId(sourceJobId));
    }

    // Batched lookup under test.
    const batched = await jobRepo.findBySourceJobIds(ids);

    // Same length, same set of `sourceJobId`s.
    expect(batched).toHaveLength(perCard.size);
    const batchedIds = new Set(batched.map((r) => r.sourceJobId));
    expect(batchedIds).toEqual(new Set(ids));

    // Every row is byte-for-byte equal to the per-card lookup.
    for (const row of batched) {
      const baseline = perCard.get(row.sourceJobId);
      expect(baseline).not.toBeNull();
      expect(row).toEqual(baseline);
    }
  });

  it('findBySourceJobIds returns an empty array for an empty input (no DB query)', async () => {
    expect(await jobRepo.findBySourceJobIds([])).toEqual([]);
  });

  it('findBySourceJobIds omits ids that do not exist (no error, no row)', async () => {
    await jobRepo.recordNewJob({
      job: {
        sourceJobId: 'present',
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

    const rows = await jobRepo.findBySourceJobIds(['present', 'missing-1', 'missing-2']);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.sourceJobId).toBe('present');
  });

  // ---------------------------------------------------------------------
  // Coverage tests for methods not exercised by the suite above. Each
  // test targets one under-covered method so a future regression (e.g.
  // a renamed column, an accidentally-removed WHERE clause) is caught
  // by the test that actually covers that code path. The vitest-coverage
  // gate (`vitest.config.ts`) enforces per-file thresholds on
  // `src/persistence/repositories/`; these tests close that gap.
  // ---------------------------------------------------------------------

  const FIXTURE_TS = '2026-08-05T10:00:00.000Z';
  async function seedJobAndEvent(sourceJobId: string): Promise<{ jobId: number }> {
    const recorded = await jobRepo.recordNewJob({
      job: {
        sourceJobId,
        extractionStatus: 'complete',
        firstDiscoveryTimestamp: FIXTURE_TS,
        lastRediscoveryTimestamp: FIXTURE_TS,
        createdTimestamp: FIXTURE_TS,
        updatedTimestamp: FIXTURE_TS,
      },
      discoveryEvent: {
        jobId: 0,
        pipelineRunId: 1,
        searchExecutionId: searchId,
        timestamp: FIXTURE_TS,
        isNew: true,
        currentExtractionState: 'complete',
        extractionAttempted: true,
        skipReason: null,
      },
    });
    return { jobId: recorded.jobId };
  }

  it('findBySourceJobId returns the job row for a registered sourceJobId', async () => {
    await seedJobAndEvent('find-1');
    const row = await jobRepo.findBySourceJobId('find-1');
    expect(row?.sourceJobId).toBe('find-1');
    expect(row?.extractionStatus).toBe('complete');
    expect(await jobRepo.findBySourceJobId('missing')).toBeNull();
  });

  it('findById returns the job row for a registered id and null otherwise', async () => {
    const { jobId } = await seedJobAndEvent('findbyid-1');
    const row = await jobRepo.findById(jobId);
    expect(row?.id).toBe(jobId);
    expect(row?.sourceJobId).toBe('findbyid-1');
    expect(await jobRepo.findById(99_999_999)).toBeNull();
  });

  it('recordDiscoveryEvent inserts a row and returns the new id', async () => {
    const { jobId } = await seedJobAndEvent('rec-evt-1');
    const id = await jobRepo.recordDiscoveryEvent({
      jobId,
      pipelineRunId: 1,
      searchExecutionId: searchId,
      timestamp: FIXTURE_TS,
      isNew: false,
      currentExtractionState: 'partial',
      extractionAttempted: true,
      skipReason: 'panel_timeout',
    });
    expect(id).toBeGreaterThan(0);
  });

  it('updateDiscoveryEvent merges a partial patch (only the keys provided are persisted)', async () => {
    const { jobId } = await seedJobAndEvent('upd-evt-1');
    const evId = await jobRepo.recordDiscoveryEvent({
      jobId,
      pipelineRunId: 1,
      searchExecutionId: searchId,
      timestamp: FIXTURE_TS,
      isNew: true,
      currentExtractionState: 'complete',
      extractionAttempted: true,
      skipReason: null,
    });
    await jobRepo.updateDiscoveryEvent(evId, { currentExtractionState: 'failed' });
    // findLatestDiscoveryEventByJobAndSearch confirms the row
    const after = await jobRepo.findLatestDiscoveryEventByJobAndSearch(jobId, searchId);
    expect(after?.currentExtractionState).toBe('failed');
    // Unrelated fields untouched
    expect(after?.extractionAttempted).toBe(true);
  });

  it('findLatestDiscoveryEventByJobAndSearch returns null when no event matches', async () => {
    const { jobId } = await seedJobAndEvent('latest-evt-1');
    expect(await jobRepo.findLatestDiscoveryEventByJobAndSearch(jobId, 99_999)).toBeNull();
  });

  it('listDiscoveryEventsByJob returns every event for the job in id order', async () => {
    const { jobId } = await seedJobAndEvent('list-evt-1');
    await jobRepo.recordDiscoveryEvent({
      jobId,
      pipelineRunId: 1,
      searchExecutionId: searchId,
      timestamp: FIXTURE_TS,
      isNew: false,
      currentExtractionState: 'partial',
      extractionAttempted: true,
      skipReason: null,
    });
    const events = await jobRepo.listDiscoveryEventsByJob(jobId);
    expect(events).toHaveLength(2);
    expect(events[0]?.id).toBeLessThan(events[1]!.id);
  });

  it('listDiscoveryEventsByRun returns every event for the run', async () => {
    await seedJobAndEvent('list-evt-run-1');
    const events = await jobRepo.listDiscoveryEventsByRun(1);
    expect(events.length).toBeGreaterThan(0);
  });

  it('listDiscoveryErrorsByRun returns the recorded errors', async () => {
    const errorId = await jobRepo.recordDiscoveryError({
      pipelineRunId: 1,
      searchExecutionId: searchId,
      cardIndex: 7,
      cardPosition: null,
      availableMetadata: null,
      artifactRefs: null,
      errorCode: 'extraction_failed',
      diagnosticMessage: 'panel-parse failed',
      timestamp: FIXTURE_TS,
    });
    expect(errorId).toBeGreaterThan(0);
    const errors = await jobRepo.listDiscoveryErrorsByRun(1);
    expect(errors.find((e) => e.id === errorId)).toBeDefined();
  });

  it('recordExtractionAttempt + listExtractionAttemptsByJob round-trip', async () => {
    const { jobId } = await seedJobAndEvent('record-attempt-1');
    const attemptId = await jobRepo.recordExtractionAttempt({
      jobId,
      pipelineRunId: 1,
      searchExecutionId: searchId,
      attemptTimestamp: FIXTURE_TS,
      method: 'search_detail_panel',
      attemptNumber: 1,
      success: false,
      errorCode: 'panel_timeout',
      errorMessage: 'timed out after 30s',
    });
    expect(attemptId).toBeGreaterThan(0);
    const attempts = await jobRepo.listExtractionAttemptsByJob(jobId);
    expect(attempts.find((a) => a.id === attemptId)?.errorCode).toBe('panel_timeout');
  });

  it('listByState returns the empty array for the failed state (sourced from discoveryErrors)', async () => {
    expect(await jobRepo.listByState({ state: 'failed', limit: 10 })).toEqual([]);
  });

  it('listByState returns the empty array for the failed state (sourced from discoveryErrors) and the seeded row for the all state', async () => {
    await seedJobAndEvent('listbystate-1');
    expect(await jobRepo.listByState({ state: 'failed', limit: 10 })).toEqual([]);
    // The 'all' state is the union of extractionStatus=complete jobs;
    // the seed above uses that status. State-specific joins
    // ('scored', 'accepted', etc.) require score_results /
    // filter_results rows and are exercised end-to-end by
    // tests/inspection/services/jobs-list-service.test.ts.
    const all = await jobRepo.listByState({ state: 'all', limit: 10 });
    expect(all.find((j) => j.sourceJobId === 'listbystate-1')).toBeDefined();
  });

  it('findBySourceJobIdOrId resolves job_<int>, a numeric sourceJobId, and rejects garbage', async () => {
    const { jobId } = await seedJobAndEvent('3857123456');
    expect((await jobRepo.findBySourceJobIdOrId(`job_${jobId}`))?.id).toBe(jobId);
    // The numeric branch parses with NUMERIC_JOB_PATTERN; reuse
    // the LinkedIn-shape jobId string as both the storage sourceJobId
    // and the lookup key (this is the shape the function is designed for).
    expect((await jobRepo.findBySourceJobIdOrId('3857123456'))?.sourceJobId).toBe('3857123456');
    expect(await jobRepo.findBySourceJobIdOrId('')).toBeNull();
    expect(await jobRepo.findBySourceJobIdOrId('   ')).toBeNull();
    expect(await jobRepo.findBySourceJobIdOrId('plain-string-not-in-table')).toBeNull();
    expect(await jobRepo.findBySourceJobIdOrId('job_abc')).toBeNull();
  });

  it('discoveryErrorCountByRun returns the recorded count', async () => {
    expect(await jobRepo.discoveryErrorCountByRun(1)).toBe(0);
    await jobRepo.recordDiscoveryError({
      pipelineRunId: 1,
      searchExecutionId: searchId,
      cardIndex: 1,
      cardPosition: null,
      availableMetadata: null,
      artifactRefs: null,
      errorCode: 'extraction_failed',
      diagnosticMessage: 'x',
      timestamp: FIXTURE_TS,
    });
    expect(await jobRepo.discoveryErrorCountByRun(1)).toBe(1);
  });
});
