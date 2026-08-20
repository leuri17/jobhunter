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

describe('JobRepository.findEventsByRun', () => {
  let directory: string;
  let connection: DatabaseConnection;
  let runRepo: PipelineRunRepository;
  let jobRepo: JobRepository;
  let searchId: number;

  beforeEach(async () => {
    directory = mkdtempSync(join(tmpdir(), 'jobhunter-jobs-events-by-run-'));
    connection = createDatabaseConnection(join(directory, 'jobhunter.sqlite'));
    runMigrations(connection, { migrationsFolder: join(REPO_ROOT, 'drizzle') });
    runRepo = new PipelineRunRepository(ctxFrom(connection));
    jobRepo = new JobRepository(ctxFrom(connection));
    const { searchIds, runId } = await runRepo.createRunWithSearches(
      {
        startTimestamp: '2026-08-20T00:00:00.000Z',
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
          startTimestamp: '2026-08-20T00:00:00.000Z',
        },
      ],
    );
    searchId = searchIds[0]!;
    void runId;

    // Insert 3 jobs + 3 discovery events for this run.
    for (let i = 0; i < 3; i += 1) {
      await jobRepo.recordNewJob({
        job: {
          sourceJobId: `job-${i}`,
          extractionStatus: 'failed',
          firstDiscoveryTimestamp: '2026-08-20T00:00:00.000Z',
          lastRediscoveryTimestamp: '2026-08-20T00:00:00.000Z',
          createdTimestamp: '2026-08-20T00:00:00.000Z',
          updatedTimestamp: '2026-08-20T00:00:00.000Z',
        },
        discoveryEvent: {
          jobId: 0,
          pipelineRunId: 1,
          searchExecutionId: searchId,
          timestamp: '2026-08-20T00:00:00.000Z',
          isNew: true,
          currentExtractionState: 'failed',
          extractionAttempted: false,
          skipReason: null,
        },
      });
    }
  });

  afterEach(() => {
    connection.close();
    rmSync(directory, { recursive: true, force: true });
  });

  it('returns the discovery events for the given run in insertion order', async () => {
    const events = await jobRepo.findEventsByRun(1);
    expect(events).toHaveLength(3);
    expect(events.every((e) => e.pipelineRunId === 1)).toBe(true);
    expect(events.every((e) => e.searchExecutionId === searchId)).toBe(true);
    expect(events.every((e) => e.isNew)).toBe(true);
    // The jobs themselves are independently fetchable via the
    // per-event `jobId` to confirm the row order matches insertion.
    const jobIds = events.map((e) => e.jobId);
    const sortedJobIds = [...jobIds].sort((a, b) => a - b);
    expect(jobIds).toEqual(sortedJobIds);
  });

  it('returns an empty list when no events exist for the run', async () => {
    const events = await jobRepo.findEventsByRun(999);
    expect(events).toHaveLength(0);
  });
});