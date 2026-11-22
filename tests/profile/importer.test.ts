import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { runMigrations } from '../../src/persistence/migrations.js';
import {
  createDatabaseConnection,
  type DatabaseConnection,
} from '../../src/persistence/connection.js';
import { createRepositories, Repositories } from '../../src/persistence/repositories/index.js';
import { resolvePlatformPaths } from '../../src/platform/paths.js';
import type { PlatformAdapter } from '../../src/platform/platform.js';
import { InvalidArgumentCountError, SourceUnreadableError } from '../../src/profile/errors.js';
import { ProfileImportService } from '../../src/profile/importer.js';

const REPO_ROOT = resolve(import.meta.dirname, '..', '..');

function adapter(home: string): PlatformAdapter {
  return { platform: 'linux', home, environment: {} };
}

function loadFixture(name: string): Uint8Array {
  return new Uint8Array(readFileSync(resolve(REPO_ROOT, 'tests/profile/fixtures', name)));
}

describe('ProfileImportService', () => {
  let tempHome: string;
  let directory: string;
  let connection: DatabaseConnection;
  let repositories: Repositories;
  let service: ProfileImportService;

  beforeEach(() => {
    tempHome = mkdtempSync(join(tmpdir(), 'jobhunter-profile-import-'));
    directory = mkdtempSync(join(tmpdir(), 'jobhunter-profile-import-db-'));
    connection = createDatabaseConnection(join(directory, 'jobhunter.sqlite'));
    runMigrations(connection, { migrationsFolder: resolve(REPO_ROOT, 'drizzle') });
    repositories = createRepositories(connection);
    mkdirSync(join(tempHome, 'profile-sources'), { recursive: true });
    const paths = resolvePlatformPaths(adapter(tempHome));
    service = new ProfileImportService({ paths, repositories });
  });

  afterEach(() => {
    connection.close();
    rmSync(tempHome, { recursive: true, force: true });
    rmSync(directory, { recursive: true, force: true });
  });

  it('imports a single Markdown file and extracts its text', async () => {
    const sourcePath = join(tempHome, 'cv.md');
    writeFileSync(sourcePath, '# Title\n\n- bullet\n- bullet\n', 'utf8');

    const result = await service.importSources([sourcePath]);

    expect(result.status).toBe('success');
    expect(result.sources).toHaveLength(1);
    const imported = result.sources[0]!;
    expect(imported.sourceType).toBe('markdown');
    expect(imported.textExtractionStatus).toBe('success');
    expect(imported.storedPath).toContain(`profile-sources/${imported.sha256}/`);
    expect(imported.reused).toBe(false);
    expect(imported.extractedTextHash).toMatch(/^[0-9a-f]{64}$/);

    const stored = await repositories.profileSources.findById(imported.id);
    expect(stored?.sha256).toBe(imported.sha256);
    expect(stored?.textExtractionStatus).toBe('success');
    expect(stored?.textExtractionMessage).toBeNull();
  });

  it('re-importing the same file reuses the existing source by sha256', async () => {
    const sourcePath = join(tempHome, 'cv.md');
    writeFileSync(sourcePath, 'duplicate content', 'utf8');

    const first = await service.importSources([sourcePath]);
    const second = await service.importSources([sourcePath]);

    expect(first.sources[0]?.id).toBe(second.sources[0]?.id);
    expect(second.sources[0]?.reused).toBe(true);
  });

  it('rejects two files in a single import call (single-source policy, #282)', async () => {
    const pathA = join(tempHome, 'a.md');
    const pathB = join(tempHome, 'b.txt');
    writeFileSync(pathA, 'first', 'utf8');
    writeFileSync(pathB, 'second', 'utf8');

    await expect(service.importSources([pathA, pathB])).rejects.toBeInstanceOf(
      InvalidArgumentCountError,
    );
    const all = await repositories.profileSources.list();
    expect(all).toHaveLength(0);
  });

  it('throws SourceUnreadableError when a path is missing (no state change)', async () => {
    const real = join(tempHome, 'real.md');
    writeFileSync(real, 'ok', 'utf8');

    const missing = join(tempHome, 'missing.md');
    await expect(service.importSources([missing])).rejects.toBeInstanceOf(SourceUnreadableError);
    const all = await repositories.profileSources.list();
    expect(all).toHaveLength(0);
  });

  it('records ocr_required for an image-only PDF without invoking AiProvider', async () => {
    const pdfBytes = loadFixture('image-only.pdf');
    const sourcePath = join(tempHome, 'image-only.pdf');
    writeFileSync(sourcePath, pdfBytes);

    const result = await service.importSources([sourcePath]);
    expect(result.status).toBe('failure');
    expect(result.sources[0]?.textExtractionStatus).toBe('failed');
    expect(result.sources[0]?.textExtractionMessage).toBe('ocr_required');
    const stored = await repositories.profileSources.findById(result.sources[0]!.id);
    expect(stored?.textExtractionStatus).toBe('failed');
    expect(stored?.textExtractionMessage).toBe('ocr_required');
  });

  it('records failed for a malformed PDF and keeps the source record', async () => {
    const pdfBytes = loadFixture('malformed.pdf');
    const sourcePath = join(tempHome, 'malformed.pdf');
    writeFileSync(sourcePath, pdfBytes);

    const result = await service.importSources([sourcePath]);
    expect(result.status).toBe('failure');
    const imported = result.sources[0]!;
    expect(imported.textExtractionStatus).toBe('failed');
    const stored = await repositories.profileSources.findById(imported.id);
    expect(stored?.sha256).toBe(imported.sha256);
  });

  it('throws InvalidArgumentCountError for zero or more than one path', async () => {
    await expect(service.importSources([])).rejects.toBeInstanceOf(InvalidArgumentCountError);
    await expect(service.importSources(['a.md', 'b.md', 'c.md'])).rejects.toBeInstanceOf(
      InvalidArgumentCountError,
    );
  });

  it('rejects a second import when one source already exists (#282)', async () => {
    writeFileSync(join(tempHome, 'one.md'), '# One', 'utf8');
    await service.importSources([join(tempHome, 'one.md')]);

    writeFileSync(join(tempHome, 'two.md'), '# Two', 'utf8');
    await expect(service.importSources([join(tempHome, 'two.md')])).rejects.toMatchObject({
      code: 'profile_source_limit_reached',
      message: expect.stringContaining('single source document'),
    });
  });

  it('allows importing exactly one file', async () => {
    writeFileSync(join(tempHome, 'one.md'), '# One', 'utf8');
    const result = await service.importSources([join(tempHome, 'one.md')]);
    expect(result.status).toBe('success');
    expect(result.sources).toHaveLength(1);
    expect(result.sources[0]?.sourceType).toBe('markdown');
  });

  it('records the source row before the copy runs (resilience to copy failure)', async () => {
    const sourcePath = join(tempHome, 'cv.md');
    writeFileSync(sourcePath, 'content', 'utf8');

    // Wire a filesystem whose writeBytes to the .tmp path throws after the
    // row is inserted (we patch the dest writing path so the stored-path
    // update succeeds but the atomic copy fails).
    const { createDefaultBinaryFileSystem } = await import('../../src/profile/file-system.js');
    const fs = createDefaultBinaryFileSystem();
    const originalWrite = fs.writeBytes.bind(fs);
    const wrappedFs = {
      ...fs,
      async writeBytes(path: string, bytes: Uint8Array): Promise<void> {
        if (path.endsWith('.tmp')) {
          throw new Error('simulated disk failure');
        }
        return originalWrite(path, bytes);
      },
    };
    const fsScopedPaths = resolvePlatformPaths(adapter(tempHome));
    const svc = new ProfileImportService({
      paths: fsScopedPaths,
      repositories,
      fileSystem: wrappedFs,
    });

    const result = await svc.importSources([sourcePath]);
    expect(result.sources).toHaveLength(1);
    const imported = result.sources[0]!;
    expect(imported.textExtractionStatus).toBe('failed');
    expect(imported.textExtractionMessage).toBe('profile_source_storage_error');
    const stored = await repositories.profileSources.findById(imported.id);
    expect(stored?.sha256).toBe(imported.sha256);
  });

  it('persists markdown external-image warnings to the source row', async () => {
    const sourcePath = join(tempHome, 'cv.md');
    writeFileSync(
      sourcePath,
      '# Title\n\n![profile photo](https://example.com/photo.png)\n',
      'utf8',
    );

    const result = await service.importSources([sourcePath]);
    expect(result.status).toBe('success');
    const imported = result.sources[0]!;
    expect(imported.warnings).toEqual(['markdown_contains_external_image_references']);
    const stored = await repositories.profileSources.findById(imported.id);
    expect(stored?.warnings).toEqual(['markdown_contains_external_image_references']);
  });

  it('returns the persisted warnings array on a re-import (reuse path)', async () => {
    const sourcePath = join(tempHome, 'cv.md');
    writeFileSync(
      sourcePath,
      '# Title\n\n![profile photo](https://example.com/photo.png)\n',
      'utf8',
    );

    const first = await service.importSources([sourcePath]);
    expect(first.sources[0]?.warnings).toEqual(['markdown_contains_external_image_references']);

    const second = await service.importSources([sourcePath]);
    expect(second.sources[0]?.reused).toBe(true);
    expect(second.sources[0]?.warnings).toEqual(['markdown_contains_external_image_references']);
  });
});
