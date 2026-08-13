import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  createDefaultBinaryFileSystem,
  type BinaryFileSystem,
} from '../../src/profile/file-system.js';
import { ProfileSourceStorageError, SourceUnreadableError } from '../../src/profile/errors.js';
import {
  copySourceFileToStorage,
  defaultFilenameFor,
  resolveSourceStoragePath,
} from '../../src/profile/file-copy.js';
import { resolvePlatformPaths } from '../../src/platform/paths.js';
import type { PlatformAdapter } from '../../src/platform/platform.js';

function adapter(home: string): PlatformAdapter {
  return { platform: 'linux', home, environment: {} };
}

describe('resolveSourceStoragePath', () => {
  it('joins the profileSources directory with the sourceId and filename', () => {
    const paths = resolvePlatformPaths(adapter('/home/tester'));
    const result = resolveSourceStoragePath(paths, 7, 'cv.pdf');
    expect(result).toBe(join(paths.profileSources.directory, '7', 'cv.pdf'));
  });

  it('rejects zero or negative source ids', () => {
    const paths = resolvePlatformPaths(adapter('/home/tester'));
    expect(() => resolveSourceStoragePath(paths, 0, 'cv.pdf')).toThrow(ProfileSourceStorageError);
    expect(() => resolveSourceStoragePath(paths, -1, 'cv.pdf')).toThrow(ProfileSourceStorageError);
  });

  it('rejects empty filenames', () => {
    const paths = resolvePlatformPaths(adapter('/home/tester'));
    expect(() => resolveSourceStoragePath(paths, 1, '')).toThrow(ProfileSourceStorageError);
    expect(() => resolveSourceStoragePath(paths, 1, '   ')).toThrow(ProfileSourceStorageError);
  });
});

describe('defaultFilenameFor', () => {
  it('returns the basename of the original path', () => {
    expect(defaultFilenameFor('pdf', '/tmp/cv.pdf')).toBe('cv.pdf');
    expect(defaultFilenameFor('markdown', '/Users/x/Documents/profile.md')).toBe('profile.md');
  });

  it('returns a sensible default when the basename is empty', () => {
    expect(defaultFilenameFor('pdf', '/')).toBe('cv.pdf');
    expect(defaultFilenameFor('markdown', '')).toBe('cv.md');
    expect(defaultFilenameFor('plain_text', '   ')).toBe('cv.txt');
  });
});

describe('copySourceFileToStorage', () => {
  let tempHome: string;
  let paths: ReturnType<typeof resolvePlatformPaths>;
  let fileSystem: BinaryFileSystem;

  beforeEach(() => {
    tempHome = mkdtempSync(join(tmpdir(), 'jobhunter-file-copy-'));
    paths = resolvePlatformPaths(adapter(tempHome));
    fileSystem = createDefaultBinaryFileSystem();
    mkdirSync(paths.profileSources.directory, { recursive: true });
  });

  afterEach(() => {
    rmSync(tempHome, { recursive: true, force: true });
  });

  it('copies the source file to the destination and creates parent directories', async () => {
    const sourcePath = join(tempHome, 'source-cv.pdf');
    const payload = Buffer.from('PDF-CONTENTS', 'utf8');
    writeFileSync(sourcePath, payload);

    const destination = resolveSourceStoragePath(paths, 42, 'cv.pdf');
    await copySourceFileToStorage({ sourcePath, destination, fileSystem });

    const copied = await fileSystem.readBytes(destination);
    expect(Buffer.from(copied).toString('utf8')).toBe('PDF-CONTENTS');
  });

  it('throws SourceUnreadableError when the source does not exist', async () => {
    const destination = resolveSourceStoragePath(paths, 1, 'cv.pdf');
    await expect(
      copySourceFileToStorage({
        sourcePath: join(tempHome, 'missing.pdf'),
        destination,
        fileSystem,
      }),
    ).rejects.toBeInstanceOf(SourceUnreadableError);
  });

  it('does not leave a partial file when the copy fails', async () => {
    const sourcePath = join(tempHome, 'source-cv.pdf');
    writeFileSync(sourcePath, Buffer.from('payload', 'utf8'));

    const failingFs: BinaryFileSystem = {
      ...fileSystem,
      async writeBytes(path, bytes) {
        if (path.endsWith('.tmp')) {
          // Write a partial copy and then throw to simulate a mid-write failure.
          await fileSystem.writeBytes(path, bytes.subarray(0, 2));
          throw new Error('simulated disk full');
        }
        await fileSystem.writeBytes(path, bytes);
      },
    };
    const destination = resolveSourceStoragePath(paths, 5, 'cv.pdf');
    await expect(
      copySourceFileToStorage({ sourcePath, destination, fileSystem: failingFs }),
    ).rejects.toBeInstanceOf(ProfileSourceStorageError);

    const tempPath = `${destination}.tmp`;
    expect(await failingFs.pathExists(tempPath)).toBe(false);
  });
});
