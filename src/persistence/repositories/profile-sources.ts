import { eq } from 'drizzle-orm';
import { z } from 'zod';

import { profileSources } from '../schema.js';
import { DuplicateSha256Error } from '../repository-errors.js';
import type { RepositoryContext } from './types.js';

const SourceTypeSchema = z.enum(['pdf', 'markdown', 'plain_text']);
const TextExtractionStatusSchema = z.enum(['pending', 'success', 'failed']);
const WarningsSchema = z.array(z.string());

export interface ProfileSourceRow {
  readonly id: number;
  readonly sourceType: 'pdf' | 'markdown' | 'plain_text';
  readonly originalFilename: string;
  readonly originalAbsolutePath: string;
  readonly storedPath: string;
  readonly mimeType: string;
  readonly fileSize: number;
  readonly sha256: string;
  readonly importTimestamp: string;
  readonly extractedTextHash: string | null;
  readonly textExtractionStatus: 'pending' | 'success' | 'failed';
  readonly textExtractionMessage: string | null;
  readonly warnings: readonly string[];
}

export interface ProfileSourceInsert {
  readonly sourceType: 'pdf' | 'markdown' | 'plain_text';
  readonly originalFilename: string;
  readonly originalAbsolutePath: string;
  readonly storedPath?: string;
  readonly mimeType: string;
  readonly fileSize: number;
  readonly sha256: string;
  readonly importTimestamp: string;
  readonly textExtractionStatus?: 'pending' | 'success' | 'failed';
  readonly textExtractionMessage?: string | null;
  readonly warnings?: readonly string[];
}

function parseWarnings(raw: string): readonly string[] {
  const parsed = JSON.parse(raw) as unknown;
  return WarningsSchema.parse(parsed);
}

export interface UpdateExtractionPatch {
  readonly extractedTextHash: string;
  readonly status: 'success' | 'failed';
  readonly message?: string | null;
  readonly warnings?: readonly string[];
}

function rowFromRecord(record: typeof profileSources.$inferSelect): ProfileSourceRow {
  return {
    id: record.id,
    sourceType: SourceTypeSchema.parse(record.sourceType),
    originalFilename: record.originalFilename,
    originalAbsolutePath: record.originalAbsolutePath,
    storedPath: record.storedPath,
    mimeType: record.mimeType,
    fileSize: record.fileSize,
    sha256: record.sha256,
    importTimestamp: record.importTimestamp,
    extractedTextHash: record.extractedTextHash,
    textExtractionStatus: TextExtractionStatusSchema.parse(record.textExtractionStatus),
    textExtractionMessage: record.textExtractionMessage,
    warnings: parseWarnings(record.warnings),
  };
}

export class ProfileSourceRepository {
  constructor(private readonly ctx: RepositoryContext) {}

  async insert(input: ProfileSourceInsert): Promise<number> {
    // The repository is now strict INSERT-OR-ERROR. SHA-256 deduplication is
    // owned by `ProfileImportService` (which calls `findBySha256` before
    // `insert`). Bypassing the service and inserting a duplicate raises
    // `DuplicateSha256Error` so the bug surfaces immediately.
    const warnings = input.warnings ?? [];
    const values: typeof profileSources.$inferInsert = {
      sourceType: input.sourceType,
      originalFilename: input.originalFilename,
      originalAbsolutePath: input.originalAbsolutePath,
      storedPath: input.storedPath ?? '',
      mimeType: input.mimeType,
      fileSize: input.fileSize,
      sha256: input.sha256,
      importTimestamp: input.importTimestamp,
      textExtractionStatus: input.textExtractionStatus ?? 'pending',
      textExtractionMessage: input.textExtractionMessage ?? null,
      warnings: JSON.stringify(warnings),
    };
    let row: { id: number } | undefined;
    try {
      const result = this.ctx.db
        .insert(profileSources)
        .values(values)
        .returning({ id: profileSources.id })
        .all();
      row = result[0];
    } catch (cause) {
      if (cause instanceof Error && cause.message.includes('UNIQUE constraint failed')) {
        throw new DuplicateSha256Error(input.sha256, cause);
      }
      throw cause;
    }
    if (row === undefined) {
      throw new Error('ProfileSourceRepository.insert: insert returned no rows');
    }
    return row.id;
  }

  async findById(id: number): Promise<ProfileSourceRow | null> {
    const rows = this.ctx.db.select().from(profileSources).where(eq(profileSources.id, id)).all();
    const row = rows[0];
    return row === undefined ? null : rowFromRecord(row);
  }

  async findBySha256(sha256: string): Promise<ProfileSourceRow | null> {
    const rows = this.ctx.db
      .select()
      .from(profileSources)
      .where(eq(profileSources.sha256, sha256))
      .all();
    const row = rows[0];
    return row === undefined ? null : rowFromRecord(row);
  }

  async updateExtraction(id: number, patch: UpdateExtractionPatch): Promise<void> {
    const set: Partial<typeof profileSources.$inferInsert> = {
      extractedTextHash: patch.extractedTextHash,
      textExtractionStatus: patch.status,
      textExtractionMessage: patch.message ?? null,
    };
    if (patch.warnings !== undefined) {
      set.warnings = JSON.stringify(patch.warnings);
    }
    this.ctx.db.update(profileSources).set(set).where(eq(profileSources.id, id)).run();
  }

  async updateStoredPath(id: number, storedPath: string): Promise<void> {
    this.ctx.db.update(profileSources).set({ storedPath }).where(eq(profileSources.id, id)).run();
  }

  async list(): Promise<readonly ProfileSourceRow[]> {
    return this.ctx.db.select().from(profileSources).all().map(rowFromRecord);
  }
}
