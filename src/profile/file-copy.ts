import path from 'node:path';

import type { PlatformPaths } from '../platform/paths.js';
import type { SourceType } from './source-types.js';

import { SourceUnreadableError, ProfileSourceStorageError } from './errors.js';
import type { BinaryFileSystem } from './file-system.js';

export function resolveSourceStoragePath(
  paths: PlatformPaths,
  sourceId: number,
  originalFilename: string,
): string {
  if (!Number.isInteger(sourceId) || sourceId <= 0) {
    throw new ProfileSourceStorageError(
      `Cannot resolve storage path for non-positive sourceId ${sourceId}.`,
      { sourceId },
    );
  }
  if (typeof originalFilename !== 'string' || originalFilename.trim() === '') {
    throw new ProfileSourceStorageError(
      'Cannot resolve storage path without an original filename.',
      { sourceId },
    );
  }
  return path.join(paths.profileSources.directory, String(sourceId), originalFilename);
}

export function defaultFilenameFor(sourceType: SourceType, originalPath: string): string {
  const base = path.basename(originalPath).trim();
  if (base !== '') return base;
  switch (sourceType) {
    case 'pdf':
      return 'cv.pdf';
    case 'markdown':
      return 'cv.md';
    case 'plain_text':
      return 'cv.txt';
  }
}

export interface CopySourceFileOptions {
  sourcePath: string;
  destination: string;
  fileSystem: BinaryFileSystem;
}

/**
 * Copy a source file to its immutable storage path atomically.
 *
 * The copy writes to a sibling `.tmp` file first, then renames it into place.
 * If the rename fails, the partial file is removed. The destination directory
 * is created on demand.
 */
export async function copySourceFileToStorage(options: CopySourceFileOptions): Promise<void> {
  const { sourcePath, destination, fileSystem } = options;
  const exists = await fileSystem.pathExists(sourcePath);
  if (!exists) {
    throw new SourceUnreadableError(`Source file does not exist: ${sourcePath}`, {
      path: sourcePath,
    });
  }

  const destinationDir = path.dirname(destination);
  await fileSystem.mkdir(destinationDir, { recursive: true });

  const tempPath = `${destination}.tmp`;
  try {
    const bytes = await fileSystem.readBytes(sourcePath);
    await fileSystem.writeBytes(tempPath, bytes);
    await fileSystem.rename(tempPath, destination);
  } catch (cause) {
    // Best-effort cleanup of the temp file before rethrowing.
    try {
      await fileSystem.removeFile(tempPath);
    } catch {
      // ignore: the temp file may not exist
    }
    if (cause instanceof Error && cause.message.includes('ENOENT')) {
      throw new SourceUnreadableError(
        `Source file became unreadable before copy: ${sourcePath}`,
        { path: sourcePath },
        cause,
      );
    }
    throw new ProfileSourceStorageError(
      `Failed to copy source file to ${destination}: ${cause instanceof Error ? cause.message : String(cause)}`,
      { sourcePath, destination },
      cause instanceof Error ? cause : undefined,
    );
  }
}
