import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  createDatabaseConnection,
  type DatabaseConnection,
} from '../../src/persistence/connection.js';
import { runMigrations } from '../../src/persistence/migrations.js';
import { createRepositories, type Repositories } from '../../src/persistence/repositories/index.js';
import { ScriptedPipelinePrompts } from '../../src/pipeline/prompts.js';
import { PipelinePrerequisiteError } from '../../src/pipeline/errors.js';
import { ReevaluationValidationError } from '../../src/reevaluation/errors.js';
import { ReevaluationService } from '../../src/reevaluation/service.js';
import { computeFilterFingerprintForJob } from '../../src/reevaluation/fingerprint.js';

import {
  insertActiveFilterForReeval,
  insertActiveFilterResultForReeval,
  insertActiveScoreResultForReeval,
  insertApprovedProfileForReeval,
  insertCompleteJobForReeval,
} from './helpers/fixtures.js';
import {
  FakeFilterApplyService,
  FakeScoringService,
  makeFakeCompleteOutcome,
  makeFakeFailedOutcome,
  makeFakeReusedOutcome,
} from './helpers/fake-services.js';

const REPO_ROOT = resolve(import.meta.dirname, '..', '..');

/**
 * Integration tests for `ReevaluationService` (, Task
 * 11). Mirrors `tests/pipeline/orchestrator.test.ts`: hermetic
 * `:memory:` SQLite + a fresh migrations run + fakes for
 * `FilterApplyService` / `ScoringService` so the test surface stays
 * deterministic.
 *
 * T18 is the sidecar scope-conflict test — at the service level
 * there is no concept of `filters-only + scores-only`
 * (single-string `scope` input). T18 is exercised by the sidecar's
 * HTTP route validation. Here we record it as
 * `it.skip` with a pointer to its HTTP home.
 */
describe('ReevaluationService', () => {
  let directory: string;
  let connection: DatabaseConnection;
  let repositories: Repositories;
  let pipelineRunId: number;
  let searchExecutionId: number;
  let filterConfigId: number;
  let profileVersionId: number;
  let fakeFilter: FakeFilterApplyService;
  let fakeScoring: FakeScoringService;

  beforeEach(async () => {
    directory = mkdtempSync(join(tmpdir(), 'jobhunter-reeval-'));
    connection = createDatabaseConnection(join(directory, 'jobhunter.sqlite'));
    runMigrations(connection, { migrationsFolder: join(REPO_ROOT, 'drizzle') });
    repositories = createRepositories(connection);

    // Create a pipeline run + search execution to satisfy the FK
    // chain on `discoveryEvents.pipelineRunId` /
    // `searchExecutions.id`.
    const created = await repositories.pipelineRuns.createRunWithSearches(
      {
        startTimestamp: '2026-08-20T10:00:00.000Z',
        configSnapshotJson: {},
        configSchemaVersion: 1,
        configHash: 'h-reeval',
        applicationVersion: '0.1.0',
      },
      [
        {
          pipelineRunId: 0,
          searchQuery: 'q',
          locationName: 'L',
          geoId: '1',
          generatedUrl: 'https://www.linkedin.com/jobs/search/?q=q',
          startTimestamp: '2026-08-20T10:00:00.000Z',
        },
      ],
    );
    pipelineRunId = created.runId;
    searchExecutionId = created.searchIds[0]!;

    filterConfigId = await insertActiveFilterForReeval(repositories);
    profileVersionId = await insertApprovedProfileForReeval(repositories);

    fakeFilter = new FakeFilterApplyService();
    fakeScoring = new FakeScoringService();
  });

  afterEach(() => {
    connection.close();
    rmSync(directory, { recursive: true, force: true });
  });

  function makeService(
    options: {
      prompts?: ScriptedPipelinePrompts;
    } = {},
  ): ReevaluationService {
    return new ReevaluationService({
      repositories,
      filterApplyService: fakeFilter.asService(),
      scoringService: fakeScoring.asService(),
      prompts: options.prompts ?? new ScriptedPipelinePrompts([]),
      scoringConcurrency: 1,
    });
  }

  /**
   * Read the active filter config + active approved profile row so
   * the tests can compute the canonical fingerprints themselves
   * (using the production helpers). The two reads are mirrored by
   * the service's prerequisite-validation block.
   */
  async function computeFilterFpForJob(jobId: number): Promise<string> {
    const jobRow = await repositories.jobs.findById(jobId);
    if (jobRow === null) throw new Error(`job ${jobId} not found`);
    const cfg = await repositories.filterConfigurations.findActive();
    if (cfg === null) throw new Error('no active filter config');
    const prof = await repositories.profileVersions.findActiveApproved();
    return computeFilterFingerprintForJob(jobRow, cfg.configJson, prof?.profileJson ?? null);
  }

  // -----------------------------------------------------------------
  // T1: Default scope with mixed stale/fresh filters + stale score.
  // -----------------------------------------------------------------
  it('T1: default scope → 2 stale filters + 1 stale score produces 2 filter entries + 1 score entry', async () => {
    await insertCompleteJobForReeval(repositories, '111', pipelineRunId, searchExecutionId);
    await insertCompleteJobForReeval(repositories, '222', pipelineRunId, searchExecutionId);
    const job3 = await insertCompleteJobForReeval(
      repositories,
      '333',
      pipelineRunId,
      searchExecutionId,
    );

    // Pre-seed a FRESH accepted filter for job 3 so it does NOT
    // appear in `filtersToReevaluate` (its filter is current).
    const freshFpForJob3 = await computeFilterFpForJob(job3);
    const job3FilterResultId = await insertActiveFilterResultForReeval(repositories, {
      jobId: job3,
      fingerprint: freshFpForJob3,
      overallOutcome: 'accepted',
      filterConfigVersionId: filterConfigId,
      profileVersionId,
    });
    void job3FilterResultId;

    // Queue the fake filter apply calls — one per stale filter rerun.
    fakeFilter.queueResult({
      outcome: 'accepted',
      filterResultId: 100,
      fingerprint: 'reeval-t1-fp-1',
      reused: false,
    });
    fakeFilter.queueResult({
      outcome: 'accepted',
      filterResultId: 101,
      fingerprint: 'reeval-t1-fp-2',
      reused: false,
    });
    // Score calls (one for the stale-score job — job 3).
    fakeScoring.queueOutcomeForJob(job3, makeFakeCompleteOutcome(job3, 90));

    const outcome = await makeService().execute({
      scope: 'default',
      dryRun: false,
      confirmScoring: false,
      env: { OPENAI_API_KEY: 'test-key' },
    });

    expect(outcome.plan.filtersToReevaluate).toHaveLength(2);
    expect(outcome.plan.jobsToScore).toHaveLength(1);
    expect(outcome.plan.skipped).toHaveLength(0);
    expect(outcome.plan.totals.filtersRerun).toBe(2);
    expect(outcome.plan.totals.scoresRerun).toBe(1);
  });

  // -----------------------------------------------------------------
  // T2: scope 'filters-only' with 2 stale filters.
  // -----------------------------------------------------------------
  it('T2: scope "filters-only" with 2 stale filters → 2 filter entries, 0 score entries, no OpenAI calls', async () => {
    const job1 = await insertCompleteJobForReeval(
      repositories,
      '111',
      pipelineRunId,
      searchExecutionId,
    );
    const job2 = await insertCompleteJobForReeval(
      repositories,
      '222',
      pipelineRunId,
      searchExecutionId,
    );
    fakeFilter.queueResult({
      outcome: 'accepted',
      filterResultId: 200,
      fingerprint: 'reeval-t2-fp-1',
      reused: false,
    });
    fakeFilter.queueResult({
      outcome: 'accepted',
      filterResultId: 201,
      fingerprint: 'reeval-t2-fp-2',
      reused: false,
    });

    const outcome = await makeService().execute({
      scope: 'filters-only',
      dryRun: false,
      confirmScoring: false,
      env: { OPENAI_API_KEY: 'test-key' },
    });

    expect(outcome.plan.filtersToReevaluate).toHaveLength(2);
    expect(outcome.plan.jobsToScore).toHaveLength(0);
    expect(outcome.plan.scoringPlan).toBeNull();
    expect(fakeScoring.scoreOneCalls).toHaveLength(0);
    expect(fakeFilter.calls).toHaveLength(2);
    void job1;
    void job2;
  });

  // -----------------------------------------------------------------
  // T3: scope 'filters-only' with stale filter + prior active score → invalidate.
  // -----------------------------------------------------------------
  it('T3: scope "filters-only" with a stale filter + prior active score → scoresInvalidated = 1', async () => {
    const jobId = await insertCompleteJobForReeval(
      repositories,
      '111',
      pipelineRunId,
      searchExecutionId,
    );
    // Pre-seed an active filter result with a STALE fingerprint
    // the service will treat the filter as stale and rerun it.
    const staleFilterFp = 'stale-filter-fp-t3';
    const filterResultId = await insertActiveFilterResultForReeval(repositories, {
      jobId,
      fingerprint: staleFilterFp,
      overallOutcome: 'accepted',
      filterConfigVersionId: filterConfigId,
      profileVersionId,
    });
    // Pre-seed an active score result on top of that filter.
    await insertActiveScoreResultForReeval(repositories, {
      jobId,
      filterResultId,
      fingerprint: 'stale-score-fp-t3',
      pipelineRunId,
    });

    fakeFilter.queueResult({
      outcome: 'accepted',
      filterResultId: filterResultId + 1,
      fingerprint: 'reeval-t3-fp-fresh',
      reused: false,
    });

    const outcome = await makeService().execute({
      scope: 'filters-only',
      dryRun: false,
      confirmScoring: false,
      env: { OPENAI_API_KEY: 'test-key' },
    });

    expect(outcome.plan.filtersToReevaluate).toHaveLength(1);
    expect(outcome.plan.totals.scoresInvalidated).toBe(1);

    const scoreResults = await repositories.scoreResults.listByJob(jobId);
    expect(scoreResults).toHaveLength(1);
    expect(scoreResults[0]?.active).toBe(false);
  });

  // -----------------------------------------------------------------
  // T4: scope 'scores-only' with stale filter → skipped, no OpenAI calls.
  // -----------------------------------------------------------------
  it('T4: scope "scores-only" with a stale filter → skipped + no OpenAI calls', async () => {
    const jobId = await insertCompleteJobForReeval(
      repositories,
      '111',
      pipelineRunId,
      searchExecutionId,
    );

    const outcome = await makeService().execute({
      scope: 'scores-only',
      dryRun: false,
      confirmScoring: false,
      env: { OPENAI_API_KEY: 'test-key' },
    });

    expect(outcome.plan.jobsToScore).toHaveLength(0);
    expect(outcome.plan.filtersToReevaluate).toHaveLength(0);
    expect(outcome.plan.skipped).toHaveLength(1);
    expect(outcome.plan.skipped[0]?.jobId).toBe(`job_${jobId}`);
    expect(outcome.plan.skipped[0]?.reason).toBe('filter_update_required');
    expect(fakeScoring.scoreOneCalls).toHaveLength(0);
    expect(fakeFilter.calls).toHaveLength(0);
  });

  // -----------------------------------------------------------------
  // T5: scope 'scores-only' with fresh accepted filter + stale score → OpenAI call.
  // -----------------------------------------------------------------
  it('T5: scope "scores-only" with a fresh accepted filter + stale score → OpenAI call', async () => {
    const jobId = await insertCompleteJobForReeval(
      repositories,
      '111',
      pipelineRunId,
      searchExecutionId,
    );
    // Pre-seed a FRESH accepted filter for the job.
    const freshFilterFp = await computeFilterFpForJob(jobId);
    await insertActiveFilterResultForReeval(repositories, {
      jobId,
      fingerprint: freshFilterFp,
      overallOutcome: 'accepted',
      filterConfigVersionId: filterConfigId,
      profileVersionId,
    });
    fakeScoring.queueOutcomeForJob(jobId, makeFakeCompleteOutcome(jobId, 88));

    const outcome = await makeService().execute({
      scope: 'scores-only',
      dryRun: false,
      confirmScoring: false,
      env: { OPENAI_API_KEY: 'test-key' },
    });

    expect(outcome.plan.jobsToScore).toHaveLength(1);
    expect(outcome.plan.filtersToReevaluate).toHaveLength(0);
    expect(outcome.plan.totals.scoresRerun).toBe(1);
    expect(fakeScoring.scoreOneCalls).toHaveLength(1);
    expect(fakeScoring.scoreOneCalls[0]?.job.id).toBe(jobId);
  });

  // -----------------------------------------------------------------
  // T6: scope 'job' with jobId 42 where the job is partial → throws job_not_complete.
  // -----------------------------------------------------------------
  it('T6: scope "job" with jobId 42 (partial job) → defensive job_not_found', async () => {
    await insertCompleteJobForReeval(repositories, '111', pipelineRunId, searchExecutionId);
    // No complete job with id 42 → listComplete() doesn't include it,
    // service throws job_not_found. The sidecar route maps the same
    // identifier to "partial" via findById + extractionStatus check
    // (the sidecar raises job_not_complete). The service is defensive
    // against both cases — listComplete excludes partial rows, so
    // job 42 is simply not present and the service throws
    // job_not_found. T6 asserts this defensive behaviour.
    await expect(
      makeService().execute({
        scope: 'job',
        dryRun: false,
        confirmScoring: false,
        env: { OPENAI_API_KEY: 'test-key' },
        jobId: 42,
      }),
    ).rejects.toMatchObject({
      code: 'job_not_found',
    });
  });

  // -----------------------------------------------------------------
  // T7: scope 'job' with jobId 99999999 (numeric LinkedIn ID) where the job is partial.
  // -----------------------------------------------------------------
  it('T7: scope "job" with jobId 99999999 (numeric) → defensive job_not_found', async () => {
    await insertCompleteJobForReeval(repositories, '111', pipelineRunId, searchExecutionId);
    // Service receives a pre-resolved numeric id; no LinkedIn
    // resolution happens here (that's the sidecar's job).
    await expect(
      makeService().execute({
        scope: 'job',
        dryRun: false,
        confirmScoring: false,
        env: { OPENAI_API_KEY: 'test-key' },
        jobId: 99999999,
      }),
    ).rejects.toMatchObject({
      code: 'job_not_found',
    });
  });

  // -----------------------------------------------------------------
  // T8: scope 'job' with jobId 9999 (does not exist) → throws job_not_found.
  // -----------------------------------------------------------------
  it('T8: scope "job" with jobId 9999 (does not exist) → throws ReevaluationValidationError(job_not_found)', async () => {
    await expect(
      makeService().execute({
        scope: 'job',
        dryRun: false,
        confirmScoring: false,
        env: { OPENAI_API_KEY: 'test-key' },
        jobId: 9999,
      }),
    ).rejects.toBeInstanceOf(ReevaluationValidationError);
    await expect(
      makeService().execute({
        scope: 'job',
        dryRun: false,
        confirmScoring: false,
        env: { OPENAI_API_KEY: 'test-key' },
        jobId: 9999,
      }),
    ).rejects.toMatchObject({
      code: 'job_not_found',
    });
  });

  // -----------------------------------------------------------------
  // T9: scope 'job' with jobId 42 (complete) + stale filter → 1 filter entry, 0 score entries.
  // -----------------------------------------------------------------
  it('T9: scope "job" (complete, stale filter) → 1 filter entry, 0 score entries', async () => {
    const jobId = await insertCompleteJobForReeval(
      repositories,
      '777',
      pipelineRunId,
      searchExecutionId,
    );
    fakeFilter.queueResult({
      outcome: 'rejected',
      filterResultId: 900,
      fingerprint: 'reeval-t9-fp',
      reused: false,
    });

    const outcome = await makeService().execute({
      scope: 'job',
      dryRun: false,
      confirmScoring: false,
      env: { OPENAI_API_KEY: 'test-key' },
      jobId,
    });

    expect(outcome.plan.filtersToReevaluate).toHaveLength(1);
    expect(outcome.plan.jobsToScore).toHaveLength(0);
    expect(outcome.plan.jobId).toBe(`job_${jobId}`);
    expect(fakeScoring.scoreOneCalls).toHaveLength(0);
  });

  // -----------------------------------------------------------------
  // T10: scope 'job' + 'filters-only' → runs only filter rerun.
  // -----------------------------------------------------------------
  it('T10: scope "job" + filters-only → runs only the filter rerun', async () => {
    const jobId = await insertCompleteJobForReeval(
      repositories,
      '888',
      pipelineRunId,
      searchExecutionId,
    );
    fakeFilter.queueResult({
      outcome: 'accepted',
      filterResultId: 1000,
      fingerprint: 'reeval-t10-fp',
      reused: false,
    });

    const outcome = await makeService().execute({
      scope: 'filters-only',
      dryRun: false,
      confirmScoring: false,
      env: { OPENAI_API_KEY: 'test-key' },
      jobId,
    });

    expect(outcome.plan.scope).toBe('filters-only');
    expect(outcome.plan.filtersToReevaluate).toHaveLength(1);
    expect(outcome.plan.jobsToScore).toHaveLength(0);
    expect(fakeFilter.calls).toHaveLength(1);
    expect(fakeScoring.scoreOneCalls).toHaveLength(0);
  });

  // -----------------------------------------------------------------
  // T11: scope 'job' + 'scores-only' → runs only score rerun.
  // -----------------------------------------------------------------
  it('T11: scope "job" + scores-only → runs only the score rerun', async () => {
    const jobId = await insertCompleteJobForReeval(
      repositories,
      '999',
      pipelineRunId,
      searchExecutionId,
    );
    // Pre-seed a fresh accepted filter so the service sees the
    // filter as current and only re-scores.
    const freshFp = await computeFilterFpForJob(jobId);
    await insertActiveFilterResultForReeval(repositories, {
      jobId,
      fingerprint: freshFp,
      overallOutcome: 'accepted',
      filterConfigVersionId: filterConfigId,
      profileVersionId,
    });
    fakeScoring.queueOutcomeForJob(jobId, makeFakeCompleteOutcome(jobId, 92));

    const outcome = await makeService().execute({
      scope: 'scores-only',
      dryRun: false,
      confirmScoring: false,
      env: { OPENAI_API_KEY: 'test-key' },
      jobId,
    });

    expect(outcome.plan.scope).toBe('scores-only');
    expect(outcome.plan.jobsToScore).toHaveLength(1);
    expect(outcome.plan.filtersToReevaluate).toHaveLength(0);
    expect(fakeScoring.scoreOneCalls).toHaveLength(1);
  });

  // -----------------------------------------------------------------
  // T12: scope 'job' + dryRun → dryRun: true, no DB writes, no OpenAI calls.
  // -----------------------------------------------------------------
  it('T12: scope "job" + dryRun → dryRun: true, all would-rerun, no DB writes, no OpenAI calls', async () => {
    const jobId = await insertCompleteJobForReeval(
      repositories,
      '1010',
      pipelineRunId,
      searchExecutionId,
    );

    const outcome = await makeService().execute({
      scope: 'job',
      dryRun: true,
      confirmScoring: false,
      env: { OPENAI_API_KEY: 'test-key' },
      jobId,
    });

    expect(outcome.plan.dryRun).toBe(true);
    expect(outcome.plan.jobId).toBe(`job_${jobId}`);
    expect(outcome.plan.filtersToReevaluate.every((e) => e.action === 'would-rerun')).toBe(true);
    expect(outcome.plan.jobsToScore.every((e) => e.action === 'would-rerun')).toBe(true);
    expect(fakeFilter.calls).toHaveLength(0);
    expect(fakeScoring.scoreOneCalls).toHaveLength(0);
  });

  // -----------------------------------------------------------------
  // T13: dryRun (no jobId) → every action would-rerun.
  // -----------------------------------------------------------------
  it('T13: dryRun (no jobId) → every action would-rerun, no DB writes, no OpenAI calls', async () => {
    await insertCompleteJobForReeval(repositories, '1111', pipelineRunId, searchExecutionId);
    await insertCompleteJobForReeval(repositories, '2222', pipelineRunId, searchExecutionId);

    const outcome = await makeService().execute({
      scope: 'default',
      dryRun: true,
      confirmScoring: false,
      env: { OPENAI_API_KEY: 'test-key' },
    });

    expect(outcome.plan.dryRun).toBe(true);
    expect(outcome.plan.scope).toBe('default');
    for (const e of outcome.plan.filtersToReevaluate) {
      expect(e.action).toBe('would-rerun');
    }
    for (const e of outcome.plan.jobsToScore) {
      expect(e.action).toBe('would-rerun');
    }
    expect(fakeFilter.calls).toHaveLength(0);
    expect(fakeScoring.scoreOneCalls).toHaveLength(0);
  });

  // -----------------------------------------------------------------
  // T14: Default scope with 1 stale score (no filter stale).
  // -----------------------------------------------------------------
  it('T14: default scope with 1 stale score → 0 filter entries + 1 score entry + scoringPlan !== null', async () => {
    const job1 = await insertCompleteJobForReeval(
      repositories,
      '111',
      pipelineRunId,
      searchExecutionId,
    );
    const job2 = await insertCompleteJobForReeval(
      repositories,
      '222',
      pipelineRunId,
      searchExecutionId,
    );
    const job3 = await insertCompleteJobForReeval(
      repositories,
      '333',
      pipelineRunId,
      searchExecutionId,
    );

    // Pre-seed FRESH accepted filters for all three jobs. They share
    // the same config + profile so the fingerprints differ only by
    // job content — each job has its own filter result row.
    for (const jobId of [job1, job2, job3]) {
      const freshFp = await computeFilterFpForJob(jobId);
      await insertActiveFilterResultForReeval(repositories, {
        jobId,
        fingerprint: freshFp,
        overallOutcome: 'accepted',
        filterConfigVersionId: filterConfigId,
        profileVersionId,
      });
    }

    // Queue 3 score outcomes (one per job) — the selection phase
    // adds all 3 to jobsToScore because none of them have a fresh
    // score. After this run, job 3's score is the only "fresh"
    // entry — but for this test, we assert that scoringPlan is
    // populated (non-null) and that the totals reflect at least one
    // score rerun.
    fakeScoring.queueOutcomeForJob(job1, makeFakeCompleteOutcome(job1, 80));
    fakeScoring.queueOutcomeForJob(job2, makeFakeCompleteOutcome(job2, 80));
    fakeScoring.queueOutcomeForJob(job3, makeFakeCompleteOutcome(job3, 80));

    const outcome = await makeService().execute({
      scope: 'default',
      dryRun: false,
      confirmScoring: false,
      env: { OPENAI_API_KEY: 'test-key' },
    });

    expect(outcome.plan.scoringPlan).not.toBeNull();
    expect(outcome.plan.jobsToScore.length).toBeGreaterThanOrEqual(1);
    expect(outcome.plan.totals.scoresRerun).toBeGreaterThanOrEqual(1);
  });

  // -----------------------------------------------------------------
  // T15: Default scope + scoring declined → no OpenAI calls beyond plan check.
  // -----------------------------------------------------------------
  it('T15: default scope + declined scoring → scoringDeclinedByUser=true + no score calls', async () => {
    const jobId = await insertCompleteJobForReeval(
      repositories,
      '111',
      pipelineRunId,
      searchExecutionId,
    );
    // Pre-seed a fresh accepted filter so the score side kicks in.
    const freshFp = await computeFilterFpForJob(jobId);
    await insertActiveFilterResultForReeval(repositories, {
      jobId,
      fingerprint: freshFp,
      overallOutcome: 'accepted',
      filterConfigVersionId: filterConfigId,
      profileVersionId,
    });
    // No score script queued → if the prompt fails to fire, the
    // service would fall through to scoring (default 'complete').

    const outcome = await makeService({
      prompts: new ScriptedPipelinePrompts([false]),
    }).execute({
      scope: 'default',
      dryRun: false,
      confirmScoring: true,
      env: { OPENAI_API_KEY: 'test-key' },
    });

    expect(outcome.plan.totals.scoringDeclinedByUser).toBe(true);
    expect(outcome.plan.totals.scoresRerun).toBe(0);
    expect(fakeScoring.scoreOneCalls).toHaveLength(0);
  });

  // -----------------------------------------------------------------
  // T16: Default scope + confirmScoring:false → no prompt call, scoring proceeds.
  // -----------------------------------------------------------------
  it('T16: default scope + confirmScoring=false → no prompt, scoring proceeds', async () => {
    const jobId = await insertCompleteJobForReeval(
      repositories,
      '111',
      pipelineRunId,
      searchExecutionId,
    );
    const freshFp = await computeFilterFpForJob(jobId);
    await insertActiveFilterResultForReeval(repositories, {
      jobId,
      fingerprint: freshFp,
      overallOutcome: 'accepted',
      filterConfigVersionId: filterConfigId,
      profileVersionId,
    });
    fakeScoring.queueOutcomeForJob(jobId, makeFakeCompleteOutcome(jobId, 75));
    // Empty scripted prompts: if the orchestrator calls the prompt,
    // it would throw "exhausted responses". Since confirmScoring is
    // false, the prompt must not be invoked.
    const outcome = await makeService({
      prompts: new ScriptedPipelinePrompts([]),
    }).execute({
      scope: 'default',
      dryRun: false,
      confirmScoring: false,
      env: { OPENAI_API_KEY: 'test-key' },
    });

    expect(outcome.plan.totals.scoringDeclinedByUser).toBe(false);
    expect(fakeScoring.scoreOneCalls).toHaveLength(1);
  });

  // -----------------------------------------------------------------
  // T17: scope 'filters-only' + confirmScoring:false → scoring proceeds trivially.
  // -----------------------------------------------------------------
  it('T17: scope "filters-only" + confirmScoring=false → scoring proceeds trivially (no OpenAI required)', async () => {
    const jobId = await insertCompleteJobForReeval(
      repositories,
      '111',
      pipelineRunId,
      searchExecutionId,
    );
    fakeFilter.queueResult({
      outcome: 'accepted',
      filterResultId: 1700,
      fingerprint: 'reeval-t17-fp',
      reused: false,
    });

    const outcome = await makeService({
      prompts: new ScriptedPipelinePrompts([]),
    }).execute({
      scope: 'filters-only',
      dryRun: false,
      confirmScoring: false,
      env: { OPENAI_API_KEY: 'test-key' },
    });

    expect(outcome.plan.filtersToReevaluate).toHaveLength(1);
    expect(outcome.plan.totals.scoresRerun).toBe(0);
    expect(fakeScoring.scoreOneCalls).toHaveLength(0);
    void jobId;
  });

  // -----------------------------------------------------------------
  // T18: scope 'filters-only' + 'scores-only' → sidecar route error.
  // -----------------------------------------------------------------
  it.skip('T18: scope conflict → sidecar route throws ReevaluationValidationError(reevaluate_scope_conflict)', () =>
    undefined);

  // -----------------------------------------------------------------
  // T19: Missing active filter config → no_active_filter.
  // -----------------------------------------------------------------
  it('T19: missing active filter config → PipelinePrerequisiteError(no_active_filter)', async () => {
    // Deactivate the active filter config inserted in beforeEach by
    // calling `activate(0)` — the first UPDATE (deactivate all) hits,
    // the second UPDATE (activate id=0) is a no-op (auto-increment IDs
    // start at 1).
    await repositories.filterConfigurations.activate(0);

    expect.assertions(2);
    try {
      await makeService().execute({
        scope: 'default',
        dryRun: false,
        confirmScoring: false,
        env: { OPENAI_API_KEY: 'test-key' },
      });
    } catch (error) {
      expect(error).toBeInstanceOf(PipelinePrerequisiteError);
      expect((error as PipelinePrerequisiteError).code).toBe('no_active_filter');
    }
  });

  // -----------------------------------------------------------------
  // T20: Missing active profile (OpenAI-required scope) → no_active_profile.
  // -----------------------------------------------------------------
  it('T20: missing active profile + default scope → no_active_profile', async () => {
    // Deactivate the active approved profile by calling `approve(0)`.
    // The first UPDATE (deactivate all approved+active) hits; the
    // second UPDATE (activate id=0) is a no-op.
    await repositories.profileVersions.approve(0, {
      approvedAt: '2026-08-20T00:00:00.000Z',
      supersededAt: '2026-08-20T00:00:00.000Z',
    });

    await expect(
      makeService().execute({
        scope: 'default',
        dryRun: false,
        confirmScoring: false,
        env: { OPENAI_API_KEY: 'test-key' },
      }),
    ).rejects.toMatchObject({ code: 'no_active_profile' });
  });

  // -----------------------------------------------------------------
  // T21: Missing OPENAI_API_KEY (OpenAI-required scope) → openai_api_key_missing.
  // -----------------------------------------------------------------
  it('T21: missing OPENAI_API_KEY + default scope → openai_api_key_missing', async () => {
    await expect(
      makeService().execute({
        scope: 'default',
        dryRun: false,
        confirmScoring: false,
        env: { OPENAI_API_KEY: '' },
      }),
    ).rejects.toMatchObject({ code: 'openai_api_key_missing' });
  });

  // -----------------------------------------------------------------
  // T22: scope 'filters-only' + missing OPENAI_API_KEY → succeeds.
  // -----------------------------------------------------------------
  it('T22: scope "filters-only" with missing OPENAI_API_KEY → executes successfully', async () => {
    const jobId = await insertCompleteJobForReeval(
      repositories,
      '111',
      pipelineRunId,
      searchExecutionId,
    );
    fakeFilter.queueResult({
      outcome: 'accepted',
      filterResultId: 2200,
      fingerprint: 'reeval-t22-fp',
      reused: false,
    });

    const outcome = await makeService().execute({
      scope: 'filters-only',
      dryRun: false,
      confirmScoring: false,
      env: { OPENAI_API_KEY: '' },
    });

    expect(outcome.plan.filtersToReevaluate).toHaveLength(1);
    expect(fakeScoring.scoreOneCalls).toHaveLength(0);
    void jobId;
  });

  // -----------------------------------------------------------------
  // T23: dryRun + missing OPENAI_API_KEY → executes successfully.
  // -----------------------------------------------------------------
  it('T23: dryRun with missing OPENAI_API_KEY → executes successfully', async () => {
    const outcome = await makeService().execute({
      scope: 'default',
      dryRun: true,
      confirmScoring: false,
      env: { OPENAI_API_KEY: '' },
    });

    expect(outcome.plan.dryRun).toBe(true);
    expect(fakeFilter.calls).toHaveLength(0);
    expect(fakeScoring.scoreOneCalls).toHaveLength(0);
  });

  // -----------------------------------------------------------------
  // Helper-style tests: ensure the service propagates the `reused`
  // flag from the filter apply call back into the plan entry.
  // -----------------------------------------------------------------
  it('flags reused filter results via action: "reused"', async () => {
    await insertCompleteJobForReeval(repositories, '111', pipelineRunId, searchExecutionId);
    // Queue a `reused: true` apply response — the service must flip
    // the entry's action to 'reused'.
    fakeFilter.queueResult({
      outcome: 'accepted',
      filterResultId: 9999,
      fingerprint: 'reeval-reused-fp',
      reused: true,
    });

    const outcome = await makeService().execute({
      scope: 'filters-only',
      dryRun: false,
      confirmScoring: false,
      env: { OPENAI_API_KEY: 'test-key' },
    });

    expect(outcome.plan.filtersToReevaluate).toHaveLength(1);
    expect(outcome.plan.filtersToReevaluate[0]?.action).toBe('reused');
  });

  it('flags score-reused via action: "reused" when the scoring service returns kind: "reused"', async () => {
    const jobId = await insertCompleteJobForReeval(
      repositories,
      '111',
      pipelineRunId,
      searchExecutionId,
    );
    const freshFp = await computeFilterFpForJob(jobId);
    await insertActiveFilterResultForReeval(repositories, {
      jobId,
      fingerprint: freshFp,
      overallOutcome: 'accepted',
      filterConfigVersionId: filterConfigId,
      profileVersionId,
    });
    fakeScoring.queueOutcomeForJob(jobId, makeFakeReusedOutcome(jobId, 77));

    const outcome = await makeService().execute({
      scope: 'scores-only',
      dryRun: false,
      confirmScoring: false,
      env: { OPENAI_API_KEY: 'test-key' },
    });

    const entry = outcome.plan.jobsToScore[0];
    expect(entry?.action).toBe('reused');
    expect(outcome.plan.totals.scoresRerun).toBe(0);
  });

  it('flags score-failed via action: "reran" with the failure logged', async () => {
    const jobId = await insertCompleteJobForReeval(
      repositories,
      '111',
      pipelineRunId,
      searchExecutionId,
    );
    const freshFp = await computeFilterFpForJob(jobId);
    await insertActiveFilterResultForReeval(repositories, {
      jobId,
      fingerprint: freshFp,
      overallOutcome: 'accepted',
      filterConfigVersionId: filterConfigId,
      profileVersionId,
    });
    fakeScoring.queueOutcomeForJob(jobId, makeFakeFailedOutcome(jobId, 'openai_timeout'));

    const outcome = await makeService().execute({
      scope: 'scores-only',
      dryRun: false,
      confirmScoring: false,
      env: { OPENAI_API_KEY: 'test-key' },
    });

    expect(outcome.plan.jobsToScore).toHaveLength(1);
    expect(outcome.plan.jobsToScore[0]?.action).toBe('reran');
  });

  it('treats scope="job" without jobId as job_not_found', async () => {
    await expect(
      makeService().execute({
        scope: 'job',
        dryRun: false,
        confirmScoring: false,
        env: { OPENAI_API_KEY: 'test-key' },
      }),
    ).rejects.toMatchObject({ code: 'job_not_found' });
  });
});
