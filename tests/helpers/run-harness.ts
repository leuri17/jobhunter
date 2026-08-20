import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { runMigrations } from '../../src/persistence/migrations.js';
import {
  createDatabaseConnection,
  type DatabaseConnection,
} from '../../src/persistence/connection.js';
import { createRepositories, Repositories } from '../../src/persistence/repositories/index.js';
import { DEFAULT_OPERATIONAL_CONFIG } from '../../src/config/schema.js';
import { FakeBrowserSession } from '../../src/linkedin/fake-session.js';
import { LinkedInDiscoveryService } from '../../src/linkedin/discovery-service.js';
import { LinkedInExtractionService } from '../../src/linkedin/extraction/service.js';
import { FilterApplyService } from '../../src/filter/service.js';
import { ScoringService } from '../../src/scoring/service.js';
import { DiagnosticManager } from '../../src/diagnostics/manager.js';
import {
  FakeOpenAIClient,
  type FakeOpenAIClientScript,
} from '../../src/profile/openai/fake-client.js';
import type { OpenAIClient } from '../../src/profile/openai/types.js';
import type { OpenAIExtractionRawResponse } from '../../src/profile/openai/types.js';
import { PipelineOrchestrator } from '../../src/pipeline/orchestrator.js';
import { ScriptedPipelinePrompts } from '../../src/pipeline/prompts.js';
import { noopPipelineLogger, type PipelineLogger } from '../../src/pipeline/log.js';

const REPO_ROOT = resolve(import.meta.dirname, '..', '..');
const MIGRATIONS_FOLDER = join(REPO_ROOT, 'drizzle');

export interface RunHarnessOptions {
  readonly config?: typeof DEFAULT_OPERATIONAL_CONFIG;
  readonly prompts?: ScriptedPipelinePrompts;
  readonly confirmScoring?: boolean;
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly applicationVersion?: string;
  readonly now?: () => Date;
  readonly fakeResponses?: readonly OpenAIExtractionRawResponse[];
  readonly fakeScripts?: readonly FakeOpenAIClientScript[];
  readonly logger?: PipelineLogger;
  readonly openAIClient?: OpenAIClient;
}

export interface RunHarness {
  readonly repositories: Repositories;
  readonly connection: DatabaseConnection;
  readonly browserSession: FakeBrowserSession;
  readonly openAIClient: OpenAIClient;
  readonly scoringService: ScoringService;
  readonly filterApplyService: FilterApplyService;
  readonly discoveryService: LinkedInDiscoveryService;
  readonly extractionService: LinkedInExtractionService;
  readonly diagnosticManager: DiagnosticManager;
  readonly orchestrator: PipelineOrchestrator;
  readonly workspaceRoot: string;
  cleanup(): void;
}

export function buildRunHarness(options: RunHarnessOptions = {}): RunHarness {
  const workspace = mkdtempSync(join(tmpdir(), 'jobhunter-run-'));
  const dataDir = join(workspace, 'data');
  mkdirSync(dataDir, { recursive: true });
  const config = options.config ?? DEFAULT_OPERATIONAL_CONFIG;
  const connection = createDatabaseConnection(':memory:');
  const migrationReport = runMigrations(connection, { migrationsFolder: MIGRATIONS_FOLDER });
  void migrationReport;
  const repositories = createRepositories(connection);

  const browserSession = new FakeBrowserSession();
  const openAIClient: OpenAIClient = (() => {
    if (options.openAIClient !== undefined) return options.openAIClient;
    if (options.fakeScripts !== undefined) return new FakeOpenAIClient(options.fakeScripts);
    if (options.fakeResponses !== undefined) {
      return new FakeOpenAIClient({ responses: options.fakeResponses });
    }
    return new FakeOpenAIClient({ responses: [] });
  })();
  const diagnosticManager = new DiagnosticManager({
    config: {
      screenshot: false,
      currentUrl: true,
      stackTrace: true,
      playwrightTrace: false,
      htmlSnapshot: false,
    },
    paths: {
      diagnostics: {
        directory: join(workspace, 'diagnostics'),
        file: (name: string) => join(workspace, 'diagnostics', name),
      },
    },
    repositories,
  });

  // Note: `ScoringService` does NOT accept a `diagnosticManager` —
  // the scoring pipeline persists its own diagnostic metadata via
  // `openaiMetadata`. The scorer logs go through the
  // `ScoringLogger` seam, not the run-level `DiagnosticManager`.
  const scoringService = new ScoringService({
    repositories,
    openaiClient: openAIClient,
    config: {
      model: config.openai.jobScoring.model,
      reasoningEffort: config.openai.jobScoring.reasoningEffort,
      concurrency: config.openai.jobScoring.concurrency,
    },
  });

  const filterApplyService = new FilterApplyService({ repositories });

  const discoveryService = new LinkedInDiscoveryService({
    repositories,
    browserSession,
    diagnosticManager,
    config: {
      navigationMs: config.scraper.timeouts.navigationMs,
      initialResultsMs: config.scraper.timeouts.initialResultsMs,
      overlayDismissalMs: config.scraper.timeouts.overlayDismissalMs,
      maxNoProgressAttempts: config.scraper.maxNoProgressAttempts,
      maxIterations: 5,
    },
  });

  const extractionService = new LinkedInExtractionService({
    repositories,
    browserSession,
    diagnosticManager,
    config: {
      navigationMs: config.scraper.timeouts.navigationMs,
      detailPanelMs: config.scraper.timeouts.detailPanelMs,
      dedicatedPageMs: config.scraper.timeouts.dedicatedPageMs,
      overlayDismissalMs: config.scraper.timeouts.overlayDismissalMs,
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
    config: {
      rawConfig: config,
      hash: 'hash-for-test',
      schemaVersion: 1,
    },
    prompts: options.prompts ?? new ScriptedPipelinePrompts([true]),
    confirmScoring: options.confirmScoring ?? true,
    env: options.env ?? { OPENAI_API_KEY: 'test-key' },
    applicationVersion: options.applicationVersion ?? '0.1.0',
    ...(options.now !== undefined ? { now: options.now } : {}),
    logger: options.logger ?? noopPipelineLogger(),
  });

  return {
    repositories,
    connection,
    browserSession,
    openAIClient,
    scoringService,
    filterApplyService,
    discoveryService,
    extractionService,
    diagnosticManager,
    orchestrator,
    workspaceRoot: workspace,
    cleanup: () => {
      connection.close();
      rmSync(workspace, { force: true, recursive: true });
    },
  };
}