import { randomUUID } from 'node:crypto';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { pino, type Logger as PinoLogger } from 'pino';
import {
  PipelineOrchestrator,
  assertPipelinePrerequisites,
  type PipelineProgressEvent,
  type PipelineRunResult,
} from '@jobhunter/core/pipeline';
import {
  LinkedInDiscoveryService,
  LinkedInExtractionService,
  createDefaultBrowserSession,
} from '@jobhunter/core/linkedin';
import { FilterApplyService } from '@jobhunter/core/filter';
import { ScoringService, pinoScoringLogger } from '@jobhunter/core/scoring';
import { createDefaultDiagnosticManager } from '@jobhunter/core/diagnostics';
import { type DefaultOpenAIClientRefusalOptions, type OpenAIClient } from '@jobhunter/core/profile';
import { loadConfig, resolveOpenAiApiKey } from '@jobhunter/core/config';
import { ApplicationError } from '@jobhunter/core/errors';
import { type DatabaseConnection } from '@jobhunter/core/persistence';
import { getSecretsBackend } from '../secrets-backend.js';
import { resolvePlatformPaths, createDefaultPlatformAdapter } from '@jobhunter/core/platform';
import { pinoPipelineLogger } from '@jobhunter/core/pipeline';
import { openDbHandle, createRepositories } from './db-helper.js';
import { sidecarFileSystem } from './fs-adapter.js';
import { initSseHeaders, writeSseEvent, closeSse } from '../sse.js';
import { resolveOpenAiClientOrNull } from './openai-resolve.js';

export interface ActiveRun {
  readonly runId: string;
  readonly controller: AbortController;
  /** Recent log lines emitted by the orchestrator (ring buffer, max 1000). */
  logs: string[];
  /** Recent progress/confirmation events (ring buffer, max 500). */
  events: RunEvent[];
  status: 'running' | 'cancelled' | 'done' | 'failed';
  result?: PipelineRunResult;
  /** Why a run failed; carried by the terminal SSE `done` event. */
  error?: { readonly code: string; readonly message: string };
  /** Set while the run waits for a scoring confirmation decision. */
  pendingConfirmation: ScoringDecisionHandle | null;
}

/** Decision handle parked on a run while scoring awaits confirmation. */
export interface ScoringDecisionHandle {
  resolve(accepted: boolean): void;
}

type RunEvent =
  | PipelineProgressEvent
  | {
      readonly type: 'confirmation_required';
      readonly runId: string;
      readonly jobsDiscovered: number;
      readonly newOpenAIRequests: number;
    };

const activeRuns = new Map<string, ActiveRun>();
const LOG_RING_BUFFER_MAX = 1000;
const EVENTS_RING_BUFFER_MAX = 500;

/** How long a run waits for a scoring decision before auto-declining. */
export const CONFIRMATION_TIMEOUT_MS = 300_000;

/**
 * Cancel all currently running pipelines. Called by main() during graceful
 * shutdown to ensure no orchestrator is left mid-flight when the server closes.
 */
export function abortAllActiveRuns(): number {
  let count = 0;
  for (const run of activeRuns.values()) {
    if (run.status === 'running') {
      run.controller.abort();
      count += 1;
    }
  }
  return count;
}

/**
 * Normalize a thrown value from a background run into the payload the
 * terminal SSE `done` event carries. `ApplicationError`s keep their
 * code (the UI routes known codes to remediation guidance); anything
 * else becomes `pipeline_failed`.
 */
export function runErrorFrom(err: unknown): { code: string; message: string } {
  if (err instanceof ApplicationError) {
    return { code: err.code, message: err.message };
  }
  const message = err instanceof Error ? err.message : String(err);
  return { code: 'pipeline_failed', message };
}

/**
 * Gate an OpenAI scoring batch behind a user decision: push a
 * `confirmation_required` event onto the run's SSE buffer, park the
 * decision handle on the run (resolved by the scoring-decision route,
 * the cancel route, or the timeout — whichever fires first), and
 * return the decision.
 */
export function beginScoringConfirmation(
  run: ActiveRun,
  plan: { jobsDiscovered: number; newOpenAIRequests: number },
): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    run.events.push({
      type: 'confirmation_required',
      runId: run.runId,
      jobsDiscovered: plan.jobsDiscovered,
      newOpenAIRequests: plan.newOpenAIRequests,
    });
    if (run.events.length > EVENTS_RING_BUFFER_MAX) run.events.shift();
    const timer = setTimeout(() => {
      run.pendingConfirmation = null;
      resolve(false);
    }, CONFIRMATION_TIMEOUT_MS);
    run.pendingConfirmation = {
      resolve: (accepted: boolean): void => {
        clearTimeout(timer);
        run.pendingConfirmation = null;
        resolve(accepted);
      },
    };
  });
}

export interface PipelineRouteOptions {
  readonly openaiClient?: OpenAIClient;
  readonly rootLogger?: PinoLogger;
  readonly refusal?: DefaultOpenAIClientRefusalOptions;
  /** Opens the SQLite handle for run preflight and execution. */
  readonly dbOpener?: () => Promise<DatabaseConnection>;
}

export async function registerPipelineRoutes(
  app: FastifyInstance,
  opts: PipelineRouteOptions = {},
): Promise<void> {
  // Resolve once per registration. Silent fallback matches the server's
  // own silent fallback for tests that build a server without a logger.
  const rootLogger: PinoLogger = opts.rootLogger ?? pino({ level: 'silent' });
  const openDb = opts.dbOpener ?? openDbHandle;

  app.get('/api/pipeline/prerequisites', async () => {
    const client = opts.openaiClient ?? (await resolveOpenAiClientOrNull(opts.refusal));
    const handle = await openDb();
    try {
      const repositories = createRepositories(handle);
      const [activeProfile, activeFilter] = await Promise.all([
        repositories.profileVersions.findActiveApproved(),
        repositories.filterConfigurations.findActive(),
      ]);
      const loaded = await loadConfig(
        resolvePlatformPaths(createDefaultPlatformAdapter()),
        sidecarFileSystem,
      );
      return {
        schemaVersion: 1,
        openaiKeyConfigured: client !== null,
        activeProfile:
          activeProfile === null
            ? null
            : { id: activeProfile.id, contentHash: activeProfile.contentHash },
        activeFilter:
          activeFilter === null
            ? null
            : { id: activeFilter.id, contentHash: activeFilter.contentHash },
        configHash: loaded.hash,
      };
    } finally {
      handle.close();
    }
  });

  app.get('/api/pipeline/active', async () => {
    let running: ActiveRun | undefined;
    let latest: ActiveRun | undefined;
    for (const run of activeRuns.values()) {
      latest = run;
      if (run.status === 'running' && running === undefined) running = run;
    }
    const selected = running ?? latest;
    return {
      schemaVersion: 1,
      runId: selected?.runId ?? null,
      status: selected?.status ?? null,
    };
  });

  app.post('/api/pipeline/run', async (_req, reply) => {
    const body = _req.body as { requireScoringConfirmation?: boolean } | undefined;
    // Gate defaults off until the pipeline page ships the confirmation
    // dialog; the redesign flips the default to on.
    const requireConfirmation = body?.requireScoringConfirmation === true;
    const client = opts.openaiClient ?? (await resolveOpenAiClientOrNull(opts.refusal));
    if (client === null) {
      reply.status(503);
      return {
        schemaVersion: 1,
        error: { code: 'openai_unavailable', message: 'No OpenAI API key is configured' },
      };
    }

    // Preflight the persisted prerequisites synchronously so a blocked
    // run fails fast with an actionable envelope instead of a 202
    // followed by a silent background failure. The orchestrator
    // re-checks between preflight and execution.
    const handle = await openDb();
    try {
      await assertPipelinePrerequisites(createRepositories(handle));
    } catch (err) {
      if (!(err instanceof ApplicationError)) throw err;
      reply.status(409);
      return {
        schemaVersion: 1,
        error: { code: err.code, message: err.message },
      };
    } finally {
      handle.close();
    }

    const runId = randomUUID();
    const controller = new AbortController();
    activeRuns.set(runId, {
      runId,
      controller,
      logs: [],
      events: [],
      status: 'running',
      pendingConfirmation: null,
    });

    void runPipeline(runId, controller, client, rootLogger, openDb, requireConfirmation);
    reply.status(202);
    return { schemaVersion: 1, runId };
  });

  app.post<{ Params: { runId: string } }>('/api/pipeline/:runId/cancel', async (req, reply) => {
    const run = activeRuns.get(req.params.runId);
    if (run === undefined) {
      reply.status(404);
      return {
        schemaVersion: 1,
        error: { code: 'pipeline_run_not_found', message: 'Run not found' },
      };
    }
    run.controller.abort();
    run.status = 'cancelled';
    run.pendingConfirmation?.resolve(false);
    return { schemaVersion: 1, status: 'cancelling' };
  });

  app.post<{ Params: { runId: string } }>(
    '/api/pipeline/:runId/scoring-decision',
    async (req, reply) => {
      const run = activeRuns.get(req.params.runId);
      if (run === undefined) {
        reply.status(404);
        return {
          schemaVersion: 1,
          error: { code: 'pipeline_run_not_found', message: 'Run not found' },
        };
      }
      if (run.pendingConfirmation === null) {
        reply.status(409);
        return {
          schemaVersion: 1,
          error: {
            code: 'no_pending_confirmation',
            message: 'The run is not waiting for a scoring decision',
          },
        };
      }
      const body = req.body as { accepted?: unknown } | undefined;
      if (body === undefined || typeof body.accepted !== 'boolean') {
        reply.status(400);
        return {
          schemaVersion: 1,
          error: { code: 'invalid_body', message: 'Body must be { accepted: boolean }' },
        };
      }
      run.pendingConfirmation.resolve(body.accepted);
      return { schemaVersion: 1, status: 'decided', accepted: body.accepted };
    },
  );

  app.get<{ Params: { runId: string } }>(
    '/api/pipeline/:runId/events',
    async (req, reply: FastifyReply) => {
      const run = activeRuns.get(req.params.runId);
      if (run === undefined) {
        reply.status(404);
        return {
          schemaVersion: 1,
          error: { code: 'pipeline_run_not_found', message: 'Run not found' },
        };
      }
      const origin = req.headers.origin;
      initSseHeaders(reply.raw, typeof origin === 'string' ? origin : undefined);
      reply.raw.write(`: connected to ${run.runId}\n\n`);

      const interval = setInterval(() => {
        // Drain any buffered logs first so tail logs from terminal transition
        // are forwarded before the `done` event.
        for (const line of run.logs.splice(0)) {
          writeSseEvent(reply.raw, 'log', line);
        }
        for (const event of run.events.splice(0)) {
          writeSseEvent(reply.raw, 'progress', event);
        }
        if (run.status === 'done' || run.status === 'failed' || run.status === 'cancelled') {
          writeSseEvent(reply.raw, 'done', {
            status: run.status,
            result: run.result ?? null,
            error: run.error ?? null,
          });
          clearInterval(interval);
          closeSse(reply.raw);
          activeRuns.delete(run.runId);
        } else {
          writeSseEvent(reply.raw, 'heartbeat', { status: run.status });
        }
      }, 1000);

      req.raw.on('close', () => clearInterval(interval));
      return reply;
    },
  );
}

async function runPipeline(
  runId: string,
  controller: AbortController,
  openaiClient: OpenAIClient,
  rootLogger: PinoLogger,
  openDb: () => Promise<DatabaseConnection>,
  requireConfirmation: boolean,
): Promise<void> {
  const run = activeRuns.get(runId);
  if (run === undefined) return;

  try {
    const paths = resolvePlatformPaths(createDefaultPlatformAdapter());
    const handle = await openDb();
    try {
      const repositories = createRepositories(handle);
      const loaded = await loadConfig(paths, sidecarFileSystem);
      const browserSession = createDefaultBrowserSession({
        navigationMs: loaded.config.scraper.timeouts.navigationMs,
        initialResultsMs: loaded.config.scraper.timeouts.initialResultsMs,
        overlayDismissalMs: loaded.config.scraper.timeouts.overlayDismissalMs,
      });
      const diagnosticManager = createDefaultDiagnosticManager({
        config: loaded.config.diagnostics.onScraperError,
        paths,
        repositories,
      });
      const discoveryService = new LinkedInDiscoveryService({
        repositories,
        browserSession,
        diagnosticManager,
        config: {
          navigationMs: loaded.config.scraper.timeouts.navigationMs,
          initialResultsMs: loaded.config.scraper.timeouts.initialResultsMs,
          overlayDismissalMs: loaded.config.scraper.timeouts.overlayDismissalMs,
          maxNoProgressAttempts: loaded.config.scraper.maxNoProgressAttempts,
          maxIterations: 5,
        },
      });
      const extractionService = new LinkedInExtractionService({
        repositories,
        browserSession,
        diagnosticManager,
        config: {
          navigationMs: loaded.config.scraper.timeouts.navigationMs,
          detailPanelMs: loaded.config.scraper.timeouts.detailPanelMs,
          dedicatedPageMs: loaded.config.scraper.timeouts.dedicatedPageMs,
          overlayDismissalMs: loaded.config.scraper.timeouts.overlayDismissalMs,
        },
      });
      const filterApplyService = new FilterApplyService({ repositories });
      const scoringService = new ScoringService({
        repositories,
        openaiClient,
        logger: pinoScoringLogger(makeTeeLogger(rootLogger, run)),
        config: {
          model: loaded.config.openai.jobScoring.model,
          reasoningEffort: loaded.config.openai.jobScoring.reasoningEffort,
          concurrency: loaded.config.openai.jobScoring.concurrency,
        },
      });
      const orchestrator = new PipelineOrchestrator({
        repositories,
        browserSession,
        discoveryService,
        extractionService,
        filterApplyService,
        scoringService,
        diagnosticManager,
        config: { rawConfig: loaded.config, hash: loaded.hash, schemaVersion: 1 },
        prompts: {
          askScoringConfirmation: requireConfirmation
            ? ({ plan }) => beginScoringConfirmation(run, plan)
            : async () => true,
        },
        confirmScoring: !requireConfirmation,
        env: process.env,
        resolveApiKey: async () => {
          return resolveOpenAiApiKey({
            store: (await getSecretsBackend()).store,
            env: process.env,
          });
        },
        applicationVersion: '0.1.0-desktop',
        logger: pinoPipelineLogger(makeTeeLogger(rootLogger, run)),
        cancelSignal: controller.signal,
        onEvent: (event) => {
          run.events.push(event);
          if (run.events.length > EVENTS_RING_BUFFER_MAX) run.events.shift();
        },
      });
      const result = await orchestrator.run({});
      run.result = result;
      run.status = result.summary.status === 'cancelled' ? 'cancelled' : 'done';

      // Schedule cleanup. The map entry is removed once any SSE consumer
      // has had a chance to read the terminal result (or immediately if no
      // consumer ever connects). 60-second TTL is sufficient for the desktop
      // UI to reconnect on transient SSE drops without losing the result.
      setTimeout(() => {
        activeRuns.delete(runId);
      }, 60_000);
    } finally {
      handle.close();
    }
  } catch (err) {
    process.stderr.write(`pipeline run ${runId} failed: ${String(err)}\n`);
    run.status = 'failed';
    run.error = runErrorFrom(err);
  }
}

/**
 * Wrap a base logger so every emitted line is also appended to the run's
 * SSE ring buffer (capped at {@link LOG_RING_BUFFER_MAX} entries).
 *
 * Each captured line is prefixed with `[<level>]` so the frontend's LogPane
 * can render levels alongside the message text. The base logger's behavior
 * (pino's structured output, plus the sidecar's silent-fallback in tests)
 * is preserved.
 */
function makeTeeLogger(base: PinoLogger, run: ActiveRun): PinoLogger {
  const tee =
    (level: 'info' | 'warn' | 'error' | 'fatal') =>
    (obj: unknown, msg?: string): void => {
      base[level](obj, msg);
      const payload = msg ?? (typeof obj === 'string' ? obj : JSON.stringify(obj));
      run.logs.push(`[${level}] ${payload}`);
      if (run.logs.length > LOG_RING_BUFFER_MAX) run.logs.shift();
    };
  return {
    info: tee('info'),
    warn: tee('warn'),
    error: tee('error'),
    debug: () => undefined,
    trace: () => undefined,
    fatal: tee('fatal'),
  } as unknown as import('pino').Logger;
}
