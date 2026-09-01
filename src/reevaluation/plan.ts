/**
 * Pure plan aggregation for .
 *
 * `buildReevaluationPlan` is a TOTAL pure function: it carries its
 * inputs through to the `ReevaluationPlan` envelope and computes the
 * numeric totals. No I/O, no scoring, no DB. The service layer
 * assembles the per-job entries + the `ScoringPlan` and passes them
 * here; this module only does the bookkeeping.
 *
 * The selection order is `jobId ASC` (mirrors  — the
 * tie-breaker documented for inspection tables). Callers MUST supply
 * already-sorted entries; this function does NOT re-sort.
 */

import type {
  ReevaluationPlan,
  ReevaluationPlanEntry,
  ReevaluationScope,
  ReevaluationSkippedEntry,
  ScoringPlan,
} from './state.js';
import { REEVALUATION_SCHEMA_VERSION } from './state.js';

/**
 * Inputs to `buildReevaluationPlan`. Pure data — no I/O. The caller
 * (the  service) resolves the per-job selection + the
 * `ScoringPlan`; this module only does the aggregation.
 */
export interface BuildReevaluationPlanInput {
  readonly scope: ReevaluationScope;
  readonly dryRun: boolean;
  readonly jobId: string | null;
  readonly filterEntries: readonly ReevaluationPlanEntry[];
  readonly scoreEntries: readonly ReevaluationPlanEntry[];
  readonly skipped: readonly ReevaluationSkippedEntry[];
  readonly scoringPlan: ScoringPlan | null;
  readonly scoringDeclinedByUser: boolean;
}

/**
 * Assemble the `ReevaluationPlan` envelope from the selection inputs.
 *
 * Totals:
 *   - `filtersRerun`         — count of `filterEntries` (every
 *                              selected job that needed a filter
 *                              rerun, regardless of action label).
 *   - `scoresRerun`          — count of `scoreEntries` whose action
 *                              is NOT `'reused'` (a `'reused'` entry
 *                              did not trigger an OpenAI call).
 *   - `scoresInvalidated`    — sum of `scoreInvalidated` across
 *                              BOTH `filterEntries` AND `scoreEntries`
 *                              (the filter rerun can invalidate
 *                              dependent scores; the score rerun
 *                              itself does not).
 *   - `skipped`              — length of `skipped`.
 *   - `scoringDeclinedByUser` — pass-through of the input flag.
 *
 * `schemaVersion` is always `REEVALUATION_SCHEMA_VERSION`. The
 * per-section arrays are carried through unchanged — the caller has
 * already sorted them by `internalId ASC` (the documented tie-breaker).
 */
export function buildReevaluationPlan(input: BuildReevaluationPlanInput): ReevaluationPlan {
  const filtersRerun = input.filterEntries.length;
  const scoresRerun = input.scoreEntries.filter((e) => e.action !== 'reused').length;
  const scoresInvalidated =
    input.filterEntries.filter((e) => e.scoreInvalidated).length +
    input.scoreEntries.filter((e) => e.scoreInvalidated).length;

  return {
    schemaVersion: REEVALUATION_SCHEMA_VERSION,
    scope: input.scope,
    dryRun: input.dryRun,
    jobId: input.jobId,
    filtersToReevaluate: input.filterEntries,
    jobsToScore: input.scoreEntries,
    skipped: input.skipped,
    scoringPlan: input.scoringPlan,
    totals: {
      filtersRerun,
      scoresRerun,
      scoresInvalidated,
      skipped: input.skipped.length,
      scoringDeclinedByUser: input.scoringDeclinedByUser,
    },
  };
}
