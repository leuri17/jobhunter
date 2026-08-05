import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runMigrations } from '../../src/persistence/migrations.js';
import { createDatabaseConnection, type DatabaseConnection } from '../../src/persistence/connection.js';
import { applicationMetadata, pipelineRuns, profileSources } from '../../src/persistence/schema.js';
import { Repositories } from '../../src/persistence/repositories/index.js';
import { withTransaction } from '../../src/persistence/transactions.js';

const REPO_ROOT = resolve(import.meta.dirname, '..', '..');

describe('withTransaction', () => {
  let directory: string;
  let connection: DatabaseConnection;

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'jobhunter-tx-'));
    connection = createDatabaseConnection(join(directory, 'jobhunter.sqlite'));
    runMigrations(connection, { migrationsFolder: join(REPO_ROOT, 'drizzle') });
  });

  afterEach(() => {
    connection.close();
    rmSync(directory, { recursive: true, force: true });
  });

  it('commits when the block returns normally', () => {
    const id = withTransaction(connection, (tx) => {
      const rows = tx
        .insert(profileSources)
        .values({
          sourceType: 'pdf',
          originalFilename: 'a.pdf',
          originalAbsolutePath: '/a.pdf',
          storedPath: '/opt/a.pdf',
          mimeType: 'application/pdf',
          fileSize: 1,
          sha256: 'a'.repeat(64),
          importTimestamp: '2026-08-05T10:00:00.000Z',
          textExtractionStatus: 'pending',
        })
        .returning({ id: profileSources.id })
        .all();
      const row = rows[0];
      if (row === undefined) throw new Error('insert returned no rows');
      return row.id;
    });
    const repos = new Repositories({ db: connection.db });
    return expect(repos.profileSources.findById(id)).resolves.not.toBeNull();
  });

  it('rolls back when the block throws', () => {
    expect(() =>
      withTransaction(connection, (tx) => {
        tx.insert(profileSources)
          .values({
            sourceType: 'pdf',
            originalFilename: 'a.pdf',
            originalAbsolutePath: '/a.pdf',
            storedPath: '/opt/a.pdf',
            mimeType: 'application/pdf',
            fileSize: 1,
            sha256: 'b'.repeat(64),
            importTimestamp: '2026-08-05T10:00:00.000Z',
            textExtractionStatus: 'pending',
          })
          .run();
        throw new Error('boom');
      }),
    ).toThrow('boom');
    const repos = new Repositories({ db: connection.db });
    return expect(repos.profileSources.findBySha256('b'.repeat(64))).resolves.toBeNull();
  });
});

describe('Repositories.transact', () => {
  let directory: string;
  let connection: DatabaseConnection;

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'jobhunter-repos-transact-'));
    connection = createDatabaseConnection(join(directory, 'jobhunter.sqlite'));
    runMigrations(connection, { migrationsFolder: join(REPO_ROOT, 'drizzle') });
  });

  afterEach(() => {
    connection.close();
    rmSync(directory, { recursive: true, force: true });
  });

  it('composes writes across multiple tables atomically (sync callback)', () => {
    const repos = new Repositories({ db: connection.db });
    // The transaction body must be sync because better-sqlite3's transaction
    // wrapper rejects Promise returns. Use txRepos.db (the transaction handle)
    // for sync Drizzle operations.
    const runId = repos.transact((txRepos) => {
      const tx = txRepos.db;
      const runRows = tx
        .insert(pipelineRuns)
        .values({
          status: 'running',
          startTimestamp: '2026-08-05T10:00:00.000Z',
          configSnapshotJson: '{}',
          configSchemaVersion: 1,
          configHash: 'h',
          applicationVersion: '0.1.0',
        })
        .returning({ id: pipelineRuns.id })
        .all();
      const runRow = runRows[0];
      if (runRow === undefined) throw new Error('insert pipeline run returned no rows');
      tx.insert(applicationMetadata)
        .values({
          key: 'lastRunId',
          value: String(runRow.id),
          updatedAt: '2026-08-05T10:00:00.000Z',
        })
        .run();
      return runRow.id;
    });
    return expect(repos.applicationMetadata.get('lastRunId')).resolves.not.toBeNull().then(() => {
      expect(typeof runId).toBe('number');
    });
  });

  it('rolls back all writes when the block throws', () => {
    const repos = new Repositories({ db: connection.db });
    expect(() => {
      repos.transact((txRepos) => {
        const tx = txRepos.db;
        tx.insert(pipelineRuns)
          .values({
            status: 'running',
            startTimestamp: '2026-08-05T10:00:00.000Z',
            configSnapshotJson: '{}',
            configSchemaVersion: 1,
            configHash: 'h',
            applicationVersion: '0.1.0',
          })
          .run();
        throw new Error('boom');
      });
    }).toThrow('boom');
    return expect(repos.pipelineRuns.listRuns()).resolves.toHaveLength(0);
  });
});
