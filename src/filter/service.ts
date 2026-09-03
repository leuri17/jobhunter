import { type Repositories } from '../persistence/repositories/index.js';
import { type ProfessionalProfile } from '../profile/schema.js';
import { calculateFilterFingerprint } from './fingerprint.js';
import {
  evaluateJob,
  type FilterEvaluationResult,
  type JobInput,
  type RuleEvaluation,
} from './evaluate.js';
import { type JobFilterConfig } from './schema.js';
import { FILTER_IMPLEMENTATION_VERSION } from './version.js';
import { type FilterOutcome } from '../persistence/repositories/filter-results.js';
import { NoActiveFilterConfigError } from './errors.js';

/**
 * `FilterApplyService` — application service that applies the global
 * deterministic filter engine to a single complete job.
 *
 * The service is the **cache ledger**: it consults
 * `filterResults.findActiveByJob(jobId, fingerprint)` and re-activates a
 * fresh row only when no match exists. The cache key is the fingerprint
 * computed from the active config hash, the relevant profile slice, and
 * the job content hash (Task 7).
 *
 * Flow:
 *
 *   1. Load the active `filter_configuration_versions` row. If absent,
 *      throw `NoActiveFilterConfigError` — the orchestrator must refuse to
 *      run a pipeline without an active global configuration.
 *   2. Load the active approved `profile_versions` row (may be `null`).
 *      The fingerprint composer's profile slice is `null` when there is no
 *      active profile (per Task 7).
 *   3. Compute the fingerprint from the job, the active config, and the
 *      profile slice.
 *   4. Cache hit: return the existing row's outcome, evaluations,
 *      reasons, and `reused: true`. No writes.
 *   5. Cache miss: run `evaluateJob(config, job)`, then persist via
 *      `filterResults.activateResult(...)`. The repository atomically
 *      flips any prior active row for the same job to `active = false`
 *      and inserts the new active row.
 *   6. Return `{ outcome, filterResultId, fingerprint, ruleEvaluations,
 *      rejectionReasons, reused: false }`.
 *
 * The service NEVER calls OpenAI (AGENTS.md §9). It does NOT invalidate
 * other config versions or run-level caches — that is the orchestrator's
 * responsibility after a configuration swap. It does NOT touch the
 * pipeline run / score-result tables; the pipelineRunId is passed
 * through to the persisted row only.
 *
 * Domain-boundary note (AGENTS.md §5, §9): this module imports only the
 * sibling `src/filter/*` modules and the `Repositories` facade from
 * `src/persistence/repositories/index.js`. It is a pure helper that
 * does not depend on Playwright, Drizzle directly, OpenAI, or Pino.
 * The `tests/filter/boundaries.test.ts` guard enforces this.
 */

export interface FilterApplyServiceOptions {
  readonly repositories: Repositories;
  /** Override the wall-clock for tests; defaults to `() => new Date()`. */
  readonly now?: () => Date;
}

export interface FilterApplyInput {
  readonly jobId: number;
  /**
   * The pre-loaded job fields (`title`, `company`, `location`,
   * `description`). The caller is responsible for fetching the job
   * record (e.g. via `jobs.findById`); the service does not touch the
   * `jobs` table.
   */
  readonly job: JobInput;
  readonly pipelineRunId?: number | null;
}

export interface FilterApplyResult {
  readonly outcome: FilterOutcome;
  readonly filterResultId: number;
  readonly fingerprint: string;
  readonly ruleEvaluations: readonly RuleEvaluation[];
  readonly rejectionReasons: readonly string[];
  readonly reused: boolean;
}

export class FilterApplyService {
  private readonly repositories: Repositories;
  private readonly now: () => Date;

  constructor(options: FilterApplyServiceOptions) {
    this.repositories = options.repositories;
    this.now = options.now ?? ((): Date => new Date());
  }

  async apply(input: FilterApplyInput): Promise<FilterApplyResult> {
    const configRow = await this.repositories.filterConfigurations.findActive();
    if (configRow === null) {
      throw new NoActiveFilterConfigError();
    }

    const profileVersion = await this.repositories.profileVersions.findActiveApproved();
    // The fingerprint composer accepts `null` directly when no active
    // profile exists; the profile slice is `null` in that case.
    // `profileJson` is typed as `unknown`; the composer expects a
    // `ProfessionalProfile | null`. The persisted value is the validated
    // shape — Task 9 does NOT re-validate here (the `ProfileVersion`
    // parser at the persistence boundary owns validation).
    const fingerprint = calculateFilterFingerprint({
      job: input.job,
      // Trust the persisted config: `findActive` returns the raw JSON.
      // Pre-validation would duplicate the schema layer; a corrupt row
      // is a separate concern.
      config: configRow.configJson as JobFilterConfig,
      profile: (profileVersion?.profileJson ?? null) as ProfessionalProfile | null,
    });

    const existing = await this.repositories.filterResults.findActiveByJob(
      input.jobId,
      fingerprint,
    );
    if (existing !== null) {
      return {
        outcome: existing.overallOutcome,
        filterResultId: existing.id,
        fingerprint: existing.fingerprint,
        ruleEvaluations: existing.rulesEvaluated as readonly RuleEvaluation[],
        rejectionReasons: (existing.rejectionReasons ?? []) as readonly string[],
        reused: true,
      };
    }

    const evaluation: FilterEvaluationResult = evaluateJob(
      configRow.configJson as JobFilterConfig,
      input.job,
    );

    const filterResultId = await this.repositories.filterResults.activateResult({
      jobId: input.jobId,
      pipelineRunId: input.pipelineRunId ?? null,
      filterConfigVersionId: configRow.id,
      filterConfigHash: configRow.contentHash,
      profileVersionId: profileVersion?.id ?? null,
      profileHash: profileVersion?.contentHash ?? null,
      filterImplementationVersion: FILTER_IMPLEMENTATION_VERSION,
      fingerprint,
      timestamp: this.now().toISOString(),
      overallOutcome: evaluation.overallOutcome,
      rulesEvaluated: evaluation.rulesEvaluated,
      rulesPassed: evaluation.rulesPassed,
      rulesFailed: evaluation.rulesFailed,
      rejectionReasons: evaluation.rejectionReasons,
    });

    return {
      outcome: evaluation.overallOutcome,
      filterResultId,
      fingerprint,
      ruleEvaluations: evaluation.rulesEvaluated,
      rejectionReasons: evaluation.rejectionReasons,
      reused: false,
    };
  }
}
