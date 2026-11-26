import type { FastifyInstance } from 'fastify';
import { pino, type Logger as PinoLogger } from 'pino';
import { JobsListService, JobsShowService, type JobListState } from '@jobhunter/core/inspection';
import {
  ReevaluationService,
  type ReevaluationExecuteInput,
  type ReevaluationScope,
} from '@jobhunter/core/reevaluation';
import { FilterApplyService } from '@jobhunter/core/filter';
import { ScoringService, pinoScoringLogger } from '@jobhunter/core/scoring';
import {
  createDefaultAiProviderClient,
  type DefaultAiProviderClientRefusalOptions,
  type AiProviderClient,
} from '@jobhunter/core/profile';
import { pinoReevaluationLogger } from '@jobhunter/core/logging';
import { type DatabaseConnection } from '@jobhunter/core/persistence';
import { loadConfig } from '@jobhunter/core/config';
import { resolvePlatformPaths, createDefaultPlatformAdapter } from '@jobhunter/core/platform';
import { openDbHandle, createRepositories } from './db-helper.js';
import { sidecarFileSystem } from './fs-adapter.js';
import {
  resolveAiProviderClientOrNull,
  resolveAiProviderApiKeyForConfig,
} from './ai-provider-resolve.js';

export interface JobsRouteOptions {
  readonly aiProviderClient?: AiProviderClient;
  readonly rootLogger?: PinoLogger;
  readonly refusal?: DefaultAiProviderClientRefusalOptions;
  /** Opens the SQLite handle. */
  readonly jobsDbOpener?: () => Promise<DatabaseConnection>;
}

/**
 * HTTP-body shape for `POST /api/jobs/reevaluate`. The body is a
 * smaller surface than `ReevaluationExecuteInput` — the handler
 * fills in `env` from `process.env` and `confirmScoring` defaults to
 * `false` so HTTP clients cannot force the service to make a single
 * AiProvider scoring batch without explicit opt-in.
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
  // Resolve once per registration. Silent fallback matches the server's
  // own silent fallback for tests that build a server without a logger.
  const rootLogger: PinoLogger = opts.rootLogger ?? pino({ level: 'silent' });
  const openDb = opts.jobsDbOpener ?? openDbHandle;

  app.get<{
    Querystring: {
      state?: JobListState;
      limit?: string;
      minScore?: string;
      company?: string;
      location?: string;
      run?: string;
    };
  }>('/api/jobs', async (req) => {
    const handle = await openDb();
    try {
      const repos = createRepositories(handle);
      const service = new JobsListService(repos);
      const q = req.query;
      const runId =
        q.run !== undefined ? Number.parseInt(q.run.replace(/^run_/, ''), 10) : undefined;
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
    } finally {
      handle.close();
    }
  });

  app.get<{ Params: { id: string } }>('/api/jobs/:id', async (req) => {
    const handle = await openDb();
    try {
      const repos = createRepositories(handle);
      const service = new JobsShowService(repos);
      const payload = await service.show(req.params.id);
      return { schemaVersion: 1, ...payload };
    } finally {
      handle.close();
    }
  });

  app.post<{ Body: ReevaluateBody }>('/api/jobs/reevaluate', async (req) => {
    const paths = resolvePlatformPaths(createDefaultPlatformAdapter());
    const handle = await openDb();
    try {
      const repos = createRepositories(handle);
      const loaded = await loadConfig(paths, sidecarFileSystem);
      const jobScoring = loaded.config.aiProvider.jobScoring;
      const filterApplyService = new FilterApplyService({ repositories: repos });
      const client =
        opts.aiProviderClient ??
        (await resolveAiProviderClientOrNull(opts.refusal)) ??
        createDefaultAiProviderClient({ apiKey: '' });
      const scoringService = new ScoringService({
        repositories: repos,
        aiProviderClient: client,
        logger: pinoScoringLogger(rootLogger),
        config: {
          model: jobScoring.model,
          reasoningEffort: jobScoring.reasoningEffort,
          concurrency: 1,
        },
      });
      const service = new ReevaluationService({
        repositories: repos,
        filterApplyService,
        scoringService,
        prompts: { askScoringConfirmation: async () => req.body.confirmScoring ?? false },
        scoringConcurrency: 1,
        jobScoring,
        logger: pinoReevaluationLogger(rootLogger),
      });
      const input: ReevaluationExecuteInput = {
        scope: req.body.scope,
        dryRun: req.body.dryRun ?? false,
        confirmScoring: req.body.confirmScoring ?? false,
        env: process.env,
        resolveApiKey: () => resolveAiProviderApiKeyForConfig(),
        ...(req.body.jobId !== undefined && req.body.jobId !== null
          ? { jobId: req.body.jobId }
          : {}),
      };
      const outcome = await service.execute(input);
      return { schemaVersion: 1 as const, plan: outcome.plan };
    } finally {
      handle.close();
    }
  });
}
