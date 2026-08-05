import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';

import type { Schema } from '../schema.js';

export type DrizzleDB = BetterSQLite3Database<Schema>;

export interface RepositoryContext {
  readonly db: DrizzleDB;
}
