import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { runMigrations } from '../../src/persistence/migrations.js';
import {
  createDatabaseConnection,
  type DatabaseConnection,
} from '../../src/persistence/connection.js';
import { createRepositories } from '../../src/persistence/repositories/index.js';
import { ProfileApprovalService } from '../../src/profile/approval-service.js';
import { ProfileSourceRepository } from '../../src/persistence/repositories/profile-sources.js';
import { ProfileVersionRepository } from '../../src/persistence/repositories/profile-versions.js';
import { PipelineRunRepository } from '../../src/persistence/repositories/pipeline-runs.js';
import { JobRepository } from '../../src/persistence/repositories/jobs.js';
import { FilterConfigurationRepository } from '../../src/persistence/repositories/filter-configurations.js';
import { FilterResultRepository } from '../../src/persistence/repositories/filter-results.js';
import type { Repositories } from '../../src/persistence/repositories/index.js';
import {
  BlockingConflictsUnresolvedError,
  InvalidProfilePayloadError,
  InvalidProfileStateError,
  UserCancelledApprovalError,
} from '../../src/profile/errors.js';

const REPO_ROOT = resolve(import.meta.dirname, '..', '..');

function makeProfileJson(id: string): Record<string, unknown> {
  return {
    schemaVersion: 1,
    id,
    createdAt: '2026-08-14T00:00:00.000Z',
    updatedAt: '2026-08-14T00:00:00.000Z',
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

async function seedSource(repo: ProfileSourceRepository, sha256: string): Promise<number> {
  return repo.insert({
    sourceType: 'pdf',
    originalFilename: `${sha256}.pdf`,
    originalAbsolutePath: `/tmp/${sha256}.pdf`,
    storedPath: `/opt/${sha256}.pdf`,
    mimeType: 'application/pdf',
    fileSize: 100,
    sha256,
    importTimestamp: '2026-08-14T00:00:00.000Z',
    textExtractionStatus: 'success',
  });
}

async function seedProfile(
  repositories: Repositories,
  profileJsonId: string,
  fingerprint: string,
  status: 'draft' | 'approved' = 'draft',
  active = false,
): Promise<number> {
  const sourceRepo = new ProfileSourceRepository({ db: repositories.db });
  const sha = `sha_${fingerprint}_${profileJsonId}`.padEnd(64, '0');
  const sourceId = await seedSource(sourceRepo, sha);
  const versionRepo = new ProfileVersionRepository({ db: repositories.db });
  return versionRepo.insert({
    status,
    schemaVersion: 1,
    contentHash: `hash-${fingerprint}`,
    extractionFingerprint: fingerprint,
    sourceIds: [sourceId],
    profileJson: makeProfileJson(profileJsonId),
    createdAt: '2026-08-14T00:00:00.000Z',
    updatedAt: '2026-08-14T00:00:00.000Z',
    active,
  });
}

async function seedFilterResultForProfile(
  repositories: Repositories,
  profileVersionId: number,
): Promise<void> {
  const runRepo = new PipelineRunRepository({ db: repositories.db });
  const jobRepo = new JobRepository({ db: repositories.db });
  const configRepo = new FilterConfigurationRepository({ db: repositories.db });
  const resultRepo = new FilterResultRepository({ db: repositories.db });
  const filterConfigId = await configRepo.insert({
    schemaVersion: 1,
    contentHash: 'cfg-hash',
    configJson: {},
    createdAt: '2026-08-14T00:00:00.000Z',
    active: true,
  });
  const { runId, searchIds } = await runRepo.createRunWithSearches(
    {
      startTimestamp: '2026-08-14T00:00:00.000Z',
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
        startTimestamp: '2026-08-14T00:00:00.000Z',
      },
    ],
  );
  const { jobId } = await jobRepo.recordNewJob({
    job: {
      sourceJobId: '111',
      extractionStatus: 'complete',
      firstDiscoveryTimestamp: '2026-08-14T00:00:00.000Z',
      lastRediscoveryTimestamp: '2026-08-14T00:00:00.000Z',
      createdTimestamp: '2026-08-14T00:00:00.000Z',
      updatedTimestamp: '2026-08-14T00:00:00.000Z',
    },
    discoveryEvent: {
      jobId: 0,
      pipelineRunId: runId,
      searchExecutionId: searchIds[0]!,
      timestamp: '2026-08-14T00:00:00.000Z',
      isNew: true,
      currentExtractionState: 'complete',
      extractionAttempted: true,
      skipReason: null,
    },
  });
  await resultRepo.activateResult({
    jobId,
    pipelineRunId: runId,
    filterConfigVersionId: filterConfigId,
    filterConfigHash: 'cfg-hash',
    profileVersionId,
    profileHash: 'h',
    filterImplementationVersion: 'filter-impl-1',
    fingerprint: `fp-${profileVersionId}-${jobId}`,
    timestamp: '2026-08-14T00:00:00.000Z',
    overallOutcome: 'accepted',
    rulesEvaluated: [],
    rulesPassed: [],
    rulesFailed: [],
  });
}

describe('ProfileApprovalService', () => {
  let directory: string;
  let connection: DatabaseConnection;
  let repositories: Repositories;

  beforeEach(async () => {
    directory = mkdtempSync(join(tmpdir(), 'jobhunter-profile-approval-service-'));
    connection = createDatabaseConnection(join(directory, 'jobhunter.sqlite'));
    runMigrations(connection, { migrationsFolder: join(REPO_ROOT, 'drizzle') });
    repositories = createRepositories(connection);
  });

  afterEach(() => {
    connection.close();
    rmSync(directory, { recursive: true, force: true });
  });

  it('approves a clean draft and returns a fresh contentHash', async () => {
    const id = await seedProfile(repositories, 'prf_clean', 'fp_clean', 'draft', false);
    const service = new ProfileApprovalService({
      repositories,
      prompts: { confirmApprovalWithWarnings: async () => true },
    });
    const summary = await service.approve(`profile_${id}`);
    expect(summary.approvedProfileVersionId).toBe(id);
    expect(summary.supersededProfileVersionId).toBeNull();
    expect(summary.invalidatedFilterResults).toBe(0);
    const after = await repositories.profileVersions.getById(id);
    expect(after.status).toBe('approved');
    expect(after.active).toBe(true);
    expect(after.contentHash).not.toBe('hash-fp_clean');
  });

  it('supersedes the prior approved profile and invalidates its filter results', async () => {
    const priorId = await seedProfile(repositories, 'prf_prior', 'fp_prior', 'approved', true);
    await seedFilterResultForProfile(repositories, priorId);
    const newId = await seedProfile(repositories, 'prf_new', 'fp_new', 'draft', false);
    const service = new ProfileApprovalService({
      repositories,
      prompts: { confirmApprovalWithWarnings: async () => true },
    });
    const summary = await service.approve(`profile_${newId}`);
    expect(summary.supersededProfileVersionId).toBe(priorId);
    expect(summary.invalidatedFilterResults).toBe(1);
    const prior = await repositories.profileVersions.getById(priorId);
    expect(prior.status).toBe('superseded');
    expect(prior.active).toBe(false);
  });

  it('throws BlockingConflictsUnresolvedError when an unresolved conflict row exists', async () => {
    const id = await seedProfile(repositories, 'prf_conflict', 'fp_conflict', 'draft', false);
    await repositories.profileVersions.insertConflict({
      profileVersionId: id,
      conflictType: 'work_experience.start_date',
      affectedField: 'startDate',
      valueSourceA: '2022-01',
      valueSourceB: '2021-06',
      sourceReferences: [],
      provisionalValue: '2022-01',
      explanation: 'disagree',
      resolutionStatus: 'unresolved',
      resolvedAt: null,
      resolvedValue: null,
    });
    const service = new ProfileApprovalService({
      repositories,
      prompts: { confirmApprovalWithWarnings: async () => true },
    });
    await expect(service.approve(`profile_${id}`)).rejects.toBeInstanceOf(
      BlockingConflictsUnresolvedError,
    );
  });

  it('throws BlockingConflictsUnresolvedError when a blocking_conflict warning exists', async () => {
    const id = await seedProfile(repositories, 'prf_bw', 'fp_bw', 'draft', false);
    await repositories.profileVersions.insertWarning({
      profileVersionId: id,
      severity: 'blocking_conflict',
      warningType: 'extraction_warning',
      fieldPath: null,
      message: 'big problem',
      createdAt: '2026-08-14T00:00:00.000Z',
    });
    const service = new ProfileApprovalService({
      repositories,
      prompts: { confirmApprovalWithWarnings: async () => true },
    });
    await expect(service.approve(`profile_${id}`)).rejects.toBeInstanceOf(
      BlockingConflictsUnresolvedError,
    );
  });

  it('prompts for confirmation when non-blocking warnings are present', async () => {
    const id = await seedProfile(repositories, 'prf_w', 'fp_w', 'draft', false);
    await repositories.profileVersions.insertWarning({
      profileVersionId: id,
      severity: 'warning',
      warningType: 'extraction_warning',
      fieldPath: null,
      message: 'soft note',
      createdAt: '2026-08-14T00:00:00.000Z',
    });
    const seen: string[] = [];
    const service = new ProfileApprovalService({
      repositories,
      prompts: {
        confirmApprovalWithWarnings: async (input) => {
          seen.push(...input.remainingWarnings);
          return true;
        },
      },
    });
    const summary = await service.approve(`profile_${id}`);
    expect(seen).toEqual(['soft note']);
    expect(summary.remainingWarnings).toBe(1);
  });

  it('throws UserCancelledApprovalError when the user declines the warnings', async () => {
    const id = await seedProfile(repositories, 'prf_w', 'fp_w', 'draft', false);
    await repositories.profileVersions.insertWarning({
      profileVersionId: id,
      severity: 'warning',
      warningType: 'extraction_warning',
      fieldPath: null,
      message: 'soft',
      createdAt: '2026-08-14T00:00:00.000Z',
    });
    const service = new ProfileApprovalService({
      repositories,
      prompts: { confirmApprovalWithWarnings: async () => false },
    });
    await expect(service.approve(`profile_${id}`)).rejects.toBeInstanceOf(
      UserCancelledApprovalError,
    );
    const after = await repositories.profileVersions.getById(id);
    expect(after.status).toBe('draft');
  });

  it('throws InvalidProfileStateError when the target is already approved', async () => {
    const id = await seedProfile(repositories, 'prf_a', 'fp_a', 'approved', true);
    const service = new ProfileApprovalService({
      repositories,
      prompts: { confirmApprovalWithWarnings: async () => true },
    });
    await expect(service.approve(`profile_${id}`)).rejects.toBeInstanceOf(InvalidProfileStateError);
  });

  it('throws InvalidProfilePayloadError when stored JSON fails Zod', async () => {
    const versionRepo = new ProfileVersionRepository({ db: repositories.db });
    const sourceRepo = new ProfileSourceRepository({ db: repositories.db });
    const sourceId = await seedSource(sourceRepo, 'c'.repeat(64));
    const id = await versionRepo.insert({
      status: 'draft',
      schemaVersion: 1,
      contentHash: 'broken',
      extractionFingerprint: 'fp_broken',
      sourceIds: [sourceId],
      profileJson: { this_is_not_a_profile: true },
      createdAt: '2026-08-14T00:00:00.000Z',
      updatedAt: '2026-08-14T00:00:00.000Z',
    });
    const service = new ProfileApprovalService({
      repositories,
      prompts: { confirmApprovalWithWarnings: async () => true },
    });
    await expect(service.approve(`profile_${id}`)).rejects.toBeInstanceOf(
      InvalidProfilePayloadError,
    );
  });
});
