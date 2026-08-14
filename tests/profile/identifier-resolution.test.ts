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
import { resolveProfileVersionId } from '../../src/profile/identifier-resolution.js';
import type { Repositories } from '../../src/persistence/repositories/index.js';
import { InvalidProfileIdentifierError } from '../../src/profile/errors.js';

const REPO_ROOT = resolve(import.meta.dirname, '..', '..');

interface SeededProfile {
  readonly id: number;
  readonly profileJson: Record<string, unknown>;
}

async function seedProfileVersion(
  repositories: Repositories,
  profileJson: Record<string, unknown>,
  extractionFingerprint: string,
): Promise<number> {
  return repositories.profileVersions.insert({
    status: 'draft',
    schemaVersion: 1,
    contentHash: `hash-${extractionFingerprint}`,
    extractionFingerprint,
    sourceIds: [],
    profileJson,
    createdAt: '2026-08-14T00:00:00.000Z',
    updatedAt: '2026-08-14T00:00:00.000Z',
  });
}

describe('resolveProfileVersionId', () => {
  let directory: string;
  let connection: DatabaseConnection;
  let repositories: Repositories;
  let seeded: SeededProfile[] = [];

  beforeEach(async () => {
    directory = mkdtempSync(join(tmpdir(), 'jobhunter-profile-id-resolution-'));
    connection = createDatabaseConnection(join(directory, 'jobhunter.sqlite'));
    runMigrations(connection, { migrationsFolder: join(REPO_ROOT, 'drizzle') });
    repositories = createRepositories(connection);
    seeded = [];
  });

  afterEach(() => {
    connection.close();
    rmSync(directory, { recursive: true, force: true });
  });

  function makeProfileJson(id: string): Record<string, unknown> {
    return {
      schemaVersion: 1,
      id,
      createdAt: '2026-08-14T00:00:00.000Z',
      updatedAt: '2026-08-14T00:00:00.000Z',
      contentHash: `hash-for-${id}`,
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

  async function seed(profileJsonId: string, fingerprint: string): Promise<number> {
    const id = await seedProfileVersion(repositories, makeProfileJson(profileJsonId), fingerprint);
    seeded.push({ id, profileJson: makeProfileJson(profileJsonId) });
    return id;
  }

  it('resolves the integer PK form when the row exists', async () => {
    const pk = await seed('prf_alpha', 'fp_alpha');
    await expect(resolveProfileVersionId(repositories, `profile_${pk}`)).resolves.toBe(pk);
  });

  it('resolves the JSON-id form when the PK form does not match', async () => {
    const pk = await seed('prf_json_only', 'fp_json_only');
    await expect(resolveProfileVersionId(repositories, 'prf_json_only')).resolves.toBe(pk);
  });

  it('prefers the integer PK form when both forms could match', async () => {
    // Both the PK (auto-increment integer) and the JSON-id "42" reference the
    // same row. The PK path is canonical, so resolution must return PK 42.
    const pk = await seed('42', 'fp_both');
    await expect(resolveProfileVersionId(repositories, `profile_${pk}`)).resolves.toBe(pk);
  });

  it('throws profile_not_found for an unknown PK form', async () => {
    await seed('prf_real', 'fp_real');
    await expect(resolveProfileVersionId(repositories, 'profile_9999')).rejects.toBeInstanceOf(
      InvalidProfileIdentifierError,
    );
    try {
      await resolveProfileVersionId(repositories, 'profile_9999');
    } catch (err) {
      expect(err).toBeInstanceOf(InvalidProfileIdentifierError);
      expect((err as InvalidProfileIdentifierError).code).toBe('profile_not_found');
      expect((err as InvalidProfileIdentifierError).exitCode).toBe(2);
    }
  });

  it('throws profile_not_found for an unknown JSON-id form', async () => {
    await seed('prf_real', 'fp_real');
    await expect(
      resolveProfileVersionId(repositories, 'prf_does_not_exist'),
    ).rejects.toBeInstanceOf(InvalidProfileIdentifierError);
  });

  it('throws profile_id_collision when two rows share the JSON id', async () => {
    await seed('prf_collision', 'fp_a');
    await seed('prf_collision', 'fp_b');
    try {
      await resolveProfileVersionId(repositories, 'prf_collision');
    } catch (err) {
      expect(err).toBeInstanceOf(InvalidProfileIdentifierError);
      expect((err as InvalidProfileIdentifierError).code).toBe('profile_id_collision');
    }
  });

  it('throws invalid_identifier for an empty input', async () => {
    try {
      await resolveProfileVersionId(repositories, '');
    } catch (err) {
      expect(err).toBeInstanceOf(InvalidProfileIdentifierError);
      expect((err as InvalidProfileIdentifierError).code).toBe('invalid_identifier');
    }
  });

  it('throws invalid_identifier for a non-integer tail after the prefix', async () => {
    try {
      await resolveProfileVersionId(repositories, 'profile_abc');
    } catch (err) {
      expect(err).toBeInstanceOf(InvalidProfileIdentifierError);
      expect((err as InvalidProfileIdentifierError).code).toBe('invalid_identifier');
    }
  });
});
