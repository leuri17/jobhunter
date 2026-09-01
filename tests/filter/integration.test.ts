import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  ConfigureFiltersService,
  FilterApplyService,
  ScriptedFilterPrompts,
  calculateFilterFingerprint,
  type ConfigureFiltersOutcome,
  type FilterApplyResult,
} from '../../src/filter/index.js';
import { type JobFilterConfig } from '../../src/filter/schema.js';
import {
  createDatabaseConnection,
  type DatabaseConnection,
} from '../../src/persistence/connection.js';
import { runMigrations } from '../../src/persistence/migrations.js';
import { createRepositories, type Repositories } from '../../src/persistence/repositories/index.js';

const REPO_ROOT = resolve(import.meta.dirname, '..', '..');

/**
 *  — end-to-end integration test.
 *
 * Exercises the full configure → apply → reuse → swap → re-apply
 * workflow against a real temporary SQLite database. This is the
 * single integration test mandated by the  brief.
 *
 * Flow (mirrors the brief's 11 steps):
 *
 *   1. Seed an approved profile (with at least one language: `english`).
 *   2. Seed a baseline `filter_configuration_versions` row (active).
 *   3. Insert a complete `jobs` row.
 *   4. Run `ConfigureFiltersService.run()` with scripted prompts that
 *      keep the config minimal + confirm save.
 *   5. Verify the new config is active; the baseline is deactivated.
 *   6. First `FilterApplyService.apply()` — cache miss, `reused: false`,
 *      outcome `accepted`, fingerprint is 64-char hex.
 *   7. Verify exactly one active `filter_results` row for the job.
 *   8. Second `apply()` — cache hit, `reused: true`, same fingerprint,
 *      no new row.
 *   9. Config swap — insert a new config that excludes `Acme`, activate
 *      it, invalidate the prior config's dependents.
 *  10. Third `apply()` — cache miss on the new fingerprint, outcome
 *      `rejected` with `excluded_company:Acme` in `rejectionReasons`.
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

function profileJsonWithEnglish(): Record<string, unknown> {
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
    languages: [
      {
        id: 'lang-1',
        name: 'English',
        normalizedName: 'english',
        level: 'native',
        sourceReferences: [],
      },
    ],
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

describe('filter engine — end-to-end', () => {
  let directory: string;
  let connection: DatabaseConnection;
  let repositories: Repositories;

  beforeEach(async () => {
    directory = mkdtempSync(join(tmpdir(), 'jobhunter-filter-integration-'));
    connection = createDatabaseConnection(join(directory, 'jobhunter.sqlite'));
    runMigrations(connection, { migrationsFolder: join(REPO_ROOT, 'drizzle') });
    repositories = createRepositories(connection);
  });

  afterEach(() => {
    connection.close();
    rmSync(directory, { recursive: true, force: true });
  });

  it('configures, applies, reuses, and re-evaluates end-to-end', async () => {
    // Step 1 — Seed an approved profile with at least one language.
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
    const profileVersionId = await repositories.profileVersions.insert({
      status: 'approved',
      schemaVersion: 1,
      contentHash: 'profile-hash',
      extractionFingerprint: 'fp_profile_1',
      sourceIds: [sourceId],
      profileJson: profileJsonWithEnglish(),
      createdAt: '2026-08-17T10:00:00.000Z',
      updatedAt: '2026-08-17T10:00:00.000Z',
      active: true,
    });
    await repositories.profileVersions.approve(profileVersionId, {
      approvedAt: '2026-08-17T10:00:00.000Z',
      supersededAt: '2026-08-17T10:00:00.000Z',
    });

    // Step 2 — Seed the baseline active filter config.
    const baselineConfigId = await repositories.filterConfigurations.insert({
      schemaVersion: 1,
      contentHash: 'cfg-hash-baseline',
      configJson: {
        ...minimalConfig(),
        languages: { accepted: ['english'], rejectWhenExplicitlyRequiresOtherLanguage: false },
      },
      createdAt: '2026-08-17T10:00:00.000Z',
      active: true,
    });

    // Step 3 — Insert a complete job (no apply call yet). Create a real
    //          pipeline run + search execution so the discovery-event FK
    //          targets a valid row.
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
    const jobRecord = await repositories.jobs.recordNewJob({
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
    const jobId = jobRecord.jobId;
    const jobInput = {
      title: 'Senior Engineer',
      company: 'Acme',
      location: 'Remote',
      description:
        'Looking for a Senior Engineer with distributed systems experience and TypeScript.',
    };

    // Step 4 — Run ConfigureFiltersService with scripted prompts.
    const scriptedPrompts = new ScriptedFilterPrompts({
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
    const configureService = new ConfigureFiltersService({
      repositories,
      prompts: scriptedPrompts,
    });
    const configureOutcome = (await configureService.run()) as Extract<
      ConfigureFiltersOutcome,
      { kind: 'saved' }
    >;
    expect(configureOutcome.kind).toBe('saved');
    expect(configureOutcome.filterConfigVersionId).toBeGreaterThan(0);
    // The baseline had no active filter results tied to it, so invalidation
    // count is 0.
    expect(configureOutcome.invalidatedFilterResults).toBe(0);

    // Step 5 — Verify the new config is active; the baseline is deactivated.
    const newConfigRow = await repositories.filterConfigurations.findById(
      configureOutcome.filterConfigVersionId,
    );
    const baselineRow = await repositories.filterConfigurations.findById(baselineConfigId);
    expect(newConfigRow?.active).toBe(true);
    expect(baselineRow?.active).toBe(false);

    // Step 6 — First apply: cache miss, accepted, reused=false.
    const applyService = new FilterApplyService({ repositories });
    const firstApply = await applyService.apply({
      jobId,
      job: jobInput,
      pipelineRunId: null,
    });
    expect(firstApply.outcome).toBe('accepted');
    expect(firstApply.reused).toBe(false);
    expect(firstApply.fingerprint).toMatch(/^[0-9a-f]{64}$/);

    // Step 7 — Exactly one active filter_results row for the job.
    const afterFirst = await repositories.filterResults.listByJob(jobId);
    expect(afterFirst).toHaveLength(1);
    expect(afterFirst[0]?.active).toBe(true);
    expect(afterFirst[0]?.filterConfigVersionId).toBe(configureOutcome.filterConfigVersionId);

    // Step 8 — Second apply: cache hit, reused=true, same fingerprint,
    //          no new row inserted.
    const secondApply = (await applyService.apply({
      jobId,
      job: jobInput,
      pipelineRunId: null,
    })) as FilterApplyResult;
    expect(secondApply.outcome).toBe('accepted');
    expect(secondApply.reused).toBe(true);
    expect(secondApply.fingerprint).toBe(firstApply.fingerprint);
    expect(secondApply.filterResultId).toBe(firstApply.filterResultId);

    const afterSecond = await repositories.filterResults.listByJob(jobId);
    expect(afterSecond).toHaveLength(1);

    // Step 9 — Config swap: insert a new config that excludes Acme,
    //          activate it, invalidate dependents of the prior config.
    const swappedConfigId = await repositories.filterConfigurations.insert({
      schemaVersion: 1,
      contentHash: 'cfg-hash-swap',
      configJson: {
        ...minimalConfig(),
        excludedCompanies: ['Acme'],
        languages: { accepted: ['english'], rejectWhenExplicitlyRequiresOtherLanguage: false },
      },
      createdAt: '2026-08-17T10:00:00.000Z',
      active: false,
    });
    await repositories.filterConfigurations.activate(swappedConfigId);
    const invalidated = await repositories.filterResults.invalidateByFilterConfigVersion(
      configureOutcome.filterConfigVersionId,
    );
    expect(invalidated).toBe(1);

    // Step 10 — Third apply: cache miss (new fingerprint, different
    //           config hash), outcome rejected with excluded_company:Acme.
    const thirdApply = await applyService.apply({
      jobId,
      job: jobInput,
      pipelineRunId: null,
    });
    expect(thirdApply.outcome).toBe('rejected');
    expect(thirdApply.reused).toBe(false);
    expect(thirdApply.fingerprint).not.toBe(firstApply.fingerprint);
    expect(thirdApply.rejectionReasons).toContain('excluded_company:Acme');

    // Sanity: the fingerprint is exactly what the composer would compute
    // from the current inputs (the new active config + the same profile
    // slice + the same job + the implementation version). This pins the
    // contract that the cache key is deterministic and reproducible.
    const expectedFingerprint = calculateFilterFingerprint({
      job: jobInput,
      config: (await repositories.filterConfigurations.findById(swappedConfigId))!
        .configJson as JobFilterConfig,
      profile: (await repositories.profileVersions.findById(profileVersionId))!
        .profileJson as Parameters<typeof calculateFilterFingerprint>[0]['profile'],
    });
    expect(thirdApply.fingerprint).toBe(expectedFingerprint);

    // The persisted audit trail shows the prior row is inactive and the
    // new row is active against the swapped config.
    const finalRows = await repositories.filterResults.listByJob(jobId);
    expect(finalRows).toHaveLength(2);
    const active = finalRows.find((row) => row.active);
    const inactive = finalRows.find((row) => !row.active);
    expect(active?.filterConfigVersionId).toBe(swappedConfigId);
    expect(active?.overallOutcome).toBe('rejected');
    expect(inactive?.filterConfigVersionId).toBe(configureOutcome.filterConfigVersionId);
    expect(inactive?.overallOutcome).toBe('accepted');
  });
});
