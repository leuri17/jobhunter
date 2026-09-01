import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createProgram } from '../../src/cli.js';
import { ScriptedInitPrompts } from '../../src/init/prompts.js';
import { ScriptedFilterPrompts } from '../../src/filter/prompts.js';
import type { SearchPrompts } from '../../src/search/prompts.js';
import type { ProfileApprovalPrompts } from '../../src/profile/approval-service.js';
import type { ProfileRejectionPrompts } from '../../src/profile/rejection-service.js';
import { FakeOpenAIClient } from '../../src/profile/openai/fake-client.js';
import type { OpenAIExtractionRawResponse } from '../../src/profile/openai/types.js';
import {
  createDatabaseConnection,
  type DatabaseConnection,
} from '../../src/persistence/connection.js';
import { runMigrations } from '../../src/persistence/migrations.js';
import { resolveRepoRootForMigrations } from '../../src/persistence/resolve-migrations.js';
import { resolvePlatformPaths } from '../../src/platform/paths.js';
import { createDefaultPlatformAdapter } from '../../src/platform/paths-default.js';
import { createRepositories } from '../../src/persistence/repositories/index.js';
import { createDefaultFileSystem } from '../../src/config/file-system-default.js';
import type { FileSystem } from '../../src/config/file-system.js';

/**
 *  /  — `jobhunter init` CLI smoke test.
 *
 * Mirrors the pattern from `tests/cli/configure-filters.test.ts`:
 *   1. `mkdtempSync` for `HOME` (so `resolvePlatformPaths` resolves a
 *      fresh `data/` slot under a temp directory).
 *   2. `bootDatabase()` mirrors `initializeDatabase` so we can seed the
 *      DB before the CLI re-opens it.
 *   3. `runCli(['init'])` injects scripted `InitPrompts` / `SearchPrompts`
 *      / `FilterPrompts` / `FakeOpenAIClient` via the orchestrator's
 *      constructor seam (which the CLI wires from `createProgram`'s
 *      options).
 */

function openAiResponse(): OpenAIExtractionRawResponse {
  return {
    rawJsonText: JSON.stringify({
      basics: {
        headline: 'Headline',
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
      warnings: [],
    }),
    tokenUsage: { promptTokens: 1, completionTokens: 1 },
  };
}

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

function scriptedCancelingSearchPrompts(): SearchPrompts {
  return {
    askSearchQueries: async () => ['engineer'],
    askDatePosted: async () => 86400,
    askWorkplaceTypes: async () => ['1', '2', '3'] as const,
    askLocationURLs: async () => [
      { name: 'Remote', geoId: '1', originalUrl: 'https://www.linkedin.com/jobs/search?geoId=1' },
    ],
    askLocationName: async () => 'Remote',
    askRenameLabel: async () => false,
    showPreview: async () => undefined,
    askConfirmation: async () => false, // triggers SearchCancelledError
  };
}

const APPROVAL_PROMPTS: ProfileApprovalPrompts = {
  confirmApprovalWithWarnings: async () => true,
};

const REJECTION_PROMPTS: ProfileRejectionPrompts = {
  confirmRejection: async () => true,
};

const PROFILE_LANGUAGES = [
  {
    id: 'lang-1',
    name: 'English',
    normalizedName: 'english',
    level: 'native',
    sourceReferences: [],
  },
];

function minimalProfileJson(jsonId: string): Record<string, unknown> {
  return {
    schemaVersion: 1,
    id: jsonId,
    createdAt: '2026-08-18T00:00:00.000Z',
    updatedAt: '2026-08-18T00:00:00.000Z',
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
    languages: PROFILE_LANGUAGES.map((l) => ({ ...l })),
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

interface CliTestContext {
  readonly stdout: string;
  readonly stderr: string;
  readonly status: number;
}

describe('CLI: jobhunter init', () => {
  let tempHome: string;
  let sourceFilePath: string;
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
    tempHome = mkdtempSync(join(tmpdir(), 'jobhunter-cli-init-'));
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

    // Create a temp file that `ProfileImportService.importSources` can
    // copy + hash. The CLI test does not exercise the real import path
    // because every scenario pre-seeds via `seedUsableSource`; but we
    // still need a path the importer can use if a future test adds it.
    sourceFilePath = join(tempHome, 'cv.txt');
    writeFileSync(sourceFilePath, 'placeholder cv contents', 'utf8');
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
    mkdirSync(paths.data.directory, { recursive: true });
    const filePath = paths.data.file('jobhunter.sqlite');
    const connection = createDatabaseConnection(filePath);
    runMigrations(connection, { migrationsFolder });
    return connection;
  }

  async function seedUsableSource(sha256: string): Promise<number> {
    const paths = resolvePlatformPaths(createDefaultPlatformAdapter());
    const fileSystem: FileSystem = createDefaultFileSystem();
    const connection = bootDatabase();
    try {
      const repositories = createRepositories(connection);
      // Write the source file so the importer (if invoked) can read it.
      const storedPath = paths.profileSources.file(sha256 + '.txt');
      await fileSystem.mkdir(paths.profileSources.directory, { recursive: true });
      await fileSystem.writeFile(storedPath, 'test cv content');
      return repositories.profileSources.insert({
        sourceType: 'plain_text',
        originalFilename: 'cv.txt',
        originalAbsolutePath: '/tmp/cv.txt',
        storedPath,
        mimeType: 'text/plain',
        fileSize: 16,
        sha256,
        importTimestamp: '2026-08-18T10:00:00.000Z',
        textExtractionStatus: 'success',
        textExtractionMessage: null,
      });
    } finally {
      connection.close();
    }
  }

  async function seedApprovedProfile(jsonId: string = 'prf_cli'): Promise<number> {
    const connection = bootDatabase();
    try {
      const repositories = createRepositories(connection);
      const sourceId = await repositories.profileSources.insert({
        sourceType: 'plain_text',
        originalFilename: 'cv.txt',
        originalAbsolutePath: '/tmp/cv.txt',
        storedPath: paths.profileSources.file('seed-approved.txt'),
        mimeType: 'text/plain',
        fileSize: 16,
        sha256: 'a'.repeat(64),
        importTimestamp: '2026-08-18T10:00:00.000Z',
        textExtractionStatus: 'success',
        textExtractionMessage: null,
      });
      const id = await repositories.profileVersions.insert({
        status: 'approved',
        schemaVersion: 1,
        contentHash: `hash-${jsonId}`,
        extractionFingerprint: `fp_${jsonId}`,
        sourceIds: [sourceId],
        profileJson: minimalProfileJson(jsonId),
        createdAt: '2026-08-18T10:00:00.000Z',
        updatedAt: '2026-08-18T10:00:00.000Z',
        active: true,
      });
      await repositories.profileVersions.approve(id, {
        approvedAt: '2026-08-18T10:00:00.000Z',
        supersededAt: '2026-08-18T10:00:00.000Z',
      });
      return id;
    } finally {
      connection.close();
    }
  }

  async function seedDraftProfile(
    jsonId: string = 'prf_draft',
    opts: { readonly blockingConflictCount?: number } = {},
  ): Promise<number> {
    const connection = bootDatabase();
    try {
      const repositories = createRepositories(connection);
      const sourceId = await repositories.profileSources.insert({
        sourceType: 'plain_text',
        originalFilename: 'cv.txt',
        originalAbsolutePath: '/tmp/cv.txt',
        storedPath: paths.profileSources.file('seed-draft.txt'),
        mimeType: 'text/plain',
        fileSize: 16,
        sha256: 'b'.repeat(64),
        importTimestamp: '2026-08-18T10:00:00.000Z',
        textExtractionStatus: 'success',
        textExtractionMessage: null,
      });
      const id = await repositories.profileVersions.insert({
        status: 'draft',
        schemaVersion: 1,
        contentHash: `hash-${jsonId}`,
        extractionFingerprint: `fp_${jsonId}`,
        sourceIds: [sourceId],
        profileJson: minimalProfileJson(jsonId),
        createdAt: '2026-08-18T10:00:00.000Z',
        updatedAt: '2026-08-18T10:00:00.000Z',
        active: false,
      });
      if (opts.blockingConflictCount !== undefined && opts.blockingConflictCount > 0) {
        for (let i = 0; i < opts.blockingConflictCount; i++) {
          await repositories.profileVersions.insertConflict({
            profileVersionId: id,
            conflictType: 'test_conflict',
            affectedField: 'basics.headline',
            valueSourceA: 'A',
            valueSourceB: 'B',
            sourceReferences: [],
            provisionalValue: 'A',
            explanation: 'seeded',
            resolutionStatus: 'unresolved',
            resolvedAt: null,
            resolvedValue: null,
          });
        }
      }
      return id;
    } finally {
      connection.close();
    }
  }

  async function seedActiveFilterConfig(): Promise<number> {
    const connection = bootDatabase();
    try {
      const repositories = createRepositories(connection);
      return repositories.filterConfigurations.insert({
        schemaVersion: 1,
        contentHash: 'cfg-hash-cli',
        configJson: {
          schemaVersion: 1,
          excludedCompanies: [],
          title: { excludedKeywords: [], requiredAnyKeywords: [] },
          description: { excludedKeywords: [], requiredAnyKeywords: [] },
          seniority: { maximum: null },
          languages: { accepted: ['english'], rejectWhenExplicitlyRequiresOtherLanguage: false },
        },
        createdAt: '2026-08-18T10:00:00.000Z',
        active: true,
      });
    } finally {
      connection.close();
    }
  }

  async function runCli(options: {
    readonly initPrompts: ScriptedInitPrompts;
    readonly initSearchPrompts?: SearchPrompts;
    readonly initApprovalPrompts?: ProfileApprovalPrompts;
    readonly initRejectionPrompts?: ProfileRejectionPrompts;
    readonly filterPrompts?: ScriptedFilterPrompts;
    readonly env?: Readonly<Record<string, string | undefined>>;
    readonly openaiKey?: string;
  }): Promise<CliTestContext> {
    const previousEnvKey = process.env['OPENAI_API_KEY'];
    if (options.openaiKey !== undefined) {
      process.env['OPENAI_API_KEY'] = options.openaiKey;
    } else if ('OPENAI_API_KEY' in process.env) {
      delete process.env['OPENAI_API_KEY'];
    }
    try {
      const fakeClient = new FakeOpenAIClient({ responses: [openAiResponse()] });
      const baseOptions = {
        initPrompts: options.initPrompts,
        filterPrompts: options.filterPrompts ?? new ScriptedFilterPrompts({}),
        openaiClient: fakeClient,
        initApprovalPrompts: options.initApprovalPrompts ?? APPROVAL_PROMPTS,
        initRejectionPrompts: options.initRejectionPrompts ?? REJECTION_PROMPTS,
      };
      const programOptions =
        options.initSearchPrompts !== undefined
          ? { ...baseOptions, initSearchPrompts: options.initSearchPrompts }
          : baseOptions;
      await createProgram(programOptions).parseAsync(['node', 'jobhunter', 'init']);
    } catch (err) {
      if (!(err instanceof Error) || !err.message.startsWith('__exit__')) throw err;
    } finally {
      if (previousEnvKey === undefined) {
        delete process.env['OPENAI_API_KEY'];
      } else {
        process.env['OPENAI_API_KEY'] = previousEnvKey;
      }
    }
    return {
      status: exitCode ?? 0,
      stdout: stdout.join(''),
      stderr: stderr.join(''),
    };
  }

  it('Scenario 1: fresh init, no OpenAI key — exit 0, stdout includes ready: no and openai_key missing', async () => {
    // Pre-seed everything except the OpenAI key. The orchestrator's
    // walk: paths ✓ → directories ✓ → migrations ✓ → config (materialize
    // a default) → openaiKey ✓ → search (skip, pre-seeded) → sources (skip,
    // pre-seeded) → extract incomplete (no key) → STOP.
    bootDatabase().close();
    await seedUsableSource('1'.repeat(64));
    await seedApprovedProfile();
    await seedActiveFilterConfig();

    const result = await runCli({
      initPrompts: new ScriptedInitPrompts({ confirmSummary: true }),
      initSearchPrompts: scriptedSearchPrompts(),
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('ready: no');
    expect(result.stdout).toContain('extract: incomplete');
    expect(result.stdout).toContain('next: extract');
    expect(result.stdout.endsWith('\n')).toBe(true);
  });

  it('Scenario 2: resume after pre-seeded config + source + approved profile + filter config — exit 0, ready: yes', async () => {
    // All four walk-relevant prerequisites are pre-seeded. The orchestrator
    // walks paths ✓, directories ✓, migrations ✓, config ✓ (load), openaiKey ✓,
    // search ✓ (skip), sources ✓ (skip), extract (needs new draft → run
    // FakeOpenAI → reuse a draft from cache, returns complete), approvedProfile
    // ✓ (skip), filters ✓ (skip).
    bootDatabase().close();
    await seedUsableSource('2'.repeat(64));
    await seedApprovedProfile('prf_resume');
    await seedDraftProfile('prf_resume_draft');
    await seedActiveFilterConfig();

    const result = await runCli({
      initPrompts: new ScriptedInitPrompts({ confirmSummary: true }),
      initSearchPrompts: scriptedSearchPrompts(),
      openaiKey: 'test-key',
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('ready: yes');
    expect(result.stdout).toContain('next: none');
  });

  it('Scenario 3: draft handoff with editHandoff=edit_then_return — exit 0, stdout includes next: approvedProfile', async () => {
    // Pre-seed a draft (not approved) and an active filter config.
    // After extract completes, the orchestrator asks editHandoff and
    // returns when the user picks 'edit_then_return'.
    bootDatabase().close();
    await seedUsableSource('3'.repeat(64));
    await seedDraftProfile('prf_handoff');
    await seedActiveFilterConfig();

    const result = await runCli({
      initPrompts: new ScriptedInitPrompts({
        editHandoff: 'edit_then_return',
        confirmSummary: true,
      }),
      initSearchPrompts: scriptedSearchPrompts(),
      openaiKey: 'test-key',
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('ready: no');
    expect(result.stdout).toContain('next: approvedProfile');
    expect(result.stdout).toContain('approvedProfile: not_started');
  });

  it('Scenario 4: blocking conflicts with editHandoff=approve_now — exit 0, stdout includes blocking_conflicts_unresolved', async () => {
    // Pre-seed a draft with one blocking conflict. The orchestrator
    // catches BlockingConflictsUnresolvedError and surfaces the typed
    // step-level failure with errorCode='blocking_conflicts_unresolved'.
    bootDatabase().close();
    await seedUsableSource('4'.repeat(64));
    await seedDraftProfile('prf_blocking', { blockingConflictCount: 1 });
    await seedActiveFilterConfig();

    const result = await runCli({
      initPrompts: new ScriptedInitPrompts({
        editHandoff: 'approve_now',
        confirmSummary: true,
      }),
      initSearchPrompts: scriptedSearchPrompts(),
      openaiKey: 'test-key',
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('ready: no');
    expect(result.stdout).toContain(
      'approvedProfile: failed [errorCode=blocking_conflicts_unresolved]',
    );
    expect(result.stdout).toContain('next: approvedProfile');
  });

  it('Scenario 5: cancellation via scripted search confirm=false — exit 130', async () => {
    // No pre-seeding. The orchestrator walks to search and the
    // scripted cancel trigger fires. The typed SearchCancelledError
    // propagates to the CLI boundary; the CLI's try/finally closes
    // the handle (asserted via the captured exit code) and exitWithError
    // renders exit code 130.
    bootDatabase().close();

    const result = await runCli({
      initPrompts: new ScriptedInitPrompts({}),
      initSearchPrompts: scriptedCancelingSearchPrompts(),
    });

    expect(result.status).toBe(130);
  });

  it('Scenario 6: missing filter config without an approved profile — exit 3', async () => {
    // Pre-seed a draft (no approved profile), sources, but NO filter
    // config. The orchestrator walks to step 9 (approvedProfile), the
    // draft is unapproved so askEditHandoff is called. With
    // `editHandoff: 'reject'`, ProfileRejectionService rejects the
    // draft (no prior approved profile exists, so the rejection just
    // marks the draft as rejected). The walk then advances to step 10
    // (filters): there is no active filter config, so the orchestrator
    // calls ConfigureFiltersService.run(). That service throws
    // `NoActiveProfileError` because no approved profile exists. The
    // orchestrator's `catch` block preserves typed ApplicationError
    // subclasses (init-service.ts:728-729), so NoActiveProfileError
    // propagates to the CLI boundary, where exitWithError maps it to
    // exit code 3 (MissingRequired). Stderr includes 'no_active_profile'.
    bootDatabase().close();
    await seedUsableSource('6'.repeat(64));
    await seedDraftProfile('prf_no_filter');

    const result = await runCli({
      initPrompts: new ScriptedInitPrompts({
        editHandoff: 'reject',
        confirmSummary: true,
      }),
      initSearchPrompts: scriptedSearchPrompts(),
      openaiKey: 'test-key',
    });

    expect(result.status).toBe(3);
    expect(result.stderr).toContain('no_active_profile');
  });

  it('Scenario 7: soft-exit on fully-ready init with confirmSummary=false — exit 0, stdout includes the summary', async () => {
    // Pre-seed everything so the walk completes with ready: true.
    // ScriptedInitPrompts has confirmSummary: false; the orchestrator
    // treats this as a SOFT exit (returns the summary, no throw, exit 0).
    bootDatabase().close();
    await seedUsableSource('7'.repeat(64));
    await seedApprovedProfile('prf_ready');
    await seedDraftProfile('prf_ready_draft');
    await seedActiveFilterConfig();

    const result = await runCli({
      initPrompts: new ScriptedInitPrompts({ confirmSummary: false }),
      initSearchPrompts: scriptedSearchPrompts(),
      openaiKey: 'test-key',
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('ready: yes');
  });
});

const paths = resolvePlatformPaths(createDefaultPlatformAdapter());
