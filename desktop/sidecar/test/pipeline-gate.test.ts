import { describe, it, expect, vi, afterEach } from 'vitest';
import type { RunSummary } from '@jobhunter/core/pipeline';
import { buildServer } from '../src/server.js';
import {
  beginScoringConfirmation,
  CONFIRMATION_TIMEOUT_MS,
  type ActiveRun,
} from '../src/routes/pipeline.js';
import {
  createDatabaseConnection,
  createRepositories,
  runMigrations,
  resolveRepoRootForMigrations,
  type DatabaseConnection,
  type Repositories,
} from '@jobhunter/core/persistence';
import type { ProfessionalProfile } from '@jobhunter/core/profile';

// State shared with the hoisted orchestrator mock: the confirmScoring
// flag and prompt answers the fake observed per run.
const gate = vi.hoisted(() => ({
  confirmScoringFlags: [] as boolean[],
  confirmed: [] as boolean[],
}));

vi.mock('../src/routes/db-helper.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/routes/db-helper.js')>();
  return {
    ...actual,
    openDbHandle: async (): Promise<never> => {
      throw new Error('openDbHandle must not be called: inject pipelineDbOpener in tests');
    },
  };
});

// Replace the orchestrator with a fake that awaits the route-wired
// confirmation prompt, so the gate protocol is exercised end to end
// without a real orchestrator (no Playwright, no LinkedIn).
vi.mock('@jobhunter/core/pipeline', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@jobhunter/core/pipeline')>();
  const fakeGate = gate;

  class FakeOrchestrator {
    constructor(
      private readonly options: {
        confirmScoring: boolean;
        prompts: {
          askScoringConfirmation: (input: {
            plan: { jobsDiscovered: number; newOpenAIRequests: number };
          }) => Promise<boolean>;
        };
      },
    ) {}

    async run(): Promise<{ summary: RunSummary; scoringPlan: null; topN: [] }> {
      fakeGate.confirmScoringFlags.push(this.options.confirmScoring);
      const confirmed = await this.options.prompts.askScoringConfirmation({
        plan: { jobsDiscovered: 2, newOpenAIRequests: 2 },
      });
      fakeGate.confirmed.push(confirmed);
      return { summary: makeRunSummary(confirmed), scoringPlan: null, topN: [] };
    }
  }

  return {
    ...actual,
    PipelineOrchestrator: FakeOrchestrator as unknown as typeof actual.PipelineOrchestrator,
  };
});

function makeRunSummary(confirmed: boolean): RunSummary {
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
    jobsDiscovered: 2,
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
    scoringDeclinedByUser: !confirmed,
    cancellationReason: null,
  };
}

function makeRun(): ActiveRun {
  return {
    runId: 'run-test',
    controller: new AbortController(),
    logs: [],
    events: [],
    status: 'running',
    pendingConfirmation: null,
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

class SseReader {
  private buffer = '';

  private constructor(private readonly reader: ReadableStreamDefaultReader<Uint8Array>) {}

  static open(res: Response): SseReader {
    if (res.body === null) throw new Error('SSE response has no body');
    return new SseReader(res.body.getReader());
  }

  async waitUntil(predicate: (text: string) => boolean, timeoutMs = 8000): Promise<string> {
    const deadline = Date.now() + timeoutMs;
    while (!predicate(this.buffer)) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) {
        throw new Error(`timed out waiting for frame; buffer so far: ${this.buffer}`);
      }
      const chunk = await Promise.race([
        this.reader.read(),
        new Promise<never>((_, reject) => {
          setTimeout(() => reject(new Error('SSE read timeout')), remaining);
        }),
      ]);
      if (chunk.done) throw new Error(`stream closed early; buffer: ${this.buffer}`);
      this.buffer += new TextDecoder().decode(chunk.value, { stream: true });
    }
    return this.buffer;
  }
}

function parseFrame(
  text: string,
  name: string,
): { status: string; result: { summary: RunSummary }; error: unknown } {
  const frame = text.split('\n\n').find((f) => f.startsWith(`event: ${name}`));
  if (frame === undefined) throw new Error(`no ${name} frame in: ${text}`);
  const line = frame.split('\n').find((l) => l.startsWith('data: '));
  if (line === undefined) throw new Error(`${name} frame has no data line`);
  return JSON.parse(line.slice('data: '.length));
}

describe('beginScoringConfirmation (unit)', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('auto-declines after the timeout and clears the pending handle', async () => {
    vi.useFakeTimers();
    const run = makeRun();
    const decision = beginScoringConfirmation(run, { jobsDiscovered: 3, newOpenAIRequests: 2 });
    expect(run.events.at(-1)).toMatchObject({
      type: 'confirmation_required',
      runId: 'run-test',
      jobsDiscovered: 3,
      newOpenAIRequests: 2,
    });
    expect(run.pendingConfirmation).not.toBeNull();
    await vi.advanceTimersByTimeAsync(CONFIRMATION_TIMEOUT_MS);
    await expect(decision).resolves.toBe(false);
    expect(run.pendingConfirmation).toBeNull();
  });

  it('resolves through the pending decision handle', async () => {
    const run = makeRun();
    const decision = beginScoringConfirmation(run, { jobsDiscovered: 1, newOpenAIRequests: 1 });
    run.pendingConfirmation?.resolve(true);
    await expect(decision).resolves.toBe(true);
    expect(run.pendingConfirmation).toBeNull();
  });
});

describe('scoring cost gate (integration)', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    gate.confirmScoringFlags.length = 0;
    gate.confirmed.length = 0;
  });

  it('pauses scoring on confirmation_required and resumes on accept', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'test-key');
    const server = await buildServer({
      env: { port: 0, host: '127.0.0.1' },
      pipelineDbOpener: makeDbOpener({ profile: true, filter: true }),
    });
    const baseUrl = await server.listen();
    try {
      const start = await fetch(`${baseUrl}/api/pipeline/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requireScoringConfirmation: true }),
      });
      expect(start.status).toBe(202);
      const { runId } = (await start.json()) as { schemaVersion: number; runId: string };

      const eventsRes = await fetch(`${baseUrl}/api/pipeline/${runId}/events`);
      const reader = SseReader.open(eventsRes);
      await reader.waitUntil(
        (t) => t.includes('event: progress') && t.includes('confirmation_required'),
      );
      expect(gate.confirmed).toHaveLength(0);

      const decision = await fetch(`${baseUrl}/api/pipeline/${runId}/scoring-decision`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accepted: true }),
      });
      expect(decision.status).toBe(200);

      const text = await reader.waitUntil((t) => t.includes('event: done'));
      expect(gate.confirmScoringFlags[0]).toBe(false);
      expect(gate.confirmed[0]).toBe(true);
      const donePayload = parseFrame(text, 'done');
      expect(donePayload.result.summary.scoringDeclinedByUser).toBe(false);
    } finally {
      await server.close();
    }
  }, 15_000);

  it('declines scoring when the decision rejects', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'test-key');
    const server = await buildServer({
      env: { port: 0, host: '127.0.0.1' },
      pipelineDbOpener: makeDbOpener({ profile: true, filter: true }),
    });
    const baseUrl = await server.listen();
    try {
      const start = await fetch(`${baseUrl}/api/pipeline/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requireScoringConfirmation: true }),
      });
      const { runId } = (await start.json()) as { schemaVersion: number; runId: string };

      const eventsRes = await fetch(`${baseUrl}/api/pipeline/${runId}/events`);
      const reader = SseReader.open(eventsRes);
      await reader.waitUntil((t) => t.includes('confirmation_required'));

      const decision = await fetch(`${baseUrl}/api/pipeline/${runId}/scoring-decision`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accepted: false }),
      });
      expect(decision.status).toBe(200);

      const text = await reader.waitUntil((t) => t.includes('event: done'));
      expect(gate.confirmed[0]).toBe(false);
      const donePayload = parseFrame(text, 'done');
      expect(donePayload.result.summary.scoringDeclinedByUser).toBe(true);
    } finally {
      await server.close();
    }
  }, 15_000);

  it('auto-confirms and skips the gate when requireScoringConfirmation is false', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'test-key');
    const server = await buildServer({
      env: { port: 0, host: '127.0.0.1' },
      pipelineDbOpener: makeDbOpener({ profile: true, filter: true }),
    });
    const baseUrl = await server.listen();
    try {
      const start = await fetch(`${baseUrl}/api/pipeline/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requireScoringConfirmation: false }),
      });
      expect(start.status).toBe(202);
      const { runId } = (await start.json()) as { schemaVersion: number; runId: string };

      const eventsRes = await fetch(`${baseUrl}/api/pipeline/${runId}/events`);
      const reader = SseReader.open(eventsRes);
      const text = await reader.waitUntil((t) => t.includes('event: done'));

      expect(text).not.toContain('confirmation_required');
      expect(gate.confirmScoringFlags[0]).toBe(true);
      expect(gate.confirmed[0]).toBe(true);
    } finally {
      await server.close();
    }
  }, 15_000);

  it('rejects a decision when no confirmation is pending', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'test-key');
    const server = await buildServer({
      env: { port: 0, host: '127.0.0.1' },
      pipelineDbOpener: makeDbOpener({ profile: true, filter: true }),
    });
    const baseUrl = await server.listen();
    try {
      const start = await fetch(`${baseUrl}/api/pipeline/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requireScoringConfirmation: false }),
      });
      const { runId } = (await start.json()) as { schemaVersion: number; runId: string };

      const decision = await fetch(`${baseUrl}/api/pipeline/${runId}/scoring-decision`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accepted: true }),
      });
      expect(decision.status).toBe(409);
      const body = (await decision.json()) as { error: { code: string } };
      expect(body.error.code).toBe('no_pending_confirmation');
    } finally {
      await server.close();
    }
  }, 10_000);

  it('reports the run as cancelled when cancelled while the gate is open', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'test-key');
    const server = await buildServer({
      env: { port: 0, host: '127.0.0.1' },
      pipelineDbOpener: makeDbOpener({ profile: true, filter: true }),
    });
    const baseUrl = await server.listen();
    try {
      const start = await fetch(`${baseUrl}/api/pipeline/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requireScoringConfirmation: true }),
      });
      const { runId } = (await start.json()) as { schemaVersion: number; runId: string };

      const eventsRes = await fetch(`${baseUrl}/api/pipeline/${runId}/events`);
      const reader = SseReader.open(eventsRes);
      await reader.waitUntil((t) => t.includes('confirmation_required'));

      const cancel = await fetch(`${baseUrl}/api/pipeline/${runId}/cancel`, {
        method: 'POST',
      });
      expect(cancel.status).toBe(200);

      const text = await reader.waitUntil((t) => t.includes('event: done'));
      const donePayload = parseFrame(text, 'done');
      expect(donePayload.status).toBe('cancelled');
    } finally {
      await server.close();
    }
  }, 15_000);

  it('gates by default when the body omits requireScoringConfirmation', async () => {
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
      const reader = SseReader.open(eventsRes);
      await reader.waitUntil((t) => t.includes('confirmation_required'));

      const decision = await fetch(`${baseUrl}/api/pipeline/${runId}/scoring-decision`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accepted: true }),
      });
      expect(decision.status).toBe(200);

      await reader.waitUntil((t) => t.includes('event: done'));
      expect(gate.confirmScoringFlags[0]).toBe(false);
      expect(gate.confirmed[0]).toBe(true);
    } finally {
      await server.close();
    }
  }, 15_000);

  it('404s a decision for an unknown run', async () => {
    const server = await buildServer({ env: { port: 0, host: '127.0.0.1' } });
    const baseUrl = await server.listen();
    try {
      const decision = await fetch(`${baseUrl}/api/pipeline/never-existed/scoring-decision`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accepted: true }),
      });
      expect(decision.status).toBe(404);
      const body = (await decision.json()) as { error: { code: string } };
      expect(body.error.code).toBe('pipeline_run_not_found');
    } finally {
      await server.close();
    }
  });
});
