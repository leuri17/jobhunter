import { describe, it, expect, vi, afterEach } from 'vitest';
import type { RunSummary } from '@jobhunter/core/pipeline';
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
// database (see pipeline.test.ts).
vi.mock('../src/routes/db-helper.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/routes/db-helper.js')>();
  return {
    ...actual,
    openDbHandle: async (): Promise<never> => {
      throw new Error('openDbHandle must not be called: inject pipelineDbOpener in tests');
    },
  };
});

// Replace the orchestrator with a deterministic fake that emits a
// fixed progress-event script through the route-supplied `onEvent`
// sink and completes. Keeps the test hermetic (no Playwright, no
// LinkedIn) while exercising the real SSE wiring.
vi.mock('@jobhunter/core/pipeline', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@jobhunter/core/pipeline')>();

  class FakeOrchestrator {
    constructor(private readonly options: { onEvent?: (event: Record<string, unknown>) => void }) {}

    async run(): Promise<{ summary: RunSummary; scoringPlan: null; topN: [] }> {
      const sink = this.options.onEvent;
      sink?.({ type: 'run_start', runId: 1, searchesPlanned: 1 });
      sink?.({
        type: 'search_start',
        runId: 1,
        index: 0,
        total: 1,
        query: 'q1',
        locationName: 'L1',
      });
      sink?.({ type: 'scoring_plan', runId: 1, jobsDiscovered: 2, newOpenAIRequests: 2 });
      return { summary: makeRunSummary(), scoringPlan: null, topN: [] };
    }
  }

  return {
    ...actual,
    PipelineOrchestrator: FakeOrchestrator as unknown as typeof actual.PipelineOrchestrator,
  };
});

function makeRunSummary(): RunSummary {
  return {
    schemaVersion: 1,
    runId: 1,
    status: 'completed',
    startTimestamp: '2026-01-01T00:00:00.000Z',
    endTimestamp: '2026-01-01T00:00:01.000Z',
    searchesPlanned: 1,
    searchesAttempted: 1,
    searchesCompleted: 1,
    searchErrors: [],
    jobsDiscovered: 0,
    newCompleteJobs: 0,
    existingCompleteJobsSkipped: 0,
    existingPartialJobsSkipped: 0,
    newPartialJobs: 0,
    failedExtractions: 0,
    jobsAccepted: 0,
    jobsRejected: 0,
    filterErrors: 0,
    jobsScored: 0,
    scoresReused: 0,
    scoringErrors: 0,
    scoringDeclinedByUser: false,
    cancellationReason: null,
  };
}

async function seedApprovedProfile(repositories: Repositories): Promise<void> {
  const id = await repositories.profileVersions.insert({
    status: 'draft',
    schemaVersion: 1,
    contentHash: 'test-profile-hash-1',
    extractionFingerprint: 'test-profile-fp-1',
    sourceIds: [1],
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

function dataLineOf(frame: string): string {
  const line = frame.split('\n').find((l) => l.startsWith('data: '));
  if (line === undefined) throw new Error(`frame has no data line: ${frame}`);
  return line.slice('data: '.length);
}

describe('pipeline progress streaming', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('forwards orchestrator progress events over SSE before the terminal done event', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'test-key');
    const server = await buildServer({
      env: { port: 0, host: '127.0.0.1' },
      pipelineDbOpener: makeDbOpener({ profile: true, filter: true }),
    });
    const baseUrl = await server.listen();
    try {
      const start = await fetch(`${baseUrl}/api/pipeline/run`, { method: 'POST' });
      expect(start.status).toBe(202);
      const { runId } = (await start.json()) as { schemaVersion: number; runId: string };

      const eventsRes = await fetch(`${baseUrl}/api/pipeline/${runId}/events`);
      const text = await eventsRes.text();
      const frames = text.split('\n\n');

      const progressPayloads = frames
        .filter((f) => f.startsWith('event: progress'))
        .map((f) => JSON.parse(dataLineOf(f)) as { type: string; [key: string]: unknown });
      expect(progressPayloads.map((p) => p.type)).toEqual([
        'run_start',
        'search_start',
        'scoring_plan',
      ]);
      expect(progressPayloads[1]).toMatchObject({ query: 'q1', locationName: 'L1' });
      expect(progressPayloads[2]).toMatchObject({ jobsDiscovered: 2, newOpenAIRequests: 2 });

      const doneFrame = frames.find((f) => f.startsWith('event: done'));
      expect(doneFrame).toBeDefined();
      const donePayload = JSON.parse(dataLineOf(doneFrame!)) as {
        status: string;
        result: { summary: { status: string } };
        error: unknown;
      };
      expect(donePayload.status).toBe('done');
      expect(donePayload.result.summary.status).toBe('completed');
      expect(donePayload.error).toBeNull();

      // Progress frames must be flushed before the terminal event.
      expect(frames.indexOf(doneFrame!)).toBeGreaterThan(
        frames.findIndex((f) => f.startsWith('event: progress')),
      );
    } finally {
      await server.close();
    }
  }, 15_000);
});
