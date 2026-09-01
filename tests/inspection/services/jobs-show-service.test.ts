import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  JobsShowService,
  linkedinJobUrl,
} from '../../../src/inspection/services/jobs-show-service.js';
import { InspectionNotFoundError } from '../../../src/inspection/errors.js';
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
 * Service-layer tests for `JobsShowService`.
 *
 * Fixture: one complete job, two discovery events, one active filter
 * result, one active score result. The service is expected to assemble
 * the full 5-section payload from these inputs.
 */
describe('JobsShowService', () => {
  let harness: InspectionHarness;
  let service: JobsShowService;
  let profileVersionId: number;
  let filterConfigVersionId: number;
  let jobInternalId: number;
  let jobSourceJobId: string;

  beforeEach(async () => {
    harness = buildInspectionHarness();
    service = new JobsShowService(harness.repositories);
    const seeded = await seedProfileAndFilter(harness.repositories);
    profileVersionId = seeded.profileVersionId;
    filterConfigVersionId = seeded.filterConfigVersionId;

    const run = await seedPipelineRun(harness.repositories, {
      searches: [{ searchQuery: 'engineer', locationName: 'Rotterdam', geoId: '1' }],
      profileVersionId,
      filterConfigVersionId,
      startTimestamp: FIXTURE_TS,
    });

    // The first job — receives two discovery events so the show
    // payload's discoveryHistory has multiple rows.
    const first = await seedJob(harness.repositories, {
      sourceJobId: '4242',
      runId: run.runId,
      searchId: run.searchIds[0]!,
      extractionStatus: 'complete',
      title: 'Senior Engineer',
      company: 'Acme',
      location: 'Rotterdam',
      description: 'Build distributed systems.',
      successfulMethod: 'search_detail_panel',
    });
    jobInternalId = first.jobId;
    jobSourceJobId = '4242';

    // Second discovery event for the same job (rediscovery).
    await harness.repositories.jobs.recordDiscoveryEvent({
      jobId: jobInternalId,
      pipelineRunId: run.runId,
      searchExecutionId: run.searchIds[0]!,
      timestamp: '2026-08-21T10:00:00.000Z',
      isNew: false,
      currentExtractionState: 'complete',
      extractionAttempted: false,
      skipReason: null,
    });

    const fr = await seedFilterResult(harness.repositories, {
      jobId: jobInternalId,
      runId: run.runId,
      filterConfigVersionId,
      outcome: 'accepted',
      profileVersionId,
      fingerprint: 'fp-show',
    });

    await seedScoreResult(harness.repositories, {
      jobId: jobInternalId,
      runId: run.runId,
      filterResultId: fr,
      overallScore: 85,
      explanation: 'Strong match.',
      inferredSeniority: 'senior',
      recommendationSummary: 'Recommend',
      fingerprint: 'score-fp-show',
    });
  });

  afterEach(() => {
    harness.cleanup();
  });

  it('returns the full payload with all 5 documented sections', async () => {
    const payload = await service.show(`job_${jobInternalId}`);
    // 1. Identity
    expect(payload.id).toBe(`job_${jobInternalId}`);
    expect(payload.internalId).toBe(jobInternalId);
    expect(payload.sourceJobId).toBe(jobSourceJobId);
    expect(payload.linkedinUrl).toBe(linkedinJobUrl(jobSourceJobId));
    // 2. Extraction
    expect(payload.title).toBe('Senior Engineer');
    expect(payload.company).toBe('Acme');
    expect(payload.location).toBe('Rotterdam');
    expect(payload.description).toBe('Build distributed systems.');
    expect(payload.extractionStatus).toBe('complete');
    expect(payload.successfulMethod).toBe('search_detail_panel');
    // 3. Discovery history (2 events from the fixture)
    expect(payload.discoveryHistory).toHaveLength(2);
    expect(payload.discoveryHistory[0]?.runId).toBeGreaterThan(0);
    expect(payload.discoveryHistory[0]?.searchExecutionId).toBeGreaterThan(0);
    expect(typeof payload.discoveryHistory[0]?.isNew).toBe('boolean');
    // 4. Current filter (accepted)
    expect(payload.currentFilter.outcome).toBe('accepted');
    expect(payload.currentFilter.fingerprint).toBe('fp-show');
    expect(payload.currentFilter.rejectionReasons).toEqual([]);
    expect(payload.currentFilter.hasHistory).toBe(true);
    expect(payload.currentFilter.filteredAt).toBe(FIXTURE_TS);
    // 5. Current score
    expect(payload.currentScore.overallScore).toBe(85);
    expect(payload.currentScore.displayScore).toBe('85.0');
    expect(payload.currentScore.explanation).toBe('Strong match.');
    expect(payload.currentScore.inferredSeniority).toBe('senior');
    expect(payload.currentScore.recommendationSummary).toBe('Recommend');
    expect(payload.currentScore.hasHistory).toBe(true);
    expect(payload.currentScore.timestamp).toBe(FIXTURE_TS);
    expect(payload.currentScore.categoryScores.length).toBeGreaterThan(0);
    if (payload.currentScore.categoryScores[0]) {
      expect(payload.currentScore.categoryScores[0].category).toBe('technicalSkills');
      expect(payload.currentScore.categoryScores[0].score).toBe(80);
    }
    // 6. Timestamps
    expect(payload.timestamps.firstDiscoveredAt).toBe(FIXTURE_TS);
    expect(payload.timestamps.createdAt).toBe(FIXTURE_TS);
    expect(payload.timestamps.updatedAt).toBe(FIXTURE_TS);
  });

  it('resolves the numeric sourceJobId form', async () => {
    const payload = await service.show(jobSourceJobId);
    expect(payload.id).toBe(`job_${jobInternalId}`);
    expect(payload.sourceJobId).toBe(jobSourceJobId);
  });

  it('throws InspectionNotFoundError("jobs_show_invalid_identifier") for an invalid identifier', async () => {
    await expect(service.show('not_a_valid_id')).rejects.toBeInstanceOf(InspectionNotFoundError);
    await expect(service.show('not_a_valid_id')).rejects.toMatchObject({
      code: 'jobs_show_invalid_identifier',
    });
  });

  it('throws InspectionNotFoundError("jobs_show_not_found") for an unknown job id', async () => {
    await expect(service.show('job_9999')).rejects.toBeInstanceOf(InspectionNotFoundError);
    await expect(service.show('job_9999')).rejects.toMatchObject({
      code: 'jobs_show_not_found',
    });
  });

  it('returns linkedinUrl === "https://www.linkedin.com/jobs/view/<sourceJobId>"', async () => {
    const payload = await service.show(`job_${jobInternalId}`);
    expect(payload.linkedinUrl).toBe(`https://www.linkedin.com/jobs/view/${jobSourceJobId}`);
  });

  it('returns null fields for jobs with no filter / score history', async () => {
    // Insert a fresh job with no filter_results / score_results rows.
    const run = await seedPipelineRun(harness.repositories, {
      searches: [{ searchQuery: 'other', locationName: 'Other', geoId: '2' }],
      profileVersionId,
      filterConfigVersionId,
      startTimestamp: FIXTURE_TS,
    });
    const empty = await seedJob(harness.repositories, {
      sourceJobId: '9999',
      runId: run.runId,
      searchId: run.searchIds[0]!,
      extractionStatus: 'complete',
      title: 'Untouched',
      company: 'Empty Co',
      location: 'Nowhere',
    });

    const payload = await service.show(`job_${empty.jobId}`);
    expect(payload.currentFilter.outcome).toBeNull();
    expect(payload.currentFilter.fingerprint).toBeNull();
    expect(payload.currentFilter.filteredAt).toBeNull();
    expect(payload.currentFilter.hasHistory).toBe(false);
    expect(payload.currentScore.overallScore).toBeNull();
    expect(payload.currentScore.displayScore).toBeNull();
    expect(payload.currentScore.explanation).toBeNull();
    expect(payload.currentScore.hasHistory).toBe(false);
  });

  it('linkedinJobUrl pure helper builds the canonical URL', () => {
    expect(linkedinJobUrl('4242')).toBe('https://www.linkedin.com/jobs/view/4242');
    expect(linkedinJobUrl('abc-123')).toBe('https://www.linkedin.com/jobs/view/abc-123');
  });
});
