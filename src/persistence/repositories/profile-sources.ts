import { eq } from 'drizzle-orm';

import { profileSources } from '../schema.js';
import type { RepositoryContext } from './types.js';

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
}

function rowFromRecord(record: typeof profileSources.$inferSelect): ProfileSourceRow {
  return {
    id: record.id,
    sourceType: record.sourceType,
    originalFilename: record.originalFilename,
    originalAbsolutePath: record.originalAbsolutePath,
    storedPath: record.storedPath,
    mimeType: record.mimeType,
    fileSize: record.fileSize,
    sha256: record.sha256,
    importTimestamp: record.importTimestamp,
    extractedTextHash: record.extractedTextHash,
    textExtractionStatus: record.textExtractionStatus,
    textExtractionMessage: record.textExtractionMessage,
  };
}

export class ProfileSourceRepository {
  constructor(private readonly ctx: RepositoryContext) {}

  async insert(input: ProfileSourceInsert): Promise<number> {
    const existing = await this.findBySha256(input.sha256);
    if (existing !== null) return existing.id;
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
    };
    const result = this.ctx.db
      .insert(profileSources)
      .values(values)
      .returning({ id: profileSources.id })
      .all();
    const row = result[0];
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

  async updateExtraction(
    id: number,
    patch: { extractedTextHash: string; status: 'success' | 'failed'; message?: string | null },
  ): Promise<void> {
    this.ctx.db
      .update(profileSources)
      .set({
        extractedTextHash: patch.extractedTextHash,
        textExtractionStatus: patch.status,
        textExtractionMessage: patch.message ?? null,
      })
      .where(eq(profileSources.id, id))
      .run();
  }

  async updateStoredPath(id: number, storedPath: string): Promise<void> {
    this.ctx.db.update(profileSources).set({ storedPath }).where(eq(profileSources.id, id)).run();
  }

  async list(): Promise<readonly ProfileSourceRow[]> {
    return this.ctx.db.select().from(profileSources).all().map(rowFromRecord);
  }
}
