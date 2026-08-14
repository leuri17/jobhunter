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
import { ProfileRejectionService } from '../../src/profile/rejection-service.js';
import { ProfileSourceRepository } from '../../src/persistence/repositories/profile-sources.js';
import { ProfileVersionRepository } from '../../src/persistence/repositories/profile-versions.js';
import type { Repositories } from '../../src/persistence/repositories/index.js';
import { InvalidProfileStateError, UserCancelledRejectionError } from '../../src/profile/errors.js';

const REPO_ROOT = resolve(import.meta.dirname, '..', '..');

function makeProfileJson(id: string): Record<string, unknown> {
  return {
    schemaVersion: 1,
    id,
    createdAt: '2026-08-14T00:00:00.000Z',
    updatedAt: '2026-08-14T00:00:00.000Z',
    contentHash: `hash-${id}`,
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
  status: 'draft' | 'approved' | 'rejected' | 'superseded' = 'draft',
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

describe('ProfileRejectionService', () => {
  let directory: string;
  let connection: DatabaseConnection;
  let repositories: Repositories;

  beforeEach(async () => {
    directory = mkdtempSync(join(tmpdir(), 'jobhunter-profile-rejection-service-'));
    connection = createDatabaseConnection(join(directory, 'jobhunter.sqlite'));
    runMigrations(connection, { migrationsFolder: join(REPO_ROOT, 'drizzle') });
    repositories = createRepositories(connection);
  });

  afterEach(() => {
    connection.close();
    rmSync(directory, { recursive: true, force: true });
  });

  it('rejects a draft with the user confirming', async () => {
    const id = await seedProfile(repositories, 'prf_d', 'fp_d', 'draft', false);
    const service = new ProfileRejectionService({
      repositories,
      prompts: { confirmRejection: async () => true },
    });
    const result = await service.reject(`profile_${id}`);
    expect(result.rejectedProfileVersionId).toBe(id);
    const after = await repositories.profileVersions.getById(id);
    expect(after.status).toBe('rejected');
    expect(after.active).toBe(false);
  });

  it('throws UserCancelledRejectionError when the user declines', async () => {
    const id = await seedProfile(repositories, 'prf_d', 'fp_d', 'draft', false);
    const service = new ProfileRejectionService({
      repositories,
      prompts: { confirmRejection: async () => false },
    });
    await expect(service.reject(`profile_${id}`)).rejects.toBeInstanceOf(
      UserCancelledRejectionError,
    );
    const after = await repositories.profileVersions.getById(id);
    expect(after.status).toBe('draft');
  });

  it('throws InvalidProfileStateError when the target is approved', async () => {
    const id = await seedProfile(repositories, 'prf_a', 'fp_a', 'approved', true);
    const service = new ProfileRejectionService({
      repositories,
      prompts: { confirmRejection: async () => true },
    });
    await expect(service.reject(`profile_${id}`)).rejects.toBeInstanceOf(InvalidProfileStateError);
  });

  it('throws InvalidProfileStateError when the target is already rejected', async () => {
    const id = await seedProfile(repositories, 'prf_r', 'fp_r', 'rejected', false);
    const service = new ProfileRejectionService({
      repositories,
      prompts: { confirmRejection: async () => true },
    });
    await expect(service.reject(`profile_${id}`)).rejects.toBeInstanceOf(InvalidProfileStateError);
  });

  it('does not touch the previously approved profile', async () => {
    const approvedId = await seedProfile(repositories, 'prf_p', 'fp_p', 'approved', true);
    const draftId = await seedProfile(repositories, 'prf_x', 'fp_x', 'draft', false);
    const service = new ProfileRejectionService({
      repositories,
      prompts: { confirmRejection: async () => true },
    });
    await service.reject(`profile_${draftId}`);
    const approvedAfter = await repositories.profileVersions.getById(approvedId);
    expect(approvedAfter.status).toBe('approved');
    expect(approvedAfter.active).toBe(true);
  });
});
