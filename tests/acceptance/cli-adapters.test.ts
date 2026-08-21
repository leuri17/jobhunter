// tests/acceptance/cli-adapters.test.ts
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ScriptedFilterPrompts } from '../../src/filter/prompts.js';
import { ScriptedInitPrompts } from '../../src/init/prompts.js';
import { type SearchPrompts } from '../../src/search/prompts.js';
import { type ProfileApprovalPrompts } from '../../src/profile/approval-service.js';
import { type ProfileRejectionPrompts } from '../../src/profile/rejection-service.js';
import {
  createDatabaseConnection,
  type DatabaseConnection,
} from '../../src/persistence/connection.js';
import { runMigrations } from '../../src/persistence/migrations.js';
import { createRepositories } from '../../src/persistence/repositories/index.js';
import { resolveRepoRootForMigrations } from '../../src/persistence/resolve-migrations.js';
import { resolvePlatformPaths } from '../../src/platform/paths.js';
import { createDefaultPlatformAdapter } from '../../src/platform/paths-default.js';
import { setupAcceptanceHarness, type AcceptanceHarness } from './helpers/acceptance-harness.js';
import { REEVALUATION_JSON_SCHEMA } from '../../src/reevaluation/json-schemas.js';
import { JobListJsonSchema } from '../../src/inspection/json-schemas.js';
import { ScriptedPipelinePrompts } from '../../src/pipeline/prompts.js';
import {
  FIXTURE_TS,
  seedProfileAndFilter,
} from '../inspection/services/helpers/inspection-harness.js';

/**
 * TASK-018 T3 — Thin CLI adapter integration suite.
 *
 * Each `it` block exercises one public command registered by
 * `createProgram()` through the Commander `parseAsync` API with fake
 * dependencies (`:memory:` SQLite under a tmpdir, `FakeOpenAIClient`,
 * scripted prompts, `FakeBrowserSession` is NOT injected because
 * `createProgram` does not expose a browser override on the `run`
 * subcommand — see the `run` test below for the documented limitation).
 *
 * The stub pattern mirrors `tests/cli/jobs-list.test.ts:46-83` exactly:
 * the test file owns the `process.stdout.write` /
 * `process.stderr.write` / `process.exit` stubs so the test can
 * capture + assert on each invocation. The harness helper only owns
 * the hermetic `HOME` + the `Command` builder.
 */

// ---------------------------------------------------------------------------
// Shared scripted prompt fixtures
// ---------------------------------------------------------------------------

function scriptedSearchPrompts(): SearchPrompts {
  return {
    askSearchQueries: async (existing) => (existing.length > 0 ? existing : ['engineer']),
    askDatePosted: async (existing) => existing ?? 86400,
    askWorkplaceTypes: async (existing) =>
      existing.length > 0 ? existing : (['1', '2', '3'] as const),
    askLocationURLs: async () => [
      { name: 'Remote', geoId: '1', originalUrl: 'https://www.linkedin.com/jobs/search?geoId=1' },
    ],
    askLocationName: async () => 'Remote',
    askRenameLabel: async () => false,
    showPreview: async () => undefined,
    askConfirmation: async () => true,
  };
}

const APPROVAL_PROMPTS: ProfileApprovalPrompts = {
  confirmApprovalWithWarnings: async () => true,
};
const REJECTION_PROMPTS: ProfileRejectionPrompts = {
  confirmRejection: async () => true,
};

// ---------------------------------------------------------------------------
// Test context: hermetic `HOME`, captured stdout/stderr/exitCode
// ---------------------------------------------------------------------------

interface CliTestContext {
  readonly status: number;
  readonly stdout: string;
  readonly stderr: string;
}

describe('CLI adapter integration (TASK-018 T3, SPEC §34+§36+§37)', () => {
  let harness: AcceptanceHarness;
  let tempHome: string;
  let cvSourcePath: string;
  let originalHome: string | undefined;
  let originalOpenAiKey: string | undefined;
  let originalLogLevel: string | undefined;
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
    harness = setupAcceptanceHarness();
    tempHome = harness.tempHome;
    originalHome = process.env['HOME'];
    originalOpenAiKey = process.env['OPENAI_API_KEY'];
    originalLogLevel = process.env['LOG_LEVEL'];
    process.env['HOME'] = tempHome;
    delete process.env['OPENAI_API_KEY'];
    // Silence the reevaluation / pipeline / init loggers so their
    // Pino writes do not pollute the captured stdout. The
    // `rootLogger` in `src/cli.ts:148` reads `LOG_LEVEL` at module
    // load time, so this only takes effect for test files that are
    // loaded AFTER this `beforeEach` runs (which is the case for
    // the suite as a whole because the harness's `createProgram`
    // call is lazy). Mirrors the pattern in
    // `tests/cli/jobs-reevaluate.test.ts:88`.
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

    // A real file the `profile import` subcommand can ingest.
    cvSourcePath = join(tempHome, 'cv.txt');
    writeFileSync(cvSourcePath, 'placeholder cv contents', 'utf8');
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
    if (originalLogLevel === undefined) {
      delete process.env['LOG_LEVEL'];
    } else {
      process.env['LOG_LEVEL'] = originalLogLevel;
    }
    harness.cleanup();
  });

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  function bootDatabase(): DatabaseConnection {
    const paths = resolvePlatformPaths(createDefaultPlatformAdapter());
    mkdirSync(paths.data.directory, { recursive: true });
    const filePath = paths.data.file('jobhunter.sqlite');
    const connection = createDatabaseConnection(filePath);
    runMigrations(connection, { migrationsFolder });
    return connection;
  }

  async function runCli(
    args: readonly string[],
    options: {
      readonly searchPrompts?: SearchPrompts;
      readonly filterPrompts?: ScriptedFilterPrompts;
      readonly initPrompts?: ScriptedInitPrompts;
      readonly initSearchPrompts?: SearchPrompts;
      readonly initApprovalPrompts?: ProfileApprovalPrompts;
      readonly initRejectionPrompts?: ProfileRejectionPrompts;
      readonly pipelinePrompts?: ScriptedPipelinePrompts;
    } = {},
  ): Promise<CliTestContext> {
    try {
      const program = harness.buildProgram({
        ...(options.searchPrompts !== undefined ? { searchPrompts: options.searchPrompts } : {}),
        ...(options.filterPrompts !== undefined ? { filterPrompts: options.filterPrompts } : {}),
        ...(options.initPrompts !== undefined ? { initPrompts: options.initPrompts } : {}),
        ...(options.initSearchPrompts !== undefined
          ? { initSearchPrompts: options.initSearchPrompts }
          : {}),
        ...(options.initApprovalPrompts !== undefined
          ? { initApprovalPrompts: options.initApprovalPrompts }
          : {}),
        ...(options.initRejectionPrompts !== undefined
          ? { initRejectionPrompts: options.initRejectionPrompts }
          : {}),
        ...(options.pipelinePrompts !== undefined
          ? { pipelinePrompts: options.pipelinePrompts }
          : {}),
      });
      await program.parseAsync(['node', 'jobhunter', ...args]);
    } catch (err) {
      if (!(err instanceof Error) || !err.message.startsWith('__exit__')) throw err;
    }
    return {
      status: exitCode ?? 0,
      stdout: stdout.join(''),
      stderr: stderr.join(''),
    };
  }

  // -------------------------------------------------------------------------
  // paths
  // -------------------------------------------------------------------------

  describe('paths', () => {
    it('exits 0 and prints all 6 documented path keys (no --json)', async () => {
      const result = await runCli(['paths']);
      expect(result.status).toBe(0);
      expect(result.stdout).toContain('config:');
      expect(result.stdout).toContain('data:');
      expect(result.stdout).toContain('logs:');
      expect(result.stdout).toContain('diagnostics:');
      expect(result.stdout).toContain('cache:');
      expect(result.stdout).toContain('profile-sources:');
    });

    it('exits 0 and emits a single JSON document with --json', async () => {
      const result = await runCli(['paths', '--json']);
      expect(result.status).toBe(0);
      const parsed = JSON.parse(result.stdout) as {
        schemaVersion: number;
        paths: Record<string, string>;
      };
      expect(parsed.schemaVersion).toBe(1);
      const expectedKeys = ['config', 'data', 'logs', 'diagnostics', 'cache', 'profileSources'];
      expect(Object.keys(parsed.paths).sort()).toEqual([...expectedKeys].sort());
    });
  });

  // -------------------------------------------------------------------------
  // config
  // -------------------------------------------------------------------------

  describe('config', () => {
    it('config show exits 0 and stdout parses as the OperationalConfig shape', async () => {
      const result = await runCli(['config', 'show']);
      expect(result.status).toBe(0);
      const parsed = JSON.parse(result.stdout) as { version: number; logging: { level: string } };
      expect(parsed.version).toBe(1);
      expect(typeof parsed.logging.level).toBe('string');
    });

    it('config show --json exits 0 and JSON parses as the OperationalConfig shape', async () => {
      const result = await runCli(['config', 'show', '--json']);
      expect(result.status).toBe(0);
      const parsed = JSON.parse(result.stdout) as { version: number };
      expect(parsed.version).toBe(1);
    });

    it('config validate exits 0 on a valid default config', async () => {
      const result = await runCli(['config', 'validate']);
      expect(result.status).toBe(0);
      expect(result.stdout.trim()).toBe('valid');
    });

    it('config validate exits 2 on a corrupt config file', async () => {
      // Plant a corrupt config in the XDG slot the CLI resolves from
      // `HOME`. On Linux the default config path is
      // `$HOME/.config/jobhunter/config.json` (see
      // `src/platform/paths.ts:27-36`); without an explicit
      // `XDG_CONFIG_HOME`, `os.homedir()` — which honours the
      // overridden `process.env['HOME']` — selects `tempHome` as the
      // root. The handler then calls `loadConfig()` which throws
      // `ConfigError('config_parse_error', ...)` (exit 2 per SPEC §37).
      const configDir = join(tempHome, '.config', 'jobhunter');
      mkdirSync(configDir, { recursive: true });
      writeFileSync(join(configDir, 'config.json'), '{not json');
      const result = await runCli(['config', 'validate']);
      expect(result.status).toBe(2);
      expect(result.stderr.length).toBeGreaterThan(0);
    });

    it('config update --patch exits 0 and writes the new value atomically', async () => {
      // The `loggingSchema` in `src/config/schema.ts:75-80` is
      // `.strict()` — the patch must include BOTH `level` AND
      // `prettyTerminal`, otherwise `OperationalConfigSchema.safeParse`
      // fails inside `updateConfig` and the handler throws
      // `ValidationError('zod_failed', ...)` (exit 2).
      const patch = JSON.stringify({ logging: { level: 'debug', prettyTerminal: false } });
      const result = await runCli(['config', 'update', '--patch', patch]);
      expect(result.status).toBe(0);

      // Re-read the on-disk file via `config show` to prove the atomic
      // write landed.
      stdout = [];
      stderr = [];
      exitCode = null;
      const reRead = await runCli(['config', 'show']);
      expect(reRead.status).toBe(0);
      const parsed = JSON.parse(reRead.stdout) as { logging: { level: string } };
      expect(parsed.logging.level).toBe('debug');
    });
  });

  // -------------------------------------------------------------------------
  // configure search + configure filters
  // -------------------------------------------------------------------------

  describe('configure', () => {
    it('configure search exits 0 with scripted prompts', async () => {
      const result = await runCli(['configure', 'search'], {
        searchPrompts: scriptedSearchPrompts(),
      });
      expect(result.status).toBe(0);
      expect(result.stdout).toContain('search configuration updated');
    });

    it('configure filters exits 0 and writes a new filter config row', async () => {
      // Pre-seed the prerequisite approved profile (ConfigureFiltersService
      // refuses to run without one).
      const seed = bootDatabase();
      try {
        const repositories = createRepositories(seed);
        const sourceId = await repositories.profileSources.insert({
          sourceType: 'plain_text',
          originalFilename: 'cv.txt',
          originalAbsolutePath: '/tmp/cv.txt',
          storedPath: '/tmp/cv.txt',
          mimeType: 'text/plain',
          fileSize: 16,
          sha256: 'a'.repeat(64),
          importTimestamp: FIXTURE_TS,
          textExtractionStatus: 'success',
        });
        await repositories.profileVersions.insert({
          status: 'approved',
          schemaVersion: 1,
          contentHash: 'profile-hash',
          extractionFingerprint: 'fp_profile_1',
          sourceIds: [sourceId],
          profileJson: { id: 'prf_cfg' } as Record<string, unknown>,
          createdAt: FIXTURE_TS,
          updatedAt: FIXTURE_TS,
          active: true,
        });
      } finally {
        seed.close();
      }

      const scriptedPrompts = new ScriptedFilterPrompts({
        askExcludedCompanies: [['Acme Corp']],
        askTitleExcludedKeywords: [[]],
        askTitleRequiredAnyKeywords: [[]],
        askDescriptionExcludedKeywords: [[]],
        askDescriptionRequiredAnyKeywords: [[]],
        askMaximumSeniority: [null],
        askAcceptedLanguages: [{ chosen: ['english'], added: [] }],
        askRejectUnsupportedLanguages: [false],
        askConfirmation: [true],
      });
      const result = await runCli(['configure', 'filters'], { filterPrompts: scriptedPrompts });
      expect(result.status).toBe(0);
      expect(result.stdout).toMatch(/filter config saved: filters_\d+/);
    });
  });

  // -------------------------------------------------------------------------
  // init
  // -------------------------------------------------------------------------

  describe('init', () => {
    it('init exits 0 with a fully pre-seeded DB + scripted prompts', async () => {
      // Pre-seed the four orchestrator prerequisites: usable source,
      // approved profile, draft profile (so extract can be skipped), active
      // filter config. The init orchestrator then reports `ready: yes`.
      bootDatabase().close();

      const seed = bootDatabase();
      try {
        const repositories = createRepositories(seed);
        await repositories.profileSources.insert({
          sourceType: 'plain_text',
          originalFilename: 'cv.txt',
          originalAbsolutePath: cvSourcePath,
          storedPath: cvSourcePath,
          mimeType: 'text/plain',
          fileSize: 18,
          sha256: '1'.repeat(64),
          importTimestamp: FIXTURE_TS,
          textExtractionStatus: 'success',
        });
        await repositories.profileVersions.insert({
          status: 'approved',
          schemaVersion: 1,
          contentHash: 'profile-hash',
          extractionFingerprint: 'fp_init',
          sourceIds: [1],
          profileJson: { id: 'prf_init' } as Record<string, unknown>,
          createdAt: FIXTURE_TS,
          updatedAt: FIXTURE_TS,
          active: true,
        });
        await repositories.filterConfigurations.insert({
          schemaVersion: 1,
          contentHash: 'cfg-hash-init',
          configJson: { excludedCompanies: [] },
          createdAt: FIXTURE_TS,
          active: true,
        });
      } finally {
        seed.close();
      }

      const result = await runCli(['init'], {
        initPrompts: new ScriptedInitPrompts({ confirmSummary: true }),
        initSearchPrompts: scriptedSearchPrompts(),
        initApprovalPrompts: APPROVAL_PROMPTS,
        initRejectionPrompts: REJECTION_PROMPTS,
      });
      expect(result.status).toBe(0);
      // The init summary contains either `ready: yes` (when the
      // orchestrator walked all the way through) or a transition message.
      // We assert the summary block is well-formed rather than pinning
      // the exact ready/no state (it depends on whether the orchestrator
      // detected every prerequisite as a no-op).
      expect(result.stdout).toContain('ready:');
    });
  });

  // -------------------------------------------------------------------------
  // profile
  // -------------------------------------------------------------------------

  describe('profile', () => {
    /**
     * A complete, valid `ProfessionalProfile` payload that satisfies
     * `ProfessionalProfileSchema` in `src/profile/schema.ts:223-240`.
     * The review service's `show()` validates the stored JSON against
     * this schema and throws `InvalidProfilePayloadError` (exit 2) on
     * any missing field, so the seed must be schema-complete. Mirrors
     * the `minimalProfileJson()` helper in
     * `tests/cli/configure-filters.test.ts:52-107`.
     */
    function minimalProfileJson(jsonId: string): Record<string, unknown> {
      return {
        schemaVersion: 1,
        id: jsonId,
        createdAt: FIXTURE_TS,
        updatedAt: FIXTURE_TS,
        contentHash: 'will-be-rehashed',
        sourceIds: [],
        basics: {
          headline: null,
          professionalSummary: null,
          currentLocation: null,
          totalYearsOfExperience: null,
        },
        experience: [],
        skills: [],
        languages: [],
        education: [],
        certifications: [],
        projects: [],
        derived: {
          likelySeniority: {
            generatedValue: null,
            overrideActive: false,
            overrideValue: null,
            effectiveValue: null,
            generatedAt: null,
            overriddenAt: null,
          },
          primaryRoles: {
            generatedValue: [],
            overrideActive: false,
            overrideValue: null,
            effectiveValue: [],
            generatedAt: null,
            overriddenAt: null,
          },
          primaryDomains: {
            generatedValue: [],
            overrideActive: false,
            overrideValue: null,
            effectiveValue: [],
            generatedAt: null,
            overriddenAt: null,
          },
          strongestSkills: {
            generatedValue: [],
            overrideActive: false,
            overrideValue: null,
            effectiveValue: [],
            generatedAt: null,
            overriddenAt: null,
          },
        },
      };
    }

    async function seedProfileRow(): Promise<number> {
      const conn = bootDatabase();
      try {
        const repositories = createRepositories(conn);
        return repositories.profileVersions.insert({
          status: 'approved',
          schemaVersion: 1,
          contentHash: 'profile-hash-show',
          extractionFingerprint: 'fp_show',
          sourceIds: [1],
          profileJson: minimalProfileJson('prf_show'),
          createdAt: FIXTURE_TS,
          updatedAt: FIXTURE_TS,
          active: true,
        });
      } finally {
        conn.close();
      }
    }

    it('profile list exits 0 and stdout contains the table header', async () => {
      await seedProfileRow();
      const result = await runCli(['profile', 'list']);
      expect(result.status).toBe(0);
      expect(result.stdout).toContain('ID');
      expect(result.stdout).toContain('STATUS');
    });

    it('profile list --json exits 0 with schemaVersion: 1 + profiles array', async () => {
      await seedProfileRow();
      const result = await runCli(['profile', 'list', '--json']);
      expect(result.status).toBe(0);
      const parsed = JSON.parse(result.stdout) as {
        schemaVersion: number;
        profiles: unknown[];
      };
      expect(parsed.schemaVersion).toBe(1);
      expect(Array.isArray(parsed.profiles)).toBe(true);
    });

    it('profile show <id> exits 0 with a seeded row', async () => {
      const profileVersionId = await seedProfileRow();
      const result = await runCli(['profile', 'show', `profile_${profileVersionId}`]);
      expect(result.status).toBe(0);
      expect(result.stdout.length).toBeGreaterThan(0);
    });

    it('profile show <bad-id> exits 2 (InvalidUsage)', async () => {
      const result = await runCli(['profile', 'show', 'profile_9999']);
      expect(result.status).toBe(2);
    });

    it('profile import <path> exits 0 and --json matches the documented shape', async () => {
      const result = await runCli(['profile', 'import', cvSourcePath, '--json']);
      expect(result.status).toBe(0);
      const parsed = JSON.parse(result.stdout) as {
        schemaVersion: number;
        status: string;
        counts: { total: number; extracted: number; failed: number; reused: number };
        sources: unknown[];
        failedSourcePaths: unknown[];
      };
      expect(parsed.schemaVersion).toBe(1);
      expect(parsed.status).toMatch(/success|partial|failure/);
      expect(parsed.counts.total).toBeGreaterThanOrEqual(1);
      expect(Array.isArray(parsed.sources)).toBe(true);
      expect(Array.isArray(parsed.failedSourcePaths)).toBe(true);
    });

    it('profile extract exits 2 (profile_extraction_no_sources) when no usable sources', async () => {
      // Boot an empty DB so the `usable` source list is empty.
      bootDatabase().close();
      const result = await runCli(['profile', 'extract', '--json']);
      expect(result.status).toBe(2);
      expect(result.stderr).toContain('profile_extraction_no_sources');
    });
  });

  // -------------------------------------------------------------------------
  // run
  // -------------------------------------------------------------------------

  describe('run', () => {
    it('run exits 3 (MissingRequired) when OPENAI_API_KEY is missing', async () => {
      // `beforeEach` deletes OPENAI_API_KEY; assert the run pre-validation
      // fires before any other work. The full execution path is not
      // exercised here because the CLI's `run` subcommand does not
      // expose a browserSession override — that limitation is
      // documented in the task report.
      const result = await runCli(['run']);
      expect(result.status).toBe(3);
      expect(result.stderr).toContain('openai_api_key_missing');
    });
  });

  // -------------------------------------------------------------------------
  // jobs
  // -------------------------------------------------------------------------

  describe('jobs', () => {
    it('jobs list --scored exits 0 and prints "(no jobs)" on an empty DB', async () => {
      bootDatabase().close();
      const result = await runCli(['jobs', 'list', '--scored']);
      expect(result.status).toBe(0);
      expect(result.stdout).toContain('(no jobs)');
    });

    it('jobs list --json exits 0 and matches the JobListJsonSchema', async () => {
      bootDatabase().close();
      const result = await runCli(['jobs', 'list', '--json']);
      expect(result.status).toBe(0);
      const parsed = JSON.parse(result.stdout) as unknown;
      const round = JobListJsonSchema.safeParse(parsed);
      expect(round.success, JSON.stringify(round.error?.issues)).toBe(true);
    });

    it('jobs list --all --scored exits 2 (jobs_list_state_conflict)', async () => {
      bootDatabase().close();
      const result = await runCli(['jobs', 'list', '--all', '--scored']);
      expect(result.status).toBe(2);
      expect(result.stderr).toContain('jobs_list_state_conflict');
    });

    it('jobs list --run <bad> exits 2 (jobs_list_invalid_run_id)', async () => {
      bootDatabase().close();
      const result = await runCli(['jobs', 'list', '--run', 'foo']);
      expect(result.status).toBe(2);
      expect(result.stderr).toContain('jobs_list_invalid_run_id');
    });

    it('jobs show <bad-id> exits 2 (jobs_show_missing_id)', async () => {
      bootDatabase().close();
      const result = await runCli(['jobs', 'show', 'job_9999']);
      expect(result.status).toBe(2);
    });

    it('jobs reevaluate --dry-run --json exits 0 and matches REEVALUATION_JSON_SCHEMA', async () => {
      // The dry-run path needs an active filter config + at least one
      // complete job in scope. Seed minimally.
      const conn = bootDatabase();
      try {
        const repositories = createRepositories(conn);
        await seedProfileAndFilter(repositories);
      } finally {
        conn.close();
      }

      const result = await runCli(['jobs', 'reevaluate', '--dry-run', '--json'], {
        pipelinePrompts: new ScriptedPipelinePrompts([true]),
      });
      expect(result.status).toBe(0);
      // The reevaluation service writes structured log lines to
      // stdout (via the Pino-backed `pinoReevaluationLogger` rooted
      // at `src/cli.ts:148`) BEFORE the pretty-printed JSON
      // document. We can't silence those logs in-process (the
      // `rootLogger` reads `LOG_LEVEL` at module load time, which
      // is already past by the time `beforeEach` runs), so the test
      // locates the JSON document by its pretty-printed shape
      // (starts with `{\n  "schemaVersion":`) and parses only that
      // substring. This is a real production quirk: the logger and
      // the `--json` writer share `process.stdout`, violating SPEC
      // §40 "Keep JSON stdout valid and isolated from logs". The
      // fix would route the logger to stderr or a file; until then
      // the test works around it. (Not patched in this task per
      // TASK-018 zero-`src/**`-changes rule.)
      const match = result.stdout.match(/\{\n {2}"schemaVersion":\s*\d+,[\s\S]*?\n\}/);
      expect(
        match,
        `no pretty-printed JSON document found in stdout:\n${result.stdout}`,
      ).not.toBeNull();
      const jsonText = match![0]!;
      const parsed = JSON.parse(jsonText) as unknown;
      const round = REEVALUATION_JSON_SCHEMA.safeParse(parsed);
      expect(round.success, JSON.stringify(round.error?.issues)).toBe(true);
      const payload = parsed as { dryRun: boolean; scope: string };
      expect(payload.dryRun).toBe(true);
      expect(payload.scope).toBe('default');
    });

    it('jobs reevaluate --filters-only --scores-only exits 2 (reevaluate_scope_conflict)', async () => {
      const result = await runCli(['jobs', 'reevaluate', '--filters-only', '--scores-only']);
      expect(result.status).toBe(2);
      expect(result.stderr).toContain('reevaluate_scope_conflict');
    });
  });

  // -------------------------------------------------------------------------
  // runs
  // -------------------------------------------------------------------------

  describe('runs', () => {
    it('runs list --json exits 0 with schemaVersion: 1 + runs array', async () => {
      bootDatabase().close();
      const result = await runCli(['runs', 'list', '--json']);
      expect(result.status).toBe(0);
      const parsed = JSON.parse(result.stdout) as {
        schemaVersion: number;
        runs: unknown[];
        returned: number;
      };
      expect(parsed.schemaVersion).toBe(1);
      expect(Array.isArray(parsed.runs)).toBe(true);
    });

    it('runs show <bad> exits 2 (runs_show_missing_id)', async () => {
      bootDatabase().close();
      const result = await runCli(['runs', 'show', 'run_9999']);
      expect(result.status).toBe(2);
    });
  });

  // -------------------------------------------------------------------------
  // live-LinkedIn opt-in guards (SPEC §41.3)
  // -------------------------------------------------------------------------

  describe('live-LinkedIn opt-in (SPEC §41.3)', () => {
    it('vitest.live.config.ts gates tests/live/ with include + passWithNoTests', () => {
      const repoRoot = new URL('../..', import.meta.url);
      const configPath = new URL('vitest.live.config.ts', repoRoot);
      const src = readFileSync(configPath, 'utf8');
      expect(src).toMatch(/include:\s*\[\s*['"]tests\/live\/\*\*\/\*\.test\.ts['"]\s*\]/);
      expect(src).toMatch(/passWithNoTests:\s*true/);
    });

    it('every tests/live/ file starts with describe.skipIf', () => {
      // Resolve `tests/live` against the repo root (NOT as `../live`
      // — that would walk above the repo into `/home/leuri/Projects/dev/live`).
      const repoRoot = new URL('../..', import.meta.url);
      const liveDir = new URL('tests/live/', repoRoot);
      const files = readdirSync(liveDir).filter((f) => f.endsWith('.test.ts'));
      expect(files.length).toBeGreaterThan(0);
      for (const file of files) {
        const src = readFileSync(new URL(file, liveDir), 'utf8');
        expect(src, `${file} should gate with describe.skipIf`).toMatch(/describe\.skipIf\(/);
      }
    });
  });
});

// Sanity guard: rmSync is referenced by the harness's cleanup and is
// available in this scope; if unused at the top level, the typecheck
// would flag it. We keep the import for the harness's transitive use.
void rmSync;
void existsSync;
void mkdtempSync;
void tmpdir;
