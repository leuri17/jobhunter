import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  createDatabaseConnection,
  type DatabaseConnection,
} from '../../src/persistence/connection.js';
import { runMigrations } from '../../src/persistence/migrations.js';

const REPO_ROOT = resolve(import.meta.dirname, '..', '..');

describe('runMigrations', () => {
  let directory: string;
  let filePath: string;
  let connection: DatabaseConnection;

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'jobhunter-migrations-'));
    filePath = join(directory, 'jobhunter.sqlite');
    connection = createDatabaseConnection(filePath);
  });

  afterEach(() => {
    try {
      connection.close();
    } catch {
      // Connection may already be closed by the test (failure path).
    }
    rmSync(directory, { recursive: true, force: true });
  });

  it('applies the committed initial migration to a fresh database', () => {
    const report = runMigrations(connection, { migrationsFolder: join(REPO_ROOT, 'drizzle') });
    expect(report.databasePath).toBe(filePath);
    expect(report.appliedMigrations.length).toBeGreaterThan(0);
    const tables = connection.sqlite
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
      )
      .all() as Array<{ name: string }>;
    expect(tables.map((t) => t.name)).toEqual(
      expect.arrayContaining([
        'application_metadata',
        'profile_sources',
        'profile_versions',
        'jobs',
        'pipeline_runs',
        'search_executions',
        'filter_results',
        'score_results',
        'openai_request_metadata',
        'diagnostic_artifacts',
      ]),
    );
  });

  it('is idempotent when run a second time', () => {
    runMigrations(connection, { migrationsFolder: join(REPO_ROOT, 'drizzle') });
    const report = runMigrations(connection, { migrationsFolder: join(REPO_ROOT, 'drizzle') });
    expect(report.appliedMigrations).toEqual([]);
  });

  it('throws MigrationError when the migrations folder is missing', () => {
    let caught: unknown;
    try {
      runMigrations(connection, { migrationsFolder: join(directory, 'no-such-folder') });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(Error);
    expect((caught as { code: string }).code).toBe('migration_apply_failed');
    expect((caught as { exitCode: number }).exitCode).toBe(1);
  });

  it('throws MigrationError when a migration file is malformed', () => {
    const badFolder = join(directory, 'bad');
    mkdirSync(badFolder, { recursive: true });
    mkdirSync(join(badFolder, 'meta'), { recursive: true });
    writeFileSync(join(badFolder, '0000_bogus.sql'), 'NOT VALID SQL HERE;');
    writeFileSync(
      join(badFolder, 'meta', '_journal.json'),
      JSON.stringify({
        version: '7',
        dialect: 'sqlite',
        entries: [{ idx: 0, version: '7', when: 0, tag: '0000_bogus', breakpoints: true }],
      }),
    );
    let caught: unknown;
    try {
      runMigrations(connection, { migrationsFolder: badFolder });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(Error);
    expect((caught as { code: string }).code).toBe('migration_apply_failed');
    expect((caught as { exitCode: number }).exitCode).toBe(1);
  });

  it('throws when the journal references a missing migration file (no silent skip)', () => {
    // The journal declares 0000_present + 0000_missing but only
    // 0000_present.sql exists on disk. Pre-fix the loop silently
    // skipped the missing entry, returning a short `appliedMigrations`
    // list as if all migrations had applied. Now the failure is
    // surfaced as a typed MigrationError — either by drizzle's migrate
    // (when the file is missing before the run) or by computeAppliedTags
    // (when the file disappears after the run). The user-facing
    // contract is: the error is not silent.
    const missingFolder = join(directory, 'missing-file');
    mkdirSync(missingFolder, { recursive: true });
    mkdirSync(join(missingFolder, 'meta'), { recursive: true });
    writeFileSync(join(missingFolder, '0000_present.sql'), 'SELECT 1;');
    writeFileSync(
      join(missingFolder, 'meta', '_journal.json'),
      JSON.stringify({
        version: '7',
        dialect: 'sqlite',
        entries: [
          { idx: 0, version: '7', when: 0, tag: '0000_present', breakpoints: true },
          { idx: 1, version: '7', when: 1, tag: '0000_missing', breakpoints: true },
        ],
      }),
    );
    let caught: unknown;
    try {
      runMigrations(connection, { migrationsFolder: missingFolder });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(Error);
    // The error is either migration_apply_failed (drizzle's migrate
    // throws before computeAppliedTags runs) or migration_file_unreadable
    // (computeAppliedTags throws). Both are typed MigrationErrors; both
    // exit code 1; both surface the failure rather than silently
    // returning a short list.
    const code = (caught as { code: string }).code;
    expect(['migration_apply_failed', 'migration_file_unreadable']).toContain(code);
    expect((caught as { exitCode: number }).exitCode).toBe(1);
  });

  it('reports appliedMigrations for every tag that successfully moved absent → present', () => {
    // Two valid migrations on a fresh DB. Both should be reported.
    const happyFolder = join(directory, 'happy');
    mkdirSync(happyFolder, { recursive: true });
    mkdirSync(join(happyFolder, 'meta'), { recursive: true });
    writeFileSync(join(happyFolder, '0000_one.sql'), 'CREATE TABLE t1 (id INTEGER PRIMARY KEY);');
    writeFileSync(join(happyFolder, '0001_two.sql'), 'CREATE TABLE t2 (id INTEGER PRIMARY KEY);');
    writeFileSync(
      join(happyFolder, 'meta', '_journal.json'),
      JSON.stringify({
        version: '7',
        dialect: 'sqlite',
        entries: [
          { idx: 0, version: '7', when: 0, tag: '0000_one', breakpoints: true },
          { idx: 1, version: '7', when: 1, tag: '0001_two', breakpoints: true },
        ],
      }),
    );
    const report = runMigrations(connection, { migrationsFolder: happyFolder });
    expect(report.appliedMigrations).toEqual(['0000_one', '0001_two']);
  });
});
