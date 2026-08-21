import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { RunsShowService } from '../../../src/inspection/services/runs-show-service.js';
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
 * Service-layer tests for `RunsShowService` (TASK-016 Wave D Task 14,
 * SPEC §31 + §35.2).
 *
 * Fixture (per the plan's Task 14 details):
 *   - 1 pipeline run + 2 search executions
 *   - 5 jobs (3 complete + 2 partial) with discovery events
 *   - 2 filter results (active, accepted)
 *   - 2 score results (active, successful)
 *   - 1 diagnostic artifact
 */
describe('RunsShowService (TASK-016 Wave D Task 14, SPEC §35.2)', () => {
  let harness: InspectionHarness;
  let service: RunsShowService;
  let runId: number;
  let searchId1: number;
  let searchId2: number;
  let profileVersionId: number;
  let filterConfigVersionId: number;

  beforeEach(async () => {
    harness = buildInspectionHarness();
    service = new RunsShowService(harness.repositories);
    const seeded = await seedProfileAndFilter(harness.repositories);
    profileVersionId = seeded.profileVersionId;
    filterConfigVersionId = seeded.filterConfigVersionId;

    // Create a run with TWO search executions + finalize the counts.
    const run = await seedPipelineRun(harness.repositories, {
      searches: [
        { searchQuery: 'engineer', locationName: 'Rotterdam', geoId: '1' },
        { searchQuery: 'devops', locationName: 'Amsterdam', geoId: '2' },
      ],
      profileVersionId,
      filterConfigVersionId,
      startTimestamp: FIXTURE_TS,
    });
    runId = run.runId;
    searchId1 = run.searchIds[0]!;
    searchId2 = run.searchIds[1]!;

    // 3 complete + accepted jobs.
    const jobIds: number[] = [];
    for (let i = 1; i <= 3; i++) {
      const j = await seedJob(harness.repositories, {
        sourceJobId: String(1000 + i),
        runId,
        searchId: searchId1,
        extractionStatus: 'complete',
        title: `Engineer ${i}`,
        company: `Co ${i}`,
        location: 'Rotterdam',
        successfulMethod: 'search_detail_panel',
      });
      jobIds.push(j.jobId);
    }
    // 2 partial jobs.
    for (let i = 4; i <= 5; i++) {
      await seedJob(harness.repositories, {
        sourceJobId: String(1000 + i),
        runId,
        searchId: searchId2,
        extractionStatus: 'partial',
        title: `Partial ${i}`,
        company: `Partial Co ${i}`,
        location: 'Amsterdam',
        successfulMethod: null,
        extractionAttempt: {
          method: 'search_detail_panel',
          success: false,
          errorCode: 'partial_extraction',
          errorMessage: 'missing fields',
        },
      });
    }
    // 2 filter results (one per the first 2 complete jobs).
    await seedFilterResult(harness.repositories, {
      jobId: jobIds[0]!,
      runId,
      filterConfigVersionId,
      outcome: 'accepted',
      profileVersionId,
      fingerprint: 'fp-show-1',
    });
    await seedFilterResult(harness.repositories, {
      jobId: jobIds[1]!,
      runId,
      filterConfigVersionId,
      outcome: 'accepted',
      profileVersionId,
      fingerprint: 'fp-show-2',
    });
    // 2 score results.
    await seedScoreResult(harness.repositories, {
      jobId: jobIds[0]!,
      runId,
      overallScore: 85,
      fingerprint: 'score-show-1',
    });
    await seedScoreResult(harness.repositories, {
      jobId: jobIds[1]!,
      runId,
      overallScore: 92,
      fingerprint: 'score-show-2',
    });
    // 1 diagnostic artifact.
    await harness.repositories.diagnostics.insert({
      pipelineRunId: runId,
      artifactType: 'screenshot',
      storedPath: '/tmp/run-1/screenshot.png',
      relativePath: 'run-1/screenshot.png',
      mimeType: 'image/png',
      fileSize: 4096,
      createdAt: FIXTURE_TS,
      description: 'test screenshot',
    });
    // Finalize the run with the documented counts so the service's
    // score counts + reused counts come from the denormalized row.
    await harness.repositories.pipelineRuns.finalizeRunStats(runId, {
      status: 'completed',
      endTimestamp: '2026-08-20T10:30:00.000Z',
      jobsDiscovered: 5,
      newCompleteJobs: 3,
      newPartialJobs: 2,
      failedExtractions: 0,
      jobsAccepted: 2,
      jobsRejected: 0,
      filterErrors: 0,
      jobsScored: 2,
      scoresReused: 1,
      scoringErrors: 0,
      searchesPlanned: 2,
      searchesAttempted: 2,
      searchesCompleted: 2,
      searchErrors: null,
    });
  });

  afterEach(() => {
    harness.cleanup();
  });

  it('returns the full payload with all 11 documented sections', async () => {
    const payload = await service.show(`run_${runId}`);
    // 1. Identity
    expect(payload.id).toBe(`run_${runId}`);
    expect(payload.internalId).toBe(runId);
    expect(payload.status).toBe('completed');
    expect(payload.startTimestamp).toBe(FIXTURE_TS);
    expect(payload.endTimestamp).toBe('2026-08-20T10:30:00.000Z');
    // 2. Configuration
    expect(payload.configuration.schemaVersion).toBe(1);
    expect(payload.configuration.hash).toBe('cfg-hash');
    expect(payload.configuration.applicationVersion).toBe('0.1.0');
    // 3. Profile / filter versions
    expect(payload.profileVersionId).toBe(profileVersionId);
    expect(payload.filterConfigVersionId).toBe(filterConfigVersionId);
    // 4. Search executions (2 from the fixture)
    expect(payload.searchExecutions).toHaveLength(2);
    expect(payload.searchExecutions[0]?.searchQuery).toBe('engineer');
    expect(payload.searchExecutions[1]?.searchQuery).toBe('devops');
    // 5. jobCounts: complete=3, partial=2, total=5
    expect(payload.jobCounts.complete).toBe(3);
    expect(payload.jobCounts.partial).toBe(2);
    expect(payload.jobCounts.failed).toBe(0);
    expect(payload.jobCounts.total).toBe(5);
    // 6. filterCounts: accepted=2
    expect(payload.filterCounts.accepted).toBe(2);
    expect(payload.filterCounts.rejected).toBe(0);
    expect(payload.filterCounts.errors).toBe(0);
    // 7. scoreCounts: scored=2 (active successful rows), reused=1, errors=0
    expect(payload.scoreCounts.scored).toBe(2);
    expect(payload.scoreCounts.reused).toBe(1);
    expect(payload.scoreCounts.errors).toBe(0);
    // 8. reusedResults
    expect(payload.reusedResults.jobsReused).toBe(1);
    // 9. errors
    expect(payload.errors.searchErrors).toEqual([]);
    expect(payload.errors.extractionFailures).toBe(0);
    expect(payload.errors.filterErrors).toBe(0);
    expect(payload.errors.scoringErrors).toBe(0);
    // 10. cancellationState
    expect(payload.cancellationState.isCancelled).toBe(false);
    expect(payload.cancellationState.reason).toBeNull();
    // 11. diagnosticReferences (1 from the fixture)
    expect(payload.diagnosticReferences).toHaveLength(1);
    expect(payload.diagnosticReferences[0]?.artifactType).toBe('screenshot');
    expect(payload.diagnosticReferences[0]?.relativePath).toBe('run-1/screenshot.png');
  });

  it('throws InspectionNotFoundError("runs_show_not_found") for an unknown run id', async () => {
    await expect(service.show('run_9999')).rejects.toBeInstanceOf(InspectionNotFoundError);
    await expect(service.show('run_9999')).rejects.toMatchObject({
      code: 'runs_show_not_found',
    });
  });

  it('throws InspectionNotFoundError("runs_show_invalid_identifier") for a malformed identifier', async () => {
    await expect(service.show('not_a_valid_id')).rejects.toBeInstanceOf(InspectionNotFoundError);
    await expect(service.show('not_a_valid_id')).rejects.toMatchObject({
      code: 'runs_show_invalid_identifier',
    });
  });

  it('surfaces the documented error counts when a search error is recorded', async () => {
    // Add a searchErrors entry to the run + update the count so the
    // payload's `errors.searchErrors` array surfaces the error.
    await harness.repositories.pipelineRuns.finalizeRunStats(runId, {
      searchErrors: [{ code: 'linkedin_blocked', message: 'blocked' }],
    });
    const payload = await service.show(`run_${runId}`);
    expect(payload.errors.searchErrors).toHaveLength(1);
    expect(payload.errors.searchErrors[0]?.code).toBe('linkedin_blocked');
    expect(payload.errors.searchErrors[0]?.message).toBe('blocked');
  });

  it('isCancelled is true when status is "cancelled"', async () => {
    await harness.repositories.pipelineRuns.finalizeRunStats(runId, {
      status: 'cancelled',
      cancellationReason: 'user requested cancel',
    });
    const payload = await service.show(`run_${runId}`);
    expect(payload.cancellationState.isCancelled).toBe(true);
    expect(payload.cancellationState.reason).toBe('user requested cancel');
  });
});
