import { describe, it, expect, beforeAll, afterAll, vi, afterEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../src/server.js';
import {
  createDatabaseConnection,
  createRepositories,
  runMigrations,
  resolveRepoRootForMigrations,
  type DatabaseConnection,
  type Repositories,
} from '@jobhunter/core/persistence';
import type { ProfessionalProfile } from '@jobhunter/core/profile';

// Hermeticity guard: no test in this file may open the real on-disk
// database. Tests that need a DB inject one through
// `buildServer({ pipelineDbOpener })`; any code path that falls back to
// `openDbHandle` throws here instead of touching the user's data or
// launching a real pipeline run (Playwright/LinkedIn).
vi.mock('../src/routes/db-helper.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/routes/db-helper.js')>();
  return {
    ...actual,
    openDbHandle: async (): Promise<never> => {
      throw new Error('openDbHandle must not be called: inject pipelineDbOpener in tests');
    },
  };
});

describe('pipeline endpoints', () => {
  let server: Awaited<ReturnType<typeof buildServer>>;
  let baseUrl: string;

  beforeAll(async () => {
    vi.stubEnv('OPENAI_API_KEY', '');
    server = await buildServer({ env: { port: 0, host: '127.0.0.1' } });
    baseUrl = await server.listen();
  });

  afterAll(async () => {
    await server.close();
    vi.unstubAllEnvs();
  });

  it('POST /api/pipeline/run returns 503 when OPENAI_API_KEY is missing', async () => {
    const res = await fetch(`${baseUrl}/api/pipeline/run`, { method: 'POST' });
    expect(res.status).toBe(503);
    const body = (await res.json()) as {
      schemaVersion: number;
      error: { code: string; message: string };
    };
    expect(body.schemaVersion).toBe(1);
    expect(body.error.code).toBe('openai_unavailable');
  });
});

async function seedApprovedProfile(repositories: Repositories): Promise<void> {
  const id = await repositories.profileVersions.insert({
    status: 'draft',
    schemaVersion: 1,
    contentHash: 'test-profile-hash-1',
    extractionFingerprint: 'test-profile-fp-1',
    sourceIds: [1],
    // `profileVersions.insert` serialises without re-validating; a
    // minimal literal is enough for the `findActiveApproved` lookup.
    profileJson: {} as ProfessionalProfile,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    active: false,
  });
  await repositories.profileVersions.approve(id, {
    approvedAt: '2026-01-01T00:00:00.000Z',
    supersededAt: '2026-01-01T00:00:00.000Z',
  });
}

async function seedActiveFilter(repositories: Repositories): Promise<void> {
  await repositories.filterConfigurations.insert({
    schemaVersion: 1,
    contentHash: 'test-filter-hash-1',
    configJson: { schemaVersion: 1 },
    createdAt: '2026-01-01T00:00:00.000Z',
    active: true,
  });
}

function makeDbOpener(seed: {
  profile: boolean;
  filter: boolean;
}): () => Promise<DatabaseConnection> {
  return async () => {
    const connection = createDatabaseConnection(':memory:');
    runMigrations(connection, { migrationsFolder: resolveRepoRootForMigrations() });
    const repositories = createRepositories(connection);
    if (seed.profile) await seedApprovedProfile(repositories);
    if (seed.filter) await seedActiveFilter(repositories);
    return connection;
  };
}

async function withServer(
  opts: Parameters<typeof buildServer>[0],
  fn: (baseUrl: string) => Promise<void>,
): Promise<void> {
  const server: FastifyInstance = await buildServer(opts);
  const baseUrl = await server.listen();
  try {
    await fn(baseUrl);
  } finally {
    await server.close();
  }
}

describe('POST /api/pipeline/run prerequisite preflight', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('returns 409 no_active_profile when no approved profile is active', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'test-key');
    await withServer(
      {
        env: { port: 0, host: '127.0.0.1' },
        pipelineDbOpener: makeDbOpener({ profile: false, filter: false }),
      },
      async (baseUrl) => {
        const res = await fetch(`${baseUrl}/api/pipeline/run`, { method: 'POST' });
        expect(res.status).toBe(409);
        const body = (await res.json()) as {
          schemaVersion: number;
          error: { code: string; message: string };
        };
        expect(body.schemaVersion).toBe(1);
        expect(body.error.code).toBe('no_active_profile');
        expect(body.error.message).toContain('profile');
      },
    );
  }, 10_000);

  it('returns 409 no_active_filter when a profile is active but no filter configuration is', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'test-key');
    await withServer(
      {
        env: { port: 0, host: '127.0.0.1' },
        pipelineDbOpener: makeDbOpener({ profile: true, filter: false }),
      },
      async (baseUrl) => {
        const res = await fetch(`${baseUrl}/api/pipeline/run`, { method: 'POST' });
        expect(res.status).toBe(409);
        const body = (await res.json()) as {
          schemaVersion: number;
          error: { code: string; message: string };
        };
        expect(body.schemaVersion).toBe(1);
        expect(body.error.code).toBe('no_active_filter');
        expect(body.error.message).toContain('filter');
      },
    );
  }, 10_000);
});

describe('GET /api/pipeline/prerequisites', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('reports every prerequisite as met for a seeded database', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'test-key');
    await withServer(
      {
        env: { port: 0, host: '127.0.0.1' },
        pipelineDbOpener: makeDbOpener({ profile: true, filter: true }),
      },
      async (baseUrl) => {
        const res = await fetch(`${baseUrl}/api/pipeline/prerequisites`);
        expect(res.status).toBe(200);
        const body = (await res.json()) as {
          schemaVersion: number;
          openaiKeyConfigured: boolean;
          activeProfile: { id: number; contentHash: string } | null;
          activeFilter: { id: number; contentHash: string } | null;
          configHash: string;
        };
        expect(body.schemaVersion).toBe(1);
        expect(body.openaiKeyConfigured).toBe(true);
        expect(body.activeProfile).toMatchObject({ contentHash: 'test-profile-hash-1' });
        expect(body.activeFilter).toMatchObject({ contentHash: 'test-filter-hash-1' });
        expect(typeof body.configHash).toBe('string');
        expect(body.configHash.length).toBeGreaterThan(0);
      },
    );
  }, 10_000);

  it('reports a missing active profile', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'test-key');
    await withServer(
      {
        env: { port: 0, host: '127.0.0.1' },
        pipelineDbOpener: makeDbOpener({ profile: false, filter: true }),
      },
      async (baseUrl) => {
        const res = await fetch(`${baseUrl}/api/pipeline/prerequisites`);
        expect(res.status).toBe(200);
        const body = (await res.json()) as {
          activeProfile: { id: number; contentHash: string } | null;
          activeFilter: { id: number; contentHash: string } | null;
        };
        expect(body.activeProfile).toBeNull();
        expect(body.activeFilter).not.toBeNull();
      },
    );
  }, 10_000);

  it('reports a missing OpenAI key', async () => {
    vi.stubEnv('OPENAI_API_KEY', '');
    await withServer(
      {
        env: { port: 0, host: '127.0.0.1' },
        pipelineDbOpener: makeDbOpener({ profile: true, filter: true }),
      },
      async (baseUrl) => {
        const res = await fetch(`${baseUrl}/api/pipeline/prerequisites`);
        expect(res.status).toBe(200);
        const body = (await res.json()) as {
          openaiKeyConfigured: boolean;
          activeProfile: { id: number; contentHash: string } | null;
        };
        expect(body.openaiKeyConfigured).toBe(false);
        expect(body.activeProfile).not.toBeNull();
      },
    );
  }, 10_000);
});

describe('GET /api/pipeline/active', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('returns null when no run is tracked', async () => {
    await withServer({ env: { port: 0, host: '127.0.0.1' } }, async (baseUrl) => {
      const res = await fetch(`${baseUrl}/api/pipeline/active`);
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        schemaVersion: number;
        runId: string | null;
        status: string | null;
      };
      expect(body).toMatchObject({ schemaVersion: 1, runId: null, status: null });
    });
  });

  it('returns the in-flight run while it executes', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'test-key');
    const seededOpener = makeDbOpener({ profile: true, filter: true });
    let opens = 0;
    const dbOpener = async (): Promise<DatabaseConnection> => {
      opens += 1;
      if (opens > 1) return new Promise<DatabaseConnection>(() => {});
      return seededOpener();
    };
    await withServer(
      { env: { port: 0, host: '127.0.0.1' }, pipelineDbOpener: dbOpener },
      async (baseUrl) => {
        const start = await fetch(`${baseUrl}/api/pipeline/run`, { method: 'POST' });
        expect(start.status).toBe(202);
        const { runId } = (await start.json()) as { schemaVersion: number; runId: string };

        const res = await fetch(`${baseUrl}/api/pipeline/active`);
        const body = (await res.json()) as { runId: string | null; status: string | null };
        expect(body.runId).toBe(runId);
        expect(body.status).toBe('running');
      },
    );
  }, 10_000);
});

describe('pipeline run failure reporting', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('includes the failure code and message in the terminal done event', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'test-key');
    const seededOpener = makeDbOpener({ profile: true, filter: true });
    let opens = 0;
    const dbOpener = async (): Promise<DatabaseConnection> => {
      opens += 1;
      if (opens > 1) throw new Error('second open failed (test-injected)');
      return seededOpener();
    };
    await withServer(
      { env: { port: 0, host: '127.0.0.1' }, pipelineDbOpener: dbOpener },
      async (baseUrl) => {
        const start = await fetch(`${baseUrl}/api/pipeline/run`, { method: 'POST' });
        expect(start.status).toBe(202);
        const { runId } = (await start.json()) as { schemaVersion: number; runId: string };

        const eventsRes = await fetch(`${baseUrl}/api/pipeline/${runId}/events`);
        // Resolves when the server closes the stream after `done`.
        const text = await eventsRes.text();
        const doneFrame = text.split('\n\n').find((frame) => frame.startsWith('event: done'));
        expect(doneFrame).toBeDefined();
        const dataLine = doneFrame?.split('\n').find((line) => line.startsWith('data: '));
        expect(dataLine).toBeDefined();
        const payload = JSON.parse(dataLine!.slice('data: '.length)) as {
          status: string;
          result: unknown;
          error: { code: string; message: string } | null;
        };
        expect(payload.status).toBe('failed');
        expect(payload.error).toMatchObject({
          code: 'pipeline_failed',
          message: expect.stringContaining('second open failed'),
        });
      },
    );
  }, 15_000);
});
