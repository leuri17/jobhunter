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
import { DiagnosticArtifactRepository } from '../../../src/persistence/repositories/diagnostics.js';
import { JobRepository } from '../../../src/persistence/repositories/jobs.js';

const REPO_ROOT = resolve(import.meta.dirname, '..', '..', '..');

function ctxFrom(c: DatabaseConnection) {
  return { db: c.db };
}

describe('DiagnosticArtifactRepository', () => {
  let directory: string;
  let connection: DatabaseConnection;
  let runRepo: PipelineRunRepository;
  let diagRepo: DiagnosticArtifactRepository;
  let runId: number;
  let searchId: number;

  beforeEach(async () => {
    directory = mkdtempSync(join(tmpdir(), 'jobhunter-diagnostics-'));
    connection = createDatabaseConnection(join(directory, 'jobhunter.sqlite'));
    runMigrations(connection, { migrationsFolder: join(REPO_ROOT, 'drizzle') });
    runRepo = new PipelineRunRepository(ctxFrom(connection));
    diagRepo = new DiagnosticArtifactRepository(ctxFrom(connection));
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
    runId = created.runId;
    searchId = created.searchIds[0]!;
  });

  afterEach(() => {
    connection.close();
    rmSync(directory, { recursive: true, force: true });
  });

  it('inserts and finds an artifact by id', async () => {
    const id = await diagRepo.insert({
      pipelineRunId: runId,
      artifactType: 'screenshot',
      storedPath: '/opt/jobhunter/diagnostics/run-1/screenshot.png',
      relativePath: 'run-1/screenshot.png',
      mimeType: 'image/png',
      fileSize: 4096,
      createdAt: '2026-08-05T10:00:00.000Z',
    });
    const row = await diagRepo.findById(id);
    expect(row?.artifactType).toBe('screenshot');
    expect(row?.pipelineRunId).toBe(runId);
  });

  it('listByRun, listBySearch, and listByJob scope correctly', async () => {
    const jobRepo = new JobRepository(ctxFrom(connection));
    const { jobId } = await jobRepo.recordNewJob({
      job: {
        sourceJobId: '123456789',
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
        pipelineRunId: runId,
        searchExecutionId: searchId,
        timestamp: '2026-08-05T10:00:00.000Z',
        isNew: true,
        currentExtractionState: 'complete',
        extractionAttempted: true,
        skipReason: null,
      },
    });
    await diagRepo.insert({
      pipelineRunId: runId,
      searchExecutionId: searchId,
      artifactType: 'screenshot',
      storedPath: '/a',
      relativePath: 'a',
      createdAt: '2026-08-05T10:00:00.000Z',
    });
    await diagRepo.insert({
      pipelineRunId: runId,
      jobId,
      artifactType: 'stack_trace',
      storedPath: '/b',
      relativePath: 'b',
      createdAt: '2026-08-05T10:01:00.000Z',
    });
    expect(await diagRepo.listByRun(runId)).toHaveLength(2);
    expect(await diagRepo.listBySearch(searchId)).toHaveLength(1);
    expect(await diagRepo.listByJob(jobId)).toHaveLength(1);
  });
});
