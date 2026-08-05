import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runMigrations } from '../../../src/persistence/migrations.js';
import { createDatabaseConnection, type DatabaseConnection } from '../../../src/persistence/connection.js';
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

  it('is idempotent on sha256 conflict and returns the existing id', async () => {
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
    const second = await repo.insert({
      sourceType: 'pdf',
      originalFilename: 'cv-renamed.pdf',
      originalAbsolutePath: '/tmp/cv-renamed.pdf',
      storedPath: '/opt/jobhunter/profile-sources/cv.sha256.pdf',
      mimeType: 'application/pdf',
      fileSize: 12345,
      sha256: 'b'.repeat(64),
      importTimestamp: '2026-08-05T10:01:00.000Z',
    });
    expect(second).toBe(first);
    const found = await repo.findBySha256('b'.repeat(64));
    expect(found?.id).toBe(first);
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

  it('list returns all sources', async () => {
    await repo.insert({
      sourceType: 'pdf', originalFilename: 'a.pdf', originalAbsolutePath: '/tmp/a.pdf',
      storedPath: '/opt/a.pdf', mimeType: 'application/pdf', fileSize: 1, sha256: 'e'.repeat(64),
      importTimestamp: '2026-08-05T10:00:00.000Z',
    });
    await repo.insert({
      sourceType: 'markdown', originalFilename: 'b.md', originalAbsolutePath: '/tmp/b.md',
      storedPath: '/opt/b.md', mimeType: 'text/markdown', fileSize: 2, sha256: 'f'.repeat(64),
      importTimestamp: '2026-08-05T10:00:00.000Z',
    });
    const rows = await repo.list();
    expect(rows).toHaveLength(2);
  });
});
