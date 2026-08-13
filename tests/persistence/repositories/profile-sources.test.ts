import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runMigrations } from '../../../src/persistence/migrations.js';
import {
  createDatabaseConnection,
  type DatabaseConnection,
} from '../../../src/persistence/connection.js';
import { DuplicateSha256Error } from '../../../src/persistence/repository-errors.js';
import { ProfileSourceRepository } from '../../../src/persistence/repositories/profile-sources.js';

const REPO_ROOT = resolve(import.meta.dirname, '..', '..', '..');

function ctxFrom(connection: DatabaseConnection) {
  return { db: connection.db };
}

describe('ProfileSourceRepository', () => {
  let directory: string;
  let connection: DatabaseConnection;
  let repo: ProfileSourceRepository;

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'jobhunter-profile-sources-'));
    connection = createDatabaseConnection(join(directory, 'jobhunter.sqlite'));
    runMigrations(connection, { migrationsFolder: join(REPO_ROOT, 'drizzle') });
    repo = new ProfileSourceRepository(ctxFrom(connection));
  });

  afterEach(() => {
    connection.close();
    rmSync(directory, { recursive: true, force: true });
  });

  it('inserts a new source and returns its id', async () => {
    const id = await repo.insert({
      sourceType: 'pdf',
      originalFilename: 'cv.pdf',
      originalAbsolutePath: '/tmp/cv.pdf',
      storedPath: '/opt/jobhunter/profile-sources/cv.sha256.pdf',
      mimeType: 'application/pdf',
      fileSize: 12345,
      sha256: 'a'.repeat(64),
      importTimestamp: '2026-08-05T10:00:00.000Z',
    });
    expect(id).toBeGreaterThan(0);
    const row = await repo.findById(id);
    expect(row).not.toBeNull();
    expect(row?.sourceType).toBe('pdf');
    expect(row?.textExtractionStatus).toBe('pending');
  });

  it('throws DuplicateSha256Error on sha256 collision (insert is strict INSERT-OR-ERROR)', async () => {
    const first = await repo.insert({
      sourceType: 'pdf',
      originalFilename: 'cv.pdf',
      originalAbsolutePath: '/tmp/cv.pdf',
      storedPath: '/opt/jobhunter/profile-sources/cv.sha256.pdf',
      mimeType: 'application/pdf',
      fileSize: 12345,
      sha256: 'b'.repeat(64),
      importTimestamp: '2026-08-05T10:00:00.000Z',
    });
    expect(first).toBeGreaterThan(0);
    await expect(
      repo.insert({
        sourceType: 'pdf',
        originalFilename: 'cv-renamed.pdf',
        originalAbsolutePath: '/tmp/cv-renamed.pdf',
        storedPath: '/opt/jobhunter/profile-sources/cv.sha256.pdf',
        mimeType: 'application/pdf',
        fileSize: 12345,
        sha256: 'b'.repeat(64),
        importTimestamp: '2026-08-05T10:01:00.000Z',
      }),
    ).rejects.toBeInstanceOf(DuplicateSha256Error);
  });

  it('updateExtraction patches only the extraction fields', async () => {
    const id = await repo.insert({
      sourceType: 'plain_text',
      originalFilename: 'cv.txt',
      originalAbsolutePath: '/tmp/cv.txt',
      storedPath: '/opt/jobhunter/profile-sources/cv.sha256.txt',
      mimeType: 'text/plain',
      fileSize: 500,
      sha256: 'c'.repeat(64),
      importTimestamp: '2026-08-05T10:00:00.000Z',
    });
    await repo.updateExtraction(id, {
      extractedTextHash: 'd'.repeat(64),
      status: 'success',
      message: null,
    });
    const row = await repo.findById(id);
    expect(row?.extractedTextHash).toBe('d'.repeat(64));
    expect(row?.textExtractionStatus).toBe('success');
    expect(row?.textExtractionMessage).toBeNull();
    expect(row?.sha256).toBe('c'.repeat(64)); // immutable
    expect(row?.fileSize).toBe(500); // immutable
  });

  it('updateStoredPath changes the stored path', async () => {
    const id = await repo.insert({
      sourceType: 'pdf',
      originalFilename: 'cv.pdf',
      originalAbsolutePath: '/tmp/cv.pdf',
      mimeType: 'application/pdf',
      fileSize: 12345,
      sha256: 'g'.repeat(64),
      importTimestamp: '2026-08-05T10:00:00.000Z',
    });
    await repo.updateStoredPath(id, '/opt/jobhunter/profile-sources/1/cv.pdf');
    const row = await repo.findById(id);
    expect(row?.storedPath).toBe('/opt/jobhunter/profile-sources/1/cv.pdf');
    expect(row?.sha256).toBe('g'.repeat(64));
  });

  it('list returns all sources', async () => {
    await repo.insert({
      sourceType: 'pdf',
      originalFilename: 'a.pdf',
      originalAbsolutePath: '/tmp/a.pdf',
      storedPath: '/opt/a.pdf',
      mimeType: 'application/pdf',
      fileSize: 1,
      sha256: 'e'.repeat(64),
      importTimestamp: '2026-08-05T10:00:00.000Z',
    });
    await repo.insert({
      sourceType: 'markdown',
      originalFilename: 'b.md',
      originalAbsolutePath: '/tmp/b.md',
      storedPath: '/opt/b.md',
      mimeType: 'text/markdown',
      fileSize: 2,
      sha256: 'f'.repeat(64),
      importTimestamp: '2026-08-05T10:00:00.000Z',
    });
    const rows = await repo.list();
    expect(rows).toHaveLength(2);
  });

  it('defaults warnings to an empty array on insert', async () => {
    const id = await repo.insert({
      sourceType: 'plain_text',
      originalFilename: 'no-warnings.txt',
      originalAbsolutePath: '/tmp/no-warnings.txt',
      storedPath: '/opt/no-warnings.txt',
      mimeType: 'text/plain',
      fileSize: 10,
      sha256: '1'.repeat(64),
      importTimestamp: '2026-08-05T10:00:00.000Z',
    });
    const row = await repo.findById(id);
    expect(row?.warnings).toEqual([]);
  });

  it('persists warnings provided to insert and round-trips them through updateExtraction', async () => {
    const id = await repo.insert({
      sourceType: 'markdown',
      originalFilename: 'cv.md',
      originalAbsolutePath: '/tmp/cv.md',
      storedPath: '/opt/cv.md',
      mimeType: 'text/markdown',
      fileSize: 100,
      sha256: '2'.repeat(64),
      importTimestamp: '2026-08-05T10:00:00.000Z',
      warnings: ['markdown_contains_external_image_references'],
    });
    const row = await repo.findById(id);
    expect(row?.warnings).toEqual(['markdown_contains_external_image_references']);

    // updateExtraction with a new warnings array should overwrite.
    await repo.updateExtraction(id, {
      extractedTextHash: 'h'.repeat(64),
      status: 'success',
      message: null,
      warnings: ['markdown_contains_external_image_references', 'another_warning'],
    });
    const updated = await repo.findById(id);
    expect(updated?.warnings).toEqual([
      'markdown_contains_external_image_references',
      'another_warning',
    ]);
  });

  it('leaves warnings as the default [] when updateExtraction omits warnings', async () => {
    const id = await repo.insert({
      sourceType: 'pdf',
      originalFilename: 'cv.pdf',
      originalAbsolutePath: '/tmp/cv.pdf',
      storedPath: '/opt/cv.pdf',
      mimeType: 'application/pdf',
      fileSize: 100,
      sha256: '3'.repeat(64),
      importTimestamp: '2026-08-05T10:00:00.000Z',
    });
    await repo.updateExtraction(id, {
      extractedTextHash: 'h'.repeat(64),
      status: 'failed',
      message: 'ocr_required',
    });
    const row = await repo.findById(id);
    expect(row?.warnings).toEqual([]);
  });
});
