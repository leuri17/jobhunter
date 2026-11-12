import { describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildServer } from '../src/server.js';
import {
  createDatabaseConnection,
  createRepositories,
  runMigrations,
  resolveRepoRootForMigrations,
  type DatabaseConnection,
} from '@jobhunter/core/persistence';

// Hermeticity guard: no test in this file may open the real on-disk
// database (see pipeline.test.ts).
vi.mock('../src/routes/db-helper.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/routes/db-helper.js')>();
  return {
    ...actual,
    openDbHandle: async (): Promise<never> => {
      throw new Error('openDbHandle must not be called: inject pipelineDbOpener in tests');
    },
  };
});

describe('pipeline startup sweep (#318)', () => {
  it('cancels runs and searches left running by a previous session at boot', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'jobhunter-sweep-'));
    const dbPath = join(directory, 'jobhunter.sqlite');

    // Seed a stale session: one running run with one pending search.
    const seed = createDatabaseConnection(dbPath);
    runMigrations(seed, { migrationsFolder: resolveRepoRootForMigrations() });
    const seedRepos = createRepositories(seed);
    const { runId } = await seedRepos.pipelineRuns.createRunWithSearches(
      {
        startTimestamp: '2026-11-10T00:07:00.000Z',
        configSnapshotJson: { version: 1 },
        configSchemaVersion: 1,
        configHash: 'cfg-hash',
        applicationVersion: '0.1.0',
      },
      [
        {
          pipelineRunId: 0,
          searchQuery: 'engineer',
          locationName: 'Rotterdam',
          geoId: '100467493',
          generatedUrl: 'https://www.linkedin.com/jobs/search/?keywords=engineer',
          startTimestamp: '2026-11-10T00:07:00.000Z',
        },
      ],
    );
    seed.close();

    // Fresh connection per open, like production; the file persists state.
    const opener = async (): Promise<DatabaseConnection> => {
      const connection = createDatabaseConnection(dbPath);
      runMigrations(connection, { migrationsFolder: resolveRepoRootForMigrations() });
      return connection;
    };

    try {
      await buildServer({
        env: { port: 0, host: '127.0.0.1' },
        pipelineDbOpener: opener,
      });

      const verify = await opener();
      try {
        const repos = createRepositories(verify);
        const run = await repos.pipelineRuns.findRunById(runId);
        expect(run?.status).toBe('cancelled');
        expect(run?.cancellationReason).toBe('app_shutdown');
        expect(run?.endTimestamp).not.toBeNull();
        const searches = await repos.pipelineRuns.listSearchesByRun(runId);
        expect(searches[0]?.finalStatus).toBe('cancelled');
      } finally {
        verify.close();
      }
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  }, 15_000);
});
