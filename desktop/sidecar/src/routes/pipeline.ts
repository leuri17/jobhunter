import { randomUUID } from 'node:crypto';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { PipelineOrchestrator, type PipelineRunResult } from '@jobhunter/core/pipeline';
import {
  LinkedInDiscoveryService,
  LinkedInExtractionService,
  createDefaultBrowserSession,
} from '@jobhunter/core/linkedin';
import { FilterApplyService } from '@jobhunter/core/filter';
import { ScoringService } from '@jobhunter/core/scoring';
import { createDefaultDiagnosticManager } from '@jobhunter/core/diagnostics';
import { type OpenAIClient } from '@jobhunter/core/profile';
import { loadConfig } from '@jobhunter/core/config';
import { resolvePlatformPaths, createDefaultPlatformAdapter } from '@jobhunter/core/platform';
import { pinoPipelineLogger } from '@jobhunter/core/pipeline';
import { openDbHandle, createRepositories } from './db-helper.js';
import { sidecarFileSystem } from './fs-adapter.js';
import { initSseHeaders, writeSseEvent, closeSse } from '../sse.js';
import { resolveOpenAiClientOrNull } from './openai-resolve.js';

interface ActiveRun {
  readonly runId: string;
  readonly controller: AbortController;
  /** Recent log lines emitted by the orchestrator (ring buffer, max 1000). */
  logs: string[];
  status: 'running' | 'cancelled' | 'done' | 'failed';
  result?: PipelineRunResult;
}

const activeRuns = new Map<string, ActiveRun>();
const LOG_RING_BUFFER_MAX = 1000;

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

export interface PipelineRouteOptions {
  readonly openaiClient?: OpenAIClient;
  readonly rootLogger?: import('pino').Logger;
}

export async function registerPipelineRoutes(
  app: FastifyInstance,
  opts: PipelineRouteOptions = {},
): Promise<void> {
  app.post('/api/pipeline/run', async (_req, reply) => {
    const client = opts.openaiClient ?? resolveOpenAiClientOrNull();
    if (client === null) {
      reply.status(503);
      return {
        schemaVersion: 1,
        error: { code: 'openai_unavailable', message: 'OPENAI_API_KEY is required' },
      };
    }

    const runId = randomUUID();
    const controller = new AbortController();
    activeRuns.set(runId, { runId, controller, logs: [], status: 'running' });

    void runPipeline(runId, controller, client, opts.rootLogger);
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
    return { schemaVersion: 1, status: 'cancelling' };
  });

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
      initSseHeaders(reply.raw);
      reply.raw.write(`: connected to ${run.runId}\n\n`);

      const interval = setInterval(() => {
        // Drain any buffered logs first so tail logs from terminal transition
        // are forwarded before the `done` event.
        for (const line of run.logs.splice(0)) {
          writeSseEvent(reply.raw, 'log', line);
        }
        if (run.status === 'done' || run.status === 'failed' || run.status === 'cancelled') {
          writeSseEvent(reply.raw, 'done', { status: run.status, result: run.result ?? null });
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
  rootLogger?: import('pino').Logger,
): Promise<void> {
  const run = activeRuns.get(runId);
  if (run === undefined) return;

  try {
    const paths = resolvePlatformPaths(createDefaultPlatformAdapter());
    const handle = await openDbHandle();
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
        prompts: { askScoringConfirmation: async () => true },
        confirmScoring: true,
        env: process.env,
        applicationVersion: '0.1.0-desktop',
        logger: pinoPipelineLogger(makeTeeLogger(rootLogger ?? consoleLogger(), run)),
        cancelSignal: controller.signal,
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
  }
}

function consoleLogger(): import('pino').Logger {
  return {
    info: (obj: unknown, msg?: string) =>
      process.stderr.write(`[info] ${msg ?? ''} ${JSON.stringify(obj)}\n`),
    warn: (obj: unknown, msg?: string) =>
      process.stderr.write(`[warn] ${msg ?? ''} ${JSON.stringify(obj)}\n`),
    error: (obj: unknown, msg?: string) =>
      process.stderr.write(`[error] ${msg ?? ''} ${JSON.stringify(obj)}\n`),
    debug: () => undefined,
    trace: () => undefined,
    fatal: (obj: unknown, msg?: string) =>
      process.stderr.write(`[fatal] ${msg ?? ''} ${JSON.stringify(obj)}\n`),
  } as unknown as import('pino').Logger;
}

/**
 * Wrap a base logger so every emitted line is also appended to the run's
 * SSE ring buffer (capped at {@link LOG_RING_BUFFER_MAX} entries).
 *
 * Each captured line is prefixed with `[<level>]` so the frontend's LogPane
 * can render levels alongside the message text. The original stderr behavior
 * of {@link consoleLogger} (and pino's stdout behavior) is preserved.
 */
function makeTeeLogger(base: import('pino').Logger, run: ActiveRun): import('pino').Logger {
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
