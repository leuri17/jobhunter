import type { FastifyInstance } from 'fastify';
import { JobsListService, JobsShowService, type JobListState } from '@jobhunter/core/inspection';
import {
  ReevaluationService,
  type ReevaluationExecuteInput,
  type ReevaluationScope,
} from '@jobhunter/core/reevaluation';
import { FilterApplyService } from '@jobhunter/core/filter';
import { ScoringService } from '@jobhunter/core/scoring';
import { createDefaultOpenAIClient, type OpenAIClient } from '@jobhunter/core/profile';
import { pinoReevaluationLogger } from '@jobhunter/core/logging';
import { openDbHandle, createRepositories } from './db-helper.js';
import { resolveOpenAiClientOrNull } from './openai-resolve.js';

export interface JobsRouteOptions {
  readonly openaiClient?: OpenAIClient;
  readonly rootLogger?: import('pino').Logger;
}

/**
 * HTTP-body shape for `POST /api/jobs/reevaluate`. The body is a
 * smaller surface than `ReevaluationExecuteInput` — the handler
 * fills in `env` from `process.env` and `confirmScoring` defaults to
 * `false` so HTTP clients cannot force the service to make a single
 * OpenAI scoring batch without explicit opt-in.
 *
 * The brief assumed `ReevaluationInput` was exported from
 * `@jobhunter/core/reevaluation`; the actual exported type is
 * `ReevaluationExecuteInput` (different field set — see
 * `src/reevaluation/state.ts`). The brief also flagged barrel gaps
 * as legitimate deviations.
 */
interface ReevaluateBody {
  readonly scope: ReevaluationScope;
  readonly jobId?: number | null;
  readonly dryRun?: boolean;
  readonly confirmScoring?: boolean;
}

export async function registerJobsRoutes(
  app: FastifyInstance,
  opts: JobsRouteOptions = {},
): Promise<void> {
  app.get<{
    Querystring: {
      state?: JobListState;
      limit?: string; minScore?: string; company?: string; location?: string; run?: string;
    };
  }>('/api/jobs', async (req) => {
    const handle = await openDbHandle();
    try {
      const repos = createRepositories(handle);
      const service = new JobsListService(repos);
      const q = req.query;
      const runId = q.run !== undefined ? Number.parseInt(q.run.replace(/^run_/, ''), 10) : undefined;
      const result = await service.list({
        state: q.state ?? 'scored',
        ...(q.limit !== undefined ? { limit: Number(q.limit) } : {}),
        ...(q.minScore !== undefined ? { minScore: Number(q.minScore) } : {}),
        ...(q.company !== undefined && q.company.length > 0 ? { company: q.company } : {}),
        ...(q.location !== undefined && q.location.length > 0 ? { location: q.location } : {}),
        ...(runId !== undefined && Number.isFinite(runId) ? { runId } : {}),
      });
      return {
        schemaVersion: 1,
        state: result.state,
        limit: result.limit,
        returned: result.returned,
        jobs: result.rows,
      };
    } finally { handle.close(); }
  });

  app.get<{ Params: { id: string } }>('/api/jobs/:id', async (req) => {
    const handle = await openDbHandle();
    try {
      const repos = createRepositories(handle);
      const service = new JobsShowService(repos);
      const payload = await service.show(req.params.id);
      return { schemaVersion: 1, ...payload };
    } finally { handle.close(); }
  });

  app.post<{ Body: ReevaluateBody }>('/api/jobs/reevaluate', async (req) => {
    const handle = await openDbHandle();
    try {
      const repos = createRepositories(handle);
      const filterApplyService = new FilterApplyService({ repositories: repos });
      const client = opts.openaiClient ?? resolveOpenAiClientOrNull() ?? createDefaultOpenAIClient({ apiKey: '' });
      const scoringService = new ScoringService({
        repositories: repos,
        openaiClient: client,
        config: { model: process.env['OPENAI_MODEL'] ?? 'gpt-5', reasoningEffort: 'medium', concurrency: 1 },
      });
      const service = new ReevaluationService({
        repositories: repos,
        filterApplyService,
        scoringService,
        prompts: { askScoringConfirmation: async () => req.body.confirmScoring ?? false },
        scoringConcurrency: 1,
        logger: pinoReevaluationLogger(opts.rootLogger ?? consoleLogger()),
      });
      const input: ReevaluationExecuteInput = {
        scope: req.body.scope,
        dryRun: req.body.dryRun ?? false,
        confirmScoring: req.body.confirmScoring ?? false,
        env: process.env,
        ...(req.body.jobId !== undefined && req.body.jobId !== null ? { jobId: req.body.jobId } : {}),
      };
      const outcome = await service.execute(input);
      return { schemaVersion: 1 as const, plan: outcome.plan };
    } finally { handle.close(); }
  });
}

function consoleLogger(): import('pino').Logger {
  return {
    info: (obj: unknown, msg?: string) => process.stderr.write(`[info] ${msg ?? ''} ${JSON.stringify(obj)}\n`),
    warn: (obj: unknown, msg?: string) => process.stderr.write(`[warn] ${msg ?? ''} ${JSON.stringify(obj)}\n`),
    error: (obj: unknown, msg?: string) => process.stderr.write(`[error] ${msg ?? ''} ${JSON.stringify(obj)}\n`),
    debug: () => undefined,
    trace: () => undefined,
    fatal: (obj: unknown, msg?: string) => process.stderr.write(`[fatal] ${msg ?? ''} ${JSON.stringify(obj)}\n`),
  } as unknown as import('pino').Logger;
}
