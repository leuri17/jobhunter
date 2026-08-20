import { describe, expect, it } from 'vitest';
import { PIPELINE_SCHEMA_VERSION, type RunSummary } from '../../src/pipeline/state.js';

describe('PipelineState', () => {
  it('PIPELINE_SCHEMA_VERSION === 1', () => {
    expect(PIPELINE_SCHEMA_VERSION).toBe(1);
  });

  it('RunSummary shape compiles with all 21 stat fields', () => {
    const summary: RunSummary = {
      schemaVersion: 1,
      runId: 42,
      status: 'completed',
      startTimestamp: '2026-08-20T00:00:00.000Z',
      endTimestamp: '2026-08-20T00:01:00.000Z',
      searchesPlanned: 4,
      searchesAttempted: 4,
      searchesCompleted: 4,
      searchErrors: [],
      jobsDiscovered: 100,
      newCompleteJobs: 50,
      existingCompleteJobsSkipped: 30,
      existingPartialJobsSkipped: 0,
      newPartialJobs: 15,
      failedExtractions: 5,
      jobsAccepted: 35,
      jobsRejected: 15,
      filterErrors: 0,
      jobsScored: 35,
      scoresReused: 10,
      scoringErrors: 0,
      scoringDeclinedByUser: false,
      cancellationReason: null,
    };
    expect(summary.runId).toBe(42);
    expect(summary.status).toBe('completed');
  });
});
