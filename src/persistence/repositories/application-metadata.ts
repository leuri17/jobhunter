import { eq } from 'drizzle-orm';

import { applicationMetadata } from '../schema.js';
import type { RepositoryContext } from './types.js';

export interface ApplicationMetadataRow {
  readonly key: string;
  readonly value: string;
  readonly updatedAt: string;
}

function rowFromRecord(record: typeof applicationMetadata.$inferSelect): ApplicationMetadataRow {
  return {
    key: record.key,
    value: record.value,
    updatedAt: record.updatedAt,
  };
}

export class ApplicationMetadataRepository {
  constructor(private readonly ctx: RepositoryContext) {}

  async get(key: string): Promise<ApplicationMetadataRow | null> {
    const rows = this.ctx.db.select().from(applicationMetadata).where(eq(applicationMetadata.key, key)).all();
    const row = rows[0];
    return row === undefined ? null : rowFromRecord(row);
  }

  async set(key: string, value: string, updatedAt: string): Promise<void> {
    this.ctx.db.transaction((tx) => {
      const existing = tx.select().from(applicationMetadata).where(eq(applicationMetadata.key, key)).all();
      if (existing.length > 0) {
        tx.update(applicationMetadata).set({ value, updatedAt }).where(eq(applicationMetadata.key, key)).run();
        return;
      }
      tx.insert(applicationMetadata).values({ key, value, updatedAt }).run();
    });
  }

  async list(): Promise<readonly ApplicationMetadataRow[]> {
    return this.ctx.db.select().from(applicationMetadata).all().map(rowFromRecord);
  }

  async delete(key: string): Promise<void> {
    this.ctx.db.delete(applicationMetadata).where(eq(applicationMetadata.key, key)).run();
  }
}