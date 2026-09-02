/**
 * Zod schemas for the JSON envelope produced by the
 * `reevaluate` sidecar route.
 *
 * The schemas are the source of truth for the JSON contract — the
 * producer (service + sidecar) trusts the service output, but
 * consumers + tests run `safeParse` against the schema to catch
 * regressions. Every payload carries `schemaVersion: 1` as the
 * first key so consumers can branch on version without parsing the
 * whole document.
 *
 *   did NOT extract `ScoringPlan` to a JSON Zod
 * schema because the plan is internal-only. The reevaluation module
 * inlines the minimal `ScoringPlan` shape here (via `z.object(...).strict()`).
 * A future task may extract it to `src/scoring/json-schemas.ts` if
 * other consumers surface.
 *
 * All string fields use plain `z.string()` (no ISO 8601 regex needed
 * for the plan entries — only `ScoringPlan` carries ISO timestamps,
 * and the timestamps inside `ScoringPlan` are produced by the
 *  pipeline scorer + planner, which already enforce the
 * format upstream).
 */

import { z } from 'zod';

/** The literal schema version. Mirrors `REEVALUATION_SCHEMA_VERSION`. */
const REEVALUATION_SCHEMA_VERSION_LITERAL = z.literal(1);

/**
 * The seven `ScoringCategory` values from `src/scoring/types.ts`.
 * Re-declared inline because this module's pure layer does NOT
 * import `src/scoring/` (the boundaries test would flag the
 * dependency).
 */
const SCORING_CATEGORY_LITERAL = z.union([
  z.literal('technicalSkills'),
  z.literal('relevantExperience'),
  z.literal('roleResponsibilityFit'),
  z.literal('seniorityFit'),
  z.literal('domainIndustryFit'),
  z.literal('spokenLanguageCompatibility'),
  z.literal('locationWorkplaceCompatibility'),
]);

/** Scoring-kind union mirrored from `ScoringKind` in `src/scoring/state.ts`. */
const SCORING_KIND_LITERAL = z.union([
  z.literal('reused'),
  z.literal('complete'),
  z.literal('failed'),
  z.literal('skipped'),
  z.literal('cancelled'),
]);

/**
 * Inline `ScoringPlanEntry` shape — the per-job entry inside the
 * `ScoringPlan.perJob` array. Mirrors `ScoringPlanEntry` from
 * `src/scoring/state.ts:72-79` field-for-field.
 */
const ScoringPlanEntryJsonSchema = z
  .object({
    jobId: z.number().int(),
    sourceJobId: z.string(),
    kind: SCORING_KIND_LITERAL,
    isEligible: z.boolean(),
    estimatedInputBytes: z.number().int().nonnegative(),
    reason: z.string().nullable(),
  })
  .strict();

/**
 * Inline `ScoringPlan` shape. Mirrors `ScoringPlan`
 * from `src/scoring/state.ts:82-93` field-for-field. The schema is
 * declared `.strict()` so unknown fields cause a validation failure
 * (mirrors the inspection-module conventions — ).
 */
export const ScoringPlanJsonSchema = z
  .object({
    schemaVersion: z.literal(1),
    runId: z.number().int(),
    searchExecutionId: z.number().int(),
    jobsDiscovered: z.number().int().nonnegative(),
    jobsAccepted: z.number().int().nonnegative(),
    scoresReused: z.number().int().nonnegative(),
    newOpenAIRequests: z.number().int().nonnegative(),
    skippedScoringCategories: z.array(SCORING_CATEGORY_LITERAL),
    scoringConcurrency: z.number().int().positive(),
    perJob: z.array(ScoringPlanEntryJsonSchema),
  })
  .strict();

/**
 * One row in the `filtersToReevaluate` / `jobsToScore` arrays
 * Mirrors `ReevaluationPlanEntry` from
 * `src/reevaluation/state.ts` field-for-field.
 */
const ReevaluationPlanEntryJsonSchema = z
  .object({
    jobId: z.string(),
    internalId: z.number().int(),
    sourceJobId: z.string(),
    action: z.union([z.literal('would-rerun'), z.literal('reran'), z.literal('reused')]),
    fingerprint: z.string(),
    scoreInvalidated: z.boolean(),
  })
  .strict();

/**
 * One row in the `skipped` array. Mirrors
 * `ReevaluationSkippedEntry` from `src/reevaluation/state.ts`
 * field-for-field.
 */
const ReevaluationSkippedEntryJsonSchema = z
  .object({
    jobId: z.string(),
    internalId: z.number().int(),
    sourceJobId: z.string(),
    reason: z.union([
      z.literal('filter_update_required'),
      z.literal('job_not_complete'),
      z.literal('job_not_found'),
    ]),
  })
  .strict();

/**
 * The `totals` block on every payload. All integer fields
 * are non-negative.
 */
const ReevaluationTotalsJsonSchema = z
  .object({
    filtersRerun: z.number().int().nonnegative(),
    scoresRerun: z.number().int().nonnegative(),
    scoresInvalidated: z.number().int().nonnegative(),
    skipped: z.number().int().nonnegative(),
    scoringDeclinedByUser: z.boolean(),
  })
  .strict();

/**
 * The top-level `--json` payload. Mirrors
 * `ReevaluationPlan` from `src/reevaluation/state.ts` field-for-field.
 *
 * The schema is `.strict()` — unknown fields are rejected. The
 * `schemaVersion` literal pins the contract to version 1.
 */
export const REEVALUATION_JSON_SCHEMA = z
  .object({
    schemaVersion: REEVALUATION_SCHEMA_VERSION_LITERAL,
    scope: z.union([
      z.literal('default'),
      z.literal('filters-only'),
      z.literal('scores-only'),
      z.literal('job'),
    ]),
    dryRun: z.boolean(),
    jobId: z.string().nullable(),
    filtersToReevaluate: z.array(ReevaluationPlanEntryJsonSchema),
    jobsToScore: z.array(ReevaluationPlanEntryJsonSchema),
    skipped: z.array(ReevaluationSkippedEntryJsonSchema),
    scoringPlan: ScoringPlanJsonSchema.nullable(),
    totals: ReevaluationTotalsJsonSchema,
  })
  .strict();

/** Inferred TypeScript type for the `--json` payload. */
export type ReevaluationJsonPayload = z.infer<typeof REEVALUATION_JSON_SCHEMA>;
/** Inferred TypeScript type for one plan entry in the `--json` output. */
export type ReevaluationPlanEntryJson = z.infer<typeof ReevaluationPlanEntryJsonSchema>;
/** Inferred TypeScript type for one skipped entry in the `--json` output. */
export type ReevaluationSkippedEntryJson = z.infer<typeof ReevaluationSkippedEntryJsonSchema>;
/** Inferred TypeScript type for the inlined `ScoringPlan` JSON shape. */
export type ScoringPlanJson = z.infer<typeof ScoringPlanJsonSchema>;
