import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import {
  createDatabaseConnection,
  type DatabaseConnection,
} from '../../../../src/persistence/connection.js';
import { runMigrations } from '../../../../src/persistence/migrations.js';
import {
  createRepositories,
  Repositories,
} from '../../../../src/persistence/repositories/index.js';

const REPO_ROOT = resolve(join(import.meta.dirname, '..', '..', '..', '..'));
const MIGRATIONS_FOLDER = join(REPO_ROOT, 'drizzle');

/**
 * Hermetic test harness for the inspection service-layer tests
 * (TASK-016 Wave D, Task 14, SPEC §31).
 *
 * Mirrors the patterns from `tests/helpers/run-harness.ts` (the
 * orchestrator-level harness) and `tests/scoring/helpers/fake-scoring-pipeline.ts`
 * (the scoring-service harness). The inspection services are
 * read-only — they don't need a fake browser session, a fake
 * OpenAI client, or a configured orchestrator. Only the SQLite
 * connection + `Repositories` facade are required.
 *
 * - Uses `:memory:` SQLite per test (via a temporary file path so
 *   the connection owns its lifecycle + cleanup is symmetric with
 *   `mkdtempSync`).
 * - `cleanup()` MUST be called in `afterEach` to release the temp
 *   directory + close the connection.
 *
 * The test fixtures live inline in each service test file; the
 * harness only owns the wiring.
 */
export interface InspectionHarness {
  readonly repositories: Repositories;
  readonly connection: DatabaseConnection;
  cleanup(): void;
}

export function buildInspectionHarness(): InspectionHarness {
  const tmpDir = mkdtempSync(join(tmpdir(), 'jobhunter-inspection-'));
  const connection = createDatabaseConnection(join(tmpDir, 'jobhunter.sqlite'));
  runMigrations(connection, { migrationsFolder: MIGRATIONS_FOLDER });
  const repositories = createRepositories(connection);
  return {
    repositories,
    connection,
    cleanup: () => {
      connection.close();
      rmSync(tmpDir, { force: true, recursive: true });
    },
  };
}

/**
 * Canonical ISO 8601 timestamp used across every fixture. Centralised
 * so every test reads the same value when asserting against
 * `firstDiscoveredAt` / `lastRediscoveryTimestamp` / etc.
 */
export const FIXTURE_TS = '2026-08-20T10:00:00.000Z';

/**
 * Insert a profile version (approved + active) + a filter config
 * (active). These are the foreign-key parents every downstream
 * `jobs` / `filterResults` / `scoreResults` row references.
 */
export async function seedProfileAndFilter(repositories: Repositories): Promise<{
  profileVersionId: number;
  filterConfigVersionId: number;
}> {
  const profileVersionId = await repositories.profileVersions.insert({
    status: 'draft',
    schemaVersion: 1,
    contentHash: 'profile-content-hash',
    extractionFingerprint: 'profile-extraction-fp',
    sourceIds: [1],
    profileJson: { headline: 'Engineer' },
    createdAt: FIXTURE_TS,
    updatedAt: FIXTURE_TS,
    active: false,
  });
  await repositories.profileVersions.approve(profileVersionId, {
    approvedAt: FIXTURE_TS,
    supersededAt: FIXTURE_TS,
  });
  const filterConfigVersionId = await repositories.filterConfigurations.insert({
    schemaVersion: 1,
    contentHash: 'filter-content-hash',
    configJson: { excludedCompanies: [] },
    createdAt: FIXTURE_TS,
    active: true,
  });
  return { profileVersionId, filterConfigVersionId };
}

/**
 * Insert one pipeline run + the requested number of search executions.
 * Returns the run id + the per-search ids (parallel to the input
 * array).
 */
export async function seedPipelineRun(
  repositories: Repositories,
  options: {
    readonly searches: readonly {
      readonly searchQuery: string;
      readonly locationName: string;
      readonly geoId: string;
    }[];
    readonly profileVersionId?: number | null;
    readonly filterConfigVersionId?: number | null;
    readonly startTimestamp?: string;
    readonly endTimestamp?: string | null;
    readonly status?:
      'running' | 'cancelling' | 'completed' | 'completed_with_errors' | 'failed' | 'cancelled';
  },
): Promise<{ runId: number; searchIds: readonly number[] }> {
  const start = options.startTimestamp ?? FIXTURE_TS;
  const { runId, searchIds } = await repositories.pipelineRuns.createRunWithSearches(
    {
      startTimestamp: start,
      configSnapshotJson: {},
      configSchemaVersion: 1,
      configHash: 'cfg-hash',
      applicationVersion: '0.1.0',
      ...(options.profileVersionId !== undefined
        ? { profileVersionId: options.profileVersionId }
        : {}),
      ...(options.filterConfigVersionId !== undefined
        ? { filterConfigVersionId: options.filterConfigVersionId }
        : {}),
    },
    options.searches.map((s) => ({
      pipelineRunId: 0, // filled in by the repo
      searchQuery: s.searchQuery,
      locationName: s.locationName,
      geoId: s.geoId,
      generatedUrl: `https://www.linkedin.com/jobs/search?q=${encodeURIComponent(s.searchQuery)}&geoId=${s.geoId}`,
      startTimestamp: start,
    })),
  );
  if (options.endTimestamp !== undefined || options.status !== undefined) {
    const patch: Record<string, unknown> = {};
    if (options.endTimestamp !== undefined) patch['endTimestamp'] = options.endTimestamp;
    if (options.status !== undefined) patch['status'] = options.status;
    await repositories.pipelineRuns.finalizeRunStats(runId, patch);
  }
  return { runId, searchIds };
}

/**
 * Insert one job row + its associated `discovery_events` row. Both
 * rows must be inserted together (the FK constraint blocks the
 * `discovery_events` row without a matching `jobs.id`).
 *
 * When `extractionAttempt` is supplied, the helper also inserts the
 * matching `extraction_attempts` row (so the partial-job mapper's
 * `missingFields` / `errorCode` projection has a source row).
 */
export async function seedJob(
  repositories: Repositories,
  options: {
    readonly sourceJobId: string;
    readonly runId: number;
    readonly searchId: number;
    readonly extractionStatus: 'complete' | 'partial' | 'failed';
    readonly title?: string | null;
    readonly company?: string | null;
    readonly location?: string | null;
    readonly description?: string | null;
    readonly successfulMethod?: 'search_detail_panel' | 'dedicated_job_page' | null;
    readonly firstDiscoveryTimestamp?: string;
    readonly lastRediscoveryTimestamp?: string;
    readonly extractionAttempt?: {
      readonly method: 'search_detail_panel' | 'dedicated_job_page';
      readonly success: boolean;
      readonly errorCode?: string | null;
      readonly errorMessage?: string | null;
    };
  },
): Promise<{ jobId: number; discoveryEventId: number; extractionAttemptId: number | undefined }> {
  const ts = options.firstDiscoveryTimestamp ?? FIXTURE_TS;
  const result = await repositories.jobs.recordNewJob({
    job: {
      sourceJobId: options.sourceJobId,
      extractionStatus: options.extractionStatus,
      firstDiscoveryTimestamp: ts,
      lastRediscoveryTimestamp: options.lastRediscoveryTimestamp ?? ts,
      title: options.title ?? null,
      company: options.company ?? null,
      location: options.location ?? null,
      description: options.description ?? null,
      successfulMethod: options.successfulMethod ?? null,
      createdTimestamp: ts,
      updatedTimestamp: ts,
    },
    discoveryEvent: {
      jobId: 0, // filled in by the repo
      pipelineRunId: options.runId,
      searchExecutionId: options.searchId,
      timestamp: ts,
      isNew: true,
      currentExtractionState: options.extractionStatus,
      extractionAttempted: true,
      skipReason: null,
    },
    ...(options.extractionAttempt !== undefined
      ? {
          extractionAttempt: {
            jobId: 0, // filled in by the repo
            pipelineRunId: options.runId,
            searchExecutionId: options.searchId,
            attemptTimestamp: ts,
            method: options.extractionAttempt.method,
            attemptNumber: 1,
            success: options.extractionAttempt.success,
            errorCode: options.extractionAttempt.errorCode ?? null,
            errorMessage: options.extractionAttempt.errorMessage ?? null,
          },
        }
      : {}),
  });
  return {
    jobId: result.jobId,
    discoveryEventId: result.discoveryEventId,
    extractionAttemptId: result.extractionAttemptId,
  };
}

/**
 * Insert an active `filter_results` row for the supplied job.
 * Returns the new row's id.
 */
export async function seedFilterResult(
  repositories: Repositories,
  options: {
    readonly jobId: number;
    readonly runId: number;
    readonly filterConfigVersionId: number;
    readonly outcome: 'accepted' | 'rejected' | 'error';
    readonly rejectionReasons?: readonly string[];
    readonly fingerprint?: string;
    readonly profileVersionId?: number | null;
  },
): Promise<number> {
  return repositories.filterResults.activateResult({
    jobId: options.jobId,
    pipelineRunId: options.runId,
    filterConfigVersionId: options.filterConfigVersionId,
    filterConfigHash: 'filter-content-hash',
    profileVersionId: options.profileVersionId ?? null,
    profileHash: 'profile-content-hash',
    filterImplementationVersion: 'filter-impl-1',
    fingerprint: options.fingerprint ?? `fp-${options.jobId}`,
    timestamp: FIXTURE_TS,
    overallOutcome: options.outcome,
    rulesEvaluated: ['rule-1'],
    rulesPassed: options.outcome === 'accepted' ? ['rule-1'] : [],
    rulesFailed: options.outcome === 'accepted' ? [] : ['rule-1'],
    rejectionReasons: options.rejectionReasons ?? null,
  });
}

/**
 * Insert an active `score_results` row for the supplied job.
 * Returns the new row's id.
 */
export async function seedScoreResult(
  repositories: Repositories,
  options: {
    readonly jobId: number;
    readonly runId: number;
    readonly filterResultId?: number | null;
    readonly overallScore: number;
    readonly success?: boolean;
    readonly errorCode?: string | null;
    readonly explanation?: string | null;
    readonly inferredSeniority?: string | null;
    readonly recommendationSummary?: string | null;
    readonly fingerprint?: string;
  },
): Promise<number> {
  return repositories.scoreResults.activateResult({
    jobId: options.jobId,
    pipelineRunId: options.runId,
    filterResultId: options.filterResultId ?? null,
    fingerprint: options.fingerprint ?? `score-fp-${options.jobId}`,
    timestamp: FIXTURE_TS,
    promptVersion: 'prompt-v1',
    rubricVersion: 'rubric-v1',
    model: 'gpt-5.6-sol',
    reasoningEffort: 'medium',
    scorerImplementationVersion: 'scorer-impl-1',
    categoryScores: [{ category: 'technicalSkills', score: 80, explanation: 'Strong match' }],
    overallScore: options.overallScore,
    explanation: options.explanation ?? 'Good overall match.',
    inferredSeniority: options.inferredSeniority ?? 'senior',
    recommendationSummary: options.recommendationSummary ?? 'Recommend',
    success: options.success ?? true,
    errorCode: options.errorCode ?? null,
  });
}
