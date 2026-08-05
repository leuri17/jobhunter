import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { Database as BetterSqliteDatabase } from 'better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';

import type { DatabaseConnection } from './connection.js';
import { MigrationError } from './errors.js';

export interface RunMigrationsOptions {
  readonly migrationsFolder: string;
}

export interface MigrationReport {
  readonly appliedMigrations: readonly string[];
  readonly databasePath: string;
}

const MIGRATIONS_TABLE = '__drizzle_migrations';

interface JournalEntry {
  readonly idx: number;
  readonly version: string;
  readonly when: number;
  readonly tag: string;
  readonly breakpoints: boolean;
}

interface Journal {
  readonly version: string;
  readonly dialect: string;
  readonly entries: readonly JournalEntry[];
}

function readJournal(folder: string): Journal {
  const journalPath = join(folder, 'meta', '_journal.json');
  if (!existsSync(journalPath)) {
    throw new Error(`Can't find meta/_journal.json file in ${folder}`);
  }
  return JSON.parse(readFileSync(journalPath, 'utf8')) as Journal;
}

function readAppliedHashes(sqlite: BetterSqliteDatabase): Set<string> {
  const exists = sqlite
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(MIGRATIONS_TABLE);
  if (!exists) {
    return new Set();
  }
  const rows = sqlite.prepare(`SELECT hash FROM ${MIGRATIONS_TABLE}`).all() as Array<{
    hash: string;
  }>;
  return new Set(rows.map((row) => row.hash));
}

function hashMigrationFile(folder: string, tag: string): string {
  const filePath = join(folder, `${tag}.sql`);
  const content = readFileSync(filePath, 'utf8');
  return createHash('sha256').update(content).digest('hex');
}

function computeAppliedTags(
  sqlite: BetterSqliteDatabase,
  journal: Journal,
  folder: string,
  before: ReadonlySet<string>,
): readonly string[] {
  const after = readAppliedHashes(sqlite);
  const applied: string[] = [];
  for (const entry of journal.entries) {
    let hash: string;
    try {
      hash = hashMigrationFile(folder, entry.tag);
    } catch {
      continue;
    }
    if (!before.has(hash) && after.has(hash)) {
      applied.push(entry.tag);
    }
  }
  return applied;
}

export function runMigrations(
  connection: DatabaseConnection,
  options: RunMigrationsOptions,
): MigrationReport {
  let journal: Journal;
  try {
    journal = readJournal(options.migrationsFolder);
  } catch (cause) {
    throw wrapFailure(options.migrationsFolder, cause);
  }

  const before = readAppliedHashes(connection.sqlite);

  try {
    migrate(connection.db, {
      migrationsFolder: options.migrationsFolder,
    });
  } catch (cause) {
    throw wrapFailure(options.migrationsFolder, cause);
  }

  const appliedMigrations = computeAppliedTags(
    connection.sqlite,
    journal,
    options.migrationsFolder,
    before,
  );

  return {
    appliedMigrations,
    databasePath: connection.sqlite.name,
  };
}

function wrapFailure(migrationsFolder: string, cause: unknown): MigrationError {
  const message = cause instanceof Error ? cause.message : String(cause);
  return new MigrationError(
    'migration_apply_failed',
    `Failed to apply migrations from ${migrationsFolder}: ${message}`,
    { migrationsFolder },
    cause instanceof Error ? cause : undefined,
  );
}
