/**
 * Fixture sidecar for Playwright e2e specs.
 *
 * Boots on `FIXTURE_SIDECAR_PORT` (default 14231) and stubs every
 * `/api/*` endpoint the desktop UI touches. Backed by in-memory
 * state so mutation-and-query specs can assert the UI's cache
 * invalidation across routes.
 *
 * Launched by `desktop/ui/playwright.config.ts` as a Playwright
 * `webServer` so the Vite dev server's calls to `/api/*` resolve
 * against deterministic responses rather than failing with
 * "sidecar offline". Also runnable standalone via `pnpm e2e:sidecar`
 * for local debugging.
 */

import { randomUUID } from 'node:crypto';
import Fastify, { type FastifyInstance, type FastifyReply } from 'fastify';
import cors from '@fastify/cors';

const DEFAULT_PORT = 14231;
const LOG_FLUSH_INTERVAL_MS = 200;
const PIPELINE_RUN_TTL_MS = 60_000;

interface ProfileVersionRecord {
  readonly profileVersionId: number;
  readonly profileId: string;
  readonly status: 'draft' | 'approved' | 'rejected' | 'superseded';
  readonly active: boolean;
  readonly contentHash: string;
  readonly sourceIds: readonly number[];
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly approvedAt: string | null;
}

interface ProfileDetailRecord {
  readonly profile: Record<string, unknown>;
  readonly status: 'draft' | 'approved' | 'rejected' | 'superseded';
  readonly active: boolean;
  readonly contentHash: string;
  readonly extractionFingerprint: string;
  readonly warnings: readonly unknown[];
  readonly conflicts: readonly unknown[];
  readonly overrides: readonly unknown[];
  readonly revisions: readonly unknown[];
}

interface JobRecord {
  readonly state: 'scored' | 'accepted' | 'rejected' | 'unscored';
  readonly id: string;
  readonly internalId: number;
  readonly sourceJobId: string;
  readonly title: string;
  readonly company: string;
  readonly location: string;
  readonly overallScore?: number;
  readonly displayScore?: string;
  readonly firstDiscoveredAt: string;
}

interface RunRecord {
  readonly id: string;
  readonly internalId: number;
  readonly startTimestamp: string;
  readonly endTimestamp: string | null;
  readonly status: 'running' | 'cancelling' | 'completed' | 'completed_with_errors' | 'failed' | 'cancelled';
  readonly searchesAttempted: number;
  readonly jobsDiscovered: number;
  readonly jobsScored: number;
  readonly errorSummary: string;
}

type RunStatus = RunRecord['status'];

interface ActivePipelineRun {
  readonly runId: string;
  readonly controller: { aborted: boolean };
  readonly logs: string[];
  timer: NodeJS.Timeout | null;
  status: 'running' | 'cancelled' | 'done' | 'failed';
  result?: unknown;
}

interface AppState {
  profiles: Map<string, ProfileVersionRecord>;
  profileDetails: Map<string, ProfileDetailRecord>;
  jobs: readonly JobRecord[];
  runs: Map<string, RunRecord>;
  pipelineRuns: Map<string, ActivePipelineRun>;
  config: Record<string, unknown>;
}

const TIMESTAMP = '2026-01-01T00:00:00.000Z';

const BASE_CONFIG = {
  version: 1,
  search: {
    searchQueries: [],
    locations: [],
    datePosted: 86400,
    workplaceTypes: ['1', '2', '3'],
  },
  openai: {
    profileExtraction: { model: 'gpt-5.6-sol', reasoningEffort: 'medium' },
    jobScoring: { model: 'gpt-5.6-sol', reasoningEffort: 'medium', concurrency: 3 },
    refusalDetection: {
      refusalMarkers: ["I can't", 'I cannot', 'as an AI', "I'm not able to", "I'm unable to", "I won't", 'As a language model'],
      flagEmptyBodies: true,
    },
  },
  scraper: {
    timeouts: {
      navigationMs: 30000,
      initialResultsMs: 20000,
      detailPanelMs: 10000,
      dedicatedPageMs: 20000,
      overlayDismissalMs: 5000,
    },
    maxNoProgressAttempts: 3,
  },
  output: { runTopN: 20, jobsListDefaultLimit: 50 },
  logging: { level: 'info', prettyTerminal: true },
  diagnostics: {
    onScraperError: {
      screenshot: true,
      currentUrl: true,
      stackTrace: true,
      playwrightTrace: false,
      htmlSnapshot: false,
    },
  },
} as const;

function seedProfiles(): { profiles: Map<string, ProfileVersionRecord>; details: Map<string, ProfileDetailRecord> } {
  const profiles = new Map<string, ProfileVersionRecord>();
  const details = new Map<string, ProfileDetailRecord>();
  // Two drafts so approve + reject tests can both target a draft
  // when run sequentially against the shared fixture process.
  const seeds: readonly { id: string; status: ProfileVersionRecord['status']; active: boolean }[] = [
    { id: 'prof_seed_1', status: 'draft', active: false },
    { id: 'prof_seed_2', status: 'approved', active: true },
    { id: 'prof_seed_3', status: 'draft', active: false },
  ];
  for (const [i, s] of seeds.entries()) {
    profiles.set(s.id, {
      profileId: s.id,
      profileVersionId: i + 1,
      status: s.status,
      active: s.active,
      contentHash: `hash_${s.id}`,
      sourceIds: [1],
      createdAt: TIMESTAMP,
      updatedAt: TIMESTAMP,
      approvedAt: s.status === 'approved' ? TIMESTAMP : null,
    });
    details.set(s.id, {
      profile: { id: s.id, fullName: s.status === 'approved' ? 'Active Profile' : 'Draft Profile' },
      status: s.status,
      active: s.active,
      contentHash: `hash_${s.id}`,
      extractionFingerprint: `fp_${s.id}`,
      warnings: [],
      conflicts: [],
      overrides: [],
      revisions: [],
    });
  }
  return { profiles, details };
}

function seedJobs(): readonly JobRecord[] {
  return [
    {
      state: 'scored',
      id: 'job_seed_scored_a',
      internalId: 1,
      sourceJobId: 'li_001',
      title: 'Staff Backend Engineer',
      company: 'Acme',
      location: 'Remote',
      overallScore: 91,
      displayScore: '91',
      firstDiscoveredAt: TIMESTAMP,
    },
    {
      state: 'scored',
      id: 'job_seed_scored_b',
      internalId: 2,
      sourceJobId: 'li_002',
      title: 'Senior Platform Engineer',
      company: 'Globex',
      location: 'Berlin',
      overallScore: 84,
      displayScore: '84',
      firstDiscoveredAt: TIMESTAMP,
    },
    {
      state: 'scored',
      id: 'job_seed_scored_c',
      internalId: 3,
      sourceJobId: 'li_003',
      title: 'Tech Lead, Data Infra',
      company: 'Initech',
      location: 'NYC',
      overallScore: 77,
      displayScore: '77',
      firstDiscoveredAt: TIMESTAMP,
    },
    {
      state: 'accepted',
      id: 'job_seed_accepted_a',
      internalId: 4,
      sourceJobId: 'li_004',
      title: 'Principal SRE',
      company: 'Hooli',
      location: 'Remote',
      firstDiscoveredAt: TIMESTAMP,
    },
    {
      state: 'rejected',
      id: 'job_seed_rejected_a',
      internalId: 5,
      sourceJobId: 'li_005',
      title: 'Junior QA Engineer',
      company: 'Soylent',
      location: 'Remote',
      firstDiscoveredAt: TIMESTAMP,
    },
    {
      state: 'unscored',
      id: 'job_seed_unscored_a',
      internalId: 6,
      sourceJobId: 'li_006',
      title: 'Engineering Manager',
      company: 'Massive Dynamic',
      location: 'Boston',
      firstDiscoveredAt: TIMESTAMP,
    },
  ];
}

function seedRuns(): Map<string, RunRecord> {
  const runs = new Map<string, RunRecord>();
  runs.set('run_seed_1', {
    id: 'run_seed_1',
    internalId: 1,
    startTimestamp: TIMESTAMP,
    endTimestamp: TIMESTAMP,
    status: 'completed',
    searchesAttempted: 4,
    jobsDiscovered: 12,
    jobsScored: 9,
    errorSummary: 'none',
  });
  return runs;
}

function createInitialState(): AppState {
  return {
    ...(() => {
      const { profiles, details } = seedProfiles();
      return { profiles, profileDetails: details };
    })(),
    jobs: seedJobs(),
    runs: seedRuns(),
    pipelineRuns: new Map(),
    config: structuredClone(BASE_CONFIG),
  };
}

function filterJobs(jobs: readonly JobRecord[], state: string): readonly JobRecord[] {
  if (state === 'all') return jobs;
  return jobs.filter((j) => j.state === state);
}

function isSubsetPatch(patch: unknown): patch is Record<string, unknown> {
  return typeof patch === 'object' && patch !== null && !Array.isArray(patch);
}

function deepMerge(base: Record<string, unknown>, patch: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...base };
  for (const [k, v] of Object.entries(patch)) {
    const existing = out[k];
    if (isSubsetPatch(v) && isSubsetPatch(existing)) {
      out[k] = deepMerge(existing, v);
    } else {
      out[k] = v;
    }
  }
  return out;
}

function sseWrite(replyRaw: NodeJS.WritableStream, event: string, data: unknown): void {
  const payload = typeof data === 'string' ? data : JSON.stringify(data);
  replyRaw.write(`event: ${event}\ndata: ${payload}\n\n`);
}

function transitionRun(run: ActivePipelineRun, status: ActivePipelineRun['status'], result?: unknown): void {
  run.status = status;
  if (result !== undefined) run.result = result;
}

function abortAllRuns(state: AppState): number {
  let count = 0;
  for (const run of state.pipelineRuns.values()) {
    if (run.status === 'running') {
      run.controller.aborted = true;
      count += 1;
    }
  }
  return count;
}

export async function buildFixtureSidecar(state: AppState = createInitialState()): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });

  await app.register(cors, {
    origin: /^(http:\/\/(localhost|127\.0\.0\.1)(:\d+)?|tauri:\/\/localhost)$/,
    credentials: true,
    // The desktop UI issues PATCH on /api/config and POST on every
    // mutation route; @fastify/cors only allows GET/HEAD/POST by
    // default, so the preflight for PATCH would otherwise 204 without
    // `access-control-allow-methods: PATCH` and the browser would
    // block the request.
    methods: ['GET', 'HEAD', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
  });

  app.get('/api/health', async () => ({ schemaVersion: 1, status: 'ok' as const }));

  app.get('/api/paths', async () => ({
    schemaVersion: 1,
    paths: {
      config: '/tmp/jobhunter/config',
      data: '/tmp/jobhunter/data',
      logs: '/tmp/jobhunter/logs',
      diagnostics: '/tmp/jobhunter/diagnostics',
      cache: '/tmp/jobhunter/cache',
      profileSources: '/tmp/jobhunter/profile-sources',
    },
  }));

  app.get('/api/config', async () => ({ schemaVersion: 1, config: state.config }));

  app.patch<{ Body: { patch?: unknown } }>('/api/config', async (req) => {
    const patch = req.body?.patch;
    if (!isSubsetPatch(patch)) {
      throw new Error('config patch must be an object');
    }
    state.config = deepMerge(state.config as Record<string, unknown>, patch);
    return { schemaVersion: 1, config: state.config };
  });

  app.post('/api/config/validate', async () => ({ schemaVersion: 1, valid: true as const }));

  app.get('/api/profile', async () => ({
    schemaVersion: 1,
    profiles: [...state.profiles.values()].sort((a, b) => b.profileVersionId - a.profileVersionId),
  }));

  app.get<{ Params: { id: string } }>('/api/profile/:id', async (req, reply) => {
    const detail = state.profileDetails.get(req.params.id);
    if (detail === undefined) {
      reply.status(404);
      return {
        schemaVersion: 1,
        error: { code: 'profile_not_found', message: `No profile with id ${req.params.id}` },
      };
    }
    return { schemaVersion: 1, ...detail };
  });

  app.post('/api/profile/import', async () => ({
    schemaVersion: 1,
    status: 'imported',
    importedSources: 0,
  }));

  app.post<{ Params: { id: string } }>('/api/profile/:id/approve', async (req, reply) => {
    const profile = state.profiles.get(req.params.id);
    if (profile === undefined) {
      reply.status(404);
      return {
        schemaVersion: 1,
        error: { code: 'profile_not_found', message: `No profile with id ${req.params.id}` },
      };
    }
    if (profile.status !== 'draft') {
      reply.status(409);
      return {
        schemaVersion: 1,
        error: { code: 'invalid_profile_state', message: `Profile is ${profile.status}, not draft` },
      };
    }
    let superseded: number | null = null;
    for (const [k, p] of state.profiles) {
      if (p.active && p.status === 'approved') {
        state.profiles.set(k, { ...p, status: 'superseded', active: false });
        superseded = p.profileVersionId;
      }
    }
    const updated: ProfileVersionRecord = {
      ...profile,
      status: 'approved',
      active: true,
      approvedAt: TIMESTAMP,
      updatedAt: TIMESTAMP,
    };
    state.profiles.set(profile.profileId, updated);
    const detail = state.profileDetails.get(profile.profileId);
    if (detail !== undefined) {
      state.profileDetails.set(profile.profileId, {
        ...detail,
        status: 'approved',
        active: true,
      });
    }
    return {
      schemaVersion: 1,
      approvedProfileVersionId: updated.profileVersionId,
      supersededProfileVersionId: superseded,
      invalidatedFilterResults: 0,
      remainingWarnings: 0,
    };
  });

  app.post<{ Params: { id: string } }>('/api/profile/:id/reject', async (req, reply) => {
    const profile = state.profiles.get(req.params.id);
    if (profile === undefined) {
      reply.status(404);
      return {
        schemaVersion: 1,
        error: { code: 'profile_not_found', message: `No profile with id ${req.params.id}` },
      };
    }
    if (profile.status !== 'draft') {
      reply.status(409);
      return {
        schemaVersion: 1,
        error: { code: 'invalid_profile_state', message: `Profile is ${profile.status}, not draft` },
      };
    }
    const updated: ProfileVersionRecord = {
      ...profile,
      status: 'rejected',
      updatedAt: TIMESTAMP,
    };
    state.profiles.set(profile.profileId, updated);
    const detail = state.profileDetails.get(profile.profileId);
    if (detail !== undefined) {
      state.profileDetails.set(profile.profileId, { ...detail, status: 'rejected' });
    }
    return {
      schemaVersion: 1,
      rejectedProfileVersionId: updated.profileVersionId,
    };
  });

  app.get<{
    Querystring: {
      state?: string;
      limit?: string;
      minScore?: string;
    };
  }>('/api/jobs', async (req) => {
    const requested = req.query.state ?? 'scored';
    const limit = req.query.limit !== undefined ? Number(req.query.limit) : 50;
    const rows = filterJobs(state.jobs, requested).slice(0, Number.isFinite(limit) ? limit : 50);
    return {
      schemaVersion: 1,
      state: requested,
      limit: Number.isFinite(limit) ? limit : 50,
      returned: rows.length,
      jobs: rows,
    };
  });

  app.get<{ Params: { id: string } }>('/api/jobs/:id', async (req, reply) => {
    const job = state.jobs.find((j) => j.id === req.params.id);
    if (job === undefined) {
      reply.status(404);
      return {
        schemaVersion: 1,
        error: { code: 'job_not_found', message: `No job with id ${req.params.id}` },
      };
    }
    return {
      schemaVersion: 1,
      id: job.id,
      internalId: job.internalId,
      sourceJobId: job.sourceJobId,
      linkedinUrl: `https://www.linkedin.com/jobs/view/${job.sourceJobId}`,
      title: job.title,
      company: job.company,
      location: job.location,
      description: null,
      extractionStatus: 'complete',
      successfulMethod: 'search_detail_panel',
      discoveryHistory: [],
      currentFilter: {
        outcome: null,
        fingerprint: null,
        rejectionReasons: [],
        filteredAt: null,
        hasHistory: false,
      },
      currentScore: {
        overallScore: job.overallScore ?? null,
        displayScore: job.displayScore ?? null,
        categoryScores: [],
        explanation: null,
        matches: [],
        gaps: [],
        concerns: [],
        inferredSeniority: null,
        recommendationSummary: null,
        timestamp: null,
        hasHistory: false,
      },
      timestamps: {
        firstDiscoveredAt: job.firstDiscoveredAt,
        lastRediscoveryAt: job.firstDiscoveredAt,
        lastExtractionAttemptAt: job.firstDiscoveredAt,
        createdAt: job.firstDiscoveredAt,
        updatedAt: job.firstDiscoveredAt,
      },
    };
  });

  app.post('/api/jobs/reevaluate', async () => ({
    schemaVersion: 1,
    plan: { reevaluateCount: 0, dryRun: true, status: 'noop' },
  }));

  app.get<{ Querystring: { limit?: string } }>('/api/runs', async (req) => {
    const limit = req.query.limit !== undefined ? Number(req.query.limit) : 20;
    const rows = [...state.runs.values()].slice(0, Number.isFinite(limit) ? limit : 20);
    return {
      schemaVersion: 1,
      limit: Number.isFinite(limit) ? limit : 20,
      returned: rows.length,
      runs: rows,
    };
  });

  app.get<{ Params: { id: string } }>('/api/runs/:id', async (req, reply) => {
    const run = state.runs.get(req.params.id);
    if (run === undefined) {
      reply.status(404);
      return {
        schemaVersion: 1,
        error: { code: 'run_not_found', message: `No run with id ${req.params.id}` },
      };
    }
    return {
      schemaVersion: 1,
      id: run.id,
      internalId: run.internalId,
      status: run.status,
      startTimestamp: run.startTimestamp,
      endTimestamp: run.endTimestamp,
      configuration: { snapshotJson: {}, schemaVersion: 1, hash: 'h', applicationVersion: '0.1.0-fixture' },
      profileVersionId: 1,
      filterConfigVersionId: 1,
      searchExecutions: [],
      jobCounts: { complete: run.jobsDiscovered, partial: 0, failed: 0, total: run.jobsDiscovered },
      filterCounts: { accepted: run.jobsScored, rejected: 0, errors: 0 },
      scoreCounts: { scored: run.jobsScored, reused: 0, errors: 0 },
      reusedResults: { jobsReused: 0 },
      errors: { searchErrors: [], extractionFailures: 0, filterErrors: 0, scoringErrors: 0 },
      cancellationState: { isCancelled: run.status === 'cancelled', reason: null },
      diagnosticReferences: [],
    };
  });

  app.post('/api/pipeline/run', async () => {
    const runId = randomUUID();
    const run: ActivePipelineRun = {
      runId,
      controller: { aborted: false },
      logs: [],
      timer: null,
      status: 'running',
    };
    state.pipelineRuns.set(runId, run);

    // Emit log lines on a short interval so the LogPane renders them
    // before the terminal event. Heartbeats and terminal transitions
    // follow the production sidecar's cadence.
    const tick = (): void => {
      if (run.controller.aborted || run.status !== 'running') return;
      run.logs.push(`[info] pipeline tick ${run.logs.length + 1}`);
    };
    tick();
    setTimeout(tick, LOG_FLUSH_INTERVAL_MS);
    setTimeout(tick, LOG_FLUSH_INTERVAL_MS * 2);

    // Schedule the terminal transition. A 2-second window is enough
    // for the UI to render at least one log line and observe the
    // running status before the done event arrives.
    run.timer = setTimeout(() => {
      if (run.status !== 'running') return;
      const completedAt = TIMESTAMP;
      const finalStatus: RunStatus = run.controller.aborted ? 'cancelled' : 'completed';
      transitionRun(run, run.controller.aborted ? 'cancelled' : 'done', {
        summary: { status: run.controller.aborted ? 'cancelled' : 'completed' },
        runs: [],
      });
      // Persist the run so /runs lists it after invalidation.
      state.runs.set(`run_${run.runId.slice(0, 8)}`, {
        id: `run_${run.runId.slice(0, 8)}`,
        internalId: state.runs.size + 1,
        startTimestamp: TIMESTAMP,
        endTimestamp: completedAt,
        status: finalStatus,
        searchesAttempted: 1,
        jobsDiscovered: 0,
        jobsScored: 0,
        errorSummary: 'none',
      });
      setTimeout(() => state.pipelineRuns.delete(run.runId), PIPELINE_RUN_TTL_MS);
    }, 1_500);

    return { schemaVersion: 1, runId };
  });

  app.post<{ Params: { runId: string } }>('/api/pipeline/:runId/cancel', async (req, reply) => {
    const run = state.pipelineRuns.get(req.params.runId);
    if (run === undefined) {
      reply.status(404);
      return {
        schemaVersion: 1,
        error: { code: 'pipeline_run_not_found', message: `No run with id ${req.params.runId}` },
      };
    }
    run.controller.aborted = true;
    run.status = 'cancelled';
    if (run.timer !== null) clearTimeout(run.timer);
    return { schemaVersion: 1, status: 'cancelling' as const };
  });

  app.get<{ Params: { runId: string } }>('/api/pipeline/:runId/events', async (req, reply: FastifyReply) => {
    const run = state.pipelineRuns.get(req.params.runId);
    if (run === undefined) {
      reply.status(404);
      return {
        schemaVersion: 1,
        error: { code: 'pipeline_run_not_found', message: `No run with id ${req.params.runId}` },
      };
    }
    // SSE bypasses the standard reply pipeline (we call flushHeaders
    // and write directly to reply.raw), so @fastify/cors's onSend
    // hook never runs. Copy the CORS headers manually before the
    // stream starts — otherwise the browser's EventSource fires
    // `error` and the UI's status flips to 'error' instead of
    // 'running'. The origin allowlist mirrors the registration
    // above; we intentionally keep the regex simple so a future
    // permissive fixture doesn't need both sites updated.
    const origin = req.headers['origin'];
    if (typeof origin === 'string' && /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) {
      reply.raw.setHeader('Access-Control-Allow-Origin', origin);
      reply.raw.setHeader('Vary', 'Origin');
      reply.raw.setHeader('Access-Control-Allow-Credentials', 'true');
    }
    reply.raw.setHeader('Content-Type', 'text/event-stream');
    reply.raw.setHeader('Cache-Control', 'no-cache');
    reply.raw.setHeader('Connection', 'keep-alive');
    reply.raw.flushHeaders();
    reply.raw.write(`: connected to ${run.runId}\n\n`);

    const interval = setInterval(() => {
      for (const line of run.logs.splice(0)) {
        sseWrite(reply.raw, 'log', line);
      }
      if (run.status === 'done' || run.status === 'cancelled' || run.status === 'failed') {
        sseWrite(reply.raw, 'done', { status: run.status, result: run.result ?? null });
        clearInterval(interval);
        reply.raw.end();
      } else {
        sseWrite(reply.raw, 'heartbeat', { status: run.status });
      }
    }, 500);

    req.raw.on('close', () => clearInterval(interval));
    return reply;
  });

  return app;
}

async function main(): Promise<void> {
  const portRaw = process.env['FIXTURE_SIDECAR_PORT'];
  const port = portRaw === undefined ? DEFAULT_PORT : Number.parseInt(portRaw, 10);
  const host = '127.0.0.1';

  const state = createInitialState();
  const app = await buildFixtureSidecar(state);

  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    process.stderr.write(`fixture-sidecar: received ${signal}\n`);
    const aborted = abortAllRuns(state);
    if (aborted > 0) process.stderr.write(`fixture-sidecar: cancelled ${aborted} pipeline run(s)\n`);
    await Promise.race([
      app.close(),
      new Promise<'timeout'>((resolve) => setTimeout(() => resolve('timeout'), 5_000)),
    ]).then((result) => {
      if (result === 'timeout') process.exit(1);
      process.exit(0);
    });
  };
  process.on('SIGTERM', () => {
    void shutdown('SIGTERM');
  });
  process.on('SIGINT', () => {
    void shutdown('SIGINT');
  });

  await app.listen({ port, host });
  process.stdout.write(`READY ${port}\n`);
}

const isEntry = import.meta.url === `file://${process.argv[1]}`;
if (isEntry) {
  main().catch((err: unknown) => {
    process.stderr.write(`fixture-sidecar boot failed: ${String(err)}\n`);
    process.exit(1);
  });
}