import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { resolvePlatformPaths, type PlatformPaths } from '../../src/platform/paths.js';
import { initializeDatabase } from '../../src/persistence/database.js';

const REPO_ROOT = resolve(import.meta.dirname, '..', '..');
const MIGRATIONS_FOLDER = join(REPO_ROOT, 'drizzle');

function linuxPathsWith(home: string, xdgDataHome: string): PlatformPaths {
  const adapter = {
    platform: 'linux' as const,
    home,
    environment: {
      HOME: home,
      XDG_DATA_HOME: xdgDataHome,
      XDG_CONFIG_HOME: xdgDataHome,
      XDG_STATE_HOME: xdgDataHome,
      XDG_CACHE_HOME: xdgDataHome,
    },
  };
  return resolvePlatformPaths(adapter);
}

describe('initializeDatabase', () => {
  let home: string;
  let paths: PlatformPaths;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'jobhunter-init-'));
    paths = linuxPathsWith(home, join(home, 'xdg-data'));
  });

  afterEach(() => {
    rmSync(home, { recursive: true, force: true });
  });

  it('creates the data directory and applies migrations on a fresh install', async () => {
    const handle = await initializeDatabase(paths, { migrationsFolder: MIGRATIONS_FOLDER });
    try {
      expect(handle.filePath).toBe(join(paths.data.directory, 'jobhunter.sqlite'));
      expect(handle.sqlite.pragma('foreign_keys', { simple: true })).toBe(1);
      expect(handle.report.appliedMigrations.length).toBeGreaterThan(0);
    } finally {
      handle.close();
    }
  });

  it('is idempotent across repeated calls on the same data directory', async () => {
    const first = await initializeDatabase(paths, { migrationsFolder: MIGRATIONS_FOLDER });
    first.close();
    const second = await initializeDatabase(paths, { migrationsFolder: MIGRATIONS_FOLDER });
    try {
      expect(second.report.appliedMigrations).toEqual([]);
    } finally {
      second.close();
    }
  });

  it('closes the connection if migration application fails', async () => {
    let caught: unknown;
    try {
      await initializeDatabase(paths, { migrationsFolder: join(home, 'no-such-folder') });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(Error);
    expect((caught as { code: string }).code).toBe('migration_apply_failed');
    expect((caught as { exitCode: number }).exitCode).toBe(1);
    // After failure the SQLite file should not be left half-open.
    // We reopen the same path to confirm we can open it again.
    const reopen = await initializeDatabase(paths, { migrationsFolder: MIGRATIONS_FOLDER });
    try {
      expect(reopen.sqlite.pragma('foreign_keys', { simple: true })).toBe(1);
    } finally {
      reopen.close();
    }
  });
});
