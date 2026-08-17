import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { runMigrations } from '../../src/persistence/migrations.js';
import {
  createDatabaseConnection,
  type DatabaseConnection,
} from '../../src/persistence/connection.js';
import { createRepositories, type Repositories } from '../../src/persistence/repositories/index.js';
import {
  ConfigureFiltersService,
  type ConfigureFiltersOutcome,
} from '../../src/filter/configure-service.js';
import {
  FilterStorageError,
  InvalidFilterConfigError,
  NoActiveProfileError,
} from '../../src/filter/errors.js';
import { ScriptedFilterPrompts } from '../../src/filter/prompts.js';
import { type JobFilterConfig } from '../../src/filter/schema.js';

/**
 * TASK-010 Task 10 — `ConfigureFiltersService` tests.
 *
 * The service composes:
 *
 *   - `filterConfigurations.findActive()` (existing config, optional)
 *   - `profileVersions.findActiveApproved()` (active approved profile, required)
 *   - the `FilterPrompts` seam (interactive collect)
 *   - `filterConfigurations.insert` / `.activate` (atomic version transition)
 *   - `filterResults.invalidateByFilterConfigVersion` (dependent invalidation)
 *
 * All tests run against a real temporary SQLite database and drive every
 * prompt step via `ScriptedFilterPrompts`.
 */

const REPO_ROOT = resolve(import.meta.dirname, '..', '..');

function minimalConfig(): JobFilterConfig {
  return {
    schemaVersion: 1,
    excludedCompanies: [],
    title: {
      excludedKeywords: [],
      requiredAnyKeywords: [],
    },
    description: {
      excludedKeywords: [],
      requiredAnyKeywords: [],
    },
    seniority: {
      maximum: null,
    },
    languages: {
      accepted: [],
      rejectWhenExplicitlyRequiresOtherLanguage: false,
    },
  };
}

const SAMPLE_PROFILE_LANGUAGES = [
  {
    id: 'lang-1',
    name: 'English',
    normalizedName: 'english',
    level: 'native',
    sourceReferences: [],
  },
  {
    id: 'lang-2',
    name: 'Portuguese',
    normalizedName: 'portuguese',
    level: 'professional',
    sourceReferences: [],
  },
  {
    id: 'lang-3',
    name: 'Dutch',
    normalizedName: 'dutch',
    level: 'conversational',
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
    languages: SAMPLE_PROFILE_LANGUAGES.map((l) => ({ ...l })),
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

describe('ConfigureFiltersService', () => {
  let directory: string;
  let connection: DatabaseConnection;
  let repositories: Repositories;
  let profileVersionId: number;

  beforeEach(async () => {
    directory = mkdtempSync(join(tmpdir(), 'jobhunter-configure-filters-'));
    connection = createDatabaseConnection(join(directory, 'jobhunter.sqlite'));
    runMigrations(connection, { migrationsFolder: join(REPO_ROOT, 'drizzle') });
    repositories = createRepositories(connection);

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
    profileVersionId = await repositories.profileVersions.insert({
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
  });

  afterEach(() => {
    vi.restoreAllMocks();
    connection.close();
    rmSync(directory, { recursive: true, force: true });
  });

  function makeService(prompts: ScriptedFilterPrompts): ConfigureFiltersService {
    return new ConfigureFiltersService({ repositories, prompts });
  }

  it('fresh config (no prior active): saves a new row and seeds languages from the profile', async () => {
    const prompts = new ScriptedFilterPrompts({
      askExcludedCompanies: [['Acme Corp']],
      askTitleExcludedKeywords: [['sales']],
      askTitleRequiredAnyKeywords: [['typescript']],
      askDescriptionExcludedKeywords: [[]],
      askDescriptionRequiredAnyKeywords: [['distributed systems']],
      askMaximumSeniority: [null],
      askAcceptedLanguages: [
        {
          // Profile-derived seeds: english, portuguese, dutch. User keeps all + adds german.
          chosen: ['english', 'portuguese', 'dutch'],
          added: ['german'],
        },
      ],
      askRejectUnsupportedLanguages: [true],
      askConfirmation: [true],
    });
    const service = makeService(prompts);

    const outcome = (await service.run()) as Extract<ConfigureFiltersOutcome, { kind: 'saved' }>;
    expect(outcome.kind).toBe('saved');
    expect(outcome.filterConfigVersionId).toBeGreaterThan(0);
    expect(outcome.invalidatedFilterResults).toBe(0); // no prior config

    // The new row is the active one.
    const allConfigs = await repositories.filterConfigurations.list();
    const activeConfigs = allConfigs.filter((c) => c.active);
    expect(activeConfigs).toHaveLength(1);
    expect(activeConfigs[0]?.id).toBe(outcome.filterConfigVersionId);

    // The persisted JSON carries the user's edits + the union of chosen/added.
    const stored = await repositories.filterConfigurations.findById(outcome.filterConfigVersionId);
    expect(stored).not.toBeNull();
    const storedConfig = stored?.configJson as JobFilterConfig;
    expect(storedConfig.excludedCompanies).toEqual(['Acme Corp']);
    expect(storedConfig.title.excludedKeywords).toEqual(['sales']);
    expect(storedConfig.title.requiredAnyKeywords).toEqual(['typescript']);
    expect(storedConfig.description.excludedKeywords).toEqual([]);
    expect(storedConfig.description.requiredAnyKeywords).toEqual(['distributed systems']);
    expect(storedConfig.seniority.maximum).toBeNull();
    expect(storedConfig.languages.accepted).toEqual(
      expect.arrayContaining(['english', 'portuguese', 'dutch', 'german']),
    );
    expect(storedConfig.languages.accepted).toHaveLength(4);
    expect(storedConfig.languages.rejectWhenExplicitlyRequiresOtherLanguage).toBe(true);
  });

  it('editing an existing config: saves a new version and invalidates dependents tied to the prior one', async () => {
    // Seed a prior active config + an active filter result row tied to it.
    const priorConfigId = await repositories.filterConfigurations.insert({
      schemaVersion: 1,
      contentHash: 'cfg-hash-prior',
      configJson: {
        ...minimalConfig(),
        excludedCompanies: ['OldCo'],
      },
      createdAt: '2026-08-17T10:00:00.000Z',
      active: true,
    });

    const { runId, searchIds } = await repositories.pipelineRuns.createRunWithSearches(
      {
        startTimestamp: '2026-08-17T10:00:00.000Z',
        configSnapshotJson: {},
        configSchemaVersion: 1,
        configHash: 'h',
        applicationVersion: '0.1.0',
      },
      [
        {
          pipelineRunId: 0,
          searchQuery: 'q',
          locationName: 'L',
          geoId: '1',
          generatedUrl: 'https://www.linkedin.com/jobs/search/?q=q',
          startTimestamp: '2026-08-17T10:00:00.000Z',
        },
      ],
    );
    const { jobId } = await repositories.jobs.recordNewJob({
      job: {
        sourceJobId: '111',
        extractionStatus: 'complete',
        firstDiscoveryTimestamp: '2026-08-17T10:00:00.000Z',
        lastRediscoveryTimestamp: '2026-08-17T10:00:00.000Z',
        createdTimestamp: '2026-08-17T10:00:00.000Z',
        updatedTimestamp: '2026-08-17T10:00:00.000Z',
      },
      discoveryEvent: {
        jobId: 0,
        pipelineRunId: runId,
        searchExecutionId: searchIds[0]!,
        timestamp: '2026-08-17T10:00:00.000Z',
        isNew: true,
        currentExtractionState: 'complete',
        extractionAttempted: true,
        skipReason: null,
      },
    });
    await repositories.filterResults.activateResult({
      jobId,
      pipelineRunId: runId,
      filterConfigVersionId: priorConfigId,
      filterConfigHash: 'cfg-hash-prior',
      profileVersionId,
      profileHash: 'profile-hash',
      filterImplementationVersion: 'filter-impl-1',
      fingerprint: 'fp-prior',
      timestamp: '2026-08-17T10:00:00.000Z',
      overallOutcome: 'accepted',
      rulesEvaluated: [],
      rulesPassed: [],
      rulesFailed: [],
    });

    const prompts = new ScriptedFilterPrompts({
      askExcludedCompanies: [['NewCo']],
      askTitleExcludedKeywords: [[]],
      askTitleRequiredAnyKeywords: [[]],
      askDescriptionExcludedKeywords: [[]],
      askDescriptionRequiredAnyKeywords: [[]],
      askMaximumSeniority: ['mid'],
      askAcceptedLanguages: [{ chosen: ['english'], added: [] }],
      askRejectUnsupportedLanguages: [false],
      askConfirmation: [true],
    });

    const outcome = (await makeService(prompts).run()) as Extract<
      ConfigureFiltersOutcome,
      { kind: 'saved' }
    >;
    expect(outcome.kind).toBe('saved');
    expect(outcome.filterConfigVersionId).not.toBe(priorConfigId);
    expect(outcome.invalidatedFilterResults).toBe(1);

    const prior = await repositories.filterConfigurations.findById(priorConfigId);
    const next = await repositories.filterConfigurations.findById(outcome.filterConfigVersionId);
    expect(prior?.active).toBe(false);
    expect(next?.active).toBe(true);
  });

  it('user declines the confirmation: returns discarded and writes nothing', async () => {
    const priorConfigId = await repositories.filterConfigurations.insert({
      schemaVersion: 1,
      contentHash: 'cfg-hash-prior',
      configJson: minimalConfig(),
      createdAt: '2026-08-17T10:00:00.000Z',
      active: true,
    });

    const prompts = new ScriptedFilterPrompts({
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

    const outcome = await makeService(prompts).run();
    expect(outcome.kind).toBe('discarded');

    const all = await repositories.filterConfigurations.list();
    expect(all).toHaveLength(1);
    expect(all[0]?.id).toBe(priorConfigId);
    expect(all[0]?.active).toBe(true);
  });

  it('no active profile → throws NoActiveProfileError (checked first)', async () => {
    // Supersede the active profile seeded in beforeEach by calling
    // approve on a non-existent id. The transaction supersedes every
    // currently active+approved row and then no-ops on the missing id,
    // leaving the table with no active approved row.
    await repositories.profileVersions.approve(99_999, {
      approvedAt: '2026-08-17T10:00:00.000Z',
      supersededAt: '2026-08-17T10:00:00.000Z',
    });

    const prompts = new ScriptedFilterPrompts({});
    await expect(makeService(prompts).run()).rejects.toBeInstanceOf(NoActiveProfileError);
  });

  it('no active config + no active profile → throws NoActiveProfileError (profile gate fires before config check)', async () => {
    // Same setup as the previous test, plus seed a prior active config.
    // The profile gate must fire BEFORE the config check, so the throw
    // is NoActiveProfileError regardless of the config state.
    await repositories.filterConfigurations.insert({
      schemaVersion: 1,
      contentHash: 'cfg-hash',
      configJson: minimalConfig(),
      createdAt: '2026-08-17T10:00:00.000Z',
      active: true,
    });
    await repositories.profileVersions.approve(99_999, {
      approvedAt: '2026-08-17T10:00:00.000Z',
      supersededAt: '2026-08-17T10:00:00.000Z',
    });

    const prompts = new ScriptedFilterPrompts({});
    await expect(makeService(prompts).run()).rejects.toBeInstanceOf(NoActiveProfileError);
  });

  it('discard after a handful of edits: no DB write, no invalidation', async () => {
    const priorConfigId = await repositories.filterConfigurations.insert({
      schemaVersion: 1,
      contentHash: 'cfg-hash-prior',
      configJson: minimalConfig(),
      createdAt: '2026-08-17T10:00:00.000Z',
      active: true,
    });
    expect(await repositories.filterConfigurations.list()).toHaveLength(1);

    const prompts = new ScriptedFilterPrompts({
      askExcludedCompanies: [['Temp']],
      askTitleExcludedKeywords: [['will-be-discarded']],
      askTitleRequiredAnyKeywords: [[]],
      askDescriptionExcludedKeywords: [[]],
      askDescriptionRequiredAnyKeywords: [[]],
      askMaximumSeniority: [null],
      askAcceptedLanguages: [{ chosen: ['english'], added: [] }],
      askRejectUnsupportedLanguages: [true],
      askConfirmation: [false],
    });

    const outcome = await makeService(prompts).run();
    expect(outcome.kind).toBe('discarded');

    const after = await repositories.filterConfigurations.list();
    expect(after).toHaveLength(1);
    expect(after[0]?.id).toBe(priorConfigId);
    expect(after[0]?.active).toBe(true);
  });

  it('throws InvalidFilterConfigError when the persisted row fails JobFilterConfigSchema.safeParse', async () => {
    // Insert a config whose JSON is intentionally not a valid JobFilterConfig
    // (missing required nested fields). The service must reject the
    // corrupted persisted row at the gate, BEFORE asking any prompts.
    await repositories.filterConfigurations.insert({
      schemaVersion: 1,
      contentHash: 'cfg-corrupt',
      configJson: { schemaVersion: 1, excludedCompanies: 'not-an-array' },
      createdAt: '2026-08-17T10:00:00.000Z',
      active: true,
    });

    const prompts = new ScriptedFilterPrompts({});
    await expect(makeService(prompts).run()).rejects.toBeInstanceOf(InvalidFilterConfigError);
  });

  it('throws FilterStorageError when filterConfigurations.insert fails (persistence)', async () => {
    const insertSpy = vi
      .spyOn(repositories.filterConfigurations, 'insert')
      .mockImplementation(() => {
        throw new Error('synthetic disk failure');
      });

    const prompts = new ScriptedFilterPrompts({
      askExcludedCompanies: [[]],
      askTitleExcludedKeywords: [[]],
      askTitleRequiredAnyKeywords: [[]],
      askDescriptionExcludedKeywords: [[]],
      askDescriptionRequiredAnyKeywords: [[]],
      askMaximumSeniority: [null],
      askAcceptedLanguages: [{ chosen: ['english'], added: [] }],
      askRejectUnsupportedLanguages: [false],
      askConfirmation: [true],
    });

    await expect(makeService(prompts).run()).rejects.toBeInstanceOf(FilterStorageError);
    insertSpy.mockRestore();
  });
});
