import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runMigrations } from '../../../src/persistence/migrations.js';
import { createDatabaseConnection, type DatabaseConnection } from '../../../src/persistence/connection.js';
import { filterConfigurationVersions as filterConfigurationVersionsTableForTest } from '../../../src/persistence/schema.js';
import { FilterConfigurationRepository } from '../../../src/persistence/repositories/filter-configurations.js';

const REPO_ROOT = resolve(import.meta.dirname, '..', '..', '..');

function ctxFrom(c: DatabaseConnection) { return { db: c.db }; }

describe('FilterConfigurationRepository', () => {
  let directory: string;
  let connection: DatabaseConnection;
  let repo: FilterConfigurationRepository;

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'jobhunter-filter-configs-'));
    connection = createDatabaseConnection(join(directory, 'jobhunter.sqlite'));
    runMigrations(connection, { migrationsFolder: join(REPO_ROOT, 'drizzle') });
    repo = new FilterConfigurationRepository(ctxFrom(connection));
  });

  afterEach(() => {
    connection.close();
    rmSync(directory, { recursive: true, force: true });
  });

  it('inserts an inactive configuration and finds it by id', async () => {
    const id = await repo.insert({
      schemaVersion: 1,
      contentHash: 'h1',
      configJson: { excludedCompanies: [], title: { excludedKeywords: [], requiredAnyKeywords: [] } },
      createdAt: '2026-08-05T10:00:00.000Z',
    });
    const row = await repo.findById(id);
    expect(row?.active).toBe(false);
    expect(row?.schemaVersion).toBe(1);
  });

  it('activate flips the active flag and deactivates any previous active row', async () => {
    const first = await repo.insert({
      schemaVersion: 1, contentHash: 'h1', configJson: {}, createdAt: '2026-08-05T10:00:00.000Z', active: true,
    });
    // Inserting a second active row directly is rejected by the partial unique index.
    await expect(
      connection.db.insert(filterConfigurationVersionsTableForTest).values({
        schemaVersion: 1, contentHash: 'h2', configJson: '{}', createdAt: '2026-08-05T11:00:00.000Z', active: true,
      }),
    ).rejects.toThrow();

    const second = await repo.insert({
      schemaVersion: 1, contentHash: 'h3', configJson: {}, createdAt: '2026-08-05T12:00:00.000Z',
    });
    await repo.activate(second);

    const active = await repo.findActive();
    expect(active?.id).toBe(second);
    const firstRow = await repo.findById(first);
    expect(firstRow?.active).toBe(false);
  });

  it('history is preserved: listing returns every row regardless of active flag', async () => {
    const a = await repo.insert({
      schemaVersion: 1, contentHash: 'a', configJson: {}, createdAt: '2026-08-05T10:00:00.000Z', active: true,
    });
    const b = await repo.insert({
      schemaVersion: 1, contentHash: 'b', configJson: {}, createdAt: '2026-08-05T11:00:00.000Z',
    });
    await repo.activate(b);
    const rows = await repo.list();
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.id).sort()).toEqual([a, b].sort());
  });
});
