import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import path from 'node:path';

import type { PlatformPaths } from '../platform/paths.js';
import type { Repositories } from '../persistence/repositories/index.js';

import {
  copySourceFileToStorage,
  defaultFilenameFor,
  resolveSourceStoragePath,
} from './file-copy.js';
import { createDefaultBinaryFileSystem, type BinaryFileSystem } from './file-system.js';
import { resolveExtractor } from './extractors/index.js';
import { InvalidArgumentCountError, SourceUnreadableError } from './errors.js';
import { hashFileContents, hashString } from './hashing.js';
import { normalizeExtractedText } from './text-normalize.js';
import { detectSourceTypeFromPath, mimeTypeFor } from './source-types.js';

/**
 * One imported source as returned by `ProfileImportService.importSources`.
 *
 * `path` is the OS-native absolute path produced by `path.resolve(rawPath)`:
 * forward slashes on POSIX, backslashes on Windows. The summary
 * renders only the basename by splitting on both separators, but `path`
 * itself is preserved verbatim. Downstream extraction operates on the
 * stored copy (`storedPath`) rather than this original path.
 */
export interface ImportedSource {
  readonly id: number;
  readonly path: string;
  readonly sourceType: 'pdf' | 'markdown' | 'plain_text';
  readonly sha256: string;
  readonly fileSize: number;
  readonly storedPath: string;
  readonly textExtractionStatus: 'pending' | 'success' | 'failed';
  readonly textExtractionMessage: string | null;
  readonly extractedTextHash: string | null;
  readonly reused: boolean;
  readonly warnings: readonly string[];
}

/**
 * Counts of sources processed by a single `profile import` invocation.
 *
 * `reused` counts sources whose SHA-256 already existed in the database. A
 * reused source is also counted in `extracted` or `failed` when its stored
 * `textExtractionStatus` is `success` or `failed` respectively. The `total`
 * field is the sum of all sources processed (including reused ones).
 *
 * Example: importing two files where one is a fresh PDF and the other is
 * a duplicate of an existing markdown receipt may produce
 * `{ total: 2, extracted: 1, failed: 0, reused: 1 }` — the reused source
 * still contributes to `extracted` because its stored status is `success`.
 */
export interface ProfileImportCounts {
  readonly total: number;
  readonly extracted: number;
  readonly failed: number;
  readonly reused: number;
}

export type ProfileImportStatus = 'success' | 'partial' | 'failure';

export interface ProfileImportResult {
  readonly status: ProfileImportStatus;
  readonly counts: ProfileImportCounts;
  readonly sources: readonly ImportedSource[];
  readonly failedSourcePaths: readonly string[];
}

export interface ProfileImportLogger {
  info(context: Record<string, unknown>, message: string): void;
  warn(context: Record<string, unknown>, message: string): void;
  error(context: Record<string, unknown>, message: string): void;
}

export interface ProfileImportServiceOptions {
  readonly paths: PlatformPaths;
  readonly repositories: Repositories;
  readonly fileSystem?: BinaryFileSystem;
  readonly now?: () => Date;
  readonly logger?: ProfileImportLogger;
}

export const noopLogger: ProfileImportLogger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

export class ProfileImportService {
  private readonly paths: PlatformPaths;
  private readonly repositories: Repositories;
  private readonly fileSystem: BinaryFileSystem;
  private readonly now: () => Date;
  private readonly logger: ProfileImportLogger;

  constructor(options: ProfileImportServiceOptions) {
    this.paths = options.paths;
    this.repositories = options.repositories;
    this.fileSystem = options.fileSystem ?? createDefaultBinaryFileSystem();
    this.now = options.now ?? ((): Date => new Date());
    this.logger = options.logger ?? noopLogger;
  }

  async importSources(rawPaths: readonly string[]): Promise<ProfileImportResult> {
    if (rawPaths.length === 0 || rawPaths.length > 2) {
      throw new InvalidArgumentCountError(
        'profile import requires exactly one or two file paths.',
        { receivedCount: rawPaths.length },
      );
    }

    const sources: ImportedSource[] = [];
    const failedPaths: string[] = [];

    for (const rawPath of rawPaths) {
      const result = await this.importOne(rawPath);
      sources.push(result);
      if (result.textExtractionStatus === 'failed') {
        failedPaths.push(result.path);
      }
    }

    let status: ProfileImportStatus;
    if (sources.length === 0) {
      status = 'failure';
    } else if (failedPaths.length === 0) {
      status = 'success';
    } else if (sources.length > failedPaths.length) {
      status = 'partial';
    } else {
      status = 'failure';
    }

    const counts: ProfileImportCounts = {
      total: sources.length,
      extracted: sources.filter((s) => s.textExtractionStatus === 'success').length,
      failed: sources.filter((s) => s.textExtractionStatus === 'failed').length,
      reused: sources.filter((s) => s.reused).length,
    };

    return { status, counts, sources, failedSourcePaths: failedPaths };
  }

  private async importOne(rawPath: string): Promise<ImportedSource> {
    const absolutePath = path.resolve(rawPath);
    const sourceType = detectSourceTypeFromPath(absolutePath);

    const exists = await this.fileSystem.pathExists(absolutePath);
    if (!exists) {
      throw new SourceUnreadableError(`Source file does not exist: ${absolutePath}`, {
        path: absolutePath,
      });
    }

    const stats = await stat(absolutePath);
    const fileSize = stats.size;

    const stream = createReadStream(absolutePath);
    const sha256 = await hashFileContents(stream);

    const existing = await this.repositories.profileSources.findBySha256(sha256);
    if (existing !== null) {
      this.logger.info(
        { event: 'profile_source_reused', sourceId: existing.id, sha256 },
        `Reusing existing profile source ${existing.id} for ${absolutePath}`,
      );
      return {
        id: existing.id,
        path: absolutePath,
        sourceType: existing.sourceType,
        sha256: existing.sha256,
        fileSize: existing.fileSize,
        storedPath: existing.storedPath,
        textExtractionStatus: existing.textExtractionStatus,
        textExtractionMessage: existing.textExtractionMessage,
        extractedTextHash: existing.extractedTextHash,
        reused: true,
        warnings: existing.warnings,
      };
    }

    const importTimestamp = this.now().toISOString();
    const originalFilename = defaultFilenameFor(sourceType, absolutePath);

    const insertedId = await this.repositories.profileSources.insert({
      sourceType,
      originalFilename,
      originalAbsolutePath: absolutePath,
      mimeType: mimeTypeFor(sourceType),
      fileSize,
      sha256,
      importTimestamp,
      textExtractionStatus: 'pending',
    });

    const storedPath = resolveSourceStoragePath(this.paths, insertedId, originalFilename);
    await this.repositories.profileSources.updateStoredPath(insertedId, storedPath);

    try {
      await copySourceFileToStorage({
        sourcePath: absolutePath,
        destination: storedPath,
        fileSystem: this.fileSystem,
      });
    } catch (cause) {
      this.logger.error(
        { event: 'profile_source_copy_failed', sourceId: insertedId, path: absolutePath },
        `Failed to copy source file to storage: ${cause instanceof Error ? cause.message : String(cause)}`,
      );
      await this.repositories.profileSources.updateExtraction(insertedId, {
        extractedTextHash: '',
        status: 'failed',
        message: 'profile_source_storage_error',
      });
      return {
        id: insertedId,
        path: absolutePath,
        sourceType,
        sha256,
        fileSize,
        storedPath,
        textExtractionStatus: 'failed',
        textExtractionMessage: 'profile_source_storage_error',
        extractedTextHash: null,
        reused: false,
        warnings: [],
      };
    }

    const storedBytes = await this.fileSystem.readBytes(storedPath);
    const extractor = resolveExtractor(sourceType);
    const extraction = await extractor.extract(storedBytes);

    if (extraction.status === 'success') {
      const normalized = normalizeExtractedText(extraction.text);
      const textHash = hashString(normalized);
      await this.repositories.profileSources.updateExtraction(insertedId, {
        extractedTextHash: textHash,
        status: 'success',
        message: null,
        warnings: extraction.warnings,
      });
      this.logger.info(
        { event: 'profile_source_extracted', sourceId: insertedId, path: absolutePath },
        `Extracted text from ${absolutePath}`,
      );
      return {
        id: insertedId,
        path: absolutePath,
        sourceType,
        sha256,
        fileSize,
        storedPath,
        textExtractionStatus: 'success',
        textExtractionMessage: null,
        extractedTextHash: textHash,
        reused: false,
        warnings: extraction.warnings,
      };
    }

    if (extraction.status === 'ocr_required') {
      await this.repositories.profileSources.updateExtraction(insertedId, {
        extractedTextHash: '',
        status: 'failed',
        message: 'ocr_required',
      });
      this.logger.warn(
        { event: 'profile_source_ocr_required', sourceId: insertedId, path: absolutePath },
        extraction.message,
      );
      return {
        id: insertedId,
        path: absolutePath,
        sourceType,
        sha256,
        fileSize,
        storedPath,
        textExtractionStatus: 'failed',
        textExtractionMessage: 'ocr_required',
        extractedTextHash: null,
        reused: false,
        warnings: [],
      };
    }

    // extraction.status === 'failed'
    await this.repositories.profileSources.updateExtraction(insertedId, {
      extractedTextHash: '',
      status: 'failed',
      message: extraction.message,
    });
    this.logger.error(
      {
        event: 'profile_source_extraction_failed',
        sourceId: insertedId,
        path: absolutePath,
        message: extraction.message,
      },
      `Failed to extract text from ${absolutePath}: ${extraction.message}`,
    );
    return {
      id: insertedId,
      path: absolutePath,
      sourceType,
      sha256,
      fileSize,
      storedPath,
      textExtractionStatus: 'failed',
      textExtractionMessage: extraction.message,
      extractedTextHash: null,
      reused: false,
      warnings: [],
    };
  }
}
