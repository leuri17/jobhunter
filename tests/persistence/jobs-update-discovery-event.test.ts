/**
 * Tests for `JobRepository.updateDiscoveryEvent` +
 * `JobRepository.findLatestDiscoveryEventByJobAndSearch`
 *
 * Both methods are method additions — no schema/migration change.
 * The tests exercise them against a real SQLite database via
 * `mkdtempSync` + `createDatabaseConnection` + `runMigrations` +
 * the existing `JobRepository.recordNewJob` + `recordDiscoveryEvent`
 * methods, mirroring `tests/persistence/repositories/jobs.test.ts`.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { runMigrations } from '../../src/persistence/migrations.js';
import {
  createDatabaseConnection,
  type DatabaseConnection,
} from '../../src/persistence/connection.js';
import { JobRepository } from '../../src/persistence/repositories/jobs.js';
import { PipelineRunRepository } from '../../src/persistence/repositories/pipeline-runs.js';

const REPO_ROOT = resolve(import.meta.dirname, '..', '..');

function ctxFrom(c: DatabaseConnection) {
  return { db: c.db };
}

describe('JobRepository.updateDiscoveryEvent + findLatestDiscoveryEventByJobAndSearch', () => {
  let directory: string;
  let connection: DatabaseConnection;
  let runRepo: PipelineRunRepository;
  let jobRepo: JobRepository;
  let searchExecutionId: number;
  let pipelineRunId: number;

  beforeEach(async () => {
    directory = mkdtempSync(join(tmpdir(), 'jobhunter-jobs-update-event-'));
    connection = createDatabaseConnection(join(directory, 'jobhunter.sqlite'));
    runMigrations(connection, { migrationsFolder: join(REPO_ROOT, 'drizzle') });
    runRepo = new PipelineRunRepository(ctxFrom(connection));
    jobRepo = new JobRepository(ctxFrom(connection));
    const created = await runRepo.createRunWithSearches(
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
    pipelineRunId = created.runId;
    searchExecutionId = created.searchIds[0]!;
  });

  afterEach(() => {
    connection.close();
    rmSync(directory, { recursive: true, force: true });
  });

  it('updateDiscoveryEvent patches the existing row (currentExtractionState + extractionAttempted)', async () => {
    const { jobId, discoveryEventId } = await jobRepo.recordNewJob({
      job: {
        sourceJobId: '1234567890',
        extractionStatus: 'failed',
        firstDiscoveryTimestamp: '2026-08-05T10:00:00.000Z',
        lastRediscoveryTimestamp: '2026-08-05T10:00:00.000Z',
        createdTimestamp: '2026-08-05T10:00:00.000Z',
        updatedTimestamp: '2026-08-05T10:00:00.000Z',
      },
      discoveryEvent: {
        jobId: 0,
        pipelineRunId,
        searchExecutionId,
        timestamp: '2026-08-05T10:00:00.000Z',
        isNew: true,
        currentExtractionState: 'failed',
        extractionAttempted: false,
        skipReason: null,
      },
    });
    expect(discoveryEventId).toBeGreaterThan(0);

    await jobRepo.updateDiscoveryEvent(discoveryEventId, {
      currentExtractionState: 'complete',
      extractionAttempted: true,
    });

    const events = await jobRepo.listDiscoveryEventsByJob(jobId);
    expect(events).toHaveLength(1);
    const event = events[0]!;
    expect(event.id).toBe(discoveryEventId);
    expect(event.currentExtractionState).toBe('complete');
    expect(event.extractionAttempted).toBe(true);
    // `skipReason` was not in the patch — must be preserved.
    expect(event.skipReason).toBeNull();
    // The other fields are also preserved.
    expect(event.pipelineRunId).toBe(pipelineRunId);
    expect(event.searchExecutionId).toBe(searchExecutionId);
    expect(event.timestamp).toBe('2026-08-05T10:00:00.000Z');
    expect(event.isNew).toBe(true);
    void jobId;
  });

  it('updateDiscoveryEvent patches skipReason when supplied alone', async () => {
    const { jobId, discoveryEventId } = await jobRepo.recordNewJob({
      job: {
        sourceJobId: '1234567891',
        extractionStatus: 'failed',
        firstDiscoveryTimestamp: '2026-08-05T10:00:00.000Z',
        lastRediscoveryTimestamp: '2026-08-05T10:00:00.000Z',
        createdTimestamp: '2026-08-05T10:00:00.000Z',
        updatedTimestamp: '2026-08-05T10:00:00.000Z',
      },
      discoveryEvent: {
        jobId: 0,
        pipelineRunId,
        searchExecutionId,
        timestamp: '2026-08-05T10:00:00.000Z',
        isNew: false,
        currentExtractionState: 'complete',
        extractionAttempted: false,
        skipReason: null,
      },
    });
    await jobRepo.updateDiscoveryEvent(discoveryEventId, {
      skipReason: 'complete_job_already_exists',
    });
    const events = await jobRepo.listDiscoveryEventsByJob(jobId);
    const event = events[0]!;
    expect(event.skipReason).toBe('complete_job_already_exists');
    expect(event.currentExtractionState).toBe('complete');
    expect(event.extractionAttempted).toBe(false);
  });

  it('updateDiscoveryEvent preserves history (no cascading side-effects)', async () => {
    const { discoveryEventId } = await jobRepo.recordNewJob({
      job: {
        sourceJobId: '1234567892',
        extractionStatus: 'partial',
        firstDiscoveryTimestamp: '2026-08-05T10:00:00.000Z',
        lastRediscoveryTimestamp: '2026-08-05T10:00:00.000Z',
        createdTimestamp: '2026-08-05T10:00:00.000Z',
        updatedTimestamp: '2026-08-05T10:00:00.000Z',
      },
      discoveryEvent: {
        jobId: 0,
        pipelineRunId,
        searchExecutionId,
        timestamp: '2026-08-05T10:00:00.000Z',
        isNew: true,
        currentExtractionState: 'partial',
        extractionAttempted: true,
        skipReason: null,
      },
    });
    // Patch only one field.
    await jobRepo.updateDiscoveryEvent(discoveryEventId, {
      skipReason: 'partial_job_already_exists',
    });
    const events = await jobRepo.listDiscoveryEventsByRun(pipelineRunId);
    expect(events).toHaveLength(1);
    expect(events[0]?.skipReason).toBe('partial_job_already_exists');
    expect(events[0]?.currentExtractionState).toBe('partial');
    expect(events[0]?.extractionAttempted).toBe(true);
  });

  it('updateDiscoveryEvent is a no-op when the patch is empty (no fields to update)', async () => {
    const { discoveryEventId } = await jobRepo.recordNewJob({
      job: {
        sourceJobId: '1234567893',
        extractionStatus: 'complete',
        firstDiscoveryTimestamp: '2026-08-05T10:00:00.000Z',
        lastRediscoveryTimestamp: '2026-08-05T10:00:00.000Z',
        createdTimestamp: '2026-08-05T10:00:00.000Z',
        updatedTimestamp: '2026-08-05T10:00:00.000Z',
      },
      discoveryEvent: {
        jobId: 0,
        pipelineRunId,
        searchExecutionId,
        timestamp: '2026-08-05T10:00:00.000Z',
        isNew: true,
        currentExtractionState: 'complete',
        extractionAttempted: true,
        skipReason: 'foo',
      },
    });
    await jobRepo.updateDiscoveryEvent(discoveryEventId, {});
    const events = await jobRepo.listDiscoveryEventsByRun(pipelineRunId);
    expect(events[0]?.skipReason).toBe('foo');
    expect(events[0]?.currentExtractionState).toBe('complete');
    expect(events[0]?.extractionAttempted).toBe(true);
  });

  it('findLatestDiscoveryEventByJobAndSearch returns the most recent (highest id) row', async () => {
    const { jobId, discoveryEventId: firstId } = await jobRepo.recordNewJob({
      job: {
        sourceJobId: '1234567894',
        extractionStatus: 'failed',
        firstDiscoveryTimestamp: '2026-08-05T10:00:00.000Z',
        lastRediscoveryTimestamp: '2026-08-05T10:00:00.000Z',
        createdTimestamp: '2026-08-05T10:00:00.000Z',
        updatedTimestamp: '2026-08-05T10:00:00.000Z',
      },
      discoveryEvent: {
        jobId: 0,
        pipelineRunId,
        searchExecutionId,
        timestamp: '2026-08-05T10:00:00.000Z',
        isNew: true,
        currentExtractionState: 'failed',
        extractionAttempted: false,
        skipReason: null,
      },
    });

    // Insert a SECOND event for the same (job, search) pair — the
    // typical pattern: re-discovery of the same job. The second
    // row must win.
    const secondId = await jobRepo.recordDiscoveryEvent({
      jobId,
      pipelineRunId,
      searchExecutionId,
      timestamp: '2026-08-05T10:05:00.000Z',
      isNew: false,
      currentExtractionState: 'failed',
      extractionAttempted: false,
      skipReason: null,
    });
    expect(secondId).toBeGreaterThan(firstId);

    const latest = await jobRepo.findLatestDiscoveryEventByJobAndSearch(jobId, searchExecutionId);
    expect(latest).not.toBeNull();
    expect(latest?.id).toBe(secondId);
    expect(latest?.timestamp).toBe('2026-08-05T10:05:00.000Z');
  });

  it('findLatestDiscoveryEventByJobAndSearch returns null when no event exists', async () => {
    const { jobId } = await jobRepo.recordNewJob({
      job: {
        sourceJobId: '1234567895',
        extractionStatus: 'failed',
        firstDiscoveryTimestamp: '2026-08-05T10:00:00.000Z',
        lastRediscoveryTimestamp: '2026-08-05T10:00:00.000Z',
        createdTimestamp: '2026-08-05T10:00:00.000Z',
        updatedTimestamp: '2026-08-05T10:00:00.000Z',
      },
      discoveryEvent: {
        jobId: 0,
        pipelineRunId,
        searchExecutionId,
        timestamp: '2026-08-05T10:00:00.000Z',
        isNew: true,
        currentExtractionState: 'failed',
        extractionAttempted: false,
        skipReason: null,
      },
    });
    // Delete the row out from under the test — simulates the data-
    // integrity case the orchestrator guards against.
    connection.db.delete(discoveryEventsTable).where(eqId(jobId)).run();

    const result = await jobRepo.findLatestDiscoveryEventByJobAndSearch(jobId, searchExecutionId);
    expect(result).toBeNull();
  });

  it('findLatestDiscoveryEventByJobAndSearch isolates by (jobId, searchExecutionId) — different search returns null', async () => {
    const { jobId } = await jobRepo.recordNewJob({
      job: {
        sourceJobId: '1234567896',
        extractionStatus: 'failed',
        firstDiscoveryTimestamp: '2026-08-05T10:00:00.000Z',
        lastRediscoveryTimestamp: '2026-08-05T10:00:00.000Z',
        createdTimestamp: '2026-08-05T10:00:00.000Z',
        updatedTimestamp: '2026-08-05T10:00:00.000Z',
      },
      discoveryEvent: {
        jobId: 0,
        pipelineRunId,
        searchExecutionId,
        timestamp: '2026-08-05T10:00:00.000Z',
        isNew: true,
        currentExtractionState: 'failed',
        extractionAttempted: false,
        skipReason: null,
      },
    });

    const otherSearchId = 99999;
    const result = await jobRepo.findLatestDiscoveryEventByJobAndSearch(jobId, otherSearchId);
    expect(result).toBeNull();
  });

  it('findLatestDiscoveryEventByJobAndSearch isolates by jobId — different job returns null', async () => {
    await jobRepo.recordNewJob({
      job: {
        sourceJobId: '1234567897',
        extractionStatus: 'failed',
        firstDiscoveryTimestamp: '2026-08-05T10:00:00.000Z',
        lastRediscoveryTimestamp: '2026-08-05T10:00:00.000Z',
        createdTimestamp: '2026-08-05T10:00:00.000Z',
        updatedTimestamp: '2026-08-05T10:00:00.000Z',
      },
      discoveryEvent: {
        jobId: 0,
        pipelineRunId,
        searchExecutionId,
        timestamp: '2026-08-05T10:00:00.000Z',
        isNew: true,
        currentExtractionState: 'failed',
        extractionAttempted: false,
        skipReason: null,
      },
    });
    const result = await jobRepo.findLatestDiscoveryEventByJobAndSearch(99999, searchExecutionId);
    expect(result).toBeNull();
  });
});

// Local imports for the negative-path test (kept here so the
// test body reads top-down without external helpers).
import { eq } from 'drizzle-orm';
import { discoveryEvents as discoveryEventsTable } from '../../src/persistence/schema.js';

function eqId(jobId: number) {
  return eq(discoveryEventsTable.jobId, jobId);
}
