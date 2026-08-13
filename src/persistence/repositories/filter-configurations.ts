import { eq } from 'drizzle-orm';
import { z } from 'zod';

import { filterConfigurationVersions } from '../schema.js';
import { jsonColumn } from './codecs.js';
import type { RepositoryContext } from './types.js';

const unknownJson = jsonColumn<unknown>(z.unknown());

export interface FilterConfigurationRow {
  readonly id: number;
  readonly schemaVersion: number;
  readonly contentHash: string;
  readonly configJson: unknown;
  readonly createdAt: string;
  readonly active: boolean;
}

export interface FilterConfigurationInsert {
  readonly schemaVersion: number;
  readonly contentHash: string;
  readonly configJson: unknown;
  readonly createdAt: string;
  readonly active?: boolean;
}

function rowFromRecord(
  record: typeof filterConfigurationVersions.$inferSelect,
): FilterConfigurationRow {
  return {
    id: record.id,
    schemaVersion: record.schemaVersion,
    contentHash: record.contentHash,
    configJson: unknownJson.decodeRequired(record.configJson),
    createdAt: record.createdAt,
    active: record.active,
  };
}

export class FilterConfigurationRepository {
  constructor(private readonly ctx: RepositoryContext) {}

  async insert(input: FilterConfigurationInsert): Promise<number> {
    const result = this.ctx.db
      .insert(filterConfigurationVersions)
      .values({
        schemaVersion: input.schemaVersion,
        contentHash: input.contentHash,
        configJson: unknownJson.encode(input.configJson),
        createdAt: input.createdAt,
        active: input.active ?? false,
      })
      .returning({ id: filterConfigurationVersions.id })
      .all();
    const row = result[0];
    if (row === undefined) throw new Error('insert returned no rows');
    return row.id;
  }

  async findById(id: number): Promise<FilterConfigurationRow | null> {
    const rows = this.ctx.db
      .select()
      .from(filterConfigurationVersions)
      .where(eq(filterConfigurationVersions.id, id))
      .all();
    const row = rows[0];
    return row === undefined ? null : rowFromRecord(row);
  }

  async findActive(): Promise<FilterConfigurationRow | null> {
    const rows = this.ctx.db
      .select()
      .from(filterConfigurationVersions)
      .where(eq(filterConfigurationVersions.active, true))
      .all();
    const row = rows[0];
    return row === undefined ? null : rowFromRecord(row);
  }

  async findByContentHash(hash: string): Promise<FilterConfigurationRow | null> {
    const rows = this.ctx.db
      .select()
      .from(filterConfigurationVersions)
      .where(eq(filterConfigurationVersions.contentHash, hash))
      .all();
    const row = rows[0];
    return row === undefined ? null : rowFromRecord(row);
  }

  async list(): Promise<readonly FilterConfigurationRow[]> {
    return this.ctx.db.select().from(filterConfigurationVersions).all().map(rowFromRecord);
  }

  async activate(id: number): Promise<void> {
    this.ctx.db.transaction((tx) => {
      tx.update(filterConfigurationVersions)
        .set({ active: false })
        .where(eq(filterConfigurationVersions.active, true))
        .run();
      tx.update(filterConfigurationVersions)
        .set({ active: true })
        .where(eq(filterConfigurationVersions.id, id))
        .run();
    });
  }
}
