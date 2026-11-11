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
  pinoLinkedInExtractionLogger,
  pinoLinkedInScraperLogger,
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
  /** Count of log lines evicted by the ring cap — keeps replay cursors absolute. */
  droppedLogs: number;
  /** Recent progress/confirmation events (ring buffer, max 500). */
  events: RunEvent[];
  /** Count of events evicted by the ring cap — keeps replay cursors absolute. */
  droppedEvents: number;
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

/**
 * Push onto a run's ring buffer without destroying history for
 * reconnecting clients: the buffers are retained until the run entry
 * is reaped (see the SSE route + the post-run TTL) so a client that
 * reconnects mid-run — the user navigating away and back — replays
 * everything it missed. The dropped-counters keep per-connection
 * cursors absolute when the cap evicts the oldest entries.
 */
function pushLog(run: ActiveRun, line: string): void {
  run.logs.push(line);
  if (run.logs.length > LOG_RING_BUFFER_MAX) {
    run.logs.shift();
    run.droppedLogs += 1;
  }
}

function pushEvent(run: ActiveRun, event: RunEvent): void {
  run.events.push(event);
  if (run.events.length > EVENTS_RING_BUFFER_MAX) {
    run.events.shift();
    run.droppedEvents += 1;
  }
}

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
    pushEvent(run, {
      type: 'confirmation_required',
      runId: run.runId,
      jobsDiscovered: plan.jobsDiscovered,
      newOpenAIRequests: plan.newOpenAIRequests,
    });
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
    // The cost gate defaults on; pass requireScoringConfirmation: false
    // to run unattended.
    const requireConfirmation = body?.requireScoringConfirmation !== false;
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
      droppedLogs: 0,
      events: [],
      droppedEvents: 0,
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

      // Per-connection replay cursors (absolute indices). A fresh
      // connection starts at the oldest retained entry, so a client
      // reconnecting mid-run — the user navigating away and back —
      // replays the full history before streaming live frames.
      let sentLogs = run.droppedLogs;
      let sentEvents = run.droppedEvents;

      let interval: ReturnType<typeof setInterval> | undefined;
      const flush = (): void => {
        // Send only the entries this connection has not sent yet; the
        // buffers themselves are retained (never spliced) so a later
        // connection can still replay them.
        const logStart = sentLogs - run.droppedLogs;
        for (const line of run.logs.slice(logStart)) {
          writeSseEvent(reply.raw, 'log', line);
        }
        sentLogs = run.droppedLogs + run.logs.length;

        const eventStart = sentEvents - run.droppedEvents;
        for (const event of run.events.slice(eventStart)) {
          writeSseEvent(reply.raw, 'progress', event);
        }
        sentEvents = run.droppedEvents + run.events.length;

        if (run.status === 'done' || run.status === 'failed' || run.status === 'cancelled') {
          writeSseEvent(reply.raw, 'done', {
            status: run.status,
            result: run.result ?? null,
            error: run.error ?? null,
          });
          if (interval !== undefined) {
            clearInterval(interval);
            interval = undefined;
          }
          closeSse(reply.raw);
          // Reap after the reconnect window rather than immediately:
          // a client connecting (or reconnecting) within the TTL still
          // gets the full replay + terminal frame. Idempotent when
          // several consumers schedule the same reap.
          setTimeout(() => {
            activeRuns.delete(run.runId);
          }, 60_000);
        } else {
          writeSseEvent(reply.raw, 'heartbeat', { status: run.status });
        }
      };

      // Flush on connect so an entering page paints the real run state
      // in the first chunk — otherwise it flashes the empty 'matrix
      // running' view for up to one interval tick.
      flush();
      interval = setInterval(flush, 1000);

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
        logger: pinoLinkedInScraperLogger(makeTeeLogger(rootLogger, run)),
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
        logger: pinoLinkedInExtractionLogger(makeTeeLogger(rootLogger, run)),
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
          pushEvent(run, event);
        },
      });
      const result = await orchestrator.run({});
      run.result = result;
      // The cancel route may have marked the run cancelled while the
      // orchestrator was finishing (e.g. at the scoring gate); don't
      // let the summary's status overwrite that.
      if (run.status !== 'cancelled') {
        run.status = result.summary.status === 'cancelled' ? 'cancelled' : 'done';
      }

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
      pushLog(run, `[${level}] ${payload}`);
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
