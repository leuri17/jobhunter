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

// Fake orchestrator: emits a fixed progress script, logs two lines
// through the sidecar's tee logger, then parks on the scoring
// confirmation gate until the decision route resolves it. Mirrors the
// real run's event/log/gate ordering without Playwright or LinkedIn.
vi.mock('@jobhunter/core/pipeline', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@jobhunter/core/pipeline')>();

  class FakeOrchestrator {
    constructor(
      private readonly options: {
        onEvent?: (event: Record<string, unknown>) => void;
        logger?: {
          searchStart: (input: { searchId: number; url: string }) => void;
          searchComplete: (input: { searchId: number; jobsDiscovered: number }) => void;
        };
        prompts?: {
          askScoringConfirmation: (input: {
            plan: { jobsDiscovered: number; newOpenAIRequests: number };
          }) => Promise<boolean>;
        };
      },
    ) {}

    async run(): Promise<{ summary: RunSummary; scoringPlan: null; topN: [] }> {
      this.options.onEvent?.({ type: 'run_start', runId: 1, searchesPlanned: 1 });
      this.options.logger?.searchStart({
        searchId: 1,
        url: 'https://www.linkedin.com/jobs/search/?keywords=q1',
      });
      this.options.onEvent?.({
        type: 'search_start',
        runId: 1,
        index: 0,
        total: 1,
        query: 'q1',
        locationName: 'L1',
      });
      this.options.logger?.searchComplete({ searchId: 1, jobsDiscovered: 3 });
      const confirmed = await this.options.prompts?.askScoringConfirmation({
        plan: { jobsDiscovered: 3, newOpenAIRequests: 3 },
      });
      if (confirmed !== true) {
        this.options.onEvent?.({ type: 'scoring_declined', runId: 1 });
      }
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

function makeDbOpener(): () => Promise<DatabaseConnection> {
  return async () => {
    const connection = createDatabaseConnection(':memory:');
    runMigrations(connection, { migrationsFolder: resolveRepoRootForMigrations() });
    const repositories = createRepositories(connection);
    await seedApprovedProfile(repositories);
    await seedActiveFilter(repositories);
    return connection;
  };
}

/** Read the SSE stream until the accumulated text contains `marker`. */
async function readUntil(
  res: { readonly body: ReadableStream<Uint8Array> },
  marker: string,
): Promise<string> {
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let text = '';
  while (!text.includes(marker)) {
    const { done, value } = await reader.read();
    if (done) break;
    text += decoder.decode(value, { stream: true });
  }
  await reader.cancel();
  return text;
}

describe('pipeline reconnect replay', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('replays the full log + progress history to a client that reconnects mid-run', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'test-key');
    const server = await buildServer({
      env: { port: 0, host: '127.0.0.1' },
      pipelineDbOpener: makeDbOpener(),
    });
    const baseUrl = await server.listen();
    try {
      const start = await fetch(`${baseUrl}/api/pipeline/run`, { method: 'POST' });
      expect(start.status).toBe(202);
      const { runId } = (await start.json()) as { schemaVersion: number; runId: string };

      // Client #1 consumes a drain tick (sees the gate event), then
      // disconnects — the user navigating away mid-run.
      const first = await fetch(`${baseUrl}/api/pipeline/${runId}/events`);
      const firstText = await readUntil(first, 'confirmation_required');
      expect(firstText).toContain('run_start');

      // Gate decision while client #1 is gone; the run finishes.
      const decide = await fetch(`${baseUrl}/api/pipeline/${runId}/scoring-decision`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ accepted: false }),
      });
      expect(decide.status).toBe(200);

      // Client #2 — the user returning to the page — must get the FULL
      // history replayed, not just what arrived after client #1 left.
      const second = await fetch(`${baseUrl}/api/pipeline/${runId}/events`);
      const secondText = await second.text();
      for (const expected of [
        'run_start',
        'search_start',
        'search start',
        'search complete',
        'confirmation_required',
        'scoring_declined',
      ]) {
        expect(secondText).toContain(expected);
      }
      const frames = secondText.split('\n\n');
      const doneFrame = frames.find((f) => f.startsWith('event: done'));
      expect(doneFrame).toBeDefined();
    } finally {
      await server.close();
    }
  }, 15_000);

  it('late-joining client (no earlier connection) receives the full history', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'test-key');
    const server = await buildServer({
      env: { port: 0, host: '127.0.0.1' },
      pipelineDbOpener: makeDbOpener(),
    });
    const baseUrl = await server.listen();
    try {
      const start = await fetch(`${baseUrl}/api/pipeline/run`, { method: 'POST' });
      const { runId } = (await start.json()) as { schemaVersion: number; runId: string };

      // The run is parked on the gate; only now does a client connect.
      const late = await fetch(`${baseUrl}/api/pipeline/${runId}/events`);
      const lateText = await readUntil(late, 'confirmation_required');
      expect(lateText).toContain('run_start');
      expect(lateText).toContain('search start');

      const decide = await fetch(`${baseUrl}/api/pipeline/${runId}/scoring-decision`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ accepted: false }),
      });
      expect(decide.status).toBe(200);
    } finally {
      await server.close();
    }
  }, 15_000);
});
