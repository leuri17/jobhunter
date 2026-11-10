import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildServer } from '../src/server.js';
import {
  createDatabaseConnection,
  createRepositories,
  runMigrations,
  resolveRepoRootForMigrations,
} from '@jobhunter/core/persistence';

// Hermeticity guard: tests must never open the real on-disk database
// (see pipeline.test.ts).
vi.mock('../src/routes/db-helper.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/routes/db-helper.js')>();
  return {
    ...actual,
    openDbHandle: async (): Promise<never> => {
      throw new Error('openDbHandle must not be called: inject filtersDbOpener in tests');
    },
  };
});

describe('POST /api/filters/default', () => {
  let server: Awaited<ReturnType<typeof buildServer>>;
  let baseUrl: string;
  let workspace: string;

  beforeAll(async () => {
    // The route opens (and closes) a connection per request, like the
    // real opener does — so idempotency needs a shared temp-file
    // database, not one shared in-memory connection.
    workspace = mkdtempSync(join(tmpdir(), 'jobhunter-filters-'));
    const setup = createDatabaseConnection(join(workspace, 'test.sqlite'));
    runMigrations(setup, { migrationsFolder: resolveRepoRootForMigrations() });
    createRepositories(setup);
    setup.close();

    server = await buildServer({
      env: { port: 0, host: '127.0.0.1' },
      filtersDbOpener: async () => createDatabaseConnection(join(workspace, 'test.sqlite')),
    });
    baseUrl = await server.listen();
  });

  afterAll(async () => {
    await server.close();
    rmSync(workspace, { force: true, recursive: true });
  });

  it('creates and activates the default filter', async () => {
    const res = await fetch(`${baseUrl}/api/filters/default`, { method: 'POST' });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      schemaVersion: number;
      filter: { id: number; contentHash: string };
      created: boolean;
    };
    expect(body.schemaVersion).toBe(1);
    expect(body.created).toBe(true);
    expect(typeof body.filter.id).toBe('number');
    expect(body.filter.contentHash.length).toBeGreaterThan(0);
  });

  it('is idempotent — a second call returns the existing active config', async () => {
    const first = (await (
      await fetch(`${baseUrl}/api/filters/default`, { method: 'POST' })
    ).json()) as {
      filter: { id: number };
      created: boolean;
    };
    const second = (await (
      await fetch(`${baseUrl}/api/filters/default`, { method: 'POST' })
    ).json()) as {
      filter: { id: number };
      created: boolean;
    };
    expect(second.created).toBe(false);
    expect(second.filter.id).toBe(first.filter.id);
  });
});
