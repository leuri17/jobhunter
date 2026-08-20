import type { ScoringStructuredOutput } from './schema.js';
import type { ScoringCategory } from './types.js';

/**
 * State vocabulary for TASK-014 — LinkedIn scoring
 * (SPEC §25 + §26 + §27.3–27.4 + §30).
 *
 * The shapes below are the typed contract between `service.ts`
 * and TASK-015's pipeline orchestrator. Pure TypeScript types
 * — no runtime values, no I/O.
 *
 * The overall scoring state vocabulary version. Bump on any
 * change to `ScoringOutcome`, `ScoringBatchOutcome`, `ScoringPlan`,
 * or related shapes. This is separate from
 * `SCORING_STRUCTURED_OUTPUT_SCHEMA_VERSION` (the Zod schema
 * version) because the state vocabulary can evolve independently
 * of the OpenAI structured-output projection.
 */
export const LINKEDIN_SCORING_SCHEMA_VERSION = 1 as const;
export type LinkedinScoringSchemaVersion = typeof LINKEDIN_SCORING_SCHEMA_VERSION;

/** The 7 scoring categories from SPEC §26.2. Re-exported from `./types.ts`
 *  for convenience so consumers can import everything from `./state.js`. */
export type { ScoringCategory } from './types.js';
export { SCORING_CATEGORIES } from './types.js';

/** Outcome kind for a single job's scoring attempt (SPEC §25.3 + §26.1). */
export type ScoringKind = 'reused' | 'complete' | 'failed' | 'skipped' | 'cancelled';

/** Tag for the only scoring method in MVP — OpenAI structured output. */
export type ScoringMethod = 'openai_structured_output';

/**
 * The structured fields returned by OpenAI for one scoring request.
 * Derived from the Zod source of truth via `z.infer` (H6) so the
 * type and the validator stay in lock-step.
 */
export type ScoringFieldSet = ScoringStructuredOutput;

/** Outcome for one job (the in-process typed result, not a JSON contract). */
export interface ScoringOutcome {
  readonly schemaVersion: LinkedinScoringSchemaVersion;
  readonly jobId: number;
  readonly sourceJobId: string;
  readonly kind: ScoringKind;
  readonly overallScore: number | null;
  readonly displayScore: string | null;
  readonly fingerprint: string;
  readonly fields: ScoringFieldSet | null;
  readonly attempted: boolean;
  readonly errorCode: string | null;
  readonly errorMessage: string | null;
  readonly artifactIds: readonly number[];
}

/** Aggregate of every per-job outcome in a single `scoreBatch` call. */
export interface ScoringBatchOutcome {
  readonly schemaVersion: LinkedinScoringSchemaVersion;
  readonly runId: number;
  readonly searchExecutionId: number;
  readonly perJob: readonly ScoringOutcome[];
  readonly totals: {
    readonly complete: number;
    readonly reused: number;
    readonly failed: number;
    readonly skipped: number;
    readonly cancelled: number;
  };
}

/** Per-job entry in the `ScoringPlan` consumed by TASK-015's confirmation UI. */
export interface ScoringPlanEntry {
  readonly jobId: number;
  readonly sourceJobId: string;
  readonly kind: ScoringKind;
  readonly isEligible: boolean;
  readonly estimatedInputBytes: number;
  readonly reason: string | null;
}

/** Data structure that the TASK-015 orchestrator uses for the confirmation UI. */
export interface ScoringPlan {
  readonly schemaVersion: LinkedinScoringSchemaVersion;
  readonly runId: number;
  readonly searchExecutionId: number;
  readonly jobsDiscovered: number;
  readonly jobsAccepted: number;
  readonly scoresReused: number;
  readonly newOpenAIRequests: number;
  readonly skippedScoringCategories: readonly ScoringCategory[];
  readonly scoringConcurrency: number;
  readonly perJob: readonly ScoringPlanEntry[];
}
