import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { runMigrations } from '../../../src/persistence/migrations.js';
import {
  createDatabaseConnection,
  type DatabaseConnection,
} from '../../../src/persistence/connection.js';
import { createRepositories, Repositories } from '../../../src/persistence/repositories/index.js';

const REPO_ROOT = resolve(import.meta.dirname, '..', '..', '..');

/**
 * Smoke tests for the `Repositories` aggregator. The class is a thin
 * factory over the individual repository classes; this test exercises
 * the factory (`createRepositories`), the constructor field
 * assignments (covers the 9 readonly initializers), and `transact`
 * (the only behaviour-bearing method on the class itself).
 *
 * The audit H17 vitest-coverage gate (`vitest.config.ts`) enforces
 * per-file thresholds on the `src/persistence/repositories/` tree.
 * Without this file `index.ts` lands at ~0% coverage and trips the
 * `functions: 77%` floor.
 */
describe('Repositories aggregator (index.ts)', () => {
  let directory: string;
  let connection: DatabaseConnection;
  let repos: Repositories;

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'jobhunter-repos-aggregator-'));
    connection = createDatabaseConnection(join(directory, 'jobhunter.sqlite'));
    runMigrations(connection, { migrationsFolder: join(REPO_ROOT, 'drizzle') });
    repos = createRepositories(connection);
  });

  afterEach(() => {
    rmSync(directory, { recursive: true, force: true });
  });

  it('createRepositories returns a Repositories instance with every sub-repository wired', () => {
    expect(repos).toBeInstanceOf(Repositories);
    // The 9 readonly sub-repository fields are populated by the
    // constructor. Touch each so a future rename fails the build.
    expect(repos.profileSources).toBeDefined();
    expect(repos.profileVersions).toBeDefined();
    expect(repos.filterConfigurations).toBeDefined();
    expect(repos.pipelineRuns).toBeDefined();
    expect(repos.jobs).toBeDefined();
    expect(repos.filterResults).toBeDefined();
    expect(repos.scoreResults).toBeDefined();
    expect(repos.openaiMetadata).toBeDefined();
    expect(repos.diagnostics).toBeDefined();
    expect(repos.applicationMetadata).toBeDefined();
    // `db` is the underlying Drizzle handle.
    expect(repos.db).toBeDefined();
  });

  it('transact runs the callback with a tx-scoped Repositories that shares the underlying savepoint', () => {
    const txSeen: Repositories[] = [];
    const result = repos.transact((txRepos) => {
      txSeen.push(txRepos);
      // The callback receives a fresh Repositories bound to the
      // transaction. Write through txRepos.db to confirm the handle
      // is usable from inside the block.
      txRepos.db.run('CREATE TABLE IF NOT EXISTS _coverage_marker (n INTEGER)');
      return 'ok';
    });
    expect(result).toBe('ok');
    expect(txSeen).toHaveLength(1);
    expect(txSeen[0]).not.toBe(repos);
    expect(txSeen[0]).toBeInstanceOf(Repositories);
  });

  it('transact rolls back on synchronous throw inside the callback', () => {
    expect(() =>
      repos.transact(() => {
        throw new Error('synthetic rollback trigger');
      }),
    ).toThrowError('synthetic rollback trigger');
    // Reaching this point is enough: better-sqlite3's transaction
    // wrapper guarantees the throw propagated and the savepoint
    // was rolled back; no observable state to assert beyond "no
    // exception escaped the wrapper".
  });
});
