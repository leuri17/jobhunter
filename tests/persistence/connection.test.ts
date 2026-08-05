import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { sql } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  createDatabaseConnection,
  type DatabaseConnection,
} from '../../src/persistence/connection.js';

describe('createDatabaseConnection', () => {
  let directory: string;
  let filePath: string;

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'jobhunter-connection-'));
    filePath = join(directory, 'jobhunter.sqlite');
  });

  afterEach(() => {
    rmSync(directory, { recursive: true, force: true });
  });

  it('opens a new SQLite file and enables foreign keys', () => {
    const connection = createDatabaseConnection(filePath);
    try {
      const foreignKeys = connection.sqlite.pragma('foreign_keys', { simple: true });
      expect(foreignKeys).toBe(1);
    } finally {
      connection.close();
    }
  });

  it('rejects foreign-key violations after the migrations have run', () => {
    const connection = createDatabaseConnection(filePath);
    try {
      // Minimal schema (jobs + pipeline_runs) is enough to exercise FK rejection.
      connection.sqlite.exec(`
        CREATE TABLE pipeline_runs (id INTEGER PRIMARY KEY AUTOINCREMENT);
        CREATE TABLE jobs (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          pipeline_run_id INTEGER NOT NULL REFERENCES pipeline_runs(id)
        );
      `);
      expect(() =>
        connection.sqlite.prepare('INSERT INTO jobs (pipeline_run_id) VALUES (?)').run(999),
      ).toThrow(/FOREIGN KEY constraint failed/);
    } finally {
      connection.close();
    }
  });

  it('returns a Drizzle instance that can run typed queries', () => {
    const connection: DatabaseConnection = createDatabaseConnection(filePath);
    try {
      connection.sqlite.exec(
        'CREATE TABLE sample (id INTEGER PRIMARY KEY AUTOINCREMENT, value TEXT NOT NULL)',
      );
      const result = connection.db.all<{ value: string }>(
        sql`SELECT value FROM sample WHERE value = ${'hello'}`,
      );
      expect(result).toEqual([]);
    } finally {
      connection.close();
    }
  });

  it('closes the underlying SQLite handle', () => {
    const connection = createDatabaseConnection(filePath);
    connection.close();
    expect(() => connection.sqlite.pragma('foreign_keys')).toThrow(
      /The database connection is not open/,
    );
  });

  it('surfaces open failures as DatabaseError', () => {
    let caught: unknown;
    try {
      createDatabaseConnection('/nonexistent/dir/jobhunter.sqlite');
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(Error);
    expect((caught as { code: string }).code).toBe('database_open_failed');
    expect((caught as { exitCode: number }).exitCode).toBe(1);
  });
});
