import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  RunsListService,
  summariseSearchErrors,
} from '../../../src/inspection/services/runs-list-service.js';
import { buildInspectionHarness, type InspectionHarness } from './helpers/inspection-harness.js';

/**
 * Service-layer tests for `RunsListService`.
 *
 * Fixture: three pipeline runs with varying statuses. The
 * `errorSummary` column is the synthetic `'<code>: <count>'`
 * summary derived from `pipelineRuns.searchErrorsJson`.
 */
describe('RunsListService', () => {
  let harness: InspectionHarness;
  let service: RunsListService;
  let runId1: number;
  let runId2: number;
  let runId3: number;

  beforeEach(async () => {
    harness = buildInspectionHarness();
    service = new RunsListService(harness.repositories);

    // Run 1: completed, no search errors.
    const r1 = await harness.repositories.pipelineRuns.createRunWithSearches(
      {
        startTimestamp: '2026-08-20T10:00:00.000Z',
        configSnapshotJson: {},
        configSchemaVersion: 1,
        configHash: 'cfg-hash',
        applicationVersion: '0.1.0',
      },
      [
        {
          pipelineRunId: 0,
          searchQuery: 'engineer',
          locationName: 'Rotterdam',
          geoId: '1',
          generatedUrl: 'https://www.linkedin.com/jobs/search?q=engineer&geoId=1',
          startTimestamp: '2026-08-20T10:00:00.000Z',
        },
      ],
    );
    runId1 = r1.runId;
    await harness.repositories.pipelineRuns.finalizeRunStats(runId1, {
      status: 'completed',
      endTimestamp: '2026-08-20T10:30:00.000Z',
      jobsDiscovered: 50,
      jobsScored: 30,
      searchesAttempted: 4,
      searchErrors: null,
    });

    // Run 2: completed_with_errors, searchErrors populated with 2 entries.
    const r2 = await harness.repositories.pipelineRuns.createRunWithSearches(
      {
        startTimestamp: '2026-08-21T10:00:00.000Z',
        configSnapshotJson: {},
        configSchemaVersion: 1,
        configHash: 'cfg-hash',
        applicationVersion: '0.1.0',
      },
      [
        {
          pipelineRunId: 0,
          searchQuery: 'devops',
          locationName: 'Amsterdam',
          geoId: '2',
          generatedUrl: 'https://www.linkedin.com/jobs/search?q=devops&geoId=2',
          startTimestamp: '2026-08-21T10:00:00.000Z',
        },
      ],
    );
    runId2 = r2.runId;
    await harness.repositories.pipelineRuns.finalizeRunStats(runId2, {
      status: 'completed_with_errors',
      endTimestamp: '2026-08-21T10:30:00.000Z',
      jobsDiscovered: 20,
      jobsScored: 15,
      searchesAttempted: 4,
      searchErrors: [
        { code: 'linkedin_blocked', message: 'blocked' },
        { code: 'linkedin_blocked', message: 'blocked again' },
      ],
    });

    // Run 3: failed, searchErrors populated with 1 entry (different code).
    const r3 = await harness.repositories.pipelineRuns.createRunWithSearches(
      {
        startTimestamp: '2026-08-22T10:00:00.000Z',
        configSnapshotJson: {},
        configSchemaVersion: 1,
        configHash: 'cfg-hash',
        applicationVersion: '0.1.0',
      },
      [
        {
          pipelineRunId: 0,
          searchQuery: 'backend',
          locationName: 'Utrecht',
          geoId: '3',
          generatedUrl: 'https://www.linkedin.com/jobs/search?q=backend&geoId=3',
          startTimestamp: '2026-08-22T10:00:00.000Z',
        },
      ],
    );
    runId3 = r3.runId;
    await harness.repositories.pipelineRuns.finalizeRunStats(runId3, {
      status: 'failed',
      endTimestamp: '2026-08-22T10:15:00.000Z',
      jobsDiscovered: 5,
      jobsScored: 0,
      searchesAttempted: 2,
      searchErrors: [{ code: 'openai_request_failed', message: 'rate limited' }],
    });
  });

  afterEach(() => {
    harness.cleanup();
  });

  it('returns the most recent 2 runs when limit=2', async () => {
    const rows = await service.list({ limit: 2 });
    expect(rows).toHaveLength(2);
    // Most recent first → runId3, runId2 (runId1 is the oldest).
    expect(rows[0]?.id).toBe(`run_${runId3}`);
    expect(rows[1]?.id).toBe(`run_${runId2}`);
  });

  it('returns the 3 most recent runs when no limit is supplied', async () => {
    // The default limit is 20 (the service's `DEFAULT_RUNS_LIST_LIMIT`).
    // With only 3 runs seeded, all 3 are returned.
    const rows = await service.list();
    expect(rows).toHaveLength(3);
    // Ordered by id DESC.
    expect(rows.map((r) => r.internalId)).toEqual([runId3, runId2, runId1]);
  });

  it('orders runs by id DESC (most recent first) when limit=20', async () => {
    const rows = await service.list({ limit: 20 });
    expect(rows.map((r) => r.internalId)).toEqual([runId3, runId2, runId1]);
  });

  it('returns errorSummary "none" for the run with no search errors', async () => {
    const rows = await service.list({ limit: 20 });
    const noErrors = rows.find((r) => r.internalId === runId1);
    expect(noErrors?.errorSummary).toBe('none');
    expect(noErrors?.status).toBe('completed');
  });

  it('returns errorSummary "<code>: <count>" for the run with search errors', async () => {
    const rows = await service.list({ limit: 20 });
    const withErrors = rows.find((r) => r.internalId === runId2);
    expect(withErrors?.errorSummary).toBe('linkedin_blocked: 2');
    const failed = rows.find((r) => r.internalId === runId3);
    expect(failed?.errorSummary).toBe('openai_request_failed: 1');
  });

  it('exposes the documented row fields (id, status, counts, summary)', async () => {
    const rows = await service.list({ limit: 20 });
    const r = rows.find((x) => x.internalId === runId2);
    expect(r).toBeDefined();
    expect(r?.id).toBe(`run_${runId2}`);
    expect(r?.status).toBe('completed_with_errors');
    expect(r?.jobsDiscovered).toBe(20);
    expect(r?.jobsScored).toBe(15);
    expect(r?.searchesAttempted).toBe(4);
    expect(r?.startTimestamp).toBe('2026-08-21T10:00:00.000Z');
    expect(r?.endTimestamp).toBe('2026-08-21T10:30:00.000Z');
  });

  it('falls back to the default limit when the supplied limit is non-positive', async () => {
    // The service treats non-positive / non-integer limits as "use
    // default" (defense-in-depth — the sidecar route validates the
    // input first). With only 3 seeded runs, the default 20 returns
    // all 3.
    const rows = await service.list({ limit: 0 });
    expect(rows).toHaveLength(3);
  });

  it('summariseSearchErrors pure helper returns "none" for null / empty / non-object entries', () => {
    expect(summariseSearchErrors(null)).toBe('none');
    expect(summariseSearchErrors([])).toBe('none');
    expect(summariseSearchErrors([null, 'string', 42, {}, { code: 1 }])).toBe('none');
  });

  it('summariseSearchErrors pure helper returns "<code>: <count>" for the first code found', () => {
    expect(
      summariseSearchErrors([
        { code: 'a', message: 'x' },
        { code: 'a', message: 'y' },
      ]),
    ).toBe('a: 2');
    expect(
      summariseSearchErrors([
        { code: 'a', message: 'x' },
        { code: 'b', message: 'y' },
      ]),
    ).toBe('a: 1');
  });
});
