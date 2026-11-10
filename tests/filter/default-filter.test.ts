import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resolve } from 'node:path';

import { runMigrations } from '../../src/persistence/migrations.js';
import {
  createDatabaseConnection,
  type DatabaseConnection,
} from '../../src/persistence/connection.js';
import { createRepositories, type Repositories } from '../../src/persistence/repositories/index.js';
import {
  DEFAULT_JOB_FILTER_CONFIG,
  ensureDefaultFilterConfig,
} from '../../src/filter/default-filter.js';
import { JobFilterConfigSchema } from '../../src/filter/schema.js';

const REPO_ROOT = resolve(import.meta.dirname, '..', '..');

/**
 * `ensureDefaultFilterConfig` — the first-run unblock for the desktop
 * app: an active filter configuration is required to run the pipeline,
 * and nothing else in the desktop app creates one (issue #307). This
 * helper creates a schema-valid accept-all default, idempotently.
 */
describe('ensureDefaultFilterConfig', () => {
  let connection: DatabaseConnection;
  let repositories: Repositories;

  beforeEach(() => {
    connection = createDatabaseConnection(':memory:');
    runMigrations(connection, { migrationsFolder: resolve(REPO_ROOT, 'drizzle') });
    repositories = createRepositories(connection);
  });

  afterEach(() => {
    connection.close();
  });

  it('ships a schema-valid default config', () => {
    expect(() => JobFilterConfigSchema.parse(DEFAULT_JOB_FILTER_CONFIG)).not.toThrow();
  });

  it('creates and activates the default when none exists', async () => {
    const result = await ensureDefaultFilterConfig(
      repositories,
      () => new Date('2026-01-01T00:00:00.000Z'),
    );
    expect(result.created).toBe(true);
    const active = await repositories.filterConfigurations.findActive();
    expect(active?.id).toBe(result.filterConfigVersionId);
    expect(active?.contentHash).toBe(result.contentHash);
    expect(active?.createdAt).toBe('2026-01-01T00:00:00.000Z');
  });

  it('is idempotent — returns the existing active config untouched', async () => {
    const first = await ensureDefaultFilterConfig(repositories);
    const second = await ensureDefaultFilterConfig(repositories);
    expect(second.created).toBe(false);
    expect(second.filterConfigVersionId).toBe(first.filterConfigVersionId);
    const all = await repositories.filterConfigurations.list();
    expect(all).toHaveLength(1);
  });
});
