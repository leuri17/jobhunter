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
import * as evaluateModule from '../../src/filter/evaluate.js';
import { FilterApplyService } from '../../src/filter/service.js';
import { NoActiveFilterConfigError } from '../../src/filter/errors.js';
import { type JobFilterConfig } from '../../src/filter/schema.js';

/**
 *  — `FilterApplyService` tests.
 *
 * The service composes:
 *
 *   - `filterConfigurations.findActive()`  (active config, required)
 *   - `profileVersions.findActiveApproved()` (active approved profile, optional)
 *   - `filterResults.findActiveByJob()`    (cache lookup)
 *   - `evaluateJob()`                      (cache miss path)
 *   - `filterResults.activateResult()`     (persistence)
 *
 * All tests run against a real temporary SQLite database. The service is
 * constructed with the real `Repositories` facade; only the synthetic
 * `error` test stubs `evaluateJob` (via `vi.spyOn`).
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

const SAMPLE_JOB = {
  title: 'Senior Backend Engineer Node.js',
  company: 'Acme Corp',
  location: 'Amsterdam, NL',
  description:
    'We are looking for a machine learning engineer with experience ' +
    'in distributed systems and TypeScript.',
};

function sha256For(fingerprint: string): string {
  const padded = (fingerprint + '0'.repeat(64)).slice(0, 64);
  return padded;
}

describe('FilterApplyService', () => {
  let directory: string;
  let connection: DatabaseConnection;
  let repositories: Repositories;
  let runId: number;
  let searchId: number;
  let jobId: number;
  let profileVersionId: number;
  let filterConfigId: number;
  let configJson: JobFilterConfig;

  beforeEach(async () => {
    directory = mkdtempSync(join(tmpdir(), 'jobhunter-filter-apply-service-'));
    connection = createDatabaseConnection(join(directory, 'jobhunter.sqlite'));
    runMigrations(connection, { migrationsFolder: join(REPO_ROOT, 'drizzle') });
    repositories = createRepositories(connection);

    // Pipeline run + search execution (FK target for `recordNewJob`).
    const created = await repositories.pipelineRuns.createRunWithSearches(
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
    runId = created.runId;
    searchId = created.searchIds[0]!;

    // Filter config (active by default in `insert`).
    configJson = minimalConfig();
    filterConfigId = await repositories.filterConfigurations.insert({
      schemaVersion: 1,
      contentHash: 'cfg-hash',
      configJson,
      createdAt: '2026-08-17T10:00:00.000Z',
      active: true,
    });

    // Job (FK target for `filter_results`).
    const job = await repositories.jobs.recordNewJob({
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
        searchExecutionId: searchId,
        timestamp: '2026-08-17T10:00:00.000Z',
        isNew: true,
        currentExtractionState: 'complete',
        extractionAttempted: true,
        skipReason: null,
      },
    });
    jobId = job.jobId;

    // Active approved profile (FK target for `filter_results.profile_version_id`).
    const sourceId = await repositories.profileSources.insert({
      sourceType: 'pdf',
      originalFilename: 'source.pdf',
      originalAbsolutePath: '/tmp/source.pdf',
      storedPath: '/opt/source.pdf',
      mimeType: 'application/pdf',
      fileSize: 100,
      sha256: sha256For('src_1'),
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

  function makeService(): FilterApplyService {
    return new FilterApplyService({ repositories });
  }

  it('cache miss: applies, persists, and returns reused=false', async () => {
    const before = await repositories.filterResults.listByJob(jobId);
    expect(before).toHaveLength(0);

    const result = await makeService().apply({
      jobId,
      job: SAMPLE_JOB,
      pipelineRunId: runId,
    });

    expect(result.reused).toBe(false);
    expect(result.outcome).toBe('accepted');
    expect(result.fingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(result.filterResultId).toBeGreaterThan(0);
    expect(result.rejectionReasons).toEqual([]);
    expect(result.ruleEvaluations.length).toBeGreaterThan(0);

    const after = await repositories.filterResults.listByJob(jobId);
    expect(after).toHaveLength(1);
    expect(after[0]?.active).toBe(true);
    expect(after[0]?.overallOutcome).toBe('accepted');
    expect(after[0]?.fingerprint).toBe(result.fingerprint);
  });

  it('cache miss: a prior active row for the same job is deactivated', async () => {
    // Seed a pre-existing active row with a fingerprint that will NOT match
    // the next `apply` call. The new apply should atomically flip it to
    // inactive (per `activateResult`'s contract).
    const priorId = await repositories.filterResults.activateResult({
      jobId,
      pipelineRunId: runId,
      filterConfigVersionId: filterConfigId,
      filterConfigHash: 'cfg-hash',
      profileVersionId,
      profileHash: 'profile-hash',
      filterImplementationVersion: 'filter-impl-1',
      fingerprint: 'fp-stale-1',
      timestamp: '2026-08-17T10:00:00.000Z',
      overallOutcome: 'accepted',
      rulesEvaluated: [],
      rulesPassed: [],
      rulesFailed: [],
    });
    expect(priorId).toBeGreaterThan(0);

    const result = await makeService().apply({
      jobId,
      job: SAMPLE_JOB,
      pipelineRunId: runId,
    });
    expect(result.reused).toBe(false);

    const after = await repositories.filterResults.listByJob(jobId);
    expect(after).toHaveLength(2);
    const active = after.find((row) => row.active);
    const inactive = after.find((row) => !row.active);
    expect(active?.id).toBe(result.filterResultId);
    expect(active?.fingerprint).toBe(result.fingerprint);
    expect(inactive?.id).toBe(priorId);
  });

  it('cache hit: a matching active row is reused (no new row inserted)', async () => {
    const first = await makeService().apply({
      jobId,
      job: SAMPLE_JOB,
      pipelineRunId: runId,
    });
    expect(first.reused).toBe(false);
    const lengthAfterFirst = (await repositories.filterResults.listByJob(jobId)).length;

    const second = await makeService().apply({
      jobId,
      job: SAMPLE_JOB,
      pipelineRunId: runId,
    });
    expect(second.reused).toBe(true);
    expect(second.outcome).toBe(first.outcome);
    expect(second.filterResultId).toBe(first.filterResultId);
    expect(second.fingerprint).toBe(first.fingerprint);

    const lengthAfterSecond = (await repositories.filterResults.listByJob(jobId)).length;
    expect(lengthAfterSecond).toBe(lengthAfterFirst);
  });

  it('config-version swap: a prior row is invalidated; the next apply produces a fresh row', async () => {
    const first = await makeService().apply({
      jobId,
      job: SAMPLE_JOB,
      pipelineRunId: runId,
    });
    expect(first.reused).toBe(false);
    const priorFilterConfigId = filterConfigId;

    // Insert a new config version (inactive at insert time) and activate it
    // — this simulates the orchestrator swapping the active config. The new
    // config differs from the prior one so the fingerprint changes.
    const newConfigId = await repositories.filterConfigurations.insert({
      schemaVersion: 1,
      contentHash: 'cfg-hash-2',
      configJson: {
        ...minimalConfig(),
        excludedCompanies: ['Globex'],
      },
      createdAt: '2026-08-17T10:00:00.000Z',
      active: false,
    });
    await repositories.filterConfigurations.activate(newConfigId);

    // The orchestrator calls `invalidateByFilterConfigVersion` for the
    // prior config version. The new apply should see no active row for
    // the new fingerprint and produce a fresh row.
    const invalidated =
      await repositories.filterResults.invalidateByFilterConfigVersion(priorFilterConfigId);
    expect(invalidated).toBe(1);

    const afterInvalidation = await repositories.filterResults.listByJob(jobId);
    const inactive = afterInvalidation.find((row) => !row.active);
    expect(inactive?.id).toBe(first.filterResultId);

    const second = await makeService().apply({
      jobId,
      job: SAMPLE_JOB,
      pipelineRunId: runId,
    });
    expect(second.reused).toBe(false);
    expect(second.filterResultId).not.toBe(first.filterResultId);
    expect(second.fingerprint).not.toBe(first.fingerprint);

    const after = await repositories.filterResults.listByJob(jobId);
    expect(after).toHaveLength(2);
    const active = after.find((row) => row.active);
    expect(active?.id).toBe(second.filterResultId);
    expect(active?.filterConfigVersionId).toBe(newConfigId);
  });

  it('throws NoActiveFilterConfigError when no filter config is active', async () => {
    // Calling `activate(0)` deactivates the currently-active row (its
    // `where` clause matches every active row) and then tries to activate
    // id = 0 — which matches nothing, so the table is left with zero
    // active rows.
    await repositories.filterConfigurations.activate(0);

    await expect(
      makeService().apply({
        jobId,
        job: SAMPLE_JOB,
        pipelineRunId: runId,
      }),
    ).rejects.toBeInstanceOf(NoActiveFilterConfigError);
  });

  it('title-only keyword match → rejected with the right reason', async () => {
    // Replace the active config with one that excludes the job's title keyword.
    await repositories.filterConfigurations.activate(0);
    const newConfigId = await repositories.filterConfigurations.insert({
      schemaVersion: 1,
      contentHash: 'cfg-hash-title',
      configJson: {
        ...minimalConfig(),
        title: { excludedKeywords: ['sales'], requiredAnyKeywords: [] },
      },
      createdAt: '2026-08-17T10:00:00.000Z',
      active: false,
    });
    await repositories.filterConfigurations.activate(newConfigId);

    const result = await makeService().apply({
      jobId,
      job: { ...SAMPLE_JOB, title: 'Senior Sales Engineer' },
      pipelineRunId: runId,
    });
    expect(result.outcome).toBe('rejected');
    expect(result.reused).toBe(false);
    expect(
      result.rejectionReasons.some((r: string) => r.startsWith('title_excluded_keyword:sales')),
    ).toBe(true);
  });

  it('seniority mismatch → rejected', async () => {
    await repositories.filterConfigurations.activate(0);
    const newConfigId = await repositories.filterConfigurations.insert({
      schemaVersion: 1,
      contentHash: 'cfg-hash-senior',
      configJson: {
        ...minimalConfig(),
        seniority: { maximum: 'mid' },
      },
      createdAt: '2026-08-17T10:00:00.000Z',
      active: false,
    });
    await repositories.filterConfigurations.activate(newConfigId);

    const result = await makeService().apply({
      jobId,
      job: { ...SAMPLE_JOB, title: 'Senior Backend Engineer' },
      pipelineRunId: runId,
    });
    expect(result.outcome).toBe('rejected');
    expect(result.reused).toBe(false);
    expect(
      result.rejectionReasons.some((r: string) => r.startsWith('seniority_exceeds_maximum:')),
    ).toBe(true);
  });

  it('language unsupported (flag on) → rejected', async () => {
    await repositories.filterConfigurations.activate(0);
    const newConfigId = await repositories.filterConfigurations.insert({
      schemaVersion: 1,
      contentHash: 'cfg-hash-lang',
      configJson: {
        ...minimalConfig(),
        languages: {
          accepted: ['german'],
          rejectWhenExplicitlyRequiresOtherLanguage: true,
        },
      },
      createdAt: '2026-08-17T10:00:00.000Z',
      active: false,
    });
    await repositories.filterConfigurations.activate(newConfigId);

    const result = await makeService().apply({
      jobId,
      job: { ...SAMPLE_JOB, description: 'Dutch required.' },
      pipelineRunId: runId,
    });
    expect(result.outcome).toBe('rejected');
    expect(result.reused).toBe(false);
    expect(result.rejectionReasons).toContain('unsupported_language:Dutch');
  });

  it('all rules pass → accepted', async () => {
    const result = await makeService().apply({
      jobId,
      job: SAMPLE_JOB,
      pipelineRunId: runId,
    });
    expect(result.outcome).toBe('accepted');
    expect(result.reused).toBe(false);
    expect(result.rejectionReasons).toEqual([]);
  });

  it('internal evaluator failure → error outcome (service still persists the row)', async () => {
    // Force a synthetic internal failure: the evaluator catches the throw
    // and reports `overallOutcome: 'error'`. The service still persists
    // the row with that outcome so the audit trail is complete.
    const errorEvaluations: readonly evaluateModule.RuleEvaluation[] = [
      {
        ruleId: 'evaluator_internal_error',
        field: 'title',
        outcome: 'failed',
        details: { errorMessage: 'synthetic failure' },
        reason: 'evaluator_internal_error',
      },
    ];
    const errorResult: evaluateModule.FilterEvaluationResult = {
      overallOutcome: 'error',
      rulesEvaluated: errorEvaluations,
      rulesPassed: [],
      rulesFailed: errorEvaluations,
      rejectionReasons: [],
    };
    const spy = vi.spyOn(evaluateModule, 'evaluateJob').mockReturnValue(errorResult);

    const result = await makeService().apply({
      jobId,
      job: SAMPLE_JOB,
      pipelineRunId: runId,
    });
    expect(result.outcome).toBe('error');
    expect(result.reused).toBe(false);
    expect(result.rejectionReasons).toEqual([]);

    // The service still persists the row.
    const after = await repositories.filterResults.listByJob(jobId);
    expect(after).toHaveLength(1);
    expect(after[0]?.active).toBe(true);
    expect(after[0]?.overallOutcome).toBe('error');

    spy.mockRestore();
  });

  it('returns the persisted filterResultId on cache miss', async () => {
    const result = await makeService().apply({
      jobId,
      job: SAMPLE_JOB,
      pipelineRunId: runId,
    });
    const stored = await repositories.filterResults.findActiveByJob(jobId, result.fingerprint);
    expect(stored).not.toBeNull();
    expect(stored?.id).toBe(result.filterResultId);
    expect(stored?.overallOutcome).toBe(result.outcome);
  });

  it('passes the optional pipelineRunId through to the persisted row', async () => {
    const result = await makeService().apply({
      jobId,
      job: SAMPLE_JOB,
      pipelineRunId: runId,
    });
    const stored = await repositories.filterResults.findActiveByJob(jobId, result.fingerprint);
    expect(stored?.pipelineRunId).toBe(runId);
  });

  it('accepts a null pipelineRunId and persists it as null', async () => {
    const result = await makeService().apply({
      jobId,
      job: SAMPLE_JOB,
      pipelineRunId: null,
    });
    const stored = await repositories.filterResults.findActiveByJob(jobId, result.fingerprint);
    expect(stored?.pipelineRunId).toBeNull();
  });
});

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
