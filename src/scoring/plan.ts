import type { ScoringKind, ScoringPlan, ScoringPlanEntry } from './state.js';
import { LINKEDIN_SCORING_SCHEMA_VERSION } from './state.js';
import type { ScoringCategory } from './types.js';

/**
 * Inputs to `buildScoringPlan`. Pure data — no I/O. The caller (the
 *  orchestrator) resolves the per-job eligibility + score-kind
 * maps; the function below aggregates them into the `ScoringPlan` shape
 * that the confirmation UI consumes.
 */
export interface BuildScoringPlanInput {
  readonly run: { readonly id: number };
  readonly searchExecution: { readonly id: number };
  readonly jobs: readonly {
    readonly id: number;
    readonly sourceJobId: string;
    readonly estimatedInputBytes: number;
  }[];
  readonly eligibleFlags: ReadonlyMap<
    number,
    { readonly isEligible: boolean; readonly reason: string | null }
  >;
  readonly scoreKinds: ReadonlyMap<number, ScoringKind>;
  readonly scoringConcurrency: number;
  readonly skippedScoringCategories?: readonly ScoringCategory[];
}

/**
 * Build the `ScoringPlan` data structure.
 *
 * - `perJob`: one entry per job in the input order. The default eligibility
 *   flag is `isEligible: true, reason: null` (a job with no flag entry is
 *   treated as eligible). The default kind is `'skipped'` (a job with no
 *   kind entry is treated as not-yet-scored).
 * - `jobsAccepted`: number of `perJob` entries with `isEligible: true`.
 * - `scoresReused`: number of `perJob` entries with `kind: 'reused'`.
 * - `newOpenAIRequests`: number of `perJob` entries with `kind: 'complete'`.
 * - `skippedScoringCategories`: defaults to `[]` when omitted.
 * - `scoringConcurrency`: carried through unchanged.
 */
export function buildScoringPlan(input: BuildScoringPlanInput): ScoringPlan {
  const perJob: ScoringPlanEntry[] = input.jobs.map((job) => {
    const flag = input.eligibleFlags.get(job.id) ?? { isEligible: true, reason: null };
    const kind = input.scoreKinds.get(job.id) ?? 'skipped';
    return {
      jobId: job.id,
      sourceJobId: job.sourceJobId,
      kind,
      isEligible: flag.isEligible,
      estimatedInputBytes: job.estimatedInputBytes,
      reason: flag.reason,
    };
  });

  const jobsAccepted = perJob.filter((entry) => entry.isEligible).length;
  const scoresReused = perJob.filter((entry) => entry.kind === 'reused').length;
  const newOpenAIRequests = perJob.filter((entry) => entry.kind === 'complete').length;

  return {
    schemaVersion: LINKEDIN_SCORING_SCHEMA_VERSION,
    runId: input.run.id,
    searchExecutionId: input.searchExecution.id,
    jobsDiscovered: input.jobs.length,
    jobsAccepted,
    scoresReused,
    newOpenAIRequests,
    skippedScoringCategories: input.skippedScoringCategories ?? [],
    scoringConcurrency: input.scoringConcurrency,
    perJob,
  };
}
