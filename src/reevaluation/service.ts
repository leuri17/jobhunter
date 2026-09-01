/**
 * `ReevaluationService` — the application service that composes the
 * filter + score caches for `jobs reevaluate`.
 *
 * The service is the read-or-rerun execution engine: it walks every
 * complete job, classifies each as filter-stale / score-stale /
 * already-current, executes the planned reruns (or no-op for the
 * dry-run path), and produces the structured `ReevaluationPlan`
 * envelope the CLI renders + serializes as JSON.
 *
 * Composition:
 *   - `FilterApplyService.apply()`   — cache ledger for filter results
 *   - `ScoringService.scoreOne()`    — per-job scoring (with cache ledger)
 *   - `ScoringService.buildScoringPlan()` — builds the plan shown in
 *     the scoring confirmation prompt + the `--json` payload.
 *   - `PipelinePrompts.askScoringConfirmation()` — the user-facing
 *     gate before the scoring batch.
 *   - `Repositories.{jobs, filterConfigurations, filterResults,
 *     profileVersions, scoreResults}.*` — read-only cache checks +
 *     the `invalidateActiveByJob` flip after a filter rerun.
 *
 * Domain-boundary note (AGENTS.md §5, §9): the service + the
 * `fingerprint.ts` helper are the ONLY modules under
 * `src/reevaluation/` that import from `src/filter/`, `src/scoring/`,
 * `src/pipeline/`, and `src/persistence/`. The pure layer (state /
 * errors / plan / format / json-schemas / index / log) does NOT.
 *
 * The service NEVER calls `process.exit`. The CLI handler in
 *  owns the exit-code mapping via `exitWithError`.
 */

import type { FilterApplyResult, FilterApplyInput } from '../filter/service.js';
import type { FilterOutcome } from '../persistence/repositories/filter-results.js';
import type { JobRow } from '../persistence/repositories/jobs.js';
import type { Repositories } from '../persistence/repositories/index.js';
import type { ScoreOneInput } from '../scoring/service.js';
import type { ScoringOutcome, ScoringPlan } from '../scoring/state.js';
import type { BuildScoringPlanInput } from '../scoring/plan.js';
import { PipelinePrerequisiteError } from '../pipeline/errors.js';
import type { PipelinePrompts } from '../pipeline/prompts.js';
import { buildReevaluationPlan } from './plan.js';
import {
  type ReevaluationExecuteInput,
  type ReevaluationOutcome,
  type ReevaluationPlan,
  type ReevaluationPlanAction,
  type ReevaluationPlanEntry,
  type ReevaluationSkippedEntry,
} from './state.js';
import { computeFilterFingerprintForJob, computeScoreFingerprintForJob } from './fingerprint.js';
import { ReevaluationValidationError } from './errors.js';
import { noopReevaluationLogger, type ReevaluationLogger } from './log.js';

/**
 * The model + reasoning-effort strings used by the scoring fingerprint
 * These match the MVP defaults from
 * `DEFAULT_OPERATIONAL_CONFIG.openai.jobScoring`. The service does
 * NOT take a `ScoringService` dependency on the model/reasoning
 * settings — the reevaluation fingerprint must stay byte-for-byte
 * compatible with the score fingerprint the pipeline produces. A
 * future task can plumb the active `OperationalConfig` through if the
 * model parameters become user-configurable.
 */
const REEVALUATION_SCORING_MODEL = 'gpt-5.6-sol';
const REEVALUATION_SCORING_REASONING_EFFORT = 'medium';

/**
 * The minimum surface the reevaluation service needs from the
 * filter apply service. Declared as a structural type (not the full
 * `FilterApplyService` class) so the test harness can inject a
 * configurable fake without inheriting from the class — the class
 * type carries private fields (`repositories`, `now`) the test
 * does not need to satisfy.
 */
export interface ReevaluationFilterApplyService {
  apply(input: FilterApplyInput): Promise<FilterApplyResult>;
}

/**
 * The minimum surface the reevaluation service needs from the
 * scoring service — `scoreOne()` for the per-job call +
 * `buildScoringPlan()` for the prompt + JSON envelope.
 */
export interface ReevaluationScoringService {
  scoreOne(input: ScoreOneInput): Promise<ScoringOutcome>;
  buildScoringPlan(input: BuildScoringPlanInput): ScoringPlan;
}

export interface ReevaluationServiceOptions {
  readonly repositories: Repositories;
  readonly filterApplyService: ReevaluationFilterApplyService;
  readonly scoringService: ReevaluationScoringService;
  readonly prompts: PipelinePrompts;
  readonly scoringConcurrency: number;
  readonly now?: () => Date;
  readonly logger?: ReevaluationLogger;
}

/**
 * Internal mutable shape used during execution. The service stamps
 * the entry with the result of the live apply/score call (`action`
 * may flip from `'reran'` to `'reused'` when the cache hits; the
 * `fingerprint` may be updated to the freshly-computed one; the
 * `scoreInvalidated` flag is set after the dependent score flip).
 *
 * `scoreKind` is the pre-execution classification used to build the
 * `ScoringPlan` accurately: `'complete'` jobs will trigger a new
 * OpenAI call (counted in `newOpenAIRequests`), `'reused'` jobs
 * will hit the cache, and `'skipped'` jobs won't be scored at all.
 */
interface MutablePlanEntry {
  jobId: string;
  internalId: number;
  sourceJobId: string;
  action: ReevaluationPlanAction;
  fingerprint: string;
  scoreInvalidated: boolean;
  scoreKind: 'complete' | 'reused' | 'skipped';
}

function freezeEntry(m: MutablePlanEntry): ReevaluationPlanEntry {
  return {
    jobId: m.jobId,
    internalId: m.internalId,
    sourceJobId: m.sourceJobId,
    action: m.action,
    fingerprint: m.fingerprint,
    scoreInvalidated: m.scoreInvalidated,
  };
}

export class ReevaluationService {
  private readonly repositories: Repositories;
  private readonly filterApplyService: ReevaluationFilterApplyService;
  private readonly scoringService: ReevaluationScoringService;
  private readonly prompts: PipelinePrompts;
  private readonly scoringConcurrency: number;
  private readonly now: () => Date;
  private readonly logger: ReevaluationLogger;

  constructor(options: ReevaluationServiceOptions) {
    this.repositories = options.repositories;
    this.filterApplyService = options.filterApplyService;
    this.scoringService = options.scoringService;
    this.prompts = options.prompts;
    this.scoringConcurrency = options.scoringConcurrency;
    this.now = options.now ?? ((): Date => new Date());
    this.logger = options.logger ?? noopReevaluationLogger();
  }

  /**
   * Per-job score rerun helper (extracted from `execute()` for
   * readability + per-job error isolation in the caller).
   *
   * Computes the score input from the supplied job row + active
   * profile + active filter config, invokes `scoreOne()`, and
   * translates the outcome into the per-entry action label. The
   * caller catches any thrown error and surfaces it as a
   * `reevaluationScoreFail` log + a best-effort entry fallback.
   */
  private async runOneScore(
    entry: MutablePlanEntry,
    job: JobRow,
    profileRow: NonNullable<
      Awaited<ReturnType<Repositories['profileVersions']['findActiveApproved']>>
    >,
    activeFilterContentHash: string,
    pipelineRunId: number | null,
  ): Promise<void> {
    const filterResult = await this.filterApplyService.apply({
      jobId: job.id,
      job: {
        title: job.title,
        company: job.company,
        location: job.location,
        description: job.description,
      },
      pipelineRunId,
    });
    // The score service's eligibility check requires
    // `filterResult.fingerprint === activeFilterFingerprint`. We
    // pass the just-computed fingerprint for both — the
    // reevaluation cache-check guarantees they are equal here.
    const activeFilterFingerprint = filterResult.fingerprint;
    const scoreInput: ScoreOneInput = {
      run: { id: pipelineRunId ?? 0 },
      searchExecution: { id: 0 },
      job: {
        id: job.id,
        sourceJobId: job.sourceJobId,
        extractionStatus: 'complete',
        normalizedTitle: job.title ?? '',
        normalizedCompany: job.company ?? '',
        normalizedLocation: job.location ?? '',
        normalizedDescription: job.description ?? '',
        language: 'en',
        workplaceType: 'remote',
        employmentType: 'full_time',
      },
      profileVersion: {
        id: profileRow.id,
        fingerprint: profileRow.contentHash,
        headline: '',
        skills: [],
        yearsOfExperience: 0,
        spokenLanguages: [],
        preferredRole: '',
        locationPreference: '',
        domainExperience: [],
      },
      effectiveDerivedValues: {},
      filterResult: {
        id: filterResult.filterResultId,
        outcome: filterResult.outcome === 'error' ? 'rejected' : filterResult.outcome,
        fingerprint: filterResult.fingerprint,
      },
      activeFilterFingerprint,
      signal: new AbortController().signal,
    };
    const scoreOutcome: ScoringOutcome = await this.scoringService.scoreOne(scoreInput);
    entry.fingerprint = scoreOutcome.fingerprint;
    if (scoreOutcome.kind === 'reused') {
      entry.action = 'reused';
      this.logger.reevaluationScoreReuse({
        jobId: job.id,
        fingerprint: scoreOutcome.fingerprint,
      });
    } else if (scoreOutcome.kind === 'complete') {
      entry.action = 'reran';
      this.logger.reevaluationScoreComplete({
        jobId: job.id,
        overallScore: scoreOutcome.overallScore ?? 0,
      });
    } else if (scoreOutcome.kind === 'failed') {
      entry.action = 'reran';
      this.logger.reevaluationScoreFail({
        jobId: job.id,
        errorCode: scoreOutcome.errorCode ?? 'unknown',
      });
    }
    // 'skipped' / 'cancelled' keep the original action label
    // ('reran' set in selection) — the service surfaces the
    // totals and the CLI decides how to render.
    void activeFilterContentHash; // parameter retained for symmetry + future audit
  }

  async execute(input: ReevaluationExecuteInput): Promise<ReevaluationOutcome> {
    this.logger.reevaluationStart({ scope: input.scope, dryRun: input.dryRun });
    void this.now; // reserved for future audit timestamp capture

    // (a) Prerequisite validation.
    const configRow = await this.repositories.filterConfigurations.findActive();
    if (configRow === null) {
      throw new PipelinePrerequisiteError(
        'no_active_filter',
        'No active filter configuration. Run `jobhunter filters configure` before reevaluating.',
        { scope: input.scope },
      );
    }

    const profileRequired =
      input.scope === 'default' || input.scope === 'scores-only' || input.scope === 'job';
    const keyRequired =
      (input.scope === 'default' || input.scope === 'scores-only') && !input.dryRun;

    let profileVersion: Awaited<ReturnType<Repositories['profileVersions']['findActiveApproved']>> =
      null;
    if (profileRequired) {
      profileVersion = await this.repositories.profileVersions.findActiveApproved();
      if (profileVersion === null) {
        throw new PipelinePrerequisiteError(
          'no_active_profile',
          'No active approved profile. Run `jobhunter profile approve` before reevaluating.',
          { scope: input.scope },
        );
      }
    }

    if (keyRequired) {
      const key = input.env['OPENAI_API_KEY'];
      if (key === undefined || key === null || key.length === 0) {
        throw new PipelinePrerequisiteError(
          'openai_api_key_missing',
          'OPENAI_API_KEY is not set. The reevaluation service requires it for OpenAI scoring.',
          { scope: input.scope, dryRun: input.dryRun },
        );
      }
    }

    // (b) Selection.
    const allCompleteJobs = await this.repositories.jobs.listComplete();
    let targetJobs: readonly JobRow[] = allCompleteJobs;
    let jobIdString: string | null = null;

    if (input.scope === 'job') {
      if (input.jobId === undefined || input.jobId === null) {
        throw new ReevaluationValidationError(
          'job_not_found',
          'No job identifier supplied to --job scope.',
          { scope: input.scope },
        );
      }
      const job = allCompleteJobs.find((j) => j.id === input.jobId);
      if (job === undefined) {
        // Could be partial / failed (excluded by listComplete) or
        // genuinely missing. The CLI has already validated for
        // partial/failed + not-found, so this is the defensive
        // double-check.
        throw new ReevaluationValidationError(
          'job_not_found',
          `No complete job with id ${input.jobId}.`,
          { jobId: input.jobId },
        );
      }
      targetJobs = [job];
      jobIdString = `job_${job.id}`;
    }

    const filtersToReevaluate: MutablePlanEntry[] = [];
    const jobsToScore: MutablePlanEntry[] = [];
    const skipped: ReevaluationSkippedEntry[] = [];

    for (const job of targetJobs) {
      const filterFp = computeFilterFingerprintForJob(
        job,
        configRow.configJson,
        profileVersion?.profileJson ?? null,
      );
      const filterResult = await this.repositories.filterResults.findActiveByJob(job.id, filterFp);
      const filterStale = filterResult === null;
      const filterOutcome: FilterOutcome | null =
        filterResult === null ? null : filterResult.overallOutcome;

      const rerunFilter =
        filterStale &&
        (input.scope === 'default' || input.scope === 'filters-only' || input.scope === 'job');

      if (rerunFilter) {
        filtersToReevaluate.push({
          jobId: `job_${job.id}`,
          internalId: job.id,
          sourceJobId: job.sourceJobId,
          action: input.dryRun ? 'would-rerun' : 'reran',
          fingerprint: filterFp,
          scoreInvalidated: false,
          scoreKind: 'skipped',
        });
      }

      // Score-side selection: only consider jobs whose filter is fresh + accepted.
      if (filterOutcome === 'accepted' && profileVersion !== null) {
        const profileRow = profileVersion;
        const scoreFp = computeScoreFingerprintForJob(
          job,
          profileRow.id,
          profileRow.contentHash,
          {},
          REEVALUATION_SCORING_MODEL,
          REEVALUATION_SCORING_REASONING_EFFORT,
        );
        const scoreRow = await this.repositories.scoreResults.findActiveByJob(job.id, scoreFp);
        const scoreStale = scoreRow === null;

        const shouldConsiderScoring =
          input.scope === 'default' || input.scope === 'scores-only' || input.scope === 'job';

        if (shouldConsiderScoring && scoreStale) {
          jobsToScore.push({
            jobId: `job_${job.id}`,
            internalId: job.id,
            sourceJobId: job.sourceJobId,
            action: input.dryRun ? 'would-rerun' : 'reran',
            fingerprint: scoreFp,
            scoreInvalidated: false,
            scoreKind: 'complete',
          });
        }
      } else if (input.scope === 'scores-only' && filterOutcome !== 'accepted') {
        // --scores-only with a non-accepted filter outcome (rejected,
        // error, or stale/missing) — skip per
        // ("filter_update_required").
        skipped.push({
          jobId: `job_${job.id}`,
          internalId: job.id,
          sourceJobId: job.sourceJobId,
          reason: 'filter_update_required',
        });
      }
    }

    // (c) Plan building.
    let scoringPlan: ScoringPlan | null = null;
    if (jobsToScore.length > 0) {
      scoringPlan = this.scoringService.buildScoringPlan({
        run: { id: input.runId ?? 0 },
        searchExecution: { id: 0 },
        jobs: jobsToScore.map((entry) => ({
          id: entry.internalId,
          sourceJobId: entry.sourceJobId,
          estimatedInputBytes: 0,
        })),
        eligibleFlags: new Map(
          jobsToScore.map((entry) => [entry.internalId, { isEligible: true, reason: null }]),
        ),
        scoreKinds: new Map(jobsToScore.map((entry) => [entry.internalId, entry.scoreKind])),
        scoringConcurrency: this.scoringConcurrency,
      });
    }

    // (d) Confirmation.
    let scoringDeclinedByUser = false;
    const shouldPrompt =
      !input.dryRun &&
      input.scope !== 'filters-only' &&
      scoringPlan !== null &&
      scoringPlan.newOpenAIRequests > 0 &&
      input.confirmScoring;

    if (shouldPrompt && scoringPlan !== null) {
      const confirmed = await this.prompts.askScoringConfirmation({ plan: scoringPlan });
      if (!confirmed) {
        scoringDeclinedByUser = true;
        this.logger.reevaluationDecline({ scope: input.scope });
      }
    }

    this.logger.reevaluationSelection({
      jobCount: filtersToReevaluate.length + jobsToScore.length,
      skippedCount: skipped.length,
    });

    // (e) Execution (filter reruns).
    let scoresInvalidatedTotal = 0;

    if (!input.dryRun) {
      for (const entry of filtersToReevaluate) {
        const job = allCompleteJobs.find((j) => j.id === entry.internalId);
        if (job === undefined) {
          continue;
        }
        const filterInput: FilterApplyInput = {
          jobId: job.id,
          job: {
            title: job.title,
            company: job.company,
            location: job.location,
            description: job.description,
          },
          pipelineRunId: input.runId ?? null,
        };
        const result: FilterApplyResult = await this.filterApplyService.apply(filterInput);
        entry.fingerprint = result.fingerprint;
        if (result.reused) {
          entry.action = 'reused';
        } else {
          entry.action = 'reran';
          const invalidatedCount = await this.repositories.scoreResults.invalidateActiveByJob(
            job.id,
          );
          scoresInvalidatedTotal += invalidatedCount;
          entry.scoreInvalidated = invalidatedCount > 0;
        }
        this.logger.reevaluationFilterRerun({
          jobId: job.id,
          fingerprint: result.fingerprint,
          reused: result.reused,
        });
        if (entry.scoreInvalidated) {
          this.logger.reevaluationFilterInvalidatedScores({
            jobId: job.id,
            count: scoresInvalidatedTotal,
          });
        }
      }
    }
    // (f) Execution (score reruns).
    if (!input.dryRun && !scoringDeclinedByUser && profileVersion !== null) {
      const profileRow = profileVersion;
      for (const entry of jobsToScore) {
        const job = allCompleteJobs.find((j) => j.id === entry.internalId);
        if (job === undefined) {
          continue;
        }
        try {
          await this.runOneScore(
            entry,
            job,
            profileRow,
            configRow.contentHash,
            input.runId ?? null,
          );
        } catch (error) {
          // Per-job error isolation (mirrors `PipelineOrchestrator.runScoring`):
          // a single job's failure must NOT abort the rest of the
          // batch. The entry stays as `action: 'reran'` (the selection
          // phase planned to rerun the score). This handles the
          // documented MVP limitation where the reevaluation service
          // uses a sentinel `pipelineRunId: 0` when no real pipeline
          // run is in scope (the score FK constraint surfaces as a
          // foreign-key violation).
          const errorCode =
            error instanceof Error && 'code' in error
              ? (error as { code: string }).code
              : 'reeval_score_failure';
          entry.action = 'reran';
          this.logger.reevaluationScoreFail({
            jobId: job.id,
            errorCode,
          });
        }
      }
    }

    // (g) Plan return.
    const plan: ReevaluationPlan = buildReevaluationPlan({
      scope: input.scope,
      dryRun: input.dryRun,
      jobId: jobIdString,
      filterEntries: filtersToReevaluate.map(freezeEntry),
      scoreEntries: jobsToScore.map(freezeEntry),
      skipped,
      scoringPlan,
      scoringDeclinedByUser,
    });

    // When the user declined the scoring prompt, the planned
    // `scoresRerun` count from `buildReevaluationPlan` reflects what
    // WOULD have been executed, not what actually ran. Override the
    // totals block so the surfaced `scoresRerun === 0` matches the
    // T15 contract.
    let finalPlan: ReevaluationPlan = plan;
    if (scoringDeclinedByUser) {
      finalPlan = {
        ...plan,
        totals: { ...plan.totals, scoresRerun: 0 },
      };
    }

    this.logger.reevaluationComplete({ totals: finalPlan.totals });

    return { plan: finalPlan };
  }
}
