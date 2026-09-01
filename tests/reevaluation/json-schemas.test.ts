import { describe, expect, it } from 'vitest';

import {
  REEVALUATION_JSON_SCHEMA,
  ScoringPlanJsonSchema,
} from '../../src/reevaluation/json-schemas.js';
import {
  REEVALUATION_SCHEMA_VERSION,
  type ReevaluationPlan,
} from '../../src/reevaluation/state.js';

/**
 * Pure-helper tests for the Zod schemas in
 * `src/reevaluation/json-schemas.ts`.
 *
 * The schemas are the source of truth for the `--json` payload
 * contract. These tests:
 *   - Build a representative fixture for every documented scope
 *     (`default`, `filters-only`, `scores-only`, `job`, plus
 *     `--dry-run` variants) and assert
 *     `REEVALUATION_JSON_SCHEMA.safeParse(fixture).success === true`.
 *   - Pin the `schemaVersion` contract: missing field fails; `2`
 *     is rejected; only the literal `1` succeeds.
 *   - Pin the type contract: `dryRun: 'yes'` is rejected (boolean
 *     required); `action: 'unknown'` is rejected; `reason:
 *     'unknown'` is rejected.
 *
 * No live DB, no I/O — pure in-memory Zod validation.
 *
 * Note: many fixture values are intentionally widened to `unknown`
 * so the TypeScript compiler does not pre-reject invalid payloads
 * that the Zod schema is meant to detect.
 */

const SCORING_PLAN_FIXTURE = {
  schemaVersion: 1,
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
} as const;

/**
 * Build a `ReevaluationPlan` fixture (typed) and cast to a plain
 * mutable object so individual tests can override fields with
 * deliberately-invalid values without TypeScript pre-rejecting them.
 */
function buildFixture(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const base: ReevaluationPlan = {
    schemaVersion: REEVALUATION_SCHEMA_VERSION,
    scope: 'default',
    dryRun: false,
    jobId: null,
    filtersToReevaluate: [],
    jobsToScore: [],
    skipped: [],
    scoringPlan: null,
    totals: {
      filtersRerun: 0,
      scoresRerun: 0,
      scoresInvalidated: 0,
      skipped: 0,
      scoringDeclinedByUser: false,
    },
  };
  return { ...base, ...overrides } as unknown as Record<string, unknown>;
}

describe('REEVALUATION_JSON_SCHEMA', () => {
  it('accepts a representative default-scope fixture', () => {
    const fixture = buildFixture({
      filtersToReevaluate: [
        {
          jobId: 'job_1',
          internalId: 1,
          sourceJobId: 'src-1',
          action: 'reran',
          fingerprint: 'fp-1-abcdef',
          scoreInvalidated: false,
        },
      ],
      jobsToScore: [
        {
          jobId: 'job_2',
          internalId: 2,
          sourceJobId: 'src-2',
          action: 'reran',
          fingerprint: 'fp-2-abcdef',
          scoreInvalidated: false,
        },
      ],
      scoringPlan: SCORING_PLAN_FIXTURE,
      totals: {
        filtersRerun: 1,
        scoresRerun: 1,
        scoresInvalidated: 0,
        skipped: 0,
        scoringDeclinedByUser: false,
      },
    });
    const result = REEVALUATION_JSON_SCHEMA.safeParse(fixture);
    expect(result.success).toBe(true);
  });

  it('accepts a filters-only fixture', () => {
    const fixture = buildFixture({
      scope: 'filters-only',
      filtersToReevaluate: [
        {
          jobId: 'job_1',
          internalId: 1,
          sourceJobId: 'src-1',
          action: 'reran',
          fingerprint: 'fp-1-abcdef',
          scoreInvalidated: true,
        },
      ],
      totals: {
        filtersRerun: 1,
        scoresRerun: 0,
        scoresInvalidated: 1,
        skipped: 0,
        scoringDeclinedByUser: false,
      },
    });
    const result = REEVALUATION_JSON_SCHEMA.safeParse(fixture);
    expect(result.success).toBe(true);
  });

  it('accepts a scores-only fixture with scoringPlan populated', () => {
    const fixture = buildFixture({
      scope: 'scores-only',
      jobsToScore: [
        {
          jobId: 'job_1',
          internalId: 1,
          sourceJobId: 'src-1',
          action: 'reran',
          fingerprint: 'fp-1-abcdef',
          scoreInvalidated: false,
        },
      ],
      scoringPlan: SCORING_PLAN_FIXTURE,
      totals: {
        filtersRerun: 0,
        scoresRerun: 1,
        scoresInvalidated: 0,
        skipped: 0,
        scoringDeclinedByUser: false,
      },
    });
    const result = REEVALUATION_JSON_SCHEMA.safeParse(fixture);
    expect(result.success).toBe(true);
  });

  it('accepts a job-scope fixture (jobId populated, scoringPlan null)', () => {
    const fixture = buildFixture({
      scope: 'job',
      jobId: 'job_42',
      filtersToReevaluate: [
        {
          jobId: 'job_42',
          internalId: 42,
          sourceJobId: 'src-42',
          action: 'reran',
          fingerprint: 'fp-42-abcdef',
          scoreInvalidated: false,
        },
      ],
    });
    const result = REEVALUATION_JSON_SCHEMA.safeParse(fixture);
    expect(result.success).toBe(true);
  });

  it('accepts a job-scope fixture with a numeric LinkedIn jobId', () => {
    const fixture = buildFixture({
      scope: 'job',
      jobId: '3857123456',
      filtersToReevaluate: [],
    });
    const result = REEVALUATION_JSON_SCHEMA.safeParse(fixture);
    expect(result.success).toBe(true);
  });

  it('accepts a --dry-run fixture (every action is "would-rerun")', () => {
    const fixture = buildFixture({
      dryRun: true,
      filtersToReevaluate: [
        {
          jobId: 'job_1',
          internalId: 1,
          sourceJobId: 'src-1',
          action: 'would-rerun',
          fingerprint: 'fp-1-abcdef',
          scoreInvalidated: false,
        },
      ],
      jobsToScore: [
        {
          jobId: 'job_2',
          internalId: 2,
          sourceJobId: 'src-2',
          action: 'would-rerun',
          fingerprint: 'fp-2-abcdef',
          scoreInvalidated: false,
        },
      ],
    });
    const result = REEVALUATION_JSON_SCHEMA.safeParse(fixture);
    expect(result.success).toBe(true);
  });

  it('accepts a fixture with skipped entries', () => {
    const fixture = buildFixture({
      skipped: [
        {
          jobId: 'job_99',
          internalId: 99,
          sourceJobId: 'src-99',
          reason: 'filter_update_required',
        },
      ],
      totals: {
        filtersRerun: 0,
        scoresRerun: 0,
        scoresInvalidated: 0,
        skipped: 1,
        scoringDeclinedByUser: false,
      },
    });
    const result = REEVALUATION_JSON_SCHEMA.safeParse(fixture);
    expect(result.success).toBe(true);
  });

  it('rejects a missing schemaVersion', () => {
    const fixture = buildFixture();
    const { schemaVersion: _omit, ...withoutSchemaVersion } = fixture;
    void _omit;
    const result = REEVALUATION_JSON_SCHEMA.safeParse(withoutSchemaVersion);
    expect(result.success).toBe(false);
  });

  it('rejects schemaVersion: 2 (only literal 1 is accepted)', () => {
    const fixture = buildFixture({ schemaVersion: 2 });
    const result = REEVALUATION_JSON_SCHEMA.safeParse(fixture);
    expect(result.success).toBe(false);
  });

  it('rejects schemaVersion: "1" (string form rejected)', () => {
    const fixture = buildFixture({ schemaVersion: '1' });
    const result = REEVALUATION_JSON_SCHEMA.safeParse(fixture);
    expect(result.success).toBe(false);
  });

  it('rejects dryRun: "yes" (boolean required)', () => {
    const fixture = buildFixture({ dryRun: 'yes' });
    const result = REEVALUATION_JSON_SCHEMA.safeParse(fixture);
    expect(result.success).toBe(false);
  });

  it('rejects an unknown action label', () => {
    const fixture = buildFixture({
      filtersToReevaluate: [
        {
          jobId: 'job_1',
          internalId: 1,
          sourceJobId: 'src-1',
          action: 'unknown',
          fingerprint: 'fp-1-abcdef',
          scoreInvalidated: false,
        },
      ],
    });
    const result = REEVALUATION_JSON_SCHEMA.safeParse(fixture);
    expect(result.success).toBe(false);
  });

  it('rejects an unknown skip reason', () => {
    const fixture = buildFixture({
      skipped: [
        {
          jobId: 'job_99',
          internalId: 99,
          sourceJobId: 'src-99',
          reason: 'unknown',
        },
      ],
    });
    const result = REEVALUATION_JSON_SCHEMA.safeParse(fixture);
    expect(result.success).toBe(false);
  });

  it('rejects an unknown scope', () => {
    const fixture = buildFixture({ scope: 'unknown' });
    const result = REEVALUATION_JSON_SCHEMA.safeParse(fixture);
    expect(result.success).toBe(false);
  });

  it('rejects a negative filterResults count (non-negative integer required)', () => {
    const fixture = buildFixture({
      totals: {
        filtersRerun: -1,
        scoresRerun: 0,
        scoresInvalidated: 0,
        skipped: 0,
        scoringDeclinedByUser: false,
      },
    });
    const result = REEVALUATION_JSON_SCHEMA.safeParse(fixture);
    expect(result.success).toBe(false);
  });

  it('rejects unknown top-level keys (strict schema)', () => {
    const fixture = { ...buildFixture(), extraField: 'extra' };
    const result = REEVALUATION_JSON_SCHEMA.safeParse(fixture);
    expect(result.success).toBe(false);
  });

  it('rejects when filtersToReevaluate is missing (required key)', () => {
    const fixture = buildFixture();
    const { filtersToReevaluate: _omit, ...without } = fixture;
    void _omit;
    const result = REEVALUATION_JSON_SCHEMA.safeParse(without);
    expect(result.success).toBe(false);
  });

  it('rejects when scoringPlan has the wrong kind for perJob entries', () => {
    const fixture = buildFixture({
      scoringPlan: {
        ...SCORING_PLAN_FIXTURE,
        perJob: [
          {
            jobId: 1,
            sourceJobId: 'src-1',
            kind: 'unknown',
            isEligible: true,
            estimatedInputBytes: 50_000,
            reason: null,
          },
        ],
      },
    });
    const result = REEVALUATION_JSON_SCHEMA.safeParse(fixture);
    expect(result.success).toBe(false);
  });
});

describe('ScoringPlanJsonSchema (,  inline shape)', () => {
  it('accepts the canonical fixture', () => {
    const result = ScoringPlanJsonSchema.safeParse(SCORING_PLAN_FIXTURE);
    expect(result.success).toBe(true);
  });

  it('accepts a fixture with skippedScoringCategories populated', () => {
    const result = ScoringPlanJsonSchema.safeParse({
      ...SCORING_PLAN_FIXTURE,
      skippedScoringCategories: ['seniorityFit', 'domainIndustryFit'],
    });
    expect(result.success).toBe(true);
  });

  it('rejects an unknown ScoringCategory in skippedScoringCategories', () => {
    const result = ScoringPlanJsonSchema.safeParse({
      ...SCORING_PLAN_FIXTURE,
      skippedScoringCategories: ['unknown_category'],
    });
    expect(result.success).toBe(false);
  });

  it('rejects scoringConcurrency: 0 (positive integer required)', () => {
    const result = ScoringPlanJsonSchema.safeParse({
      ...SCORING_PLAN_FIXTURE,
      scoringConcurrency: 0,
    });
    expect(result.success).toBe(false);
  });

  it('rejects a missing runId (required key)', () => {
    const { runId: _omit, ...without } = SCORING_PLAN_FIXTURE as unknown as Record<string, unknown>;
    void _omit;
    const result = ScoringPlanJsonSchema.safeParse(without);
    expect(result.success).toBe(false);
  });

  it('rejects schemaVersion: 2 in the inline ScoringPlan shape', () => {
    const result = ScoringPlanJsonSchema.safeParse({
      ...SCORING_PLAN_FIXTURE,
      schemaVersion: 2,
    });
    expect(result.success).toBe(false);
  });
});
