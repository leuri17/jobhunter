import { and, eq } from 'drizzle-orm';
import { hashString } from '../profile/hashing.js';
import { runWithRetry } from '../profile/openai/retry.js';
import type { OpenAIClient } from '../profile/openai/types.js';
import type { Repositories } from '../persistence/repositories/index.js';
import { openaiRequestMetadata, scoreResults } from '../persistence/schema.js';
import { RUBRIC, RUBRIC_VERSION } from './rubric.js';
import { SCORER_IMPLEMENTATION_VERSION, computeScoreFingerprint } from './fingerprint.js';
import { computeOverallScore, formatDisplayScore } from './score-formula.js';
import {
  ScoringStructuredOutputSchema,
  SCORING_STRUCTURED_OUTPUT_SCHEMA_VERSION,
  SCORING_RESPONSE_SCHEMA_NAME,
  type ScoringStructuredOutput,
} from './schema.js';
import { SCORING_PROMPT_VERSION, buildScoringPrompt } from './prompt.js';
import { isJobEligibleForScoring } from './eligibility.js';
import { buildScoringPlan, type BuildScoringPlanInput } from './plan.js';
import { ScoringHardStopError, ScoringInvalidStructuredOutputError } from './errors.js';
import { noopScoringLogger, type ScoringLogger } from './log.js';
import {
  LINKEDIN_SCORING_SCHEMA_VERSION,
  type ScoringBatchOutcome,
  type ScoringFieldSet,
  type ScoringOutcome,
  type ScoringPlan,
} from './state.js';
import { SCORING_CATEGORIES } from './types.js';

/** Hardcoded 200 KB cap for the assembled scoring payload. */
const MAX_INPUT_BYTES = 200_000;

/** Three consecutive authentication failures abort the batch. */
const CONSECUTIVE_AUTH_FAILURE_LIMIT = 3;

export interface ScoringServiceConfig {
  readonly model: string;
  readonly reasoningEffort: 'low' | 'medium' | 'high';
  readonly concurrency: number;
}

export interface ScoringServiceOptions {
  readonly repositories: Repositories;
  readonly openaiClient: OpenAIClient;
  readonly logger?: ScoringLogger;
  readonly config: ScoringServiceConfig;
  readonly now?: () => Date;
}

export interface ScoreOneInput {
  readonly run: { readonly id: number };
  readonly searchExecution: { readonly id: number };
  readonly job: {
    readonly id: number;
    readonly sourceJobId: string;
    readonly extractionStatus: 'complete' | 'partial' | 'failed';
    readonly normalizedTitle: string;
    readonly normalizedCompany: string;
    readonly normalizedLocation: string;
    readonly normalizedDescription: string;
    readonly language: string;
    readonly workplaceType: string;
    readonly employmentType: string;
  };
  readonly profileVersion: {
    readonly id: number;
    readonly fingerprint: string;
    readonly headline: string;
    readonly skills: readonly string[];
    readonly yearsOfExperience: number;
    readonly spokenLanguages: readonly string[];
    readonly preferredRole: string;
    readonly locationPreference: string;
    readonly domainExperience: readonly string[];
  };
  readonly effectiveDerivedValues: Readonly<Record<string, unknown>>;
  readonly filterResult: {
    readonly id: number;
    readonly outcome: 'accepted' | 'rejected';
    readonly fingerprint: string;
  };
  readonly activeFilterFingerprint: string;
  readonly signal: AbortSignal;
}

export interface ScoreBatchInput {
  readonly run: { readonly id: number };
  readonly searchExecution: { readonly id: number };
  readonly jobs: readonly ScoreOneInput[];
  readonly signal: AbortSignal;
}

function makeOutcome(input: {
  job: ScoreOneInput['job'];
  kind: ScoringOutcome['kind'];
  overallScore: number | null;
  displayScore: string | null;
  fingerprint: string;
  fields: ScoringFieldSet | null;
  attempted: boolean;
  errorCode: string | null;
  errorMessage: string | null;
}): ScoringOutcome {
  return {
    schemaVersion: LINKEDIN_SCORING_SCHEMA_VERSION,
    jobId: input.job.id,
    sourceJobId: input.job.sourceJobId,
    kind: input.kind,
    overallScore: input.overallScore,
    displayScore: input.displayScore,
    fingerprint: input.fingerprint,
    fields: input.fields,
    attempted: input.attempted,
    errorCode: input.errorCode,
    errorMessage: input.errorMessage,
    artifactIds: [],
  };
}

/** Extract the integer scores from a validated scoring response. */
function extractScores(
  categoryScores: ScoringStructuredOutput['categoryScores'],
): Readonly<Record<(typeof SCORING_CATEGORIES)[number], number>> {
  const out: Record<string, number> = {};
  for (const cat of SCORING_CATEGORIES) {
    out[cat] = categoryScores[cat].score;
  }
  return out as Readonly<Record<(typeof SCORING_CATEGORIES)[number], number>>;
}

export class ScoringService {
  private readonly repositories: Repositories;
  private readonly openaiClient: OpenAIClient;
  private readonly logger: ScoringLogger;
  private readonly config: ScoringServiceConfig;
  private readonly now: () => Date;

  constructor(options: ScoringServiceOptions) {
    this.repositories = options.repositories;
    this.openaiClient = options.openaiClient;
    this.logger = options.logger ?? noopScoringLogger();
    this.config = options.config;
    this.now = options.now ?? ((): Date => new Date());
  }

  async scoreOne(input: ScoreOneInput): Promise<ScoringOutcome> {
    const startedAt = this.now().toISOString();
    this.logger.scoringStart({
      jobId: input.job.id,
      sourceJobId: input.job.sourceJobId,
      fingerprint: '',
    });

    // (a) Eligibility.
    if (
      !isJobEligibleForScoring({
        job: { extractionStatus: input.job.extractionStatus },
        filterResult: input.filterResult,
        activeFilterFingerprint: input.activeFilterFingerprint,
      })
    ) {
      this.logger.scoringSkip({ jobId: input.job.id, reason: 'ineligible' });
      return makeOutcome({
        job: input.job,
        kind: 'skipped',
        overallScore: null,
        displayScore: null,
        fingerprint: '',
        fields: null,
        attempted: false,
        errorCode: 'scoring_ineligible',
        errorMessage: 'Job is not eligible for scoring.',
      });
    }

    // (b) Build payload + fingerprint.
    const { systemMessage, userMessage } = buildScoringPrompt({
      promptVersion: SCORING_PROMPT_VERSION,
      profile: {
        headline: input.profileVersion.headline,
        skills: input.profileVersion.skills,
        yearsOfExperience: input.profileVersion.yearsOfExperience,
        spokenLanguages: input.profileVersion.spokenLanguages,
        preferredRole: input.profileVersion.preferredRole,
        locationPreference: input.profileVersion.locationPreference,
        domainExperience: input.profileVersion.domainExperience,
      },
      facts: {},
      effectiveDerivedValues: input.effectiveDerivedValues,
      job: {
        title: input.job.normalizedTitle,
        company: input.job.normalizedCompany,
        location: input.job.normalizedLocation,
        description: input.job.normalizedDescription,
        language: input.job.language,
        workplaceType: input.job.workplaceType,
        employmentType: input.job.employmentType,
      },
      rubric: RUBRIC,
    });
    const messages = [
      { role: 'system' as const, content: systemMessage },
      { role: 'user' as const, content: userMessage },
    ];

    // (c) Input-too-large guard.
    const payloadBytes = Buffer.byteLength(
      JSON.stringify({ systemMessage, userMessage, rubric: RUBRIC }),
      'utf8',
    );
    if (payloadBytes > MAX_INPUT_BYTES) {
      this.logger.scoringFail({ jobId: input.job.id, errorCode: 'scoring_input_too_large' });
      return makeOutcome({
        job: input.job,
        kind: 'failed',
        overallScore: null,
        displayScore: null,
        fingerprint: '',
        fields: null,
        attempted: false,
        errorCode: 'scoring_input_too_large',
        errorMessage: `Payload size ${payloadBytes} bytes exceeds ${MAX_INPUT_BYTES}-byte cap.`,
      });
    }

    // Compute the fingerprint.
    const jobContentHash = hashString(
      JSON.stringify({
        title: input.job.normalizedTitle,
        company: input.job.normalizedCompany,
        location: input.job.normalizedLocation,
        description: input.job.normalizedDescription,
      }),
    );
    const effectiveDerivedValuesHash = hashString(JSON.stringify(input.effectiveDerivedValues));
    const fingerprint = computeScoreFingerprint({
      jobContentHash,
      profileVersionId: input.profileVersion.id,
      profileFingerprint: input.profileVersion.fingerprint,
      effectiveDerivedValuesHash,
      promptVersion: SCORING_PROMPT_VERSION,
      rubricVersion: RUBRIC_VERSION,
      model: this.config.model,
      reasoningEffort: this.config.reasoningEffort,
      modelConfig: {},
      scorerImplementationVersion: SCORER_IMPLEMENTATION_VERSION,
    });

    // (d) Reuse the active score when the fingerprint matches.
    const existing = await this.repositories.scoreResults.findActiveByJob(
      input.job.id,
      fingerprint,
    );
    if (existing !== null) {
      this.logger.scoringReuse({
        jobId: input.job.id,
        fingerprint,
        previousScoreTimestamp: existing.timestamp,
      });
      return makeOutcome({
        job: input.job,
        kind: 'reused',
        overallScore: existing.overallScore,
        displayScore: formatDisplayScore(existing.overallScore),
        fingerprint,
        fields: null,
        attempted: false,
        errorCode: null,
        errorMessage: null,
      });
    }

    // (e) Call OpenAI via runWithRetry.
    let attemptCount = 0;
    let raw: ScoringStructuredOutput;
    let tokenUsage: { readonly promptTokens: number; readonly completionTokens: number } | null =
      null;
    try {
      const result = await runWithRetry(
        async () => {
          if (input.signal.aborted) {
            throw new DOMException('Aborted', 'AbortError');
          }
          const response = await this.openaiClient.extract({
            promptVersion: `v${SCORING_PROMPT_VERSION}`,
            model: this.config.model,
            reasoningEffort: this.config.reasoningEffort,
            messages,
            sources: [],
            responseSchemaName: SCORING_RESPONSE_SCHEMA_NAME,
            structuredOutputSchemaVersion: SCORING_STRUCTURED_OUTPUT_SCHEMA_VERSION,
            maxCompletionTokens: 2000,
          });
          attemptCount += 1;
          tokenUsage = response.tokenUsage;
          let parsed: unknown;
          try {
            parsed = JSON.parse(response.rawJsonText);
          } catch {
            throw new ScoringInvalidStructuredOutputError({
              attemptNumber: attemptCount,
              validationError: 'invalid_json',
            });
          }
          const parsedResult = ScoringStructuredOutputSchema.safeParse(parsed);
          if (!parsedResult.success) {
            throw new ScoringInvalidStructuredOutputError({
              attemptNumber: attemptCount,
              validationError: parsedResult.error.message,
            });
          }
          return parsedResult.data;
        },
        {
          maxAttempts: 3,
          baseDelayMs: 500,
          maxDelayMs: 8_000,
          jitter: 'full',
        },
      );
      raw = result.value;
      attemptCount = result.attempts.length;
    } catch (cause) {
      if (input.signal.aborted) {
        this.logger.scoringFail({ jobId: input.job.id, errorCode: 'cancelled' });
        return makeOutcome({
          job: input.job,
          kind: 'cancelled',
          overallScore: null,
          displayScore: null,
          fingerprint,
          fields: null,
          attempted: true,
          errorCode: 'cancelled',
          errorMessage: 'Aborted before completion.',
        });
      }
      const errorCode =
        cause instanceof Error && 'code' in cause
          ? (cause as { code: string }).code
          : 'openai_unknown_failure';
      this.logger.scoringFail({ jobId: input.job.id, errorCode });
      return makeOutcome({
        job: input.job,
        kind: 'failed',
        overallScore: null,
        displayScore: null,
        fingerprint,
        fields: null,
        attempted: true,
        errorCode,
        errorMessage: cause instanceof Error ? cause.message : String(cause),
      });
    }

    // (f) Compute overall score in JobHunter (not OpenAI).
    const categoryScoreNumbers = extractScores(raw.categoryScores);
    const overallScore = computeOverallScore(categoryScoreNumbers);
    const displayScore = formatDisplayScore(overallScore);
    const completedAt = this.now().toISOString();

    // (g) Persist atomically via flat `transact` (sync callback,
    //     uses `txRepos.db` directly — the async sub-repository
    //     wrappers are not safe inside the sync `transact` callback).
    let newScoreResultId = 0;
    this.repositories.transact((txRepos) => {
      // Write 1: mark the previous active row as inactive.
      txRepos.db
        .update(scoreResults)
        .set({ active: false })
        .where(and(eq(scoreResults.jobId, input.job.id), eq(scoreResults.active, true)))
        .run();
      // Write 2: insert the new active row.
      const inserted = txRepos.db
        .insert(scoreResults)
        .values({
          jobId: input.job.id,
          pipelineRunId: input.run.id,
          filterResultId: input.filterResult.id,
          fingerprint,
          timestamp: completedAt,
          promptVersion: `v${SCORING_PROMPT_VERSION}`,
          rubricVersion: `${RUBRIC_VERSION}`,
          model: this.config.model,
          reasoningEffort: this.config.reasoningEffort,
          scorerImplementationVersion: `${SCORER_IMPLEMENTATION_VERSION}`,
          categoryScoresJson: JSON.stringify([raw.categoryScores]),
          overallScore,
          explanation: raw.recommendationSummary,
          keyMatchesJson: JSON.stringify(raw.keyMatches),
          importantGapsJson: JSON.stringify(raw.importantGaps),
          importantConcernsJson: JSON.stringify(raw.importantConcerns),
          inferredSeniority: raw.inferredSeniority,
          recommendationSummary: raw.recommendationSummary,
          success: true,
          errorCode: null,
          errorMessage: null,
          active: true,
        })
        .returning({ id: scoreResults.id })
        .all();
      const row = inserted[0];
      if (row === undefined) {
        throw new Error('ScoringService.scoreOne: scoreResults insert returned no rows.');
      }
      newScoreResultId = row.id;
      // Write 3: insert the openaiMetadata row. The Drizzle schema
      //     columns are plain `text` (not `text({ mode: 'json' })`),
      //     so we JSON-stringify the values explicitly (the
      //     repository's `insert` method does the same via
      //     `unknownJson.encode(...)`).
      txRepos.db
        .insert(openaiRequestMetadata)
        .values({
          operationType: 'job_scoring',
          relatedEntityType: 'score_result',
          relatedEntityId: newScoreResultId,
          inputHashesJson: JSON.stringify([
            jobContentHash,
            input.profileVersion.fingerprint,
            effectiveDerivedValuesHash,
          ]),
          promptVersion: `v${SCORING_PROMPT_VERSION}`,
          structuredOutputSchemaVersion: SCORING_STRUCTURED_OUTPUT_SCHEMA_VERSION,
          model: this.config.model,
          reasoningEffort: this.config.reasoningEffort,
          configJson: JSON.stringify({
            model: this.config.model,
            reasoningEffort: this.config.reasoningEffort,
            promptVersion: SCORING_PROMPT_VERSION,
            structuredOutputSchemaVersion: SCORING_STRUCTURED_OUTPUT_SCHEMA_VERSION,
            rubricVersion: RUBRIC_VERSION,
            scorerImplementationVersion: SCORER_IMPLEMENTATION_VERSION,
          }),
          tokenUsageJson: tokenUsage === null ? null : JSON.stringify(tokenUsage),
          validatedOutputJson: JSON.stringify(raw),
          attemptCount,
          startTimestamp: startedAt,
          endTimestamp: completedAt,
          success: true,
          errorCode: null,
          errorMessage: null,
        })
        .run();
    });

    this.logger.scoringComplete({
      jobId: input.job.id,
      kind: 'complete',
      overallScore,
      displayScore,
    });
    return makeOutcome({
      job: input.job,
      kind: 'complete',
      overallScore,
      displayScore,
      fingerprint,
      fields: raw,
      attempted: true,
      errorCode: null,
      errorMessage: null,
    });
  }

  async scoreBatch(input: ScoreBatchInput): Promise<ScoringBatchOutcome> {
    const outcomes: ScoringOutcome[] = [];
    const queue = [...input.jobs];
    let consecutiveAuthFailures = 0;

    const processNext = async (): Promise<void> => {
      while (queue.length > 0) {
        if (input.signal.aborted) {
          while (queue.length > 0) {
            const job = queue.shift()!;
            outcomes.push(
              makeOutcome({
                job: job.job,
                kind: 'cancelled',
                overallScore: null,
                displayScore: null,
                fingerprint: '',
                fields: null,
                attempted: false,
                errorCode: 'cancelled',
                errorMessage: 'Aborted before processing.',
              }),
            );
          }
          return;
        }
        const job = queue.shift()!;
        const outcome = await this.scoreOne({ ...job, signal: input.signal });
        outcomes.push(outcome);
        if (outcome.kind === 'failed' && outcome.errorCode === 'openai_authentication') {
          consecutiveAuthFailures += 1;
          if (consecutiveAuthFailures >= CONSECUTIVE_AUTH_FAILURE_LIMIT) {
            throw new ScoringHardStopError({ consecutiveAuthFailures });
          }
        } else {
          consecutiveAuthFailures = 0;
        }
      }
    };

    const workerCount = Math.max(1, Math.min(this.config.concurrency, input.jobs.length));
    const workers: Promise<void>[] = [];
    for (let i = 0; i < workerCount; i++) {
      workers.push(processNext());
    }
    try {
      await Promise.all(workers);
    } catch (cause) {
      if (cause instanceof ScoringHardStopError) {
        while (queue.length > 0) {
          const job = queue.shift()!;
          outcomes.push(
            makeOutcome({
              job: job.job,
              kind: 'skipped',
              overallScore: null,
              displayScore: null,
              fingerprint: '',
              fields: null,
              attempted: false,
              errorCode: 'hard_stop',
              errorMessage: `Batch aborted after ${cause.metadata['consecutiveAuthFailures']} consecutive auth failures.`,
            }),
          );
        }
      } else {
        throw cause;
      }
    }

    const totals = {
      complete: outcomes.filter((o) => o.kind === 'complete').length,
      reused: outcomes.filter((o) => o.kind === 'reused').length,
      failed: outcomes.filter((o) => o.kind === 'failed').length,
      skipped: outcomes.filter((o) => o.kind === 'skipped').length,
      cancelled: outcomes.filter((o) => o.kind === 'cancelled').length,
    };

    return {
      schemaVersion: LINKEDIN_SCORING_SCHEMA_VERSION,
      runId: input.run.id,
      searchExecutionId: input.searchExecution.id,
      perJob: outcomes,
      totals,
    };
  }

  buildScoringPlan(input: BuildScoringPlanInput): ScoringPlan {
    return buildScoringPlan(input);
  }
}
