import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createProgram } from '../../src/cli.js';
import { ScriptedFilterPrompts } from '../../src/filter/prompts.js';
import { type JobFilterConfig } from '../../src/filter/schema.js';
import {
  createDatabaseConnection,
  type DatabaseConnection,
} from '../../src/persistence/connection.js';
import { runMigrations } from '../../src/persistence/migrations.js';
import { resolveRepoRootForMigrations } from '../../src/persistence/resolve-migrations.js';
import { resolvePlatformPaths } from '../../src/platform/paths.js';
import { createDefaultPlatformAdapter } from '../../src/platform/paths-default.js';
import { createRepositories } from '../../src/persistence/repositories/index.js';

/**
 * TASK-010 Task 11 — `configure filters` CLI smoke test.
 *
 * The test mirrors `tests/cli/profile-list.test.ts` (TASK-009). It sets
 * `HOME` to a temp directory so `resolvePlatformPaths` resolves a fresh
 * `data/` slot, runs `runMigrations` to create the schema, seeds the
 * prerequisite rows, closes the seed connection, then drives the CLI
 * with a `ScriptedFilterPrompts` injected via `createProgram`'s new
 * `filterPrompts` option.
 */

function minimalConfig(): JobFilterConfig {
  return {
    schemaVersion: 1,
    excludedCompanies: [],
    title: { excludedKeywords: [], requiredAnyKeywords: [] },
    description: { excludedKeywords: [], requiredAnyKeywords: [] },
    seniority: { maximum: null },
    languages: { accepted: [], rejectWhenExplicitlyRequiresOtherLanguage: false },
  };
}

const PROFILE_LANGUAGES = [
  {
    id: 'lang-1',
    name: 'English',
    normalizedName: 'english',
    level: 'native',
    sourceReferences: [],
  },
];

function minimalProfileJson(): Record<string, unknown> {
  return {
    schemaVersion: 1,
    id: 'prf_1',
    createdAt: '2026-08-17T00:00:00.000Z',
    updatedAt: '2026-08-17T00:00:00.000Z',
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

describe('CLI: jobhunter configure filters — wiring', () => {
  let tempHome: string;
  let originalHome: string | undefined;
  let stdout: string[] = [];
  let stderr: string[] = [];
  let exitCode: number | null = null;
  let originalExit: typeof process.exit | undefined;
  let originalOut: typeof process.stdout.write | undefined;
  let originalErr: typeof process.stderr.write | undefined;
  let migrationsFolder: string;

  beforeEach(async () => {
    if (originalExit === undefined) {
      originalExit = process.exit;
      originalOut = process.stdout.write;
      originalErr = process.stderr.write;
    }
    tempHome = mkdtempSync(join(tmpdir(), 'jobhunter-cli-configure-filters-'));
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
    // Manually mirror `initializeDatabase` so we can seed the DB before
    // the CLI re-opens it. The CLI opens its own connection on the
    // next call; SQLite serializes writes so the two connections don't
    // collide.
    const paths = resolvePlatformPaths(createDefaultPlatformAdapter());
    mkdirSync(paths.data.directory, { recursive: true });
    const filePath = paths.data.file('jobhunter.sqlite');
    const connection = createDatabaseConnection(filePath);
    runMigrations(connection, { migrationsFolder });
    return connection;
  }

  async function seedApprovedProfile(connection: DatabaseConnection): Promise<number> {
    const repositories = createRepositories(connection);
    const sourceId = await repositories.profileSources.insert({
      sourceType: 'pdf',
      originalFilename: 'source.pdf',
      originalAbsolutePath: '/tmp/source.pdf',
      storedPath: '/opt/source.pdf',
      mimeType: 'application/pdf',
      fileSize: 100,
      sha256: 'a'.repeat(64),
      importTimestamp: '2026-08-17T10:00:00.000Z',
      textExtractionStatus: 'success',
    });
    return repositories.profileVersions.insert({
      status: 'approved',
      schemaVersion: 1,
      contentHash: 'profile-hash',
      extractionFingerprint: 'fp_profile_1',
      sourceIds: [sourceId],
      profileJson: minimalProfileJson(),
      createdAt: '2026-08-17T10:00:00.000Z',
      updatedAt: '2026-08-17T10:00:00.000Z',
      active: true,
    });
  }

  async function seedPriorActiveConfig(connection: DatabaseConnection): Promise<number> {
    const repositories = createRepositories(connection);
    return repositories.filterConfigurations.insert({
      schemaVersion: 1,
      contentHash: 'cfg-hash-prior',
      configJson: {
        ...minimalConfig(),
        excludedCompanies: ['OldCo'],
      },
      createdAt: '2026-08-17T10:00:00.000Z',
      active: true,
    });
  }

  async function runCli(
    args: readonly string[],
    options: {
      filterPrompts: ScriptedFilterPrompts;
    },
  ): Promise<{ status: number; stdout: string; stderr: string }> {
    try {
      await createProgram({ filterPrompts: options.filterPrompts }).parseAsync([
        'node',
        'jobhunter',
        ...args,
      ]);
    } catch (err) {
      if (!(err instanceof Error) || !err.message.startsWith('__exit__')) throw err;
    }
    return {
      status: exitCode ?? 0,
      stdout: stdout.join(''),
      stderr: stderr.join(''),
    };
  }

  it('saves a fresh config: exit 0, stdout includes the new id, DB has the new row, prior config deactivated', async () => {
    const seed = bootDatabase();
    try {
      await seedApprovedProfile(seed);
    } finally {
      seed.close();
    }
    const priorConfigId = await (async () => {
      const s = bootDatabase();
      try {
        return await seedPriorActiveConfig(s);
      } finally {
        s.close();
      }
    })();

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
    const match = result.stdout.match(/filter config saved: filters_(\d+)/);
    expect(match).not.toBeNull();
    const newId = Number(match![1]);
    expect(Number.isInteger(newId)).toBe(true);
    expect(newId).toBeGreaterThan(0);
    expect(result.stdout).toMatch(/invalidated filter results: \d+/);

    // Verify DB state: the prior config is deactivated; the new one is active.
    const verify = bootDatabase();
    try {
      const prior = await createRepositories(verify).filterConfigurations.findById(priorConfigId);
      const next = await createRepositories(verify).filterConfigurations.findById(newId);
      expect(prior?.active).toBe(false);
      expect(next?.active).toBe(true);
    } finally {
      verify.close();
    }
  });

  it('discards: exit 0, stdout includes "filter config discarded", no new row', async () => {
    const seed = bootDatabase();
    let priorConfigId: number | undefined;
    try {
      await seedApprovedProfile(seed);
      priorConfigId = await seedPriorActiveConfig(seed);
    } finally {
      seed.close();
    }

    const scriptedPrompts = new ScriptedFilterPrompts({
      askExcludedCompanies: [['WillBeDiscarded']],
      askTitleExcludedKeywords: [[]],
      askTitleRequiredAnyKeywords: [[]],
      askDescriptionExcludedKeywords: [[]],
      askDescriptionRequiredAnyKeywords: [[]],
      askMaximumSeniority: [null],
      askAcceptedLanguages: [{ chosen: ['english'], added: [] }],
      askRejectUnsupportedLanguages: [false],
      askConfirmation: [false],
    });

    const result = await runCli(['configure', 'filters'], { filterPrompts: scriptedPrompts });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('filter config discarded');

    // Verify no new row was inserted.
    const verify = bootDatabase();
    try {
      const all = await createRepositories(verify).filterConfigurations.list();
      expect(all).toHaveLength(1);
      expect(all[0]?.id).toBe(priorConfigId);
      expect(all[0]?.active).toBe(true);
    } finally {
      verify.close();
    }
  });

  it('no active profile: exit 3, stderr includes "no_active_profile"', async () => {
    // Boot an empty DB; no profile is seeded.
    const seed = bootDatabase();
    seed.close();

    const scriptedPrompts = new ScriptedFilterPrompts({});
    const result = await runCli(['configure', 'filters'], { filterPrompts: scriptedPrompts });
    expect(result.status).toBe(3);
    expect(result.stderr).toContain('no_active_profile');
  });

  it('createProgram accepts the optional filterPrompts option (no breaking change)', () => {
    // Smoke test: passing an empty options object still produces a working
    // program. The CLI's main entrypoint uses this signature.
    const program = createProgram();
    expect(program.name()).toBe('jobhunter');
  });
});
