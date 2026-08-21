import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runMigrations } from '../../../src/persistence/migrations.js';
import {
  createDatabaseConnection,
  type DatabaseConnection,
} from '../../../src/persistence/connection.js';
import { PipelineRunRepository } from '../../../src/persistence/repositories/pipeline-runs.js';
import { JobRepository } from '../../../src/persistence/repositories/jobs.js';
import { ScoreResultRepository } from '../../../src/persistence/repositories/score-results.js';

const REPO_ROOT = resolve(import.meta.dirname, '..', '..', '..');

function ctxFrom(c: DatabaseConnection) {
  return { db: c.db };
}

describe('ScoreResultRepository', () => {
  let directory: string;
  let connection: DatabaseConnection;
  let runRepo: PipelineRunRepository;
  let jobRepo: JobRepository;
  let resultRepo: ScoreResultRepository;
  let runId: number;
  let searchId: number;
  let jobId1: number;
  let jobId2: number;
  let jobId3: number;

  async function createJob(sourceJobId: string): Promise<number> {
    const { jobId } = await jobRepo.recordNewJob({
      job: {
        sourceJobId,
        extractionStatus: 'complete',
        firstDiscoveryTimestamp: '2026-08-05T10:00:00.000Z',
        lastRediscoveryTimestamp: '2026-08-05T10:00:00.000Z',
        createdTimestamp: '2026-08-05T10:00:00.000Z',
        updatedTimestamp: '2026-08-05T10:00:00.000Z',
      },
      discoveryEvent: {
        jobId: 0,
        pipelineRunId: runId,
        searchExecutionId: searchId,
        timestamp: '2026-08-05T10:00:00.000Z',
        isNew: true,
        currentExtractionState: 'complete',
        extractionAttempted: true,
        skipReason: null,
      },
    });
    return jobId;
  }

  beforeEach(async () => {
    directory = mkdtempSync(join(tmpdir(), 'jobhunter-score-results-'));
    connection = createDatabaseConnection(join(directory, 'jobhunter.sqlite'));
    runMigrations(connection, { migrationsFolder: join(REPO_ROOT, 'drizzle') });
    runRepo = new PipelineRunRepository(ctxFrom(connection));
    jobRepo = new JobRepository(ctxFrom(connection));
    resultRepo = new ScoreResultRepository(ctxFrom(connection));
    const { runId: rid, searchIds } = await runRepo.createRunWithSearches(
      {
        startTimestamp: '2026-08-05T10:00:00.000Z',
        configSnapshotJson: {},
        configSchemaVersion: 1,
        configHash: 'h',
        applicationVersion: '0.1.0',
      },
      [
        {
          pipelineRunId: 0,
          searchQuery: 'q',
          locationName: 'L',
          geoId: '1',
          generatedUrl: 'https://www.linkedin.com/jobs/search/?q=q',
          startTimestamp: '2026-08-05T10:00:00.000Z',
        },
      ],
    );
    runId = rid;
    searchId = searchIds[0]!;
    jobId1 = await createJob('111');
    jobId2 = await createJob('222');
    jobId3 = await createJob('333');
  });

  afterEach(() => {
    connection.close();
    rmSync(directory, { recursive: true, force: true });
  });

  it('activateResult atomically replaces the previous active row for a job', async () => {
    const first = await resultRepo.activateResult({
      jobId: jobId1,
      pipelineRunId: runId,
      fingerprint: 'fp-A',
      timestamp: '2026-08-05T10:00:00.000Z',
      promptVersion: 'p1',
      rubricVersion: 'r1',
      model: 'gpt-5.6-sol',
      reasoningEffort: 'medium',
      scorerImplementationVersion: 'scorer-1',
      categoryScores: [{ name: 'skills', value: 0.8 }],
      overallScore: 0.8,
      success: true,
    });
    const second = await resultRepo.activateResult({
      jobId: jobId1,
      pipelineRunId: runId,
      fingerprint: 'fp-B',
      timestamp: '2026-08-05T11:00:00.000Z',
      promptVersion: 'p1',
      rubricVersion: 'r1',
      model: 'gpt-5.6-sol',
      reasoningEffort: 'medium',
      scorerImplementationVersion: 'scorer-2',
      categoryScores: [{ name: 'skills', value: 0.9 }],
      overallScore: 0.9,
      success: true,
    });
    expect(second).toBeGreaterThan(first);

    const active = (await resultRepo.listByJob(jobId1)).find((r) => r.active);
    expect(active?.id).toBe(second);
    expect(active?.overallScore).toBe(0.9);
  });

  it('findActiveByJob returns the active row only when the fingerprint matches', async () => {
    await resultRepo.activateResult({
      jobId: jobId1,
      pipelineRunId: runId,
      fingerprint: 'fp-A',
      timestamp: '2026-08-05T10:00:00.000Z',
      promptVersion: 'p1',
      rubricVersion: 'r1',
      model: 'gpt-5.6-sol',
      reasoningEffort: 'medium',
      scorerImplementationVersion: 'scorer-1',
      categoryScores: [],
      overallScore: 0.5,
      success: true,
    });
    expect((await resultRepo.findActiveByJob(jobId1, 'fp-A'))?.fingerprint).toBe('fp-A');
    expect(await resultRepo.findActiveByJob(jobId1, 'fp-OLD')).toBeNull();
  });

  it('topByRun returns rows ordered by overallScore descending', async () => {
    for (const [jobId, score] of [
      [jobId1, 0.5],
      [jobId2, 0.9],
      [jobId3, 0.7],
    ] as const) {
      await resultRepo.activateResult({
        jobId,
        pipelineRunId: runId,
        fingerprint: `fp-${jobId}`,
        timestamp: '2026-08-05T10:00:00.000Z',
        promptVersion: 'p1',
        rubricVersion: 'r1',
        model: 'gpt-5.6-sol',
        reasoningEffort: 'medium',
        scorerImplementationVersion: 'scorer-1',
        categoryScores: [],
        overallScore: score,
        success: true,
      });
    }
    const top = await resultRepo.topByRun(runId, 2);
    expect(top.map((r) => r.overallScore)).toEqual([0.9, 0.7]);
  });

  it('preserves history (stale rows are not deleted)', async () => {
    await resultRepo.activateResult({
      jobId: jobId1,
      pipelineRunId: runId,
      fingerprint: 'fp-A',
      timestamp: '2026-08-05T10:00:00.000Z',
      promptVersion: 'p1',
      rubricVersion: 'r1',
      model: 'gpt-5.6-sol',
      reasoningEffort: 'medium',
      scorerImplementationVersion: 'scorer-1',
      categoryScores: [],
      overallScore: 0.5,
      success: true,
    });
    await resultRepo.activateResult({
      jobId: jobId1,
      pipelineRunId: runId,
      fingerprint: 'fp-B',
      timestamp: '2026-08-05T11:00:00.000Z',
      promptVersion: 'p1',
      rubricVersion: 'r1',
      model: 'gpt-5.6-sol',
      reasoningEffort: 'medium',
      scorerImplementationVersion: 'scorer-1',
      categoryScores: [],
      overallScore: 0.7,
      success: true,
    });
    const history = await resultRepo.listByJob(jobId1);
    expect(history).toHaveLength(2);
    expect(history.filter((r) => r.active)).toHaveLength(1);
  });

  it('invalidateActiveByJob flips the 1 active row for the targeted job and returns 1 (schema invariant: at most 1 active row per job)', async () => {
    // Build history: 3 score_results rows for jobId1. The schema
    // enforces "at most 1 active row per job" via the partial unique
    // index `score_results_active_idx (job_id) WHERE active = 1`
    // (`drizzle/0000_open_white_tiger.sql:319`), so after three
    // `activateResult` calls jobId1 has 1 active + 2 inactive rows.
    // `invalidateActiveByJob` must count + flip the 1 active row,
    // and the resulting history must show all 3 rows inactive.
    await resultRepo.activateResult({
      jobId: jobId1,
      pipelineRunId: runId,
      fingerprint: 'fp-job1-A',
      timestamp: '2026-08-05T10:00:00.000Z',
      promptVersion: 'p1',
      rubricVersion: 'r1',
      model: 'gpt-5.6-sol',
      reasoningEffort: 'medium',
      scorerImplementationVersion: 'scorer-1',
      categoryScores: [],
      overallScore: 0.4,
      success: true,
    });
    await resultRepo.activateResult({
      jobId: jobId1,
      pipelineRunId: runId,
      fingerprint: 'fp-job1-B',
      timestamp: '2026-08-05T10:01:00.000Z',
      promptVersion: 'p1',
      rubricVersion: 'r1',
      model: 'gpt-5.6-sol',
      reasoningEffort: 'medium',
      scorerImplementationVersion: 'scorer-1',
      categoryScores: [],
      overallScore: 0.5,
      success: true,
    });
    await resultRepo.activateResult({
      jobId: jobId1,
      pipelineRunId: runId,
      fingerprint: 'fp-job1-C',
      timestamp: '2026-08-05T10:02:00.000Z',
      promptVersion: 'p1',
      rubricVersion: 'r1',
      model: 'gpt-5.6-sol',
      reasoningEffort: 'medium',
      scorerImplementationVersion: 'scorer-1',
      categoryScores: [],
      overallScore: 0.6,
      success: true,
    });

    // Pre-condition: 3 rows total, 1 active + 2 inactive (history).
    const job1RowsBefore = await resultRepo.listByJob(jobId1);
    expect(job1RowsBefore).toHaveLength(3);
    expect(job1RowsBefore.filter((r) => r.active)).toHaveLength(1);

    const flipped = await resultRepo.invalidateActiveByJob(jobId1);
    expect(flipped).toBe(1);

    const job1RowsAfter = await resultRepo.listByJob(jobId1);
    expect(job1RowsAfter).toHaveLength(3);
    expect(job1RowsAfter.every((r) => r.active === false)).toBe(true);
  });

  it('invalidateActiveByJob is idempotent and does not touch other jobs', async () => {
    // First invalidateActiveByJob call flips jobId1's active rows.
    await resultRepo.activateResult({
      jobId: jobId1,
      pipelineRunId: runId,
      fingerprint: 'fp-job1-A',
      timestamp: '2026-08-05T10:00:00.000Z',
      promptVersion: 'p1',
      rubricVersion: 'r1',
      model: 'gpt-5.6-sol',
      reasoningEffort: 'medium',
      scorerImplementationVersion: 'scorer-1',
      categoryScores: [],
      overallScore: 0.5,
      success: true,
    });
    expect((await resultRepo.listByJob(jobId1)).filter((r) => r.active)).toHaveLength(1);

    const first = await resultRepo.invalidateActiveByJob(jobId1);
    expect(first).toBe(1);

    // Second call is a no-op — no active rows remain.
    const second = await resultRepo.invalidateActiveByJob(jobId1);
    expect(second).toBe(0);

    // The historical row must remain queryable (AGENTS.md §6).
    const job1Rows = await resultRepo.listByJob(jobId1);
    expect(job1Rows).toHaveLength(1);
    expect(job1Rows[0]?.active).toBe(false);

    // A subsequent insertion of an active row for a DIFFERENT job
    // must NOT be touched by another `invalidateActiveByJob(jobId1)`.
    await resultRepo.activateResult({
      jobId: jobId2,
      pipelineRunId: runId,
      fingerprint: 'fp-job2',
      timestamp: '2026-08-05T10:00:00.000Z',
      promptVersion: 'p1',
      rubricVersion: 'r1',
      model: 'gpt-5.6-sol',
      reasoningEffort: 'medium',
      scorerImplementationVersion: 'scorer-1',
      categoryScores: [],
      overallScore: 0.7,
      success: true,
    });
    expect((await resultRepo.listByJob(jobId2)).filter((r) => r.active)).toHaveLength(1);

    const third = await resultRepo.invalidateActiveByJob(jobId1);
    expect(third).toBe(0);

    const job2Rows = await resultRepo.listByJob(jobId2);
    expect(job2Rows).toHaveLength(1);
    expect(job2Rows[0]?.active).toBe(true);
    expect(job2Rows[0]?.fingerprint).toBe('fp-job2');
  });
});
