import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { JobsListService } from '../../../src/inspection/services/jobs-list-service.js';
import { InspectionValidationError } from '../../../src/inspection/errors.js';
import {
  buildInspectionHarness,
  FIXTURE_TS,
  seedFilterResult,
  seedJob,
  seedPipelineRun,
  seedProfileAndFilter,
  seedScoreResult,
  type InspectionHarness,
} from './helpers/inspection-harness.js';

/**
 * Service-layer tests for `JobsListService`.
 *
 * The fixture mirrors the documented state matrix:
 *   - Job 1: complete, accepted, scored 85 — `scored` (+ `accepted`)
 *   - Job 2: complete, accepted, scored 95 — `scored` (+ `accepted`)
 *   - Job 3: complete, accepted, NO score — `unscored` (+ `accepted`)
 *   - Job 4: partial                          — `partial`
 *   - Job 5: failed-extraction (no jobs row)  — placeholder
 *
 * `accepted` / `rejected` / `filter-errors` / `scoring-errors` /
 * `failed` are exercised via the same fixture (the SQL-driven
 * repository handles each state uniformly).
 */
describe('JobsListService', () => {
  let harness: InspectionHarness;
  let service: JobsListService;
  let profileVersionId: number;
  let filterConfigVersionId: number;
  let runId: number;
  let searchId: number;

  beforeEach(async () => {
    harness = buildInspectionHarness();
    service = new JobsListService(harness.repositories);
    const seeded = await seedProfileAndFilter(harness.repositories);
    profileVersionId = seeded.profileVersionId;
    filterConfigVersionId = seeded.filterConfigVersionId;
    const run = await seedPipelineRun(harness.repositories, {
      searches: [{ searchQuery: 'engineer', locationName: 'Rotterdam', geoId: '1' }],
      profileVersionId,
      filterConfigVersionId,
      startTimestamp: FIXTURE_TS,
    });
    runId = run.runId;
    searchId = run.searchIds[0]!;

    // Job 1: complete, accepted, scored 85.
    const j1 = await seedJob(harness.repositories, {
      sourceJobId: '1001',
      runId,
      searchId,
      extractionStatus: 'complete',
      title: 'Senior Engineer',
      company: 'Example Co',
      location: 'Rotterdam',
      successfulMethod: 'search_detail_panel',
    });
    const fr1 = await seedFilterResult(harness.repositories, {
      jobId: j1.jobId,
      runId,
      filterConfigVersionId,
      outcome: 'accepted',
      profileVersionId,
      fingerprint: 'fp-1',
    });
    await seedScoreResult(harness.repositories, {
      jobId: j1.jobId,
      runId,
      filterResultId: fr1,
      overallScore: 85,
      explanation: 'Good match.',
      inferredSeniority: 'senior',
      recommendationSummary: 'Recommend',
      fingerprint: 'score-fp-1',
    });

    // Job 2: complete, accepted, scored 95 (higher than Job 1 → ranked first).
    const j2 = await seedJob(harness.repositories, {
      sourceJobId: '1002',
      runId,
      searchId,
      extractionStatus: 'complete',
      title: 'Staff Engineer',
      company: 'Example Inc',
      location: 'Amsterdam',
      successfulMethod: 'search_detail_panel',
    });
    const fr2 = await seedFilterResult(harness.repositories, {
      jobId: j2.jobId,
      runId,
      filterConfigVersionId,
      outcome: 'accepted',
      profileVersionId,
      fingerprint: 'fp-2',
    });
    await seedScoreResult(harness.repositories, {
      jobId: j2.jobId,
      runId,
      filterResultId: fr2,
      overallScore: 95,
      explanation: 'Excellent match.',
      inferredSeniority: 'staff',
      recommendationSummary: 'Strongly recommend',
      fingerprint: 'score-fp-2',
    });

    // Job 3: complete, accepted, NO score → unscored.
    const j3 = await seedJob(harness.repositories, {
      sourceJobId: '1003',
      runId,
      searchId,
      extractionStatus: 'complete',
      title: 'Backend Engineer',
      company: 'Example BV',
      location: 'Utrecht',
      successfulMethod: 'search_detail_panel',
    });
    await seedFilterResult(harness.repositories, {
      jobId: j3.jobId,
      runId,
      filterConfigVersionId,
      outcome: 'accepted',
      profileVersionId,
      fingerprint: 'fp-3',
    });

    // Job 4: partial extraction (with a failed extraction attempt so
    // the mapper's missingFields + errorCode projection has a source
    // row).
    await seedJob(harness.repositories, {
      sourceJobId: '1004',
      runId,
      searchId,
      extractionStatus: 'partial',
      title: 'Partial Engineer',
      company: 'Partial Co',
      location: 'Rotterdam',
      successfulMethod: null,
      extractionAttempt: {
        method: 'search_detail_panel',
        success: false,
        errorCode: 'partial_extraction',
        errorMessage: 'description + company missing',
      },
    });

    // Job 5: failed extraction. (Not asserted directly — the
    // `failed` state is sourced from `discoveryErrors`, which is a
    // separate fixture in `runs-list-service.test.ts`. This row is
    // only here so the count + scope checks don't ignore a row with
    // extraction_status='failed'.)
    await seedJob(harness.repositories, {
      sourceJobId: '1005',
      runId,
      searchId,
      extractionStatus: 'failed',
      title: 'Failed Engineer',
      company: 'Failed Co',
      location: 'Rotterdam',
      successfulMethod: null,
    });
  });

  afterEach(() => {
    harness.cleanup();
  });

  it('returns the 2 scored jobs in score-DESC order for the scored view', async () => {
    const result = await service.list({ state: 'scored' });
    expect(result.state).toBe('scored');
    expect(result.rows).toHaveLength(2);
    // First row is the higher-scoring job (95).
    expect(result.rows[0]?.state).toBe('scored');
    if (result.rows[0]?.state === 'scored') {
      expect(result.rows[0].overallScore).toBe(95);
      expect(result.rows[0].displayScore).toBe('95.0');
    }
    if (result.rows[1]?.state === 'scored') {
      expect(result.rows[1].overallScore).toBe(85);
      expect(result.rows[1].displayScore).toBe('85.0');
    }
    expect(result.returned).toBe(2);
  });

  it('returns the unfiltered complete job for the unscored view', async () => {
    const result = await service.list({ state: 'unscored' });
    expect(result.state).toBe('unscored');
    expect(result.rows).toHaveLength(1);
    if (result.rows[0]?.state === 'unscored') {
      expect(result.rows[0].sourceJobId).toBe('1003');
      expect(result.rows[0].scoringStatus).toBe('pending');
    }
  });

  it('returns the partial job for the partialJobs view', async () => {
    const result = await service.list({ state: 'partial' });
    expect(result.state).toBe('partial');
    expect(result.rows).toHaveLength(1);
    if (result.rows[0]?.state === 'partial') {
      expect(result.rows[0].linkedinJobId).toBe('1004');
      expect(result.rows[0].availableTitle).toBe('Partial Engineer');
      expect(result.rows[0].missingFields.length).toBeGreaterThan(0);
    }
  });

  it('filters the allJobs view by minScore to scored jobs >= 50', async () => {
    const result = await service.list({ state: 'all', minScore: 50 });
    // Both scored jobs (85 + 95) are >= 50; the unfiltered + partial
    // + failed rows are excluded by the minScore filter.
    expect(result.rows.length).toBe(2);
    for (const row of result.rows) {
      expect(row.state).toBe('all');
      if (row.state === 'all') {
        expect(row.score).not.toBe('—');
      }
    }
  });

  it('filters the scored view by case-insensitive substring match on company', async () => {
    const result = await service.list({ state: 'scored', company: 'example' });
    expect(result.rows).toHaveLength(2);
    // The repository's `LIKE` is ASCII case-insensitive in SQLite by
    // default; `Example Co` + `Example Inc` both match `'example'`.
    for (const row of result.rows) {
      expect(row.state).toBe('scored');
    }
  });

  it('caps the scored view to exactly N rows when limit is set', async () => {
    const result = await service.list({ state: 'scored', limit: 1 });
    expect(result.rows).toHaveLength(1);
    expect(result.limit).toBe(1);
    expect(result.returned).toBe(1);
  });

  it('throws InspectionValidationError("jobs_list_invalid_limit") for limit=0', async () => {
    await expect(service.list({ state: 'scored', limit: 0 })).rejects.toBeInstanceOf(
      InspectionValidationError,
    );
    await expect(service.list({ state: 'scored', limit: 0 })).rejects.toMatchObject({
      code: 'jobs_list_invalid_limit',
    });
  });

  it('throws InspectionValidationError("jobs_list_invalid_min_score") for minScore=150', async () => {
    await expect(service.list({ state: 'scored', minScore: 150 })).rejects.toBeInstanceOf(
      InspectionValidationError,
    );
    await expect(service.list({ state: 'scored', minScore: 150 })).rejects.toMatchObject({
      code: 'jobs_list_invalid_min_score',
    });
  });

  it('scopes the scored view to the supplied runId', async () => {
    // Insert a SECOND pipeline run + a scored job attached only to
    // that run. After scoping to runId=1, the second-run job must
    // not appear.
    const second = await seedPipelineRun(harness.repositories, {
      searches: [{ searchQuery: 'other', locationName: 'Other', geoId: '2' }],
      profileVersionId,
      filterConfigVersionId,
      startTimestamp: '2026-08-21T10:00:00.000Z',
    });
    const otherJob = await seedJob(harness.repositories, {
      sourceJobId: '2001',
      runId: second.runId,
      searchId: second.searchIds[0]!,
      extractionStatus: 'complete',
      title: 'Other Job',
      company: 'Other Co',
      location: 'Other',
    });
    const fr = await seedFilterResult(harness.repositories, {
      jobId: otherJob.jobId,
      runId: second.runId,
      filterConfigVersionId,
      outcome: 'accepted',
      profileVersionId,
    });
    await seedScoreResult(harness.repositories, {
      jobId: otherJob.jobId,
      runId: second.runId,
      filterResultId: fr,
      overallScore: 70,
      fingerprint: 'score-fp-other',
    });

    // Without scoping: both scored jobs surface (one per run).
    const unScoped = await service.list({ state: 'scored' });
    expect(unScoped.rows).toHaveLength(3);

    // Scoped to run 1: only the 2 originally-scored jobs surface.
    const scoped = await service.list({ state: 'scored', runId: runId });
    expect(scoped.rows).toHaveLength(2);
    for (const row of scoped.rows) {
      expect(row.state).toBe('scored');
    }
    expect(scoped.refinements.runId).toBe(runId);
  });

  it('returns the refinements envelope exactly as supplied (sans the company lowercase)', async () => {
    const result = await service.list({
      state: 'all',
      minScore: 0,
      company: 'Example',
      location: 'Rotterdam',
    });
    expect(result.refinements).toEqual({
      minimumScore: 0,
      company: 'example',
      location: 'rotterdam',
      runId: null,
    });
  });

  it('returns all 5 jobs without refinements for the allJobs view', async () => {
    const result = await service.list({ state: 'all' });
    // 5 jobs (complete-scored-x2 + complete-unscored + partial + failed).
    expect(result.rows).toHaveLength(5);
    expect(result.returned).toBe(5);
  });

  it('returns only the 3 accepted jobs (Jobs 1, 2, 3) for the acceptedJobs view', async () => {
    const result = await service.list({ state: 'accepted' });
    expect(result.rows).toHaveLength(3);
    for (const row of result.rows) {
      expect(row.state).toBe('accepted');
    }
  });

  it('returns an empty array (no filter_errors rows in the fixture) for the filter-errors view', async () => {
    const result = await service.list({ state: 'filter-errors' });
    expect(result.rows).toHaveLength(0);
  });

  it('returns an empty array (no failed score rows in the fixture) for the scoring-errors view', async () => {
    const result = await service.list({ state: 'scoring-errors' });
    expect(result.rows).toHaveLength(0);
  });
});
