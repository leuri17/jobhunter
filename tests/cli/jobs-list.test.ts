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
 * TASK-016 Wave D Task 15 — CLI wiring tests for `jobs list`.
 *
 * Mirrors the stub pattern from `tests/cli/profile-list.test.ts`
 * + the database-boot pattern from `tests/cli/configure-filters.test.ts`
 * (run the CLI once to create the SQLite file + migrations, then
 * connect to the same file + seed fixtures, then run the CLI
 * again to capture stdout/stderr).
 */
describe('CLI: jobhunter jobs list (TASK-016 Wave D Task 15, SPEC §34)', () => {
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
    tempHome = mkdtempSync(join(tmpdir(), 'jobhunter-cli-jobs-list-'));
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

  /** Open the same SQLite file the CLI uses + apply migrations. */
  function bootDatabase(): DatabaseConnection {
    const paths = resolvePlatformPaths(createDefaultPlatformAdapter());
    const filePath = paths.data.file('jobhunter.sqlite');
    const connection = createDatabaseConnection(filePath);
    runMigrations(connection, { migrationsFolder });
    return connection;
  }

  /**
   * Boot the CLI once with no fixtures so the SQLite file + schema
   * are created. Subsequent runs of `runCli` reuse the same file.
   */
  async function ensureDatabaseReady(): Promise<void> {
    await runCli(['jobs', 'list']);
    stdout = [];
    stderr = [];
    exitCode = null;
  }

  /** Seed the 1-job / 1-active-filter / 1-active-score fixture. */
  async function seedScoredJobFixture(): Promise<void> {
    const connection = bootDatabase();
    const repositories = createRepositories(connection);
    const seeded = await seedProfileAndFilter(repositories);
    const run = await seedPipelineRun(repositories, {
      searches: [{ searchQuery: 'engineer', locationName: 'Rotterdam', geoId: '1' }],
      profileVersionId: seeded.profileVersionId,
      filterConfigVersionId: seeded.filterConfigVersionId,
      startTimestamp: FIXTURE_TS,
    });
    const job = await seedJob(repositories, {
      sourceJobId: '1001',
      runId: run.runId,
      searchId: run.searchIds[0]!,
      extractionStatus: 'complete',
      title: 'Senior Engineer',
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
    connection.close();
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

  describe('command registration (SPEC §34)', () => {
    it('registers the `jobs` subcommand', () => {
      const program = createProgram();
      const jobs = program.commands.find((c) => c.name() === 'jobs');
      expect(jobs).toBeDefined();
    });

    it('registers the `jobs list` subcommand', () => {
      const program = createProgram();
      const jobs = program.commands.find((c) => c.name() === 'jobs');
      const list = jobs?.commands.find((c) => c.name() === 'list');
      expect(list).toBeDefined();
    });

    it('exposes every documented state flag on `jobs list`', () => {
      const program = createProgram();
      const jobs = program.commands.find((c) => c.name() === 'jobs');
      const list = jobs?.commands.find((c) => c.name() === 'list');
      const flags = new Set(list?.options.map((o) => o.long ?? '') ?? []);
      const expected = [
        '--all',
        '--scored',
        '--accepted',
        '--rejected',
        '--unscored',
        '--partial',
        '--failed',
        '--filter-errors',
        '--scoring-errors',
        '--limit',
        '--min-score',
        '--company',
        '--location',
        '--run',
        '--json',
      ];
      for (const expectedFlag of expected) {
        expect(flags.has(expectedFlag), `missing flag ${expectedFlag}`).toBe(true);
      }
    });
  });

  describe('happy path (empty DB)', () => {
    it('exits 0 + prints (no jobs) when no state flag is supplied', async () => {
      await ensureDatabaseReady();
      const result = await runCli(['jobs', 'list']);
      expect(result.status).toBe(0);
      expect(result.stdout).toContain('(no jobs)');
    });
  });

  describe('happy path (with fixture)', () => {
    it('exits 0 + prints a single JSON document when --json is supplied', async () => {
      await ensureDatabaseReady();
      await seedScoredJobFixture();
      const result = await runCli(['jobs', 'list', '--json']);
      expect(result.status).toBe(0);
      const parsed = JSON.parse(result.stdout) as {
        schemaVersion: number;
        state: string;
        filters: unknown;
        limit: number;
        returned: number;
        jobs: unknown[];
      };
      expect(parsed.schemaVersion).toBe(1);
      expect(parsed.state).toBe('scored');
      expect(parsed.limit).toBe(50);
      expect(parsed.returned).toBe(1);
      expect(parsed.jobs).toHaveLength(1);
      expect(parsed.jobs[0]).toMatchObject({ state: 'scored' });
    });
  });

  describe('state flag mutex (Decision 5)', () => {
    it('exits 2 + jobs_list_state_conflict when two state flags are supplied', async () => {
      await ensureDatabaseReady();
      const result = await runCli(['jobs', 'list', '--all', '--scored']);
      expect(result.status).toBe(2);
      expect(result.stderr).toContain('jobs_list_state_conflict');
    });
  });

  describe('refinement validation', () => {
    it('exits 2 + jobs_list_invalid_limit when --limit is 0', async () => {
      await ensureDatabaseReady();
      const result = await runCli(['jobs', 'list', '--limit', '0']);
      expect(result.status).toBe(2);
      expect(result.stderr).toContain('jobs_list_invalid_limit');
    });

    it('exits 2 + jobs_list_invalid_min_score when --min-score is out of range', async () => {
      await ensureDatabaseReady();
      const result = await runCli(['jobs', 'list', '--min-score', '150']);
      expect(result.status).toBe(2);
      expect(result.stderr).toContain('jobs_list_invalid_min_score');
    });

    it('exits 2 + jobs_list_invalid_run_id when --run is malformed', async () => {
      await ensureDatabaseReady();
      const result = await runCli(['jobs', 'list', '--run', 'foo']);
      expect(result.status).toBe(2);
      expect(result.stderr).toContain('jobs_list_invalid_run_id');
    });
  });

  describe('JSON output (SPEC §36)', () => {
    it('emits valid single JSON document with --json on an empty DB', async () => {
      await ensureDatabaseReady();
      const result = await runCli(['jobs', 'list', '--json']);
      expect(result.status).toBe(0);
      const parsed = JSON.parse(result.stdout) as {
        schemaVersion: number;
        state: string;
        filters: unknown;
        limit: number;
        returned: number;
        jobs: unknown[];
      };
      expect(parsed.schemaVersion).toBe(1);
      expect(parsed.state).toBe('scored');
      expect(parsed.filters).toBeDefined();
      expect(parsed.limit).toBe(50);
      expect(parsed.returned).toBe(0);
      expect(parsed.jobs).toEqual([]);
    });
  });
});
