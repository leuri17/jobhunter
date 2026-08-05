import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runMigrations } from '../../../src/persistence/migrations.js';
import { createDatabaseConnection, type DatabaseConnection } from '../../../src/persistence/connection.js';
import { ApplicationMetadataRepository } from '../../../src/persistence/repositories/application-metadata.js';

const REPO_ROOT = resolve(import.meta.dirname, '..', '..', '..');

function ctxFrom(c: DatabaseConnection) { return { db: c.db }; }

describe('ApplicationMetadataRepository', () => {
  let directory: string;
  let connection: DatabaseConnection;
  let repo: ApplicationMetadataRepository;

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'jobhunter-app-metadata-'));
    connection = createDatabaseConnection(join(directory, 'jobhunter.sqlite'));
    runMigrations(connection, { migrationsFolder: join(REPO_ROOT, 'drizzle') });
    repo = new ApplicationMetadataRepository(ctxFrom(connection));
  });

  afterEach(() => {
    connection.close();
    rmSync(directory, { recursive: true, force: true });
  });

  it('set then get returns the value', async () => {
    await repo.set('init.completedAt', '2026-08-05T10:00:00.000Z', '2026-08-05T10:00:00.000Z');
    const row = await repo.get('init.completedAt');
    expect(row?.value).toBe('2026-08-05T10:00:00.000Z');
  });

  it('set overwrites an existing key', async () => {
    await repo.set('init.completedAt', 'a', '2026-08-05T10:00:00.000Z');
    await repo.set('init.completedAt', 'b', '2026-08-05T11:00:00.000Z');
    const row = await repo.get('init.completedAt');
    expect(row?.value).toBe('b');
    expect(row?.updatedAt).toBe('2026-08-05T11:00:00.000Z');
  });

  it('list returns all rows', async () => {
    await repo.set('a', '1', '2026-08-05T10:00:00.000Z');
    await repo.set('b', '2', '2026-08-05T10:00:00.000Z');
    const rows = await repo.list();
    expect(rows).toHaveLength(2);
  });

  it('delete removes the row', async () => {
    await repo.set('a', '1', '2026-08-05T10:00:00.000Z');
    await repo.delete('a');
    expect(await repo.get('a')).toBeNull();
  });
});