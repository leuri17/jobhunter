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

const REPO_ROOT = resolve(import.meta.dirname, '..', '..', '..');

function ctxFrom(c: DatabaseConnection) {
  return { db: c.db };
}

describe('PipelineRunRepository', () => {
  let directory: string;
  let connection: DatabaseConnection;
  let repo: PipelineRunRepository;

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'jobhunter-pipeline-runs-'));
    connection = createDatabaseConnection(join(directory, 'jobhunter.sqlite'));
    runMigrations(connection, { migrationsFolder: join(REPO_ROOT, 'drizzle') });
    repo = new PipelineRunRepository(ctxFrom(connection));
  });

  afterEach(() => {
    connection.close();
    rmSync(directory, { recursive: true, force: true });
  });

  it('createRunWithSearches atomically persists a run and its searches', async () => {
    const { runId, searchIds } = await repo.createRunWithSearches(
      {
        startTimestamp: '2026-08-05T10:00:00.000Z',
        configSnapshotJson: { version: 1 },
        configSchemaVersion: 1,
        configHash: 'cfg-hash',
        applicationVersion: '0.1.0',
      },
      [
        {
          pipelineRunId: 0, // ignored by repo
          searchQuery: 'engineer',
          locationName: 'Rotterdam',
          geoId: '100467493',
          generatedUrl: 'https://www.linkedin.com/jobs/search/?keywords=engineer&geoId=100467493',
          startTimestamp: '2026-08-05T10:00:00.000Z',
        },
        {
          pipelineRunId: 0,
          searchQuery: 'scientist',
          locationName: 'Amsterdam',
          geoId: '100467494',
          generatedUrl: 'https://www.linkedin.com/jobs/search/?keywords=scientist&geoId=100467494',
          startTimestamp: '2026-08-05T10:00:00.000Z',
        },
      ],
    );
    expect(runId).toBeGreaterThan(0);
    expect(searchIds).toHaveLength(2);

    const run = await repo.findRunById(runId);
    expect(run?.status).toBe('running');
    const searches = await repo.listSearchesByRun(runId);
    expect(searches).toHaveLength(2);
    expect(searches.map((s) => s.searchQuery).sort()).toEqual(['engineer', 'scientist']);
  });

  it('createRunWithSearches rolls back when the in-tx write fails (no orphan rows)', async () => {
    // The repository overrides each search's pipelineRunId to the just-created
    // run id, so a user-supplied bad pipelineRunId does NOT trigger an FK
    // violation. To exercise the rollback path we wrap the real database
    // connection with a transaction shim that throws after the run insert
    // see the implementation note in  §Task 5 ("an explicit throw
    // inside a wrapping test fixture").
    const db = connection.db;
    const originalTransaction = db.transaction.bind(db);
    let txCallCount = 0;
    (db as unknown as { transaction: typeof db.transaction }).transaction = ((
      cb: (tx: typeof db) => unknown,
    ) => {
      txCallCount += 1;
      if (txCallCount === 1) {
        return originalTransaction((tx) => {
          cb(tx);
          // Force the in-flight transaction to roll back.
          throw new Error('simulated search insert failure');
        });
      }
      return originalTransaction(cb as Parameters<typeof db.transaction>[0]);
    }) as typeof db.transaction;

    const before = (await repo.listRuns()).length;
    await expect(
      repo.createRunWithSearches(
        {
          startTimestamp: '2026-08-05T10:00:00.000Z',
          configSnapshotJson: {},
          configSchemaVersion: 1,
          configHash: 'cfg-hash',
          applicationVersion: '0.1.0',
        },
        [
          {
            pipelineRunId: 999999,
            searchQuery: 'broken',
            locationName: 'Nowhere',
            geoId: '1',
            generatedUrl: 'https://www.linkedin.com/jobs/search/?q=broken',
            startTimestamp: '2026-08-05T10:00:00.000Z',
          },
        ],
      ),
    ).rejects.toThrow(/simulated search insert failure/);

    // Restore the original transaction for the post-rollback read.
    (db as unknown as { transaction: typeof db.transaction }).transaction = originalTransaction;
    const after = (await repo.listRuns()).length;
    expect(after).toBe(before);
  });

  it('finalizeRunStats updates the persisted counters', async () => {
    const { runId } = await repo.createRunWithSearches(
      {
        startTimestamp: '2026-08-05T10:00:00.000Z',
        configSnapshotJson: {},
        configSchemaVersion: 1,
        configHash: 'cfg-hash',
        applicationVersion: '0.1.0',
      },
      [],
    );
    await repo.finalizeRunStats(runId, {
      status: 'completed',
      endTimestamp: '2026-08-05T10:30:00.000Z',
      searchesPlanned: 2,
      searchesCompleted: 2,
      jobsDiscovered: 7,
      jobsAccepted: 4,
      jobsRejected: 3,
    });
    const run = await repo.findRunById(runId);
    expect(run?.status).toBe('completed');
    expect(run?.jobsDiscovered).toBe(7);
    expect(run?.jobsAccepted).toBe(4);
  });

  it('updateSearchStatus writes the final status and counts', async () => {
    const { searchIds } = await repo.createRunWithSearches(
      {
        startTimestamp: '2026-08-05T10:00:00.000Z',
        configSnapshotJson: {},
        configSchemaVersion: 1,
        configHash: 'cfg-hash',
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
    const searchId = searchIds[0]!;
    await repo.updateSearchStatus(searchId, {
      finalStatus: 'completed',
      endTimestamp: '2026-08-05T10:05:00.000Z',
      jobsDiscovered: 5,
      newJobs: 3,
      existingJobs: 2,
    });
    const search = await repo.findSearchById(searchId);
    expect(search?.finalStatus).toBe('completed');
    expect(search?.jobsDiscovered).toBe(5);
  });

  // ---------------------------------------------------------------------
  // Coverage tests for the under-covered methods. The audit H17
  // vitest-coverage gate (`vitest.config.ts`) enforces per-file
  // thresholds on `src/persistence/repositories/`. `pipeline-runs.ts`
  // was at 68% lines / 43% branches; these tests cover the remaining
  // read paths that weren't exercised by the suite above.
  // ---------------------------------------------------------------------

  it('findRunById returns the persisted run row, or null when unknown', async () => {
    const { runId } = await repo.createRunWithSearches(
      {
        startTimestamp: '2026-08-05T10:00:00.000Z',
        configSnapshotJson: {},
        configSchemaVersion: 1,
        configHash: 'h',
        applicationVersion: '0.1.0',
      },
      [{ pipelineRunId: 0, searchQuery: 'q', locationName: 'L', generatedUrl: 'https://example.com/jobs?q=q', startTimestamp: '2026-08-05T10:00:00.000Z', geoId: '1' }],
    );
    const row = await repo.findRunById(runId);
    expect(row?.id).toBe(runId);
    expect(row?.status).toBe('running');
    expect(await repo.findRunById(99_999_999)).toBeNull();
  });

  it('listRuns returns every persisted run (no status filter)', async () => {
    await repo.createRunWithSearches(
      { startTimestamp: '2026-08-05T10:00:00.000Z', configSnapshotJson: {}, configSchemaVersion: 1, configHash: 'h1', applicationVersion: '0.1.0' },
      [{ pipelineRunId: 0, searchQuery: 'q1', locationName: 'L', generatedUrl: 'https://example.com/jobs?q=q1', startTimestamp: '2026-08-05T10:00:00.000Z', geoId: '1' }],
    );
    await repo.createRunWithSearches(
      { startTimestamp: '2026-08-05T11:00:00.000Z', configSnapshotJson: {}, configSchemaVersion: 1, configHash: 'h2', applicationVersion: '0.1.0' },
      [{ pipelineRunId: 0, searchQuery: 'q2', locationName: 'L', generatedUrl: 'https://example.com/jobs?q=q2', startTimestamp: '2026-08-05T10:00:00.000Z', geoId: '1' }],
    );
    const rows = await repo.listRuns();
    expect(rows).toHaveLength(2);
  });

  it('listRuns filters by status when opts.status is supplied', async () => {
    const { runId } = await repo.createRunWithSearches(
      { startTimestamp: '2026-08-05T10:00:00.000Z', configSnapshotJson: {}, configSchemaVersion: 1, configHash: 'h', applicationVersion: '0.1.0' },
      [{ pipelineRunId: 0, searchQuery: 'q', locationName: 'L', generatedUrl: 'https://example.com/jobs?q=q', startTimestamp: '2026-08-05T10:00:00.000Z', geoId: '1' }],
    );
    await repo.finalizeRunStats(runId, { status: 'failed' });
    const failed = await repo.listRuns({ status: 'failed' });
    expect(failed.map((r) => r.id)).toContain(runId);
    expect(await repo.listRuns({ status: 'completed' })).toHaveLength(0);
  });

  it('listRecent returns the most recent runs (newest first, limit N)', async () => {
    await repo.createRunWithSearches(
      { startTimestamp: '2026-08-05T10:00:00.000Z', configSnapshotJson: {}, configSchemaVersion: 1, configHash: 'a', applicationVersion: '0.1.0' },
      [{ pipelineRunId: 0, searchQuery: 'q1', locationName: 'L', generatedUrl: 'https://example.com/jobs?q=q1', startTimestamp: '2026-08-05T10:00:00.000Z', geoId: '1' }],
    );
    await repo.createRunWithSearches(
      { startTimestamp: '2026-08-05T11:00:00.000Z', configSnapshotJson: {}, configSchemaVersion: 1, configHash: 'b', applicationVersion: '0.1.0' },
      [{ pipelineRunId: 0, searchQuery: 'q2', locationName: 'L', generatedUrl: 'https://example.com/jobs?q=q2', startTimestamp: '2026-08-05T10:00:00.000Z', geoId: '1' }],
    );
    await repo.createRunWithSearches(
      { startTimestamp: '2026-08-05T12:00:00.000Z', configSnapshotJson: {}, configSchemaVersion: 1, configHash: 'c', applicationVersion: '0.1.0' },
      [{ pipelineRunId: 0, searchQuery: 'q3', locationName: 'L', generatedUrl: 'https://example.com/jobs?q=q3', startTimestamp: '2026-08-05T10:00:00.000Z', geoId: '1' }],
    );
    const recent = await repo.listRecent(2);
    expect(recent).toHaveLength(2);
    expect(recent[0]?.configHash).toBe('c');
    expect(recent[1]?.configHash).toBe('b');
  });

  it('listRecent returns an empty array for a non-positive limit (no DB query)', async () => {
    expect(await repo.listRecent(0)).toEqual([]);
    expect(await repo.listRecent(-3)).toEqual([]);
  });

  it('findWithDetails returns the run joined with its search executions', async () => {
    const { runId, searchIds } = await repo.createRunWithSearches(
      {
        startTimestamp: '2026-08-05T10:00:00.000Z',
        configSnapshotJson: {},
        configSchemaVersion: 1,
        configHash: 'h',
        applicationVersion: '0.1.0',
      },
      [
        { pipelineRunId: 0, searchQuery: 'q1', locationName: 'L', generatedUrl: 'https://example.com/jobs?q=q1', startTimestamp: '2026-08-05T10:00:00.000Z', geoId: '1' },
        { pipelineRunId: 0, searchQuery: 'q2', locationName: 'L', generatedUrl: 'https://example.com/jobs?q=q2', startTimestamp: '2026-08-05T10:00:00.000Z', geoId: '2' },
      ],
    );
    const details = await repo.findWithDetails(runId);
    expect(details?.row.id).toBe(runId);
    expect(details?.searches).toHaveLength(2);
    expect([...(details?.searches ?? [])].map((s) => s.id).sort()).toEqual([...searchIds].sort());
    expect(await repo.findWithDetails(99_999_999)).toBeNull();
  });

  it('listSearchesByRun returns every search under a run', async () => {
    const { runId, searchIds } = await repo.createRunWithSearches(
      {
        startTimestamp: '2026-08-05T10:00:00.000Z',
        configSnapshotJson: {},
        configSchemaVersion: 1,
        configHash: 'h',
        applicationVersion: '0.1.0',
      },
      [
        { pipelineRunId: 0, searchQuery: 'a', locationName: 'L', generatedUrl: 'https://example.com/jobs?q=a', startTimestamp: '2026-08-05T10:00:00.000Z', geoId: '1' },
        { pipelineRunId: 0, searchQuery: 'b', locationName: 'L', generatedUrl: 'https://example.com/jobs?q=b', startTimestamp: '2026-08-05T10:00:00.000Z', geoId: '2' },
      ],
    );
    const searches = await repo.listSearchesByRun(runId);
    expect(searches).toHaveLength(2);
    expect(searches.map((s) => s.id).sort()).toEqual([...searchIds].sort());
    expect(await repo.listSearchesByRun(99_999_999)).toEqual([]);
  });
});
