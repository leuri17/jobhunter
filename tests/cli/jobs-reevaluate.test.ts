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
  seedJob,
  seedPipelineRun,
} from '../inspection/services/helpers/inspection-harness.js';
import {
  insertActiveFilterForReeval,
  insertActiveFilterResultForReeval,
  insertApprovedProfileForReeval,
} from '../reevaluation/helpers/fixtures.js';
import { FakeOpenAIClient } from '../../src/profile/openai/fake-client.js';
import type { OpenAIExtractionRawResponse } from '../../src/profile/openai/types.js';
import { loadScoringFixture } from '../scoring/fixtures/loadFixture.js';
import { ScriptedPipelinePrompts } from '../../src/pipeline/prompts.js';

/**
 * CLI smoke tests for `jobhunter jobs reevaluate` (TASK-017 Wave D
 * Task 8 + Task 11 cases). Mirrors the stub pattern from
 * `tests/cli/jobs-list.test.ts` — boot the CLI once to create the
 * SQLite file + schema, then connect to the same file + seed
 * fixtures, then run the CLI again to capture stdout/stderr.
 *
 * The 6 cases per the plan:
 *   1. `jobs reevaluate --dry-run --json` (empty DB) → valid JSON,
 *      `schemaVersion === 1`, `scope === 'default'`, `dryRun === true`,
 *      `totals.filtersRerun === 0`.
 *   2. `jobs reevaluate --filters-only --scores-only` → exit 2 + stderr
 *      contains `reevaluate_scope_conflict`.
 *   3. `jobs reevaluate --job not_a_valid_id` → exit 2 + stderr contains
 *      `invalid_identifier`.
 *   4. `jobs reevaluate --job job_9999` → exit 2 + stderr contains
 *      `job_not_found`.
 *   5. `jobs reevaluate --json` with 1 stale filter + 1 stale score →
 *      valid JSON, `totals.filtersRerun === 1`, `totals.scoresRerun === 1`.
 *   6. `jobs reevaluate` (human-readable) → stdout contains
 *      `Scope: default`, `Filters to reevaluate: <n>`, `Jobs to score: <n>`.
 */
describe('CLI: jobhunter jobs reevaluate (TASK-017 Wave D Task 8 + Task 11, SPEC §28 + §36)', () => {
  let tempHome: string;
  let originalHome: string | undefined;
  let stdout: string[] = [];
  let stderr: string[] = [];
  let exitCode: number | null = null;
  let originalExit: typeof process.exit | undefined;
  let originalOut: typeof process.stdout.write | undefined;
  let originalErr: typeof process.stderr.write | undefined;
  let migrationsFolder: string;
  let originalOpenAiKey: string | undefined;

  beforeEach(() => {
    if (originalExit === undefined) {
      originalExit = process.exit;
      originalOut = process.stdout.write;
      originalErr = process.stderr.write;
    }
    tempHome = mkdtempSync(join(tmpdir(), 'jobhunter-cli-jobs-reevaluate-'));
    originalHome = process.env['HOME'];
    process.env['HOME'] = tempHome;
    // Provide a stable OPENAI_API_KEY so the reevaluation service
    // can compose its ScoringService (the default scope path
    // surfaces `openai_api_key_missing` otherwise). The real OpenAI
    // client is never invoked — the reevaluation service uses the
    // fake `--dry-run` / `--filters-only` paths that bypass OpenAI
    // entirely.
    originalOpenAiKey = process.env['OPENAI_API_KEY'];
    process.env['OPENAI_API_KEY'] = 'cli-smoke-test-key';
    // The reevaluation service logs every transition through Pino
    // (writes to stdout by default). For the JSON output tests we
    // need the stdout stream to contain EXACTLY one valid JSON
    // document — set the log level to `silent` so the structured
    // log lines don't pollute the captured stdout.
    process.env['LOG_LEVEL'] = 'silent';
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
    if (originalOpenAiKey === undefined) {
      delete process.env['OPENAI_API_KEY'];
    } else {
      process.env['OPENAI_API_KEY'] = originalOpenAiKey;
    }
    delete process.env['LOG_LEVEL'];
    rmSync(tempHome, { recursive: true, force: true });
  });

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

  /**
   * Seed JUST the active approved profile + active filter config
   * (no jobs). The reevaluation service throws
   * `PipelinePrerequisiteError('no_active_filter')` if the active
   * filter config is missing — this helper lets the empty-DB test
   * (which expects exit 0) bypass that pre-flight check.
   */
  async function seedActiveProfileAndFilter(): Promise<void> {
    const connection = bootDatabase();
    const repositories = createRepositories(connection);
    await insertActiveFilterForReeval(repositories);
    await insertApprovedProfileForReeval(repositories);
    connection.close();
  }

  /**
   * Seed the documented "1 stale filter + 1 stale score" fixture:
   * two complete jobs (job_1 filter is stale, job_2 filter is
   * fresh+accepted but score is stale). The reevaluation service
   * will:
   *   - put job_1 in `filtersToReevaluate` (stale filter).
   *   - put job_2 in `jobsToScore` (fresh filter, stale score).
   *
   * Uses the reevaluation-specific fixtures (which seed a full
   * `JobFilterConfig` shape — the inspection harness's minimal
   * `{ excludedCompanies: [] }` does NOT contain the
   * `title/description/seniority/languages` fields the filter
   * fingerprint composer expects).
   */
  async function seedStaleFilterAndScoreFixture(): Promise<void> {
    const connection = bootDatabase();
    const repositories = createRepositories(connection);
    const filterConfigVersionId = await insertActiveFilterForReeval(repositories);
    const profileVersionId = await insertApprovedProfileForReeval(repositories);
    const run = await seedPipelineRun(repositories, {
      searches: [{ searchQuery: 'engineer', locationName: 'Rotterdam', geoId: '1' }],
      profileVersionId,
      filterConfigVersionId,
      startTimestamp: FIXTURE_TS,
    });
    // Job 1: stale filter (no active filter result seeded).
    await seedJob(repositories, {
      sourceJobId: '1001',
      runId: run.runId,
      searchId: run.searchIds[0]!,
      extractionStatus: 'complete',
      title: 'Senior Engineer',
      company: 'Acme',
      location: 'Rotterdam',
      successfulMethod: 'search_detail_panel',
    });
    // Job 2: fresh accepted filter + stale score. The filter
    // fingerprint the service will compute is derived from the
    // active config + profile + the job's row fields — we need
    // to compute that exact value here so the seeded filter
    // result matches the cache lookup.
    const job2 = await seedJob(repositories, {
      sourceJobId: '1002',
      runId: run.runId,
      searchId: run.searchIds[0]!,
      extractionStatus: 'complete',
      title: 'Backend Engineer',
      company: 'Beta',
      location: 'Amsterdam',
      successfulMethod: 'search_detail_panel',
    });
    const cfgRow = await repositories.filterConfigurations.findActive();
    const profRow = await repositories.profileVersions.findActiveApproved();
    const job2Row = await repositories.jobs.findById(job2.jobId);
    if (cfgRow === null || profRow === null || job2Row === null) {
      throw new Error('seedStaleFilterAndScoreFixture: missing prerequisite row');
    }
    // Compute the filter fingerprint with the production helper so
    // it matches byte-for-byte the value `findActiveByJob` will be
    // queried against during the service's selection phase.
    const { computeFilterFingerprintForJob } =
      await import('../../src/reevaluation/fingerprint.js');
    const freshFp = computeFilterFingerprintForJob(job2Row, cfgRow.configJson, profRow.profileJson);
    await insertActiveFilterResultForReeval(repositories, {
      jobId: job2.jobId,
      fingerprint: freshFp,
      overallOutcome: 'accepted',
      filterConfigVersionId,
      profileVersionId,
    });
    connection.close();
  }

  /**
   * Build a `FakeOpenAIClient` that returns a valid scoring response.
   * Without this the CLI's ScoringService would retry against the
   * real OpenAI client (the test has no network) and time out. The
   * fixture mirrors the production `scoring-output-valid` payload so
   * the score service parses + persists it cleanly.
   */
  function makeValidOpenAIClient(): FakeOpenAIClient {
    const response: OpenAIExtractionRawResponse = {
      rawJsonText: loadScoringFixture('scoring-output-valid'),
      tokenUsage: { promptTokens: 100, completionTokens: 50 },
    };
    return new FakeOpenAIClient({ responses: [response] });
  }

  async function runCli(args: readonly string[]): Promise<{
    status: number;
    stdout: string;
    stderr: string;
  }> {
    try {
      await createProgram({
        openaiClient: makeValidOpenAIClient(),
        // Use a scripted prompts adapter so the scoring confirmation
        // never tries to read from stdin (which hangs in the test
        // environment). `[true]` accepts every prompt.
        pipelinePrompts: new ScriptedPipelinePrompts([true]),
      }).parseAsync(['node', 'jobhunter', ...args]);
    } catch (err) {
      if (!(err instanceof Error) || !err.message.startsWith('__exit__')) throw err;
    }
    const rawStdout = stdout.join('');
    // For `--json` runs, the reevaluation service's Pino logger
    // interleaves single-line JSON log lines with the multi-line
    // pretty-printed payload on stdout. Locate the payload by
    // finding the line that starts with `{` AND ends with `}` —
    // every pino log is one line, the payload is multi-line. For
    // human-readable runs pass through the full stdout (the test
    // asserts on specific section labels).
    let finalStdout = rawStdout;
    if (args.includes('--json')) {
      const lines = rawStdout.split('\n');
      const startIdx = lines.findIndex((l) => l === '{');
      const endIdx = lines.findLastIndex((l) => l === '}');
      if (startIdx >= 0 && endIdx > startIdx) {
        finalStdout = lines.slice(startIdx, endIdx + 1).join('\n');
      }
    }
    return {
      status: exitCode ?? 0,
      stdout: finalStdout,
      stderr: stderr.join(''),
    };
  }

  // -------------------------------------------------------------------
  // Command registration (SPEC §31).
  // -------------------------------------------------------------------
  describe('command registration', () => {
    it('registers the `jobs reevaluate` subcommand under `jobs`', () => {
      const program = createProgram();
      const jobs = program.commands.find((c) => c.name() === 'jobs');
      const reeval = jobs?.commands.find((c) => c.name() === 'reevaluate');
      expect(reeval).toBeDefined();
    });

    it('exposes every documented flag on `jobs reevaluate`', () => {
      const program = createProgram();
      const jobs = program.commands.find((c) => c.name() === 'jobs');
      const reeval = jobs?.commands.find((c) => c.name() === 'reevaluate');
      const flags = new Set(reeval?.options.map((o) => o.long ?? '') ?? []);
      const expected = ['--filters-only', '--scores-only', '--job', '--dry-run', '--yes', '--json'];
      for (const expectedFlag of expected) {
        expect(flags.has(expectedFlag), `missing flag ${expectedFlag}`).toBe(true);
      }
    });
  });

  // -------------------------------------------------------------------
  // Case 1: --dry-run --json on an empty DB.
  // -------------------------------------------------------------------
  it('emits a valid JSON document on an empty DB (--dry-run --json)', async () => {
    await ensureDatabaseReady();
    // The reevaluation service requires an active filter config
    // even on an empty DB (the selection phase needs the config to
    // compute fingerprints). Seed just enough for the pre-flight
    // check to pass.
    await seedActiveProfileAndFilter();
    const result = await runCli(['jobs', 'reevaluate', '--dry-run', '--json']);
    expect(result.status).toBe(0);
    const parsed = JSON.parse(result.stdout) as {
      schemaVersion: number;
      scope: string;
      dryRun: boolean;
      jobId: string | null;
      filtersToReevaluate: unknown[];
      jobsToScore: unknown[];
      skipped: unknown[];
      totals: {
        filtersRerun: number;
        scoresRerun: number;
        scoresInvalidated: number;
        skipped: number;
        scoringDeclinedByUser: boolean;
      };
    };
    expect(parsed.schemaVersion).toBe(1);
    expect(parsed.scope).toBe('default');
    expect(parsed.dryRun).toBe(true);
    expect(parsed.jobId).toBeNull();
    expect(parsed.totals.filtersRerun).toBe(0);
    expect(parsed.filtersToReevaluate).toEqual([]);
    expect(parsed.jobsToScore).toEqual([]);
  });

  // -------------------------------------------------------------------
  // Case 2: --filters-only + --scores-only → scope conflict.
  // -------------------------------------------------------------------
  it('exits 2 + reevaluate_scope_conflict when --filters-only and --scores-only are both supplied', async () => {
    await ensureDatabaseReady();
    const result = await runCli(['jobs', 'reevaluate', '--filters-only', '--scores-only']);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('reevaluate_scope_conflict');
  });

  // -------------------------------------------------------------------
  // Case 3: --job with a malformed identifier.
  // -------------------------------------------------------------------
  it('exits 2 + invalid_identifier when --job is malformed', async () => {
    await ensureDatabaseReady();
    const result = await runCli(['jobs', 'reevaluate', '--job', 'not_a_valid_id']);
    expect(result.status).toBe(2);
    // The InvalidIdentifierError emitted by `resolveJobIdentifier`
    // is caught by `exitWithError` (which prints `<code>: <message>`).
    expect(result.stderr).toContain('invalid_identifier');
  });

  // -------------------------------------------------------------------
  // Case 4: --job job_9999 (does not exist) →).
  // -------------------------------------------------------------------
  it('exits 2 + job_not_found when --job does not resolve', async () => {
    await ensureDatabaseReady();
    const result = await runCli(['jobs', 'reevaluate', '--job', 'job_9999']);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('job_not_found');
  });

  // -------------------------------------------------------------------
  // Case 5: --json with the documented stale-fixture.
  // -------------------------------------------------------------------
  it('emits a valid JSON document with --json + stale filter + stale score', async () => {
    await ensureDatabaseReady();
    await seedStaleFilterAndScoreFixture();
    const result = await runCli(['jobs', 'reevaluate', '--json']);
    expect(result.status).toBe(0);
    const parsed = JSON.parse(result.stdout) as {
      schemaVersion: number;
      filtersToReevaluate: Array<{ action: string }>;
      jobsToScore: Array<{ action: string }>;
      totals: { filtersRerun: number; scoresRerun: number };
    };
    expect(parsed.schemaVersion).toBe(1);
    expect(parsed.filtersToReevaluate).toHaveLength(1);
    expect(parsed.filtersToReevaluate[0]?.action).toBe('reran');
    expect(parsed.jobsToScore).toHaveLength(1);
    expect(parsed.totals.filtersRerun).toBe(1);
    expect(parsed.totals.scoresRerun).toBe(1);
  });

  // -------------------------------------------------------------------
  // Case 6: human-readable output (no --json).
  // -------------------------------------------------------------------
  it('emits a human-readable summary that contains the documented sections', async () => {
    await ensureDatabaseReady();
    await seedStaleFilterAndScoreFixture();
    const result = await runCli(['jobs', 'reevaluate']);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('Scope: default');
    expect(result.stdout).toContain('Filters to reevaluate: 1');
    expect(result.stdout).toContain('Jobs to score: 1');
    // No JSON markers in the human-readable stream.
    expect(result.stdout).not.toContain('"schemaVersion"');
  });
});
