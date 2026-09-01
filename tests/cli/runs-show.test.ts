import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createProgram } from '../../src/cli.js';
import {
  createDatabaseConnection,
  type DatabaseConnection,
} from '../../src/persistence/connection.js';
import { runMigrations } from '../../src/persistence/migrations.js';
import { createRepositories } from '../../src/persistence/repositories/index.js';
import { resolveRepoRootForMigrations } from '../../src/persistence/resolve-migrations.js';
import { resolvePlatformPaths } from '../../src/platform/paths.js';
import { createDefaultPlatformAdapter } from '../../src/platform/paths-default.js';
import {
  FIXTURE_TS,
  seedFilterResult,
  seedJob,
  seedPipelineRun,
  seedProfileAndFilter,
  seedScoreResult,
} from '../inspection/services/helpers/inspection-harness.js';

/**
 *  — CLI wiring tests for `runs show`.
 *
 * Mirrors the stub + DB-boot pattern from `tests/cli/jobs-show.test.ts`.
 * Covers the three error surfaces (invalid identifier, unknown
 * id, success with --json). The `runs show --json` payload is
 * wrapped with `schemaVersion: 1` ( requirement) by the
 * CLI handler — the test asserts that field on the emitted JSON.
 */
describe('CLI: jobhunter runs show', () => {
  let tempHome: string;
  let originalHome: string | undefined;
  let stdout: string[] = [];
  let stderr: string[] = [];
  let exitCode: number | null = null;
  let originalExit: typeof process.exit | undefined;
  let originalOut: typeof process.stdout.write | undefined;
  let originalErr: typeof process.stderr.write | undefined;
  let migrationsFolder: string;

  beforeEach(() => {
    if (originalExit === undefined) {
      originalExit = process.exit;
      originalOut = process.stdout.write;
      originalErr = process.stderr.write;
    }
    tempHome = mkdtempSync(join(tmpdir(), 'jobhunter-cli-runs-show-'));
    originalHome = process.env['HOME'];
    process.env['HOME'] = tempHome;
    stdout = [];
    stderr = [];
    exitCode = null;
    migrationsFolder = resolveRepoRootForMigrations();
    process.exit = ((code: number) => {
      if (exitCode === null) exitCode = code;
      throw new Error(`__exit__:${code}`);
    }) as typeof process.exit;
    process.stdout.write = ((chunk: string | Uint8Array): boolean => {
      stdout.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'));
      return true;
    }) as typeof process.stdout.write;
    process.stderr.write = ((chunk: string | Uint8Array): boolean => {
      stderr.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'));
      return true;
    }) as typeof process.stderr.write;
  });

  afterEach(() => {
    if (originalExit !== undefined) process.exit = originalExit;
    if (originalOut !== undefined) process.stdout.write = originalOut;
    if (originalErr !== undefined) process.stderr.write = originalErr;
    if (originalHome === undefined) {
      delete process.env['HOME'];
    } else {
      process.env['HOME'] = originalHome;
    }
    rmSync(tempHome, { recursive: true, force: true });
  });

  function bootDatabase(): DatabaseConnection {
    const paths = resolvePlatformPaths(createDefaultPlatformAdapter());
    const filePath = paths.data.file('jobhunter.sqlite');
    const connection = createDatabaseConnection(filePath);
    runMigrations(connection, { migrationsFolder });
    return connection;
  }

  async function ensureDatabaseReady(): Promise<void> {
    await runCli(['jobs', 'list']);
    stdout = [];
    stderr = [];
    exitCode = null;
  }

  /**
   * Seed one complete run + 2 search executions + a couple of
   * filter + score results so the show payload has populated
   * counts. Returns the new run id.
   */
  async function seedShowRunFixture(): Promise<number> {
    const connection = bootDatabase();
    const repositories = createRepositories(connection);
    const seeded = await seedProfileAndFilter(repositories);
    const run = await seedPipelineRun(repositories, {
      searches: [
        { searchQuery: 'engineer', locationName: 'Rotterdam', geoId: '1' },
        { searchQuery: 'devops', locationName: 'Amsterdam', geoId: '2' },
      ],
      profileVersionId: seeded.profileVersionId,
      filterConfigVersionId: seeded.filterConfigVersionId,
      startTimestamp: FIXTURE_TS,
    });
    const job = await seedJob(repositories, {
      sourceJobId: '1001',
      runId: run.runId,
      searchId: run.searchIds[0]!,
      extractionStatus: 'complete',
      title: 'Engineer',
      company: 'Acme',
      location: 'Rotterdam',
      successfulMethod: 'search_detail_panel',
    });
    const fr = await seedFilterResult(repositories, {
      jobId: job.jobId,
      runId: run.runId,
      filterConfigVersionId: seeded.filterConfigVersionId,
      outcome: 'accepted',
      profileVersionId: seeded.profileVersionId,
    });
    await seedScoreResult(repositories, {
      jobId: job.jobId,
      runId: run.runId,
      filterResultId: fr,
      overallScore: 85,
    });
    await repositories.pipelineRuns.finalizeRunStats(run.runId, {
      status: 'completed',
      endTimestamp: '2026-08-20T10:30:00.000Z',
      jobsDiscovered: 1,
      newCompleteJobs: 1,
      newPartialJobs: 0,
      failedExtractions: 0,
      jobsAccepted: 1,
      jobsRejected: 0,
      filterErrors: 0,
      jobsScored: 1,
      scoresReused: 0,
      scoringErrors: 0,
      searchesPlanned: 2,
      searchesAttempted: 2,
      searchesCompleted: 2,
      searchErrors: null,
    });
    const runId = run.runId;
    connection.close();
    return runId;
  }

  async function runCli(args: readonly string[]): Promise<{
    status: number;
    stdout: string;
    stderr: string;
  }> {
    try {
      await createProgram().parseAsync(['node', 'jobhunter', ...args]);
    } catch (err) {
      if (!(err instanceof Error) || !err.message.startsWith('__exit__')) throw err;
    }
    return {
      status: exitCode ?? 0,
      stdout: stdout.join(''),
      stderr: stderr.join(''),
    };
  }

  describe('error surfaces', () => {
    it('exits 2 + runs_show_invalid_identifier for a malformed id', async () => {
      await ensureDatabaseReady();
      const result = await runCli(['runs', 'show', 'not_a_valid_id']);
      expect(result.status).toBe(2);
      expect(result.stderr).toContain('runs_show_invalid_identifier');
    });

    it('exits 2 + runs_show_not_found for an unknown run id', async () => {
      await ensureDatabaseReady();
      const result = await runCli(['runs', 'show', 'run_9999']);
      expect(result.status).toBe(2);
      expect(result.stderr).toContain('runs_show_not_found');
    });
  });

  describe('happy path (with fixture + --json)', () => {
    it('emits valid single JSON document with --json after a fixture insert', async () => {
      await ensureDatabaseReady();
      const runId = await seedShowRunFixture();
      const result = await runCli(['runs', 'show', `run_${runId}`, '--json']);
      expect(result.status).toBe(0);
      const parsed = JSON.parse(result.stdout) as {
        schemaVersion: number;
        id: string;
        internalId: number;
        status: string;
        startTimestamp: string;
        endTimestamp: string | null;
        configuration: { hash: string; schemaVersion: number };
        profileVersionId: number | null;
        filterConfigVersionId: number | null;
        searchExecutions: unknown[];
        jobCounts: { complete: number; partial: number; failed: number; total: number };
        filterCounts: { accepted: number; rejected: number; errors: number };
        scoreCounts: { scored: number; reused: number; errors: number };
        reusedResults: { jobsReused: number };
        errors: {
          searchErrors: unknown[];
          extractionFailures: number;
          filterErrors: number;
          scoringErrors: number;
        };
        cancellationState: { isCancelled: boolean; reason: string | null };
        diagnosticReferences: unknown[];
      };
      expect(parsed.schemaVersion).toBe(1);
      expect(parsed.id).toBe(`run_${runId}`);
      expect(parsed.internalId).toBe(runId);
      expect(parsed.status).toBe('completed');
      expect(parsed.startTimestamp).toBe(FIXTURE_TS);
      expect(parsed.endTimestamp).toBe('2026-08-20T10:30:00.000Z');
      expect(parsed.configuration.hash).toBe('cfg-hash');
      expect(parsed.profileVersionId).toBeGreaterThan(0);
      expect(parsed.filterConfigVersionId).toBeGreaterThan(0);
      expect(parsed.searchExecutions).toHaveLength(2);
      expect(parsed.jobCounts.complete).toBe(1);
      expect(parsed.filterCounts.accepted).toBe(1);
      expect(parsed.scoreCounts.scored).toBe(1);
      expect(parsed.reusedResults.jobsReused).toBe(0);
      expect(parsed.errors.searchErrors).toEqual([]);
      expect(parsed.cancellationState.isCancelled).toBe(false);
      expect(parsed.diagnosticReferences).toEqual([]);
    });
  });
});
