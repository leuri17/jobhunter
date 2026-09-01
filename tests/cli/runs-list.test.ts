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

/**
 *  — CLI wiring tests for `runs list`.
 *
 * Mirrors the stub + DB-boot pattern from `tests/cli/jobs-list.test.ts`.
 * No fixture needed for the documented scenarios — the empty-DB
 * assertions cover the table / JSON contracts end-to-end. The
 * `--limit 1` test inserts one pipeline run so the table has one
 * row to surface.
 */
describe('CLI: jobhunter runs list', () => {
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
    tempHome = mkdtempSync(join(tmpdir(), 'jobhunter-cli-runs-list-'));
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

  /** Insert one completed pipeline run. */
  async function seedOneRun(): Promise<void> {
    const connection = bootDatabase();
    const repositories = createRepositories(connection);
    const { runId } = await repositories.pipelineRuns.createRunWithSearches(
      {
        startTimestamp: '2026-08-20T10:00:00.000Z',
        configSnapshotJson: {},
        configSchemaVersion: 1,
        configHash: 'cfg-hash',
        applicationVersion: '0.1.0',
      },
      [
        {
          pipelineRunId: 0,
          searchQuery: 'engineer',
          locationName: 'Rotterdam',
          geoId: '1',
          generatedUrl: 'https://www.linkedin.com/jobs/search?q=engineer&geoId=1',
          startTimestamp: '2026-08-20T10:00:00.000Z',
        },
      ],
    );
    await repositories.pipelineRuns.finalizeRunStats(runId, {
      status: 'completed',
      endTimestamp: '2026-08-20T10:30:00.000Z',
      jobsDiscovered: 50,
      jobsScored: 30,
      searchesAttempted: 4,
      searchErrors: null,
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

  describe('happy path (empty DB)', () => {
    it('exits 0 + prints (no runs) when the DB is empty', async () => {
      await ensureDatabaseReady();
      const result = await runCli(['runs', 'list']);
      expect(result.status).toBe(0);
      expect(result.stdout).toContain('(no runs)');
    });
  });

  describe('happy path (with fixture)', () => {
    it('renders exactly 1 data row when --limit 1 is supplied', async () => {
      await ensureDatabaseReady();
      await seedOneRun();
      const result = await runCli(['runs', 'list', '--limit', '1']);
      expect(result.status).toBe(0);
      // Header row + 1 data row.
      const lines = result.stdout.split('\n').filter((line) => line.length > 0);
      expect(lines).toHaveLength(2);
      expect(result.stdout).toContain('run_1');
    });
  });

  describe('JSON output', () => {
    it('emits valid single JSON document with --json on an empty DB', async () => {
      await ensureDatabaseReady();
      const result = await runCli(['runs', 'list', '--json']);
      expect(result.status).toBe(0);
      const parsed = JSON.parse(result.stdout) as {
        schemaVersion: number;
        limit: number;
        returned: number;
        runs: unknown[];
      };
      expect(parsed.schemaVersion).toBe(1);
      expect(parsed.limit).toBe(20);
      expect(parsed.returned).toBe(0);
      expect(parsed.runs).toEqual([]);
    });
  });
});
