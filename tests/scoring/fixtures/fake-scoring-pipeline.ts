import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import type {
  OpenAIClient,
  OpenAIExtractionRawResponse,
} from '../../../src/profile/openai/types.js';
import {
  FakeOpenAIClient,
  type FakeOpenAIClientScript,
} from '../../../src/profile/openai/fake-client.js';
import {
  createDatabaseConnection,
  type DatabaseConnection,
} from '../../../src/persistence/connection.js';
import { runMigrations } from '../../../src/persistence/migrations.js';
import {
  createRepositories,
  type Repositories,
} from '../../../src/persistence/repositories/index.js';
import type {
  ScoreBatchInput,
  ScoreOneInput,
  ScoringServiceConfig,
} from '../../../src/scoring/service.js';
import { ScoringService } from '../../../src/scoring/service.js';

const REPO_ROOT = resolve(join(import.meta.dirname, '..', '..', '..'));

/**
 * Public configuration for the fake pipeline.
 */
export interface FakeScoringPipelineOptions {
  /**
   * Initial set of scripts to install on the underlying
   * `FakeOpenAIClient`. The constructor also accepts a single
   * `FakeOpenAIClientScript` (reused for every call) — see the
   * `FakeOpenAIClient` overload. To queue per-call responses, pass
   * an array of scripts; each element is consumed by one `extract`
   * call (the last script sticks for any call beyond the array
   * length, mirroring `FakeOpenAIClient`'s retry-loop fallback).
   */
  readonly fakeScripts: readonly FakeOpenAIClientScript[] | FakeOpenAIClientScript;
  readonly config: ScoringServiceConfig;
  /**
   * Optional clock for deterministic `startedAt` / `completedAt`
   * timestamps. Defaults to a fixed ISO string so the persisted
   * `openai_request_metadata.startTimestamp` is stable across runs.
   */
  readonly now?: () => Date;
}

/**
 * Tracks the peak number of concurrent in-flight `extract` calls the
 * `FakeOpenAIClient` sees. The scoring service fans out
 * `scoreBatch` over a worker pool sized at
 * `min(config.concurrency, jobs.length)`; the tracker exposes both
 * the peak and the running counter so a test can assert the pool is
 * doing what the orchestrator claims (no over-subscription, no
 * serial execution).
 */
export class ConcurrentCallTracker {
  private inFlight = 0;
  private peak = 0;
  private total = 0;

  /** Called by the wrapper around every `extract` call. */
  enter(): { exit: () => void } {
    this.inFlight += 1;
    this.total += 1;
    if (this.inFlight > this.peak) this.peak = this.inFlight;
    return {
      exit: (): void => {
        this.inFlight -= 1;
      },
    };
  }

  /** Peak concurrent in-flight calls observed since the last reset. */
  get maxConcurrent(): number {
    return this.peak;
  }

  /** Total number of `extract` calls observed. */
  get totalCalls(): number {
    return this.total;
  }

  /** Currently in-flight calls (for `assert`-style hooks in tests). */
  get currentInFlight(): number {
    return this.inFlight;
  }

  /** Reset peak + total. The next call re-arms the counters. */
  reset(): void {
    this.peak = 0;
    this.total = 0;
    this.inFlight = 0;
  }
}

/**
 * Deterministic `OpenAIClient` wrapper that records every
 * `extract` request and tracks the peak concurrent in-flight calls.
 * Delegates to the `FakeOpenAIClient` for scripted responses / errors.
 */
class ConcurrencyTrackingOpenAIClient implements OpenAIClient {
  readonly requests: Parameters<OpenAIClient['extract']>[0][] = [];
  private inner: FakeOpenAIClient;

  constructor(
    inner: FakeOpenAIClient,
    private readonly tracker: ConcurrentCallTracker,
  ) {
    this.inner = inner;
  }

  async extract(
    request: Parameters<OpenAIClient['extract']>[0],
  ): ReturnType<OpenAIClient['extract']> {
    this.requests.push(request);
    const guard = this.tracker.enter();
    try {
      return await this.inner.extract(request);
    } finally {
      guard.exit();
    }
  }

  getRequestCount(): number {
    return this.requests.length;
  }

  /**
   * Swap the wrapped `FakeOpenAIClient`. Used by
   * `FakeScoringPipeline.replaceOpenAIScripts(...)` to re-queue
   * scripts mid-test without rebuilding the pipeline.
   */
  replaceInner(next: FakeOpenAIClient): void {
    this.inner = next;
  }
}

const DEFAULT_TIMESTAMP = '2026-09-07T00:00:00.000Z';

const DEFAULT_ACTIVE_FILTER_FINGERPRINT = 'fake-active-filter-fingerprint-1';
const DEFAULT_FILTER_RESULT_FINGERPRINT = DEFAULT_ACTIVE_FILTER_FINGERPRINT;
const DEFAULT_PROFILE_FINGERPRINT = 'profile-fp-1';
const DEFAULT_FILTER_CONTENT_HASH = 'fake-filter-content-hash';
const DEFAULT_PROFILE_CONTENT_HASH = 'fake-profile-content-hash';

/**
 * Hermetic test harness for the scoring service.
 *
 * Owns:
 *   - a temp SQLite database with the full schema migrated in;
 *   - the real `ScoringService` wired against that database and a
 *     `FakeOpenAIClient` wrapped in a concurrency tracker;
 *   - the parent rows (`pipelineRuns`, `searchExecutions`,
 *     `profileVersions`, `filterConfigurationVersions`,
 *     `filterResults`, `jobs`) the service needs to insert the
 *     `scoreResults` + `openaiRequestMetadata` rows;
 *   - a controllable `AbortController` whose signal the test passes
 *     into `scoreOne` / `scoreBatch`.
 *
 * Exposes helpers to:
 *   - build a `ScoreOneInput` / `ScoreBatchInput` against the
 *     pre-inserted parent rows (with overrides for the per-test
 *     scenarios);
 *   - add additional complete jobs to the DB so `scoreBatch` has
 *     more than one candidate to chew through;
 *   - pre-insert an active `scoreResults` row with a given
 *     fingerprint so the reuse path returns `kind: 'reused'`;
 *   - assert worker-pool concurrency via `tracker.maxConcurrent`.
 *
 * Always call `await pipeline.cleanup()` (in `afterEach`/`finally`)
 * to release the temp dir and close the DB connection.
 *
 * Construction is async (the seed rows live behind async repository
 * methods); use `await FakeScoringPipeline.create(options)`.
 */
export class FakeScoringPipeline {
  readonly service: ScoringService;
  readonly repositories: Repositories;
  readonly tmpDir: string;
  readonly connection: DatabaseConnection;
  readonly controller: AbortController;
  readonly tracker: ConcurrentCallTracker;
  fakeOpenAIClient: FakeOpenAIClient;
  /** Wrapper around `fakeOpenAIClient` with concurrent-call tracking. */
  readonly openaiClient: ConcurrencyTrackingOpenAIClient;
  /** Snapshot of the service config, captured at construction time. */
  readonly serviceConfig: ScoringServiceConfig;

  readonly runId: number;
  readonly searchExecutionId: number;
  readonly profileVersionId: number;
  readonly filterConfigVersionId: number;
  readonly filterResultId: number;
  readonly jobId: number;
  readonly activeFilterFingerprint: string;
  readonly filterResultFingerprint: string;

  private readonly now: () => Date;

  private constructor(init: {
    options: FakeScoringPipelineOptions;
    seed: {
      runId: number;
      searchExecutionId: number;
      profileVersionId: number;
      filterConfigVersionId: number;
      filterResultId: number;
      jobId: number;
    };
    tmpDir: string;
    connection: DatabaseConnection;
    repositories: Repositories;
  }) {
    this.tmpDir = init.tmpDir;
    this.connection = init.connection;
    this.repositories = init.repositories;
    this.now = init.options.now ?? ((): Date => new Date(DEFAULT_TIMESTAMP));
    this.controller = new AbortController();
    this.activeFilterFingerprint = DEFAULT_ACTIVE_FILTER_FINGERPRINT;
    this.filterResultFingerprint = DEFAULT_FILTER_RESULT_FINGERPRINT;
    this.serviceConfig = init.options.config;

    this.runId = init.seed.runId;
    this.searchExecutionId = init.seed.searchExecutionId;
    this.profileVersionId = init.seed.profileVersionId;
    this.filterConfigVersionId = init.seed.filterConfigVersionId;
    this.filterResultId = init.seed.filterResultId;
    this.jobId = init.seed.jobId;

    this.tracker = new ConcurrentCallTracker();
    this.fakeOpenAIClient = new FakeOpenAIClient(init.options.fakeScripts);
    this.openaiClient = new ConcurrencyTrackingOpenAIClient(this.fakeOpenAIClient, this.tracker);

    this.service = new ScoringService({
      repositories: this.repositories,
      openaiClient: this.openaiClient,
      config: init.options.config,
      now: this.now,
    });
  }

  /**
   * Build the pipeline + seed every parent row the scoring service
   * needs to satisfy FK constraints when it writes
   * `scoreResults.pipelineRunId` / `jobId` / `filterResultId`.
   *
   * Opens a single SQLite connection, runs migrations, seeds the
   * parent rows, then constructs the service against that same
   * connection (closing + reopening would lose the seeded data).
   */
  static async create(options: FakeScoringPipelineOptions): Promise<FakeScoringPipeline> {
    const tmpDir = mkdtempSync(join(tmpdir(), 'jobhunter-scoring-'));
    const connection = createDatabaseConnection(join(tmpDir, 'test.db'));
    runMigrations(connection, { migrationsFolder: join(REPO_ROOT, 'drizzle') });
    const repositories = createRepositories(connection);
    const now = options.now ?? ((): Date => new Date(DEFAULT_TIMESTAMP));

    const { runId, searchIds } = await repositories.pipelineRuns.createRunWithSearches(
      {
        startTimestamp: now().toISOString(),
        configSnapshotJson: { scoring: { model: options.config.model } },
        configSchemaVersion: 1,
        configHash: 'fake-config-hash',
        applicationVersion: '0.0.0-test',
      },
      [
        {
          pipelineRunId: 0,
          searchQuery: 'software engineer',
          locationName: 'Remote',
          geoId: '000000',
          generatedUrl: 'https://example.com/jobs?q=software+engineer',
          startTimestamp: now().toISOString(),
        },
      ],
    );
    const searchExecutionId = searchIds[0]!;

    const profileVersionId = await repositories.profileVersions.insert({
      status: 'approved',
      schemaVersion: 1,
      contentHash: DEFAULT_PROFILE_CONTENT_HASH,
      extractionFingerprint: 'fake-profile-extraction-fp',
      sourceIds: [1],
      profileJson: { headline: 'Senior Engineer', skills: ['TypeScript'] },
      createdAt: now().toISOString(),
      updatedAt: now().toISOString(),
      active: true,
    });

    const filterConfigVersionId = await repositories.filterConfigurations.insert({
      schemaVersion: 1,
      contentHash: DEFAULT_FILTER_CONTENT_HASH,
      configJson: { excludedCompanies: [] },
      createdAt: now().toISOString(),
      active: true,
    });

    const jobResult = await repositories.jobs.recordNewJob({
      job: {
        sourceJobId: 'linkedin-1',
        extractionStatus: 'complete',
        firstDiscoveryTimestamp: now().toISOString(),
        lastRediscoveryTimestamp: now().toISOString(),
        createdTimestamp: now().toISOString(),
        updatedTimestamp: now().toISOString(),
        title: null,
        company: null,
        location: null,
        description: null,
        successfulMethod: 'search_detail_panel',
      },
      discoveryEvent: {
        jobId: 0,
        pipelineRunId: runId,
        searchExecutionId,
        timestamp: now().toISOString(),
        isNew: true,
        currentExtractionState: 'complete',
        extractionAttempted: true,
        skipReason: null,
      },
    });

    const filterResultId = await repositories.filterResults.activateResult({
      jobId: jobResult.jobId,
      pipelineRunId: runId,
      filterConfigVersionId,
      filterConfigHash: DEFAULT_FILTER_CONTENT_HASH,
      profileVersionId,
      profileHash: DEFAULT_PROFILE_CONTENT_HASH,
      filterImplementationVersion: '1.0.0',
      fingerprint: DEFAULT_FILTER_RESULT_FINGERPRINT,
      timestamp: now().toISOString(),
      overallOutcome: 'accepted',
      rulesEvaluated: [],
      rulesPassed: [],
      rulesFailed: [],
    });

    return new FakeScoringPipeline({
      options,
      seed: {
        runId,
        searchExecutionId,
        profileVersionId,
        filterConfigVersionId,
        filterResultId,
        jobId: jobResult.jobId,
      },
      tmpDir,
      connection,
      repositories,
    });
  }

  /**
   * Insert a complete job (and matching `filterResults` active row)
   * so `scoreBatch` has more than one candidate. Returns the
   * `ScoreOneInput` the test can drop into `scoreBatch.jobs`.
   */
  async insertCompleteJob(
    overrides: {
      readonly sourceJobId?: string;
      readonly normalizedTitle?: string;
      readonly normalizedCompany?: string;
      readonly normalizedLocation?: string;
      readonly normalizedDescription?: string;
    } = {},
  ): Promise<{ readonly jobId: number; readonly scoreOneInput: ScoreOneInput }> {
    const sourceJobId = overrides.sourceJobId ?? `linkedin-${this.nextJobCounter()}`;
    const jobResult = await this.repositories.jobs.recordNewJob({
      job: {
        sourceJobId,
        extractionStatus: 'complete',
        firstDiscoveryTimestamp: this.now().toISOString(),
        lastRediscoveryTimestamp: this.now().toISOString(),
        createdTimestamp: this.now().toISOString(),
        updatedTimestamp: this.now().toISOString(),
        title: overrides.normalizedTitle ?? null,
        company: overrides.normalizedCompany ?? null,
        location: overrides.normalizedLocation ?? null,
        description: overrides.normalizedDescription ?? null,
        successfulMethod: 'search_detail_panel',
      },
      discoveryEvent: {
        jobId: 0,
        pipelineRunId: this.runId,
        searchExecutionId: this.searchExecutionId,
        timestamp: this.now().toISOString(),
        isNew: true,
        currentExtractionState: 'complete',
        extractionAttempted: true,
        skipReason: null,
      },
    });
    await this.repositories.filterResults.activateResult({
      jobId: jobResult.jobId,
      pipelineRunId: this.runId,
      filterConfigVersionId: this.filterConfigVersionId,
      filterConfigHash: DEFAULT_FILTER_CONTENT_HASH,
      profileVersionId: this.profileVersionId,
      profileHash: DEFAULT_PROFILE_CONTENT_HASH,
      filterImplementationVersion: '1.0.0',
      fingerprint: this.activeFilterFingerprint,
      timestamp: this.now().toISOString(),
      overallOutcome: 'accepted',
      rulesEvaluated: [],
      rulesPassed: [],
      rulesFailed: [],
    });
    const jobOverrides: {
      sourceJobId?: string;
      normalizedTitle?: string;
      normalizedCompany?: string;
      normalizedLocation?: string;
      normalizedDescription?: string;
    } = {};
    if (overrides.sourceJobId !== undefined) jobOverrides.sourceJobId = sourceJobId;
    if (overrides.normalizedTitle !== undefined)
      jobOverrides.normalizedTitle = overrides.normalizedTitle;
    if (overrides.normalizedCompany !== undefined)
      jobOverrides.normalizedCompany = overrides.normalizedCompany;
    if (overrides.normalizedLocation !== undefined)
      jobOverrides.normalizedLocation = overrides.normalizedLocation;
    if (overrides.normalizedDescription !== undefined)
      jobOverrides.normalizedDescription = overrides.normalizedDescription;
    const scoreOneInput = this.makeScoreOneInput({
      job: makeDefaultJob(jobResult.jobId, jobOverrides),
    });
    return { jobId: jobResult.jobId, scoreOneInput };
  }

  /** Build a `ScoreOneInput` against the pre-inserted parent rows. */
  makeScoreOneInput(overrides: Partial<ScoreOneInput> = {}): ScoreOneInput {
    const { job, ...rest } = overrides;
    return makeBaseScoreOneInput({
      run: { id: this.runId },
      searchExecution: { id: this.searchExecutionId },
      profileVersionId: this.profileVersionId,
      filterResultId: this.filterResultId,
      activeFilterFingerprint: this.activeFilterFingerprint,
      jobId: this.jobId,
      signal: this.controller.signal,
      ...(job !== undefined ? { job } : {}),
      ...rest,
    });
  }

  /** Build a `ScoreBatchInput` whose `jobs` are the supplied `scoreOne`-shaped inputs. */
  makeScoreBatchInput(
    jobs: readonly ScoreOneInput[],
    signal: AbortSignal = this.controller.signal,
  ): ScoreBatchInput {
    return {
      run: { id: this.runId },
      searchExecution: { id: this.searchExecutionId },
      jobs,
      signal,
    };
  }

  /**
   * Pre-insert an active `scoreResults` row with the given fingerprint
   * so the next `scoreOne` call sees a hit on `findActiveByJob` and
   * short-circuits to `kind: 'reused'` without calling OpenAI.
   * Returns the inserted row's id.
   */
  async preInsertActiveScoreResult(options: {
    readonly jobId?: number;
    readonly fingerprint: string;
    readonly overallScore?: number;
  }): Promise<number> {
    return this.repositories.scoreResults.activateResult({
      jobId: options.jobId ?? this.jobId,
      pipelineRunId: this.runId,
      filterResultId: this.filterResultId,
      fingerprint: options.fingerprint,
      timestamp: this.now().toISOString(),
      promptVersion: 'v1',
      rubricVersion: '1',
      model: this.serviceConfig.model,
      reasoningEffort: this.serviceConfig.reasoningEffort,
      scorerImplementationVersion: '1',
      categoryScores: [],
      overallScore: options.overallScore ?? 80,
      explanation: 'pre-seeded reuse row',
      success: true,
    });
  }

  /**
   * Replace the OpenAI scripts at runtime. Replaces the wrapped
   * `FakeOpenAIClient` with a fresh instance whose `requests` queue
   * starts empty. The wrapper's own `requests` log and concurrent-
   * call tracker are preserved across the swap (so a test can
   * assert the cumulative `extract` count without losing history).
   */
  replaceOpenAIScripts(scripts: readonly FakeOpenAIClientScript[]): void {
    this.fakeOpenAIClient = new FakeOpenAIClient(scripts);
    this.openaiClient.replaceInner(this.fakeOpenAIClient);
  }

  /** Get the recorded `extract` requests (one per call). */
  getRecordedRequests(): readonly Parameters<OpenAIClient['extract']>[0][] {
    return this.openaiClient.requests;
  }

  /** Release the temp directory + close the DB connection. */
  async cleanup(): Promise<void> {
    this.connection.close();
    rmSync(this.tmpDir, { recursive: true, force: true });
  }

  private jobCounter = 2;
  private nextJobCounter(): number {
    const value = this.jobCounter;
    this.jobCounter += 1;
    return value;
  }
}

/**
 * Builders for the per-job fields used by the test inputs.
 */
function makeDefaultJob(
  jobId: number,
  overrides: {
    readonly sourceJobId?: string;
    readonly normalizedTitle?: string;
    readonly normalizedCompany?: string;
    readonly normalizedLocation?: string;
    readonly normalizedDescription?: string;
  } = {},
): ScoreOneInput['job'] {
  return {
    id: jobId,
    sourceJobId: overrides.sourceJobId ?? `linkedin-${jobId}`,
    extractionStatus: 'complete',
    normalizedTitle: overrides.normalizedTitle ?? 'Senior Engineer',
    normalizedCompany: overrides.normalizedCompany ?? 'Acme',
    normalizedLocation: overrides.normalizedLocation ?? 'Remote',
    normalizedDescription: overrides.normalizedDescription ?? 'Build distributed systems.',
    language: 'en',
    workplaceType: 'remote',
    employmentType: 'full_time',
  };
}

function makeBaseScoreOneInput(input: {
  readonly run: { readonly id: number };
  readonly searchExecution: { readonly id: number };
  readonly profileVersionId: number;
  readonly filterResultId: number;
  readonly activeFilterFingerprint: string;
  readonly jobId: number;
  readonly signal: AbortSignal;
  readonly profileFingerprint?: string;
  readonly job?: ScoreOneInput['job'];
}): ScoreOneInput {
  return {
    run: input.run,
    searchExecution: input.searchExecution,
    job: input.job ?? makeDefaultJob(input.jobId),
    profileVersion: {
      id: input.profileVersionId,
      fingerprint: input.profileFingerprint ?? DEFAULT_PROFILE_FINGERPRINT,
      headline: 'Senior Engineer',
      skills: ['TypeScript', 'Python'],
      yearsOfExperience: 7,
      spokenLanguages: ['English'],
      preferredRole: 'Senior IC',
      locationPreference: 'Remote',
      domainExperience: ['Healthcare'],
    },
    effectiveDerivedValues: { location: 'Remote' },
    filterResult: {
      id: input.filterResultId,
      outcome: 'accepted',
      fingerprint: input.activeFilterFingerprint,
    },
    activeFilterFingerprint: input.activeFilterFingerprint,
    signal: input.signal,
  };
}

/**
 * Helper to build a scripted `OpenAIExtractionRawResponse` from a
 * raw JSON string. Mirrors the per-test pattern in
 * `service.test.ts:makeValidResponse`.
 */
export function makeValidResponse(
  rawJsonText: string,
  extra: Partial<OpenAIExtractionRawResponse> = {},
): OpenAIExtractionRawResponse {
  return {
    rawJsonText,
    tokenUsage: { promptTokens: 100, completionTokens: 50 },
    ...extra,
  };
}
