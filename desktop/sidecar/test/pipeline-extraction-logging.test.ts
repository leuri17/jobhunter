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

interface ExtractionLoggerLike {
  extractionStart(input: { readonly jobId: number; readonly sourceJobId: string }): void;
  extractionFail(input: {
    readonly jobId: number;
    readonly errorCode: string;
    readonly method?: string;
  }): void;
}

// Fake extraction service: emits through whatever logger the sidecar
// wired into its constructor options. Everything else from
// @jobhunter/core/linkedin stays real.
vi.mock('@jobhunter/core/linkedin', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@jobhunter/core/linkedin')>();

  class FakeLinkedInExtractionService {
    constructor(private readonly options: { logger?: ExtractionLoggerLike } = {}) {}

    async extractBatch(): Promise<unknown> {
      this.options.logger?.extractionStart({ jobId: 42, sourceJobId: '4242' });
      this.options.logger?.extractionFail({
        jobId: 42,
        errorCode: 'extraction_failure_surfaced_to_log_stream',
      });
      return {
        schemaVersion: 1,
        runId: 1,
        searchExecutionId: 1,
        perJob: [],
        totals: { complete: 0, partial: 0, failed: 1, skipped: 0, cancelled: 0 },
      };
    }
  }

  return {
    ...actual,
    LinkedInExtractionService:
      FakeLinkedInExtractionService as unknown as typeof actual.LinkedInExtractionService,
  };
});

// Fake orchestrator: runs one extractBatch() pass through the
// extraction service the sidecar constructed, then completes. This is
// the only way the wired logger gets exercised without Playwright.
vi.mock('@jobhunter/core/pipeline', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@jobhunter/core/pipeline')>();

  class FakeOrchestrator {
    constructor(
      private readonly options: {
        onEvent?: (event: Record<string, unknown>) => void;
        extractionService: { extractBatch: () => Promise<unknown> };
      },
    ) {}

    async run(): Promise<{ summary: RunSummary; scoringPlan: null; topN: [] }> {
      await this.options.extractionService.extractBatch();
      this.options.onEvent?.({ type: 'run_start', runId: 1, searchesPlanned: 1 });
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

function dataLineOf(frame: string): string {
  const line = frame.split('\n').find((l) => l.startsWith('data: '));
  if (line === undefined) throw new Error(`frame has no data line: ${frame}`);
  return line.slice('data: '.length);
}

describe('pipeline extraction logging', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('forwards extraction-service log lines to the run SSE log stream', async () => {
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

      const eventsRes = await fetch(`${baseUrl}/api/pipeline/${runId}/events`);
      const text = await eventsRes.text();
      const frames = text.split('\n\n');

      const doneFrame = frames.find((f) => f.startsWith('event: done'));
      expect(doneFrame).toBeDefined();

      const logPayloads = frames
        .filter((f) => f.startsWith('event: log'))
        .map((f) => dataLineOf(f));
      expect(logPayloads.some((l) => l.includes('extraction started'))).toBe(true);
      expect(logPayloads.some((l) => l.includes('[warn] extraction failed'))).toBe(true);
    } finally {
      await server.close();
    }
  }, 15_000);
});
