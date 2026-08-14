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
import { ProfileReviewService } from '../../src/profile/review-service.js';
import { ProfileSourceRepository } from '../../src/persistence/repositories/profile-sources.js';
import { ProfileVersionRepository } from '../../src/persistence/repositories/profile-versions.js';
import type { Repositories } from '../../src/persistence/repositories/index.js';
import {
  InvalidProfileIdentifierError,
  InvalidProfilePayloadError,
} from '../../src/profile/errors.js';

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
): Promise<number> {
  const sourceRepo = new ProfileSourceRepository({
    db: repositories.db,
  });
  const sourceId = await seedSource(
    sourceRepo,
    `sha_${fingerprint}_${profileJsonId}`.padEnd(64, '0'),
  );
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
    active: status === 'approved',
  });
}

describe('ProfileReviewService', () => {
  let directory: string;
  let connection: DatabaseConnection;
  let repositories: Repositories;
  let service: ProfileReviewService;

  beforeEach(async () => {
    directory = mkdtempSync(join(tmpdir(), 'jobhunter-profile-review-service-'));
    connection = createDatabaseConnection(join(directory, 'jobhunter.sqlite'));
    runMigrations(connection, { migrationsFolder: join(REPO_ROOT, 'drizzle') });
    repositories = createRepositories(connection);
    service = new ProfileReviewService(repositories);
  });

  afterEach(() => {
    connection.close();
    rmSync(directory, { recursive: true, force: true });
  });

  describe('list', () => {
    it('returns an empty array when no profiles exist', async () => {
      const out = await service.list();
      expect(out).toEqual([]);
    });

    it('returns every profile in id-DESC order', async () => {
      const id1 = await seedProfile(repositories, 'prf_alpha', 'fp_a');
      const id2 = await seedProfile(repositories, 'prf_beta', 'fp_b');
      const id3 = await seedProfile(repositories, 'prf_gamma', 'fp_c');
      const out = await service.list();
      expect(out.map((e) => e.profileVersionId)).toEqual([id3, id2, id1]);
    });

    it('filters by status when requested', async () => {
      const _draft = await seedProfile(repositories, 'prf_d', 'fp_d', 'draft');
      const approved = await seedProfile(repositories, 'prf_a', 'fp_a', 'approved');
      const out = await service.list({ status: 'approved' });
      expect(out).toHaveLength(1);
      expect(out[0]?.profileVersionId).toBe(approved);
      expect(out[0]?.status).toBe('approved');
    });

    it('surfaces the JSON profile id alongside the PK', async () => {
      const id = await seedProfile(repositories, 'prf_named', 'fp_named');
      const out = await service.list();
      const entry = out.find((e) => e.profileVersionId === id);
      expect(entry?.profileId).toBe('prf_named');
    });
  });

  describe('show', () => {
    it('resolves PK form and returns the full payload', async () => {
      const id = await seedProfile(repositories, 'prf_show', 'fp_show');
      const payload = await service.show(`profile_${id}`);
      expect(payload.status).toBe('draft');
      expect(payload.profile.id).toBe('prf_show');
      expect(payload.contentHash).toBe(`hash-fp_show`);
      expect(payload.warnings).toEqual([]);
      expect(payload.conflicts).toEqual([]);
      expect(payload.overrides).toEqual([]);
      expect(payload.revisions).toEqual([]);
    });

    it('resolves JSON-id form', async () => {
      await seedProfile(repositories, 'prf_json_form', 'fp_json_form');
      const payload = await service.show('prf_json_form');
      expect(payload.profile.id).toBe('prf_json_form');
      expect(payload.profile.schemaVersion).toBe(1);
    });

    it('throws InvalidProfileIdentifierError for unknown id', async () => {
      await expect(service.show('profile_9999')).rejects.toBeInstanceOf(
        InvalidProfileIdentifierError,
      );
    });

    it('throws InvalidProfilePayloadError when stored JSON fails Zod', async () => {
      const versionRepo = new ProfileVersionRepository({ db: repositories.db });
      const sourceRepo = new ProfileSourceRepository({ db: repositories.db });
      const sourceId = await seedSource(sourceRepo, 'b'.repeat(64));
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
      await expect(service.show(`profile_${id}`)).rejects.toBeInstanceOf(
        InvalidProfilePayloadError,
      );
    });
  });
});
