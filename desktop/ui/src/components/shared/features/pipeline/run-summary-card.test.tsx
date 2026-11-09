// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import type { RunSummary } from '@jobhunter/core/pipeline';
import { asRunSummary } from './run-summary-card';

const realSummary: RunSummary = {
  schemaVersion: 1,
  runId: 1,
  status: 'completed',
  startTimestamp: '2026-01-01T00:00:00.000Z',
  endTimestamp: '2026-01-01T00:00:02.000Z',
  searchesPlanned: 1,
  searchesAttempted: 1,
  searchesCompleted: 1,
  searchErrors: [],
  jobsDiscovered: 2,
  newCompleteJobs: 1,
  existingCompleteJobsSkipped: 0,
  existingPartialJobsSkipped: 0,
  newPartialJobs: 1,
  failedExtractions: 0,
  jobsAccepted: 1,
  jobsRejected: 0,
  filterErrors: 0,
  jobsScored: 1,
  scoresReused: 0,
  scoringErrors: 0,
  scoringDeclinedByUser: false,
  cancellationReason: null,
};

describe('asRunSummary', () => {
  it('accepts the terminal SSE payload (PipelineRunResult) and returns its summary', () => {
    const payload = { summary: realSummary, scoringPlan: null, topN: [] };
    expect(asRunSummary(payload)).toEqual(realSummary);
  });

  it('rejects payloads that are not a run result', () => {
    expect(asRunSummary(null)).toBeNull();
    expect(asRunSummary({})).toBeNull();
    expect(
      asRunSummary({ summary: { schemaVersion: 2, runId: 1, status: 'completed' } }),
    ).toBeNull();
    expect(asRunSummary({ schemaVersion: 1, runId: 1, status: 'completed' })).toBeNull();
  });
});
