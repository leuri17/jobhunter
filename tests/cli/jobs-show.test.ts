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
 *  — CLI wiring tests for `jobs show`.
 *
 * Same boot/stub pattern as `tests/cli/jobs-list.test.ts`. Covers
 * the three error surfaces (invalid identifier, unknown id,
 * success with --json).
 */
describe('CLI: jobhunter jobs show', () => {
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
    tempHome = mkdtempSync(join(tmpdir(), 'jobhunter-cli-jobs-show-'));
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

  /** Seed one complete job + active filter + active score. Returns the new job id. */
  async function seedShowFixture(): Promise<number> {
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
      sourceJobId: '1234',
      runId: run.runId,
      searchId: run.searchIds[0]!,
      extractionStatus: 'complete',
      title: 'Senior Engineer',
      company: 'Acme',
      location: 'Rotterdam',
      description: 'Build distributed systems.',
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
    const jobId = job.jobId;
    connection.close();
    return jobId;
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
    it('exits 2 + jobs_show_invalid_identifier for a malformed id', async () => {
      await ensureDatabaseReady();
      const result = await runCli(['jobs', 'show', 'not_a_valid_id']);
      expect(result.status).toBe(2);
      expect(result.stderr).toContain('jobs_show_invalid_identifier');
    });

    it('exits 2 + jobs_show_not_found for an unknown job id', async () => {
      await ensureDatabaseReady();
      const result = await runCli(['jobs', 'show', 'job_9999']);
      expect(result.status).toBe(2);
      expect(result.stderr).toContain('jobs_show_not_found');
    });
  });

  describe('happy path (with fixture + --json)', () => {
    it('emits valid single JSON document with --json after a fixture insert', async () => {
      await ensureDatabaseReady();
      const jobId = await seedShowFixture();
      const result = await runCli(['jobs', 'show', `job_${jobId}`, '--json']);
      expect(result.status).toBe(0);
      const parsed = JSON.parse(result.stdout) as {
        schemaVersion: number;
        id: string;
        internalId: number;
        sourceJobId: string;
        linkedinUrl: string;
        title: string;
        company: string;
        location: string;
        description: string;
        extractionStatus: string;
        successfulMethod: string | null;
        discoveryHistory: unknown[];
        currentFilter: unknown;
        currentScore: unknown;
        timestamps: unknown;
      };
      expect(parsed.schemaVersion).toBe(1);
      expect(parsed.id).toBe(`job_${jobId}`);
      expect(parsed.internalId).toBe(jobId);
      expect(parsed.sourceJobId).toBe('1234');
      expect(parsed.linkedinUrl).toBe('https://www.linkedin.com/jobs/view/1234');
      expect(parsed.title).toBe('Senior Engineer');
      expect(parsed.company).toBe('Acme');
      expect(parsed.location).toBe('Rotterdam');
      expect(parsed.extractionStatus).toBe('complete');
      expect(parsed.successfulMethod).toBe('search_detail_panel');
      expect(parsed.discoveryHistory.length).toBeGreaterThan(0);
      expect(parsed.currentFilter).toBeDefined();
      expect(parsed.currentScore).toBeDefined();
      expect(parsed.timestamps).toBeDefined();
    });

    it('also resolves the numeric sourceJobId form', async () => {
      await ensureDatabaseReady();
      await seedShowFixture();
      const result = await runCli(['jobs', 'show', '1234', '--json']);
      expect(result.status).toBe(0);
      const parsed = JSON.parse(result.stdout) as { sourceJobId: string };
      expect(parsed.sourceJobId).toBe('1234');
    });
  });
});
