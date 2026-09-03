import { describe, expect, it } from 'vitest';

import { buildReevaluationPlan } from '../../src/reevaluation/plan.js';
import {
  REEVALUATION_SCHEMA_VERSION,
  type ReevaluationPlanEntry,
  type ReevaluationSkippedEntry,
  type ScoringPlan,
} from '../../src/reevaluation/state.js';

/**
 * Pure-helper tests for `buildReevaluationPlan`. Mirrors `tests/scoring/plan.test.ts`.
 *
 * The function is a TOTAL pure aggregation: it carries its inputs
 * through to the `ReevaluationPlan` envelope and computes the numeric
 * totals. No I/O, no scoring, no DB.
 *
 * Cases:
 *   - Default scope + 2 filter reruns + 1 score rerun + 1 skip →
 *     totals `{ filtersRerun: 2, scoresRerun: 1, scoresInvalidated: 0,
 *     skipped: 1, scoringDeclinedByUser: false }`.
 *   - `dryRun: true` scope + 2 filter reruns → `dryRun: true`, action
 *     labels are `'would-rerun'`.
 *   - `scores-only` scope + scoring plan passed → `scoringPlan !== null`.
 *   - Empty inputs → `totals: { filtersRerun: 0, scoresRerun: 0,
 *     scoresInvalidated: 0, skipped: 0, scoringDeclinedByUser: false }`.
 */

const TS = '2026-08-20T10:00:00.000Z';

function makeFilterEntry(
  id: number,
  action: ReevaluationPlanEntry['action'],
  scoreInvalidated = false,
): ReevaluationPlanEntry {
  return {
    jobId: `job_${id}`,
    internalId: id,
    sourceJobId: `src-${id}`,
    action,
    fingerprint: `fp-${id}-0123456789abcdef`,
    scoreInvalidated,
  };
}

function makeScoreEntry(
  id: number,
  action: ReevaluationPlanEntry['action'],
  scoreInvalidated = false,
): ReevaluationPlanEntry {
  return {
    jobId: `job_${id}`,
    internalId: id,
    sourceJobId: `src-${id}`,
    action,
    fingerprint: `fp-score-${id}`,
    scoreInvalidated,
  };
}

function makeSkippedEntry(
  id: number,
  reason: ReevaluationSkippedEntry['reason'],
): ReevaluationSkippedEntry {
  return {
    jobId: `job_${id}`,
    internalId: id,
    sourceJobId: `src-${id}`,
    reason,
  };
}

const BASE_SCORING_PLAN: ScoringPlan = {
  schemaVersion: 1 as const,
  runId: 1,
  searchExecutionId: 10,
  jobsDiscovered: 1,
  jobsAccepted: 1,
  scoresReused: 0,
  newOpenAIRequests: 1,
  skippedScoringCategories: [],
  scoringConcurrency: 3,
  perJob: [
    {
      jobId: 1,
      sourceJobId: 'src-1',
      kind: 'complete',
      isEligible: true,
      estimatedInputBytes: 50_000,
      reason: null,
    },
  ],
};

describe('buildReevaluationPlan', () => {
  it('default scope: 2 filter reruns + 1 score rerun + 1 skip → documented totals', () => {
    const filterEntries = [makeFilterEntry(1, 'reran'), makeFilterEntry(2, 'reran')];
    const scoreEntries = [makeScoreEntry(3, 'reran')];
    const skipped = [makeSkippedEntry(4, 'filter_update_required')];

    const plan = buildReevaluationPlan({
      scope: 'default',
      dryRun: false,
      jobId: null,
      filterEntries,
      scoreEntries,
      skipped,
      scoringPlan: BASE_SCORING_PLAN,
      scoringDeclinedByUser: false,
    });

    expect(plan.schemaVersion).toBe(REEVALUATION_SCHEMA_VERSION);
    expect(plan.scope).toBe('default');
    expect(plan.dryRun).toBe(false);
    expect(plan.jobId).toBeNull();
    expect(plan.filtersToReevaluate).toEqual(filterEntries);
    expect(plan.jobsToScore).toEqual(scoreEntries);
    expect(plan.skipped).toEqual(skipped);
    expect(plan.scoringPlan).toBe(BASE_SCORING_PLAN);
    expect(plan.totals).toEqual({
      filtersRerun: 2,
      scoresRerun: 1,
      scoresInvalidated: 0,
      skipped: 1,
      scoringDeclinedByUser: false,
    });
  });

  it('dryRun scope: 2 filter reruns → dryRun: true, action labels are "would-rerun"', () => {
    const filterEntries = [makeFilterEntry(1, 'would-rerun'), makeFilterEntry(2, 'would-rerun')];

    const plan = buildReevaluationPlan({
      scope: 'default',
      dryRun: true,
      jobId: null,
      filterEntries,
      scoreEntries: [],
      skipped: [],
      scoringPlan: null,
      scoringDeclinedByUser: false,
    });

    expect(plan.dryRun).toBe(true);
    expect(plan.filtersToReevaluate).toHaveLength(2);
    expect(plan.filtersToReevaluate.every((e) => e.action === 'would-rerun')).toBe(true);
    expect(plan.totals).toEqual({
      filtersRerun: 2,
      scoresRerun: 0,
      scoresInvalidated: 0,
      skipped: 0,
      scoringDeclinedByUser: false,
    });
  });

  it('scores-only scope + scoring plan passed → scoringPlan !== null', () => {
    const scoreEntries = [makeScoreEntry(1, 'reran')];

    const plan = buildReevaluationPlan({
      scope: 'scores-only',
      dryRun: false,
      jobId: null,
      filterEntries: [],
      scoreEntries,
      skipped: [],
      scoringPlan: BASE_SCORING_PLAN,
      scoringDeclinedByUser: false,
    });

    expect(plan.scope).toBe('scores-only');
    expect(plan.scoringPlan).toBe(BASE_SCORING_PLAN);
    expect(plan.scoringPlan).not.toBeNull();
    expect(plan.totals.scoresRerun).toBe(1);
  });

  it('scores-only with a reused entry → counts only non-reused entries', () => {
    const scoreEntries = [
      makeScoreEntry(1, 'reran'),
      makeScoreEntry(2, 'reused'),
      makeScoreEntry(3, 'reran'),
    ];

    const plan = buildReevaluationPlan({
      scope: 'scores-only',
      dryRun: false,
      jobId: null,
      filterEntries: [],
      scoreEntries,
      skipped: [],
      scoringPlan: BASE_SCORING_PLAN,
      scoringDeclinedByUser: false,
    });

    expect(plan.totals.scoresRerun).toBe(2);
  });

  it('empty inputs → totals all zero + scoringPlan null', () => {
    const plan = buildReevaluationPlan({
      scope: 'default',
      dryRun: false,
      jobId: null,
      filterEntries: [],
      scoreEntries: [],
      skipped: [],
      scoringPlan: null,
      scoringDeclinedByUser: false,
    });

    expect(plan.filtersToReevaluate).toEqual([]);
    expect(plan.jobsToScore).toEqual([]);
    expect(plan.skipped).toEqual([]);
    expect(plan.scoringPlan).toBeNull();
    expect(plan.totals).toEqual({
      filtersRerun: 0,
      scoresRerun: 0,
      scoresInvalidated: 0,
      skipped: 0,
      scoringDeclinedByUser: false,
    });
  });

  it('job scope: jobId carries through verbatim', () => {
    const filterEntries = [makeFilterEntry(42, 'reran')];
    const plan = buildReevaluationPlan({
      scope: 'job',
      dryRun: false,
      jobId: 'job_42',
      filterEntries,
      scoreEntries: [],
      skipped: [],
      scoringPlan: null,
      scoringDeclinedByUser: false,
    });

    expect(plan.scope).toBe('job');
    expect(plan.jobId).toBe('job_42');
  });

  it('scoresInvalidated sums both filterEntries + scoreEntries', () => {
    const filterEntries = [makeFilterEntry(1, 'reran', true), makeFilterEntry(2, 'reran', false)];
    const scoreEntries = [makeScoreEntry(3, 'reran', true), makeScoreEntry(4, 'reused', false)];

    const plan = buildReevaluationPlan({
      scope: 'default',
      dryRun: false,
      jobId: null,
      filterEntries,
      scoreEntries,
      skipped: [],
      scoringPlan: BASE_SCORING_PLAN,
      scoringDeclinedByUser: false,
    });

    expect(plan.totals.scoresInvalidated).toBe(2);
  });

  it('scoringDeclinedByUser flag passes through unchanged', () => {
    const scoreEntries = [makeScoreEntry(1, 'reran')];
    const plan = buildReevaluationPlan({
      scope: 'default',
      dryRun: false,
      jobId: null,
      filterEntries: [],
      scoreEntries,
      skipped: [],
      scoringPlan: BASE_SCORING_PLAN,
      scoringDeclinedByUser: true,
    });

    expect(plan.totals.scoringDeclinedByUser).toBe(true);
    // The entries were not executed; the totals reflect the
    // would-have-been plan but the decline flag is recorded.
    expect(plan.totals.scoresRerun).toBe(1);
  });

  it('dryRun with a numeric LinkedIn sourceJobId is preserved verbatim', () => {
    const filterEntries: ReevaluationPlanEntry[] = [
      {
        jobId: 'job_7',
        internalId: 7,
        sourceJobId: '3857123456',
        action: 'would-rerun',
        fingerprint: 'abcdef0123456789',
        scoreInvalidated: false,
      },
    ];

    const plan = buildReevaluationPlan({
      scope: 'job',
      dryRun: true,
      jobId: '3857123456',
      filterEntries,
      scoreEntries: [],
      skipped: [],
      scoringPlan: null,
      scoringDeclinedByUser: false,
    });

    expect(plan.jobId).toBe('3857123456');
    expect(plan.filtersToReevaluate[0]?.sourceJobId).toBe('3857123456');
  });

  it('skipped entries of every documented reason are carried through', () => {
    const skipped = [
      makeSkippedEntry(1, 'filter_update_required'),
      makeSkippedEntry(2, 'job_not_complete'),
      makeSkippedEntry(3, 'job_not_found'),
    ];

    const plan = buildReevaluationPlan({
      scope: 'default',
      dryRun: false,
      jobId: null,
      filterEntries: [],
      scoreEntries: [],
      skipped,
      scoringPlan: null,
      scoringDeclinedByUser: false,
    });

    expect(plan.skipped).toHaveLength(3);
    expect(plan.totals.skipped).toBe(3);
    expect(plan.skipped.map((s) => s.reason)).toEqual([
      'filter_update_required',
      'job_not_complete',
      'job_not_found',
    ]);
  });
});

void TS;
