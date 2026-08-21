import type {
  FilterApplyInput,
  FilterApplyResult,
  FilterApplyService,
} from '../../../src/filter/service.js';
import type { FilterOutcome } from '../../../src/persistence/repositories/filter-results.js';
import type { ScoringOutcome, ScoringPlan, ScoringPlanEntry } from '../../../src/scoring/state.js';
import type { BuildScoringPlanInput } from '../../../src/scoring/plan.js';
import type { ScoreOneInput, ScoringService } from '../../../src/scoring/service.js';

/**
 * A locally-typed alias for the `RuleEvaluation` shape. The shape is
 * declared in `src/filter/service.ts` as part of `FilterApplyResult`
 * but is NOT exported. We type our scripts against the structural
 * shape directly to avoid the unexported type dependency.
 */
type RuleEval = {
  readonly ruleId: string;
  readonly field: 'company' | 'title' | 'description' | 'seniority' | 'languages';
  readonly outcome: 'passed' | 'failed' | 'abstained';
  readonly details: Readonly<Record<string, unknown>>;
  readonly reason: string;
};

/**
 * A configurable fake `FilterApplyService` that returns a scripted
 * `FilterApplyResult` per call (or falls back to the default
 * behaviour: accept the job, mark `reused: false`, return a
 * deterministic fingerprint).
 *
 * Mirrors the test pattern used in `tests/scoring/helpers/fake-scoring-pipeline.ts`
 * — the test harness installs a fake before constructing the
 * service, then asserts on the call count + args.
 */
export interface FakeFilterApplyServiceOptions {
  readonly defaultOutcome?: FilterOutcome;
  readonly defaultReused?: boolean;
}

export class FakeFilterApplyService {
  readonly calls: FilterApplyInput[] = [];
  private readonly scripts: ReadResult[] = [];
  private cursor = 0;

  constructor(
    private readonly options: FakeFilterApplyServiceOptions = {},
    scripts: ReadonlyArray<ReadResult | undefined> = [],
  ) {
    for (const s of scripts) {
      if (s !== undefined) this.scripts.push(s);
    }
  }

  /** Queue one scripted response. Each call consumes one script entry. */
  queueResult(
    result: Omit<ReadResult, 'ruleEvaluations' | 'rejectionReasons'> & {
      ruleEvaluations?: readonly RuleEval[];
      rejectionReasons?: readonly string[];
    },
  ): void {
    this.scripts.push({
      outcome: result.outcome,
      filterResultId: result.filterResultId,
      fingerprint: result.fingerprint,
      reused: result.reused,
      ruleEvaluations: result.ruleEvaluations ?? [],
      rejectionReasons: result.rejectionReasons ?? [],
    });
  }

  async apply(input: FilterApplyInput): Promise<FilterApplyResult> {
    this.calls.push(input);
    const script = this.scripts[this.cursor] ?? this.defaultResult(input.jobId);
    this.cursor += 1;
    return script;
  }

  /** Apply the fake as a `FilterApplyService` (compatible shape). */
  asService(): Pick<FilterApplyService, 'apply'> {
    return { apply: (input: FilterApplyInput) => this.apply(input) };
  }

  private defaultResult(jobId: number): FilterApplyResult {
    return {
      outcome: this.options.defaultOutcome ?? 'accepted',
      filterResultId: jobId * 1000,
      fingerprint: `fake-filter-fp-${jobId}-${this.cursor}`,
      ruleEvaluations: [],
      rejectionReasons: [],
      reused: this.options.defaultReused ?? false,
    };
  }
}

interface ReadResult {
  outcome: FilterOutcome;
  filterResultId: number;
  fingerprint: string;
  reused: boolean;
  ruleEvaluations: readonly RuleEval[];
  rejectionReasons: readonly string[];
}

/**
 * A configurable fake `ScoringService` for the reevaluation test
 * harness. `scoreOne()` returns a scripted `ScoringOutcome` (or the
 * default — `'reused'` for matching fingerprints, `'complete'` for
 * misses). `buildScoringPlan()` mirrors the real builder (single-job
 * per entry, eligible, kind: 'skipped').
 */
export interface FakeScoringServiceOptions {
  readonly model?: string;
  readonly reasoningEffort?: string;
  readonly openAIClient?: unknown;
}

export class FakeScoringService {
  readonly scoreOneCalls: ScoreOneInput[] = [];
  private readonly scoreOneScripts: Map<number, ScoringOutcome> = new Map();
  private nextScriptedJobId: number | null = null;
  private nextScriptedOutcome: ScoringOutcome | null = null;

  /** Queue one scripted `ScoringOutcome` for the next call. */
  queueOutcome(outcome: ScoringOutcome): void {
    this.nextScriptedOutcome = outcome;
  }

  /** Queue a scripted outcome keyed on jobId. */
  queueOutcomeForJob(jobId: number, outcome: ScoringOutcome): void {
    this.scoreOneScripts.set(jobId, outcome);
  }

  async scoreOne(input: ScoreOneInput): Promise<ScoringOutcome> {
    this.scoreOneCalls.push(input);
    if (this.scoreOneScripts.has(input.job.id)) {
      return this.scoreOneScripts.get(input.job.id)!;
    }
    if (this.nextScriptedOutcome !== null) {
      const out = this.nextScriptedOutcome;
      this.nextScriptedOutcome = null;
      return out;
    }
    // Default: produce a `complete` outcome for any input.
    return makeFakeCompleteOutcome(input.job.id);
  }

  buildScoringPlan(input: BuildScoringPlanInput): ScoringPlan {
    return realBuildScoringPlan(input);
  }

  asService(): Pick<ScoringService, 'scoreOne' | 'buildScoringPlan'> {
    return {
      scoreOne: (input: ScoreOneInput) => this.scoreOne(input),
      buildScoringPlan: (input: BuildScoringPlanInput) => this.buildScoringPlan(input),
    };
  }
}

/** Minimal `ScoringOutcome` factory for the `complete` kind. */
export function makeFakeCompleteOutcome(jobId: number, overallScore = 85): ScoringOutcome {
  return {
    schemaVersion: 1 as const,
    jobId,
    sourceJobId: `src-${jobId}`,
    kind: 'complete',
    overallScore,
    displayScore: '85.0',
    fingerprint: `fake-score-fp-${jobId}`,
    fields: null,
    attempted: true,
    errorCode: null,
    errorMessage: null,
    artifactIds: [],
  };
}

/** Minimal `ScoringOutcome` factory for the `reused` kind. */
export function makeFakeReusedOutcome(jobId: number, overallScore = 80): ScoringOutcome {
  return {
    schemaVersion: 1 as const,
    jobId,
    sourceJobId: `src-${jobId}`,
    kind: 'reused',
    overallScore,
    displayScore: '80.0',
    fingerprint: `fake-score-fp-reused-${jobId}`,
    fields: null,
    attempted: false,
    errorCode: null,
    errorMessage: null,
    artifactIds: [],
  };
}

/** Minimal `ScoringOutcome` factory for the `failed` kind. */
export function makeFakeFailedOutcome(jobId: number, errorCode = 'openai_timeout'): ScoringOutcome {
  return {
    schemaVersion: 1 as const,
    jobId,
    sourceJobId: `src-${jobId}`,
    kind: 'failed',
    overallScore: null,
    displayScore: null,
    fingerprint: '',
    fields: null,
    attempted: true,
    errorCode,
    errorMessage: 'synthetic test failure',
    artifactIds: [],
  };
}

// Inlined reimplementation of `buildScoringPlan` (Task 7 — keeps the
// test harness independent of the real scoring module's runtime
// imports). The scoring service exposes this as a method, so the
// fake just delegates to the real builder below.

function realBuildScoringPlan(input: BuildScoringPlanInput): ScoringPlan {
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
    schemaVersion: 1 as const,
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
