import { describe, expect, it } from 'vitest';
import { formatRunSummary, formatTopNTable, formatScoringPlan } from '../../src/pipeline/format.js';
import type { RunSummary, TopNRow } from '../../src/pipeline/state.js';
import { LINKEDIN_SCORING_SCHEMA_VERSION } from '../../src/scoring/state.js';

const baseSummary: RunSummary = {
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

describe('Pipeline format', () => {
  it('formatRunSummary includes key fields', () => {
    const out = formatRunSummary(baseSummary);
    expect(out).toContain('run: run_42');
    expect(out).toContain('status: completed');
    expect(out).toContain('jobs: discovered=100');
  });

  it('formatTopNTable renders empty correctly', () => {
    expect(formatTopNTable([], 80)).toBe('(no scored jobs)');
  });

  it('formatTopNTable renders rows', () => {
    const rows: TopNRow[] = [
      {
        jobId: 1,
        sourceJobId: '42',
        score: 87.5,
        displayScore: '87.5',
        title: 'Engineer',
        company: 'Acme',
        location: 'Rotterdam',
        firstDiscovered: '2026-08-20T00:00:00.000Z',
      },
    ];
    const out = formatTopNTable(rows, 120);
    expect(out).toContain('job_1');
    expect(out).toContain('87.5');
    expect(out).toContain('Engineer');
  });

  it('formatScoringPlan includes key fields', () => {
    const plan = {
      schemaVersion: LINKEDIN_SCORING_SCHEMA_VERSION,
      runId: 42,
      searchExecutionId: 1,
      jobsDiscovered: 10,
      jobsAccepted: 8,
      scoresReused: 3,
      newOpenAIRequests: 5,
      skippedScoringCategories: [],
      scoringConcurrency: 3,
      perJob: [],
    };
    const out = formatScoringPlan(plan);
    expect(out).toContain('jobs discovered: 10');
    expect(out).toContain('new OpenAI requests: 5');
  });
});
