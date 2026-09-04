import { chmodSync } from 'node:fs';

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
  // Lock down file permissions so PII (LinkedIn JDs, profile drafts, OpenAI
  // audit metadata, scoring summaries) is not world-readable on multi-user
  // hosts (shared laptops, shared CI runners, NFS mounts). better-sqlite3
  // creates the file with mode 0o644 by default; chmod after open so the
  // file is guaranteed to exist. Failure is logged but non-fatal: the open
  // already succeeded, and a degraded protection mode is preferable to
  // crashing the caller.
  try {
    chmodSync(filePath, 0o600);
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    process.stderr.write(
      `persistence: failed to chmod 0o600 on ${filePath}: ${message}\n`,
    );
  }
  const db = drizzle(sqlite, { schema });
  return {
    db,
    sqlite,
    close(): void {
      sqlite.close();
    },
  };
}
