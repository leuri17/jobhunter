import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { runMigrations } from '../../src/persistence/migrations.js';
import {
  createDatabaseConnection,
  type DatabaseConnection,
} from '../../src/persistence/connection.js';
import { createRepositories, type Repositories } from '../../src/persistence/repositories/index.js';
import { ProfileEditingService } from '../../src/profile/editing-service.js';
import { InvalidProfilePayloadError, InvalidProfileStateError } from '../../src/profile/errors.js';
import { derivedOverrides, profileVersions } from '../../src/persistence/schema.js';
import type { ProfessionalProfile, Skill } from '../../src/profile/schema.js';

const REPO_ROOT = resolve(import.meta.dirname, '..', '..');
const NOW = new Date('2026-11-02T12:00:00.000Z');

function makeSkill(id: string, name: string, normalizedName: string): Skill {
  return {
    id,
    name,
    normalizedName,
    category: 'framework',
    proficiency: null,
    yearsOfExperience: null,
    lastUsedAt: null,
    evidence: [],
  };
}

function makeProfileJson(id: string): ProfessionalProfile {
  return {
    schemaVersion: 1,
    id,
    createdAt: '2026-08-14T00:00:00.000Z',
    updatedAt: '2026-08-14T00:00:00.000Z',
    contentHash: 'will-be-rehashed',
    sourceIds: [],
    basics: {
      fullName: null,
      email: null,
      phone: null,
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

describe('ProfileEditingService.applyBulkEdit', () => {
  let directory: string;
  let connection: DatabaseConnection;
  let repos: Repositories;
  let service: ProfileEditingService;

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'jobhunter-editing-service-'));
    connection = createDatabaseConnection(join(directory, 'jobhunter.sqlite'));
    runMigrations(connection, { migrationsFolder: join(REPO_ROOT, 'drizzle') });
    repos = createRepositories(connection);
    service = new ProfileEditingService({ repositories: repos, now: () => NOW });
  });

  afterEach(() => {
    connection.close();
    rmSync(directory, { recursive: true, force: true });
  });

  function seedVersion(
    status: 'draft' | 'approved' | 'rejected' | 'superseded',
    opts: { active?: boolean; profileId?: string } = {},
  ): number {
    const profileId = opts.profileId ?? `prf_${Math.random().toString(36).slice(2, 10)}`;
    const inserted = connection.db
      .insert(profileVersions)
      .values({
        status,
        schemaVersion: 1,
        contentHash: 'seeded',
        extractionFingerprint: 'fp',
        sourceIdsJson: '[]',
        profileJson: JSON.stringify(makeProfileJson(profileId)),
        model: 'gpt-5',
        reasoningEffort: 'medium',
        promptVersion: 'p1',
        structuredOutputSchemaVersion: 2,
        extractorImplementationVersion: 'e1',
        createdAt: NOW.toISOString(),
        updatedAt: NOW.toISOString(),
        approvedAt: status === 'approved' ? NOW.toISOString() : null,
        supersededAt: null,
        active: opts.active ?? false,
      })
      .returning({ id: profileVersions.id })
      .all();
    return inserted[0]!.id;
  }

  it('updates a draft in place, fills normalizedName, and dedupes by normalized name', async () => {
    const id = seedVersion('draft');
    const edited = makeProfileJson(`profile_${id}`);
    edited.skills = [makeSkill('s1', 'React', ''), makeSkill('s2', 'react', 'react')];

    const result = await service.applyBulkEdit(`profile_${id}`, edited);

    expect(result.derived).toBe(false);
    expect(result.profileVersionId).toBe(id);
    const row = await repos.profileVersions.getById(id);
    const saved = row.profileJson as ProfessionalProfile;
    expect(saved.skills).toHaveLength(1);
    expect(saved.skills[0]!.normalizedName).toBe('react');
    expect(saved.contentHash).not.toBe('seeded');
    expect(saved.updatedAt).toBe(NOW.toISOString());
  });

  it('persists derived-override deactivation when resetting to generated', async () => {
    const id = seedVersion('draft');
    const active = makeProfileJson(`profile_${id}`);
    active.derived.primaryRoles = {
      generatedValue: ['Frontend developer'],
      overrideActive: true,
      overrideValue: ['Staff Engineer'],
      effectiveValue: ['Staff Engineer'],
      generatedAt: null,
      overriddenAt: NOW.toISOString(),
    };
    await service.applyBulkEdit(`profile_${id}`, active);

    const rowsAfterActive = connection.db.select().from(derivedOverrides).all();
    const activeRow = rowsAfterActive.find(
      (r) => r.profileVersionId === id && r.derivedField === 'primaryRoles',
    );
    expect(activeRow).toBeDefined();
    expect(activeRow!.overrideActive).toBe(true);

    const reset = makeProfileJson(`profile_${id}`);
    reset.derived.primaryRoles = {
      generatedValue: ['Frontend developer'],
      overrideActive: false,
      overrideValue: null,
      effectiveValue: ['Frontend developer'],
      generatedAt: null,
      overriddenAt: null,
    };
    await service.applyBulkEdit(`profile_${id}`, reset);

    const rowsAfterReset = connection.db.select().from(derivedOverrides).all();
    const resetRow = rowsAfterReset.find(
      (r) => r.profileVersionId === id && r.derivedField === 'primaryRoles',
    );
    expect(resetRow).toBeDefined();
    expect(resetRow!.overrideActive).toBe(false);
    expect(resetRow!.overrideValueJson).toBeNull();
  });

  it('editing an approved version derives a new draft and keeps the approved row active', async () => {
    const approvedId = seedVersion('approved', { active: true, profileId: 'prf_approved' });
    const edited = makeProfileJson('prf_approved');

    const result = await service.applyBulkEdit('prf_approved', edited);

    expect(result.derived).toBe(true);
    expect(result.profileVersionId).not.toBe(approvedId);
    const approved = await repos.profileVersions.getById(approvedId);
    expect(approved.active).toBe(true);
    expect(approved.status).toBe('approved');
    const draft = await repos.profileVersions.getById(result.profileVersionId);
    expect(draft.status).toBe('draft');
    expect(draft.active).toBe(false);
  });

  it('refuses rejected and superseded versions', async () => {
    const rejectedId = seedVersion('rejected');
    const supersededId = seedVersion('superseded');
    await expect(
      service.applyBulkEdit(`profile_${rejectedId}`, makeProfileJson('x')),
    ).rejects.toBeInstanceOf(InvalidProfileStateError);
    await expect(
      service.applyBulkEdit(`profile_${supersededId}`, makeProfileJson('y')),
    ).rejects.toBeInstanceOf(InvalidProfileStateError);
  });

  it('upserts derived overrides when overrideActive is set', async () => {
    const id = seedVersion('draft');
    const edited = makeProfileJson(`profile_${id}`);
    edited.derived.primaryRoles = {
      generatedValue: ['Developer'],
      overrideActive: true,
      overrideValue: ['Staff Engineer'],
      effectiveValue: ['Staff Engineer'],
      generatedAt: null,
      overriddenAt: NOW.toISOString(),
    };

    const result = await service.applyBulkEdit(`profile_${id}`, edited);

    const overrides = await repos.profileVersions.listOverrides(result.profileVersionId);
    const roles = overrides.find((o) => o.derivedField === 'primaryRoles');
    expect(roles).toBeDefined();
    expect(roles?.overrideActive).toBe(true);
  });

  it('rejects an invalid profile with InvalidProfilePayloadError', async () => {
    const id = seedVersion('draft');
    const broken = { ...makeProfileJson(`profile_${id}`), basics: undefined };
    await expect(service.applyBulkEdit(`profile_${id}`, broken)).rejects.toBeInstanceOf(
      InvalidProfilePayloadError,
    );
  });

  it('accepts a draft edit where skills carry empty normalizedName from manual UI adds', async () => {
    const id = seedVersion('draft');
    const edited = makeProfileJson(`profile_${id}`);
    edited.skills = [makeSkill('s1', 'Kubernetes', '')];

    const result = await service.applyBulkEdit(`profile_${id}`, edited as unknown);

    const row = await repos.profileVersions.getById(result.profileVersionId);
    const saved = row.profileJson as ProfessionalProfile;
    expect(saved.skills[0]!.normalizedName).not.toBe('');
  });
});
