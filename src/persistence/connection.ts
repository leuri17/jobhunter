import Database from 'better-sqlite3';
import type { Database as BetterSqliteDatabase } from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';

import { DatabaseError } from './errors.js';
import { schema, type Schema } from './schema.js';

export interface DatabaseConnection {
  readonly db: BetterSQLite3Database<Schema>;
  readonly sqlite: BetterSqliteDatabase;
  close(): void;
}

export function createDatabaseConnection(filePath: string): DatabaseConnection {
  let sqlite: BetterSqliteDatabase;
  try {
    sqlite = new Database(filePath);
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    throw new DatabaseError(
      'database_open_failed',
      `Failed to open SQLite database at ${filePath}: ${message}`,
      { filePath },
      cause instanceof Error ? cause : undefined,
    );
  }
  sqlite.pragma('foreign_keys = ON');
  const db = drizzle(sqlite, { schema });
  return {
    db,
    sqlite,
    close(): void {
      sqlite.close();
    },
  };
}
