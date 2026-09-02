/**
 * State vocabulary for  — explicit job reevaluation and scope
 * handling.
 *
 * The shapes below are the typed contract between the reevaluation
 * service layer and the formatter + JSON-schema layers (this
 * wave). Pure TypeScript types — no runtime values, no I/O.
 *
 * The scope vocabulary and skip reasons (Decisions 6 +
 * 7) are documented in the  plan. The JSON schema in
 * `./json-schemas.ts` mirrors these literals via `z.union([...])`
 * adding a new scope or skip reason is a coordinated edit across this
 * file + the schema + the sidecar route.
 *
 * No new state vocabulary is introduced outside this module.
 */

/**
 * JSON schema version for every JSON payload produced by the
 * reevaluation module. Bumped on any payload shape change
 * so consumers can detect breaking changes via `schemaVersion`.
 * Mirrors `INSPECTION_SCHEMA_VERSION`, `PIPELINE_SCHEMA_VERSION`,
 * `LINKEDIN_SCORING_SCHEMA_VERSION`.
 */
export const REEVALUATION_SCHEMA_VERSION = 1 as const;
export type ReevaluationSchemaVersion = typeof REEVALUATION_SCHEMA_VERSION;

/**
 * Re-evaluation scope vocabulary. The sidecar route maps
 * the documented scope flag set to one of these literals BEFORE calling the
 * service. The plan envelope + the JSON output both carry the
 * scope verbatim so consumers can branch on it.
 *
 * - `default`      — every complete job with a stale/missing filter OR
 *                    a stale/missing score (when the current filter is
 *                    `accepted`).
 * - `filters-only` — every complete job whose current fingerprint
 *                    doesn't match an active filter result.
 * - `scores-only`  — every complete job with a current accepted
 *                    filter but no active successful score.
 * - `job`          — single-job mode (combined with `filters-only`,
 *                    `scores-only`, `dry-run`, or no other flag).
 */
export type ReevaluationScope = 'default' | 'filters-only' | 'scores-only' | 'job';

/**
 * Action label for one `ReevaluationPlanEntry`. In `dry-run` mode every action is `'would-rerun'`;
 * in live mode entries flip to `'reran'` or `'reused'` as the service
 * executes them.
 */
export type ReevaluationPlanAction = 'would-rerun' | 'reran' | 'reused';

/**
 * Reason for a `ReevaluationSkippedEntry` (Decisions 6 + 7 +
 * ).
 *
 * - `filter_update_required` — `scores-only` skipped a job because
 *   its current filter is stale or missing.
 * - `job_not_complete`       — `job <id>` resolved a non-complete
 *   job (sidecar translates to `ReevaluationValidationError`).
 * - `job_not_found`          — `job <id>` resolved no row (sidecar
 *   translates to `ReevaluationValidationError`).
 */
export type ReevaluationSkipReason =
  'filter_update_required' | 'job_not_complete' | 'job_not_found';

/**
 * One row in the `ReevaluationPlan.filtersToReevaluate` /
 * `ReevaluationPlan.jobsToScore` arrays. The per-row
 * fingerprint is the new filter fingerprint (after rerun) or the
 * reused fingerprint when the action is `'reused'`.
 */
export interface ReevaluationPlanEntry {
  readonly jobId: string;
  readonly internalId: number;
  readonly sourceJobId: string;
  readonly action: ReevaluationPlanAction;
  readonly fingerprint: string;
  readonly scoreInvalidated: boolean;
}

/**
 * One row in the `ReevaluationPlan.skipped` array.
 */
export interface ReevaluationSkippedEntry {
  readonly jobId: string;
  readonly internalId: number;
  readonly sourceJobId: string;
  readonly reason: ReevaluationSkipReason;
}

/**
 * Re-export of the `ScoringPlan` shape consumed by the JSON output
 * for `scores-only` / `dry-run` scopes.
 * The reevaluation module does NOT mutate this shape — the
 * `ScoringService.buildScoringPlan` builder produces it and
 * the reevaluation service carries it through verbatim. Re-exported
 * here so consumers can import the entire reevaluation contract from
 * a single module.
 */
export type { ScoringPlan } from '../scoring/state.js';
import type { ScoringPlan } from '../scoring/state.js';

/**
 * Top-level totals block for `ReevaluationPlan.totals`. The numeric
 * fields mirror the per-section lengths + score-invalidation counts
 * so consumers do not have to re-aggregate. `scoringDeclinedByUser` is
 * `true` when the user was prompted for scoring confirmation and
 * declined (  — `yes` bypasses the prompt).
 */
export interface ReevaluationTotals {
  readonly filtersRerun: number;
  readonly scoresRerun: number;
  readonly scoresInvalidated: number;
  readonly skipped: number;
  readonly scoringDeclinedByUser: boolean;
}

/**
 * The structured plan returned by `ReevaluationService.execute`
 * and rendered by the formatter + JSON schema. The shape
 * is the consumer-facing contract; the per-job `fingerprint` is the
 * new filter fingerprint (or the reused one), and the `action`
 * labels describe what the service did (or would have done in
 * `dry-run` mode — ).
 *
 * `jobId` is `null` for every scope except `job`, where it is the
 * caller-supplied identifier verbatim. `scoringPlan` is `null` when no
 * OpenAI-scored work was produced (e.g. `filters-only`, empty
 * `dry-run`, or `job` with a fully fresh score).
 */
export interface ReevaluationPlan {
  readonly schemaVersion: typeof REEVALUATION_SCHEMA_VERSION;
  readonly scope: ReevaluationScope;
  readonly dryRun: boolean;
  readonly jobId: string | null;
  readonly filtersToReevaluate: readonly ReevaluationPlanEntry[];
  readonly jobsToScore: readonly ReevaluationPlanEntry[];
  readonly skipped: readonly ReevaluationSkippedEntry[];
  readonly scoringPlan: ScoringPlan | null;
  readonly totals: ReevaluationTotals;
}

/**
 * The envelope returned by `ReevaluationService.execute`.
 * The shape wraps the plan for forward-compat — the service may add
 * fields (e.g. a generated `runId`, an execution log) without
 * breaking existing consumers of `ReevaluationPlan`.
 */
export interface ReevaluationOutcome {
  readonly plan: ReevaluationPlan;
}

/**
 * The input shape passed by the sidecar route into
 * `ReevaluationService.execute`. The sidecar route maps the
 * scope flag set onto the scope literal BEFORE calling the
 * service — the service only sees a fully validated input.
 *
 * - `scope`               — the four-value enum from this file.
 * - `dryRun`              — true when `dry-run` was supplied.
 * - `confirmScoring`      — true when the service should prompt the
 *                           user before the scoring batch. The sidecar
 *                           route computes `!options.yes`; for
 *                           `filters-only` / `dry-run` scopes the
 *                           service overrides this to `false` because
 *                           no OpenAI requests are produced.
 * - `jobId`               — internal job id for `job` scope. The
 *                           sidecar route resolves the caller
 *                           identifier (`job_<int>` or numeric
 *                           LinkedIn `sourceJobId`) via
 *                           `resolveJobIdentifier` and passes the
 *                           resolved integer id here. Ignored for
 *                           every other scope.
 * - `env`                 — `process.env` (or a stub). The service
 *                           reads `OPENAI_API_KEY` for the
 *                           prerequisite check.
 * - `now`                 — injectable clock (defaults to `new Date()`
 *                           inside the service).
 * - `runId`               — optional sentinel. The reevaluation is
 *                           NOT a pipeline run; the service passes
 *                           `runId ?? 0` to `ScoringService.scoreOne`
 *                           because the score-result row requires a
 *                           non-null `pipelineRunId`. Future tasks
 *                           may add a `reevaluationRuns` table to
 *                           resolve the audit lineage properly.
 */
export interface ReevaluationExecuteInput {
  readonly scope: ReevaluationScope;
  readonly dryRun: boolean;
  readonly confirmScoring: boolean;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly jobId?: number | null;
  readonly now?: () => Date;
  readonly runId?: number | null;
}
