import type { FastifyInstance } from 'fastify';
import { ensureDefaultFilterConfig } from '@jobhunter/core/filter';
import { type DatabaseConnection } from '@jobhunter/core/persistence';
import { openDbHandle, createRepositories } from './db-helper.js';

export interface FilterRouteOptions {
  /** Opens the SQLite handle. */
  readonly dbOpener?: () => Promise<DatabaseConnection>;
}

export async function registerFilterRoutes(
  app: FastifyInstance,
  opts: FilterRouteOptions = {},
): Promise<void> {
  const openDb = opts.dbOpener ?? openDbHandle;

  // First-run unblock (issue #307): create the accept-all default
  // filter configuration when none is active. Idempotent — an existing
  // active configuration is returned untouched.
  app.post('/api/filters/default', async () => {
    const handle = await openDb();
    try {
      const result = await ensureDefaultFilterConfig(createRepositories(handle));
      return {
        schemaVersion: 1,
        filter: { id: result.filterConfigVersionId, contentHash: result.contentHash },
        created: result.created,
      };
    } finally {
      handle.close();
    }
  });
}
