import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runMigrations } from '../../../src/persistence/migrations.js';
import { createDatabaseConnection, type DatabaseConnection } from '../../../src/persistence/connection.js';
import { profileVersions as profileVersionsTableForTest } from '../../../src/persistence/schema.js';
import { ProfileSourceRepository } from '../../../src/persistence/repositories/profile-sources.js';
import { ProfileVersionRepository } from '../../../src/persistence/repositories/profile-versions.js';
import { RecordNotFoundError } from '../../../src/persistence/repository-errors.js';

const REPO_ROOT = resolve(import.meta.dirname, '..', '..', '..');

function ctxFrom(connection: DatabaseConnection) {
  return { db: connection.db };
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
    importTimestamp: '2026-08-05T10:00:00.000Z',
  });
}

describe('ProfileVersionRepository', () => {
  let directory: string;
  let connection: DatabaseConnection;
  let sourceRepo: ProfileSourceRepository;
  let versionRepo: ProfileVersionRepository;

  beforeEach(async () => {
    directory = mkdtempSync(join(tmpdir(), 'jobhunter-profile-versions-'));
    connection = createDatabaseConnection(join(directory, 'jobhunter.sqlite'));
    runMigrations(connection, { migrationsFolder: join(REPO_ROOT, 'drizzle') });
    sourceRepo = new ProfileSourceRepository(ctxFrom(connection));
    versionRepo = new ProfileVersionRepository(ctxFrom(connection));
  });

  afterEach(() => {
    connection.close();
    rmSync(directory, { recursive: true, force: true });
  });

  it('inserts a draft and finds it by id', async () => {
    const sourceId = await seedSource(sourceRepo, 'a'.repeat(64));
    const id = await versionRepo.insert({
      status: 'draft',
      schemaVersion: 1,
      contentHash: 'h1',
      extractionFingerprint: 'fp1',
      sourceIds: [sourceId],
      profileJson: { headline: 'Engineer' },
      createdAt: '2026-08-05T10:00:00.000Z',
      updatedAt: '2026-08-05T10:00:00.000Z',
    });
    const row = await versionRepo.getById(id);
    expect(row.status).toBe('draft');
    expect(row.sourceIds).toEqual([sourceId]);
    expect(row.profileJson).toMatchObject({ headline: 'Engineer' });
    expect(row.active).toBe(false);
  });

  it('getById throws RecordNotFoundError for missing ids', async () => {
    await expect(versionRepo.getById(999)).rejects.toBeInstanceOf(RecordNotFoundError);
  });

  it('approves a draft and marks the previously active row superseded', async () => {
    const sourceId = await seedSource(sourceRepo, 'b'.repeat(64));
    const first = await versionRepo.insert({
      status: 'draft', schemaVersion: 1, contentHash: 'h1', extractionFingerprint: 'fp1',
      sourceIds: [sourceId], profileJson: {},
      createdAt: '2026-08-05T10:00:00.000Z', updatedAt: '2026-08-05T10:00:00.000Z',
    });
    await versionRepo.approve(first, { approvedAt: '2026-08-05T10:01:00.000Z', supersededAt: '2026-08-05T10:01:00.000Z' });

    const second = await versionRepo.insert({
      status: 'draft', schemaVersion: 1, contentHash: 'h2', extractionFingerprint: 'fp2',
      sourceIds: [sourceId], profileJson: {},
      createdAt: '2026-08-05T11:00:00.000Z', updatedAt: '2026-08-05T11:00:00.000Z',
    });
    await versionRepo.approve(second, { approvedAt: '2026-08-05T11:01:00.000Z', supersededAt: '2026-08-05T11:01:00.000Z' });

    const active = await versionRepo.findActiveApproved();
    expect(active?.id).toBe(second);
    expect(active?.status).toBe('approved');
    expect(active?.active).toBe(true);
    const previous = await versionRepo.getById(first);
    expect(previous.status).toBe('superseded');
    expect(previous.active).toBe(false);
    expect(previous.supersededAt).toBe('2026-08-05T11:01:00.000Z');
  });

  it('rejects a draft without disturbing the currently active profile', async () => {
    const sourceId = await seedSource(sourceRepo, 'c'.repeat(64));
    const first = await versionRepo.insert({
      status: 'draft', schemaVersion: 1, contentHash: 'h1', extractionFingerprint: 'fp1',
      sourceIds: [sourceId], profileJson: {},
      createdAt: '2026-08-05T10:00:00.000Z', updatedAt: '2026-08-05T10:00:00.000Z',
    });
    await versionRepo.approve(first, { approvedAt: '2026-08-05T10:01:00.000Z', supersededAt: '2026-08-05T10:01:00.000Z' });

    const second = await versionRepo.insert({
      status: 'draft', schemaVersion: 1, contentHash: 'h2', extractionFingerprint: 'fp2',
      sourceIds: [sourceId], profileJson: {},
      createdAt: '2026-08-05T11:00:00.000Z', updatedAt: '2026-08-05T11:00:00.000Z',
    });
    await versionRepo.reject(second, { now: '2026-08-05T12:00:00.000Z' });

    const active = await versionRepo.findActiveApproved();
    expect(active?.id).toBe(first);
    const rejected = await versionRepo.getById(second);
    expect(rejected.status).toBe('rejected');
  });

  it('only one row can be active+approved (partial unique index enforced)', async () => {
    const sourceId = await seedSource(sourceRepo, 'd'.repeat(64));
    const first = await versionRepo.insert({
      status: 'draft', schemaVersion: 1, contentHash: 'h1', extractionFingerprint: 'fp1',
      sourceIds: [sourceId], profileJson: {},
      createdAt: '2026-08-05T10:00:00.000Z', updatedAt: '2026-08-05T10:00:00.000Z',
    });
    await versionRepo.approve(first, { approvedAt: '2026-08-05T10:01:00.000Z', supersededAt: '2026-08-05T10:01:00.000Z' });

    // Cannot manually insert a second active+approved row directly.
    await expect(
      connection.db.insert(profileVersionsTableForTest).values({
        status: 'approved',
        schemaVersion: 1,
        contentHash: 'h2',
        extractionFingerprint: 'fp2',
        sourceIdsJson: '[]',
        profileJson: '{}',
        createdAt: '2026-08-05T11:00:00.000Z',
        updatedAt: '2026-08-05T11:00:00.000Z',
        active: true,
      }),
    ).rejects.toThrow();
  });

  it('inserts and lists revisions, conflicts, warnings, and overrides', async () => {
    const sourceId = await seedSource(sourceRepo, 'e'.repeat(64));
    const versionId = await versionRepo.insert({
      status: 'draft', schemaVersion: 1, contentHash: 'h1', extractionFingerprint: 'fp1',
      sourceIds: [sourceId], profileJson: {},
      createdAt: '2026-08-05T10:00:00.000Z', updatedAt: '2026-08-05T10:00:00.000Z',
    });

    await versionRepo.insertRevision({
      profileVersionId: versionId,
      revisionTimestamp: '2026-08-05T10:00:00.000Z',
      source: 'openai',
      fieldPath: 'headline',
      previousValue: null,
      newValue: 'Engineer',
      note: null,
    });
    await versionRepo.insertConflict({
      profileVersionId: versionId,
      conflictType: 'company_dating',
      affectedField: 'workExperience[0].endDate',
      valueSourceA: '2024-01-01',
      valueSourceB: '2023-12-01',
      sourceReferences: [{ sourceId, field: 'endDate' }],
      provisionalValue: '2023-12-01',
      explanation: 'Two sources disagree.',
      resolutionStatus: 'unresolved',
      resolvedAt: null,
      resolvedValue: null,
    });
    await versionRepo.insertWarning({
      profileVersionId: versionId,
      severity: 'warning',
      warningType: 'missing_field',
      fieldPath: 'certifications',
      message: 'No certifications listed.',
      createdAt: '2026-08-05T10:00:00.000Z',
    });
    await versionRepo.upsertOverride({
      profileVersionId: versionId,
      derivedField: 'likelySeniority',
      overrideActive: true,
      overrideValue: 'senior',
      generatedValue: 'mid',
      generatedAt: '2026-08-05T10:00:00.000Z',
      overriddenAt: '2026-08-05T10:01:00.000Z',
    });

    expect(await versionRepo.listRevisions(versionId)).toHaveLength(1);
    expect(await versionRepo.listConflicts(versionId)).toHaveLength(1);
    expect(await versionRepo.listWarnings(versionId)).toHaveLength(1);
    expect(await versionRepo.listOverrides(versionId)).toHaveLength(1);
  });

  it('resolveConflict flips resolutionStatus and stores resolvedValue', async () => {
    const sourceId = await seedSource(sourceRepo, 'f'.repeat(64));
    const versionId = await versionRepo.insert({
      status: 'draft', schemaVersion: 1, contentHash: 'h1', extractionFingerprint: 'fp1',
      sourceIds: [sourceId], profileJson: {},
      createdAt: '2026-08-05T10:00:00.000Z', updatedAt: '2026-08-05T10:00:00.000Z',
    });
    const conflictId = await versionRepo.insertConflict({
      profileVersionId: versionId,
      conflictType: 'company_dating',
      affectedField: 'workExperience[0].endDate',
      valueSourceA: '2024-01-01',
      valueSourceB: '2023-12-01',
      sourceReferences: [],
      provisionalValue: '2023-12-01',
      explanation: null,
      resolutionStatus: 'unresolved',
      resolvedAt: null,
      resolvedValue: null,
    });
    await versionRepo.resolveConflict(conflictId, {
      resolvedAt: '2026-08-05T10:00:00.000Z',
      resolvedValue: '2023-12-01',
    });
    const conflicts = await versionRepo.listConflicts(versionId);
    expect(conflicts[0]?.resolutionStatus).toBe('resolved');
    expect(conflicts[0]?.resolvedValue).toBe('2023-12-01');
  });
});
