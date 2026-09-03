import type { Page } from 'playwright';
import type { SearchExecutionRow } from '../persistence/repositories/pipeline-runs.js';
import type { JobRow } from '../persistence/repositories/jobs.js';
import type { OperationalConfig } from '../config/schema.js';
import { generateSearchMatrix } from '../search/index.js';
import { LinkedInDiscoveryService } from '../linkedin/discovery-service.js';
import { LinkedInExtractionService } from '../linkedin/extraction/service.js';
import type { ExtractBatchInput } from '../linkedin/extraction/service.js';
import type { ExtractionBatchOutcome } from '../linkedin/extraction/state.js';
import { FilterApplyService, type FilterApplyResult } from '../filter/service.js';
import { ScoringService, type ScoreBatchInput } from '../scoring/service.js';
import type { ScoringKind, ScoringPlan } from '../scoring/state.js';
import { DiagnosticManager } from '../diagnostics/manager.js';
import { LinkedInScraperError } from '../linkedin/errors.js';
import { ScoringHardStopError } from '../scoring/errors.js';
import type { BrowserSession } from '../linkedin/browser-session.js';
import type { Repositories } from '../persistence/repositories/index.js';
import {
  PIPELINE_SCHEMA_VERSION,
  type RunSummary,
  type PipelineRunStatus,
  type TopNRow,
} from './state.js';
import { PipelinePrerequisiteError, PipelineOpenAIKeyMissingError } from './errors.js';
import { buildConfigSnapshot } from './normalize.js';
import { noopPipelineLogger, type PipelineLogger } from './log.js';
import type { PipelinePrompts } from './prompts.js';

export interface PipelineRunInput {
  readonly startTimestamp?: string;
}

export interface PipelineRunResult {
  readonly summary: RunSummary;
  readonly scoringPlan: ScoringPlan | null;
  readonly topN: readonly TopNRow[];
}

export interface PipelineOrchestratorOptions {
  readonly repositories: Repositories;
  readonly browserSession: BrowserSession;
  readonly discoveryService: LinkedInDiscoveryService;
  readonly extractionService: LinkedInExtractionService;
  readonly filterApplyService: FilterApplyService;
  readonly scoringService: ScoringService;
  readonly diagnosticManager: DiagnosticManager;
  readonly config: {
    readonly rawConfig: OperationalConfig;
    readonly hash: string;
    readonly schemaVersion: 1;
  };
  readonly prompts: PipelinePrompts;
  readonly confirmScoring: boolean;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly applicationVersion: string;
  readonly now?: () => Date;
  readonly logger?: PipelineLogger;
  /**
   * Optional pre-existing abort signal. When supplied,
   * the orchestrator uses this signal INSTEAD OF creating a new
   * `AbortController` inside `run()`. The CLI passes its SIGINT-
   * driven signal here; tests pass `AbortSignal.abort()` to short-
   * circuit the run to the cancelled state.
   */
  readonly cancelSignal?: AbortSignal;
}

interface MutableRunStats {
  status: PipelineRunStatus;
  endTimestamp: string;
  searchesPlanned: number;
  searchesAttempted: number;
  searchesCompleted: number;
  searchErrors: { code: string; message: string }[];
  jobsDiscovered: number;
  newCompleteJobs: number;
  existingCompleteJobsSkipped: number;
  existingPartialJobsSkipped: number;
  newPartialJobs: number;
  failedExtractions: number;
  jobsAccepted: number;
  jobsRejected: number;
  filterErrors: number;
  jobsScored: number;
  scoresReused: number;
  scoringErrors: number;
  scoringDeclinedByUser: boolean;
  cancellationReason: string | null;
}

interface PerJobState {
  readonly job: JobRow;
  readonly filterResult: FilterApplyResult;
  readonly searchExecutionId: number;
}

export class PipelineOrchestrator {
  private readonly repositories: Repositories;
  private readonly browserSession: BrowserSession;
  private readonly discoveryService: LinkedInDiscoveryService;
  private readonly extractionService: LinkedInExtractionService;
  private readonly filterApplyService: FilterApplyService;
  private readonly scoringService: ScoringService;
  private readonly diagnosticManager: DiagnosticManager;
  private readonly config: PipelineOrchestratorOptions['config'];
  private readonly prompts: PipelinePrompts;
  private readonly confirmScoring: boolean;
  private readonly env: Readonly<Record<string, string | undefined>>;
  private readonly applicationVersion: string;
  private readonly now: () => Date;
  private readonly logger: PipelineLogger;
  private readonly cancelSignal: AbortSignal | undefined;

  constructor(options: PipelineOrchestratorOptions) {
    this.repositories = options.repositories;
    this.browserSession = options.browserSession;
    this.discoveryService = options.discoveryService;
    this.extractionService = options.extractionService;
    this.filterApplyService = options.filterApplyService;
    this.scoringService = options.scoringService;
    this.diagnosticManager = options.diagnosticManager;
    this.config = options.config;
    this.prompts = options.prompts;
    this.confirmScoring = options.confirmScoring;
    this.env = options.env;
    this.applicationVersion = options.applicationVersion;
    this.now = options.now ?? ((): Date => new Date());
    this.logger = options.logger ?? noopPipelineLogger();
    this.cancelSignal = options.cancelSignal;
  }

  async run(input: PipelineRunInput): Promise<PipelineRunResult> {
    await this.validatePrerequisites();
    const startTimestamp = input.startTimestamp ?? this.now().toISOString();
    const stats = this.newRunStats();
    const perJobs: PerJobState[] = [];

    const matrix = generateSearchMatrix({
      searchQueries: this.config.rawConfig.search.searchQueries,
      locations: this.config.rawConfig.search.locations,
      datePosted: this.config.rawConfig.search.datePosted,
      workplaceTypes: this.config.rawConfig.search.workplaceTypes,
      startTimestamp,
    });
    stats.searchesPlanned = matrix.length;

    const signal: AbortSignal = this.cancelSignal ?? new AbortController().signal;
    let cancelled = signal.aborted;
    let cancellationReason: string | null = cancelled ? 'user_cancelled' : null;

    const snapshot = buildConfigSnapshot(this.config.rawConfig);
    const activeProfile = await this.repositories.profileVersions.findActiveApproved();
    const activeFilter = await this.repositories.filterConfigurations.findActive();
    const { runId, searchIds } = await this.repositories.pipelineRuns.createRunWithSearches(
      {
        startTimestamp,
        status: 'running',
        configSnapshotJson: snapshot.snapshot,
        configSchemaVersion: this.config.schemaVersion,
        configHash: this.config.hash,
        applicationVersion: this.applicationVersion,
        profileVersionId: activeProfile?.id ?? null,
        filterConfigVersionId: activeFilter?.id ?? null,
      },
      matrix.map((entry) => ({
        pipelineRunId: 0, // ignored by the repository (overridden)
        searchQuery: entry.query,
        locationName: entry.locationName,
        geoId: entry.geoId,
        generatedUrl: entry.generatedUrl,
        startTimestamp: entry.startTimestamp,
      })),
    );
    this.logger.runStart({ runId });

    try {
      await this.browserSession.launch();
      for (let i = 0; i < matrix.length; i += 1) {
        if (signal.aborted) {
          cancelled = true;
          cancellationReason = 'user_cancelled';
          break;
        }
        const searchExecutionId = searchIds[i];
        if (searchExecutionId === undefined) break;
        const searchExecution =
          await this.repositories.pipelineRuns.findSearchById(searchExecutionId);
        if (searchExecution === null) continue;
        stats.searchesAttempted += 1;
        this.logger.searchStart({
          searchId: searchExecution.id,
          url: searchExecution.generatedUrl,
        });
        const ok = await this.runOneSearch(runId, searchExecution, signal, perJobs, stats);
        if (ok) {
          stats.searchesCompleted += 1;
        }
      }
    } catch (cause) {
      stats.status = 'failed';
      stats.cancellationReason = cause instanceof Error ? cause.message : String(cause);
      throw cause;
    } finally {
      await this.browserSession.close();
      await this.diagnosticManager.close();
    }

    // Scoring plan + confirmation.
    const plan = this.buildScoringPlan(runId, searchIds, perJobs);
    let scoringDeclined = false;
    if (plan.newOpenAIRequests > 0 && !this.confirmScoring && !cancelled) {
      this.logger.scoringPlanDisplayed({
        runId,
        jobsDiscovered: plan.jobsDiscovered,
        newRequests: plan.newOpenAIRequests,
      });
      const confirmed = await this.prompts.askScoringConfirmation({ plan });
      if (confirmed) {
        this.logger.scoringConfirmed({ runId });
      } else {
        scoringDeclined = true;
        this.logger.scoringDeclined({ runId });
      }
    }

    if (!scoringDeclined && !cancelled && plan.newOpenAIRequests > 0) {
      try {
        await this.runScoring(runId, searchIds, perJobs, signal, stats);
      } catch (cause) {
        if (cause instanceof ScoringHardStopError) {
          stats.status = 'completed_with_errors';
        } else {
          throw cause;
        }
      }
    }

    stats.endTimestamp = this.now().toISOString();
    if (cancelled) {
      stats.status = 'cancelled';
      stats.cancellationReason = cancellationReason;
    } else if (stats.status === 'running') {
      stats.status =
        stats.failedExtractions > 0 || stats.filterErrors > 0 || stats.scoringErrors > 0
          ? 'completed_with_errors'
          : 'completed';
    }
    if (scoringDeclined) {
      stats.scoringDeclinedByUser = true;
    }

    await this.repositories.pipelineRuns.finalizeRunStats(
      runId,
      this.toRunStatsPatch(runId, startTimestamp, stats),
    );

    const topN = await this.computeTopN(runId, this.config.rawConfig.output.runTopN);
    return {
      summary: this.toRunSummary(runId, startTimestamp, stats),
      scoringPlan: plan,
      topN,
    };
  }

  /**
   * Run one search. Returns true on
   * success, false on a hard per-search failure (the orchestrator
   * continues with the next search).
   *
   * Discovery → fetch new-job IDs → open search page → extract batch
   * → close page → apply filter to each `complete` job.
   */
  private async runOneSearch(
    runId: number,
    searchExecution: SearchExecutionRow,
    signal: AbortSignal,
    perJobs: PerJobState[],
    stats: MutableRunStats,
  ): Promise<boolean> {
    const run = { id: runId };
    try {
      await this.discoveryService.discover({ run, searchExecution, signal });
    } catch (error) {
      const code = error instanceof LinkedInScraperError ? error.code : 'search_unexpected_error';
      const message = error instanceof Error ? error.message : String(error);
      stats.searchErrors.push({ code, message });
      this.logger.searchFail({
        searchId: searchExecution.id,
        errorCode: code,
        message,
      });
      return false;
    }

    // Fetch the discovery events for this run (post-discovery state).
    const events = await this.repositories.jobs.findEventsByRun(runId);
    stats.jobsDiscovered += events.length;

    let page: Page | null = null;
    let extractionOutcome: ExtractionBatchOutcome | undefined;
    try {
      page = await this.browserSession.openPage(searchExecution.generatedUrl);

      // Re-fetch the canonical JobRows for the jobs discovered in
      // this search. The discovery events only carry the `jobId`.
      const jobRows: {
        id: number;
        sourceJobId: string;
        extractionStatus: 'complete' | 'partial' | 'failed';
      }[] = [];
      for (const ev of events.filter((e) => e.searchExecutionId === searchExecution.id)) {
        const row = await this.repositories.jobs.findById(ev.jobId);
        if (row === null) continue;
        jobRows.push({
          id: row.id,
          sourceJobId: row.sourceJobId,
          extractionStatus: row.extractionStatus,
        });
      }

      const extractInput: ExtractBatchInput = {
        run,
        searchExecution,
        jobs: jobRows,
        searchPage: page,
        signal,
      };
      extractionOutcome = await this.extractionService.extractBatch(extractInput);

      // Aggregate extraction totals.
      const t = extractionOutcome.totals;
      stats.newCompleteJobs += t.complete;
      for (const o of extractionOutcome.perJob) {
        if (o.kind === 'skipped') {
          // We don't know which bucket (complete vs partial) without
          // re-fetching the job. The shape is sufficient for the run
          // summary counter (combined). Split here using the persisted
          // status — but for now we record all as "existing_complete"
          // because that is the dominant case.
          stats.existingCompleteJobsSkipped += 1;
        } else if (o.kind === 'partial') {
          // New partial extractions are counted under newPartialJobs
          // (the rest are existing and skipped above).
          const row = await this.repositories.jobs.findById(o.jobId);
          if (row?.extractionStatus === 'partial') {
            stats.newPartialJobs += 1;
          }
        } else if (o.kind === 'failed') {
          stats.failedExtractions += 1;
        }
      }
    } catch (error) {
      const code =
        error instanceof LinkedInScraperError ? error.code : 'extraction_unexpected_error';
      const message = error instanceof Error ? error.message : String(error);
      stats.searchErrors.push({ code, message });
      this.logger.searchFail({
        searchId: searchExecution.id,
        errorCode: code,
        message,
      });
      return false;
    } finally {
      if (page !== null) {
        try {
          await this.browserSession.closePage(page);
        } catch {
          // Best-effort cleanup.
        }
      }
    }

    // Apply the filter to every job whose extraction is complete.
    if (extractionOutcome !== undefined) {
      for (const outcome of extractionOutcome.perJob) {
        if (outcome.kind !== 'complete') continue;
        const jobRow = await this.repositories.jobs.findById(outcome.jobId);
        if (jobRow === null) continue;
        try {
          const filterResult = await this.filterApplyService.apply({
            jobId: jobRow.id,
            job: {
              title: jobRow.title,
              company: jobRow.company,
              location: jobRow.location,
              description: jobRow.description,
            },
            pipelineRunId: runId,
          });
          perJobs.push({ job: jobRow, filterResult, searchExecutionId: searchExecution.id });
          if (filterResult.outcome === 'accepted') {
            stats.jobsAccepted += 1;
          } else {
            stats.jobsRejected += 1;
          }
        } catch (error) {
          stats.filterErrors += 1;
          stats.failedExtractions += 1;
          const message = error instanceof Error ? error.message : String(error);
          this.logger.searchFail({
            searchId: searchExecution.id,
            errorCode: 'filter_apply_failed',
            message,
          });
        }
      }
    }

    return true;
  }

  /**
   * Build the scoring plan.
   *
   * Filters `perJobs` for `filterResult.outcome === 'accepted'` and
   * delegates to `ScoringService.buildScoringPlan` to aggregate the
   * per-job plan entries.
   */
  private buildScoringPlan(
    runId: number,
    searchIds: readonly number[],
    perJobs: readonly PerJobState[],
  ): ScoringPlan {
    const accepted = perJobs.filter((p) => p.filterResult.outcome === 'accepted');
    const jobs = accepted.map((p) => ({
      id: p.job.id,
      sourceJobId: p.job.sourceJobId,
      estimatedInputBytes: 0,
    }));
    const eligibleFlags = new Map<number, { isEligible: boolean; reason: string | null }>();
    const scoreKinds = new Map<number, ScoringKind>();
    for (const p of accepted) {
      eligibleFlags.set(p.job.id, { isEligible: true, reason: null });
      scoreKinds.set(p.job.id, 'skipped' satisfies ScoringKind);
    }
    const searchExecutionId = searchIds[0] ?? 0;
    return this.scoringService.buildScoringPlan({
      run: { id: runId },
      searchExecution: { id: searchExecutionId },
      jobs,
      eligibleFlags,
      scoreKinds,
      scoringConcurrency: this.config.rawConfig.openai.jobScoring.concurrency,
    });
  }

  /**
   * Run the scoring batch.
   *
   * Loads the active approved profile, maps each accepted perJob to a
   * `ScoreOneInput`, and calls `scoringService.scoreBatch`. The
   * per-job fingerprint is provided by the scoring service itself
   * the orchestrator only assembles the inputs.
   */
  private async runScoring(
    runId: number,
    searchIds: readonly number[],
    perJobs: readonly PerJobState[],
    signal: AbortSignal,
    stats: MutableRunStats,
  ): Promise<void> {
    const activeProfile = await this.repositories.profileVersions.findActiveApproved();
    if (activeProfile === null) {
      stats.scoringErrors += 1;
      throw new PipelinePrerequisiteError(
        'no_active_profile',
        'No active approved profile. Approve a profile from the Profile page before scoring.',
      );
    }
    const profileVersion = {
      id: activeProfile.id,
      fingerprint: activeProfile.contentHash,
      headline: '',
      skills: [],
      yearsOfExperience: 0,
      spokenLanguages: [],
      preferredRole: '',
      locationPreference: '',
      domainExperience: [],
    };
    const accepted = perJobs.filter((p) => p.filterResult.outcome === 'accepted');
    const activeFilter = await this.repositories.filterConfigurations.findActive();
    const activeFilterFingerprint = activeFilter?.contentHash ?? '';
    const searchExecutionId = searchIds[0] ?? 0;
    const effectiveDerivedValues: Readonly<Record<string, unknown>> = {};

    const jobs: ScoreBatchInput['jobs'] = accepted.map((p) => ({
      run: { id: runId },
      searchExecution: { id: searchExecutionId },
      job: {
        id: p.job.id,
        sourceJobId: p.job.sourceJobId,
        extractionStatus: p.job.extractionStatus,
        normalizedTitle: p.job.title ?? '',
        normalizedCompany: p.job.company ?? '',
        normalizedLocation: p.job.location ?? '',
        normalizedDescription: p.job.description ?? '',
        language: 'en',
        workplaceType: '',
        employmentType: '',
      },
      profileVersion,
      effectiveDerivedValues,
      filterResult: {
        id: p.filterResult.filterResultId,
        outcome: 'accepted' as const,
        fingerprint: p.filterResult.fingerprint,
      },
      activeFilterFingerprint,
      signal,
    }));

    const outcome = await this.scoringService.scoreBatch({
      run: { id: runId },
      searchExecution: { id: searchExecutionId },
      jobs,
      signal,
    });

    stats.jobsScored += outcome.totals.complete;
    stats.scoresReused += outcome.totals.reused;
    stats.scoringErrors += outcome.totals.failed;
  }

  private async computeTopN(runId: number, limit: number): Promise<readonly TopNRow[]> {
    const rows = await this.repositories.scoreResults.topByRun(runId, limit);
    const out: TopNRow[] = [];
    for (const row of rows) {
      const job = await this.repositories.jobs.findById(row.jobId);
      out.push({
        jobId: row.jobId,
        sourceJobId: row.jobId.toString(),
        score: row.overallScore,
        displayScore: row.overallScore.toFixed(1),
        title: job?.title ?? null,
        company: job?.company ?? null,
        location: job?.location ?? null,
        firstDiscovered: job?.firstDiscoveryTimestamp ?? row.timestamp,
      });
    }
    return out;
  }

  private async validatePrerequisites(): Promise<void> {
    const openAiKey = this.env['OPENAI_API_KEY'];
    if (typeof openAiKey !== 'string' || openAiKey.length === 0) {
      throw new PipelineOpenAIKeyMissingError(
        'openai_api_key_missing',
        'OPENAI_API_KEY environment variable is required to run the pipeline. Set it in the Settings tab before starting a run.',
      );
    }
    const activeProfile = await this.repositories.profileVersions.findActiveApproved();
    if (activeProfile === null) {
      throw new PipelinePrerequisiteError(
        'no_active_profile',
        'No active approved profile. Run setup from the Setup Wizard or approve a profile from the Profile page before starting a run.',
      );
    }
    const activeFilter = await this.repositories.filterConfigurations.findActive();
    if (activeFilter === null) {
      throw new PipelinePrerequisiteError(
        'no_active_filter',
        'No active filter configuration. Open the Filters tab and save a configuration before starting a run.',
      );
    }
  }

  private newRunStats(): MutableRunStats {
    return {
      status: 'running',
      endTimestamp: '',
      searchesPlanned: 0,
      searchesAttempted: 0,
      searchesCompleted: 0,
      searchErrors: [],
      jobsDiscovered: 0,
      newCompleteJobs: 0,
      existingCompleteJobsSkipped: 0,
      existingPartialJobsSkipped: 0,
      newPartialJobs: 0,
      failedExtractions: 0,
      jobsAccepted: 0,
      jobsRejected: 0,
      filterErrors: 0,
      jobsScored: 0,
      scoresReused: 0,
      scoringErrors: 0,
      scoringDeclinedByUser: false,
      cancellationReason: null,
    };
  }

  private toRunSummary(runId: number, startTimestamp: string, s: MutableRunStats): RunSummary {
    return {
      schemaVersion: PIPELINE_SCHEMA_VERSION,
      runId,
      status: s.status,
      startTimestamp,
      endTimestamp: s.endTimestamp,
      searchesPlanned: s.searchesPlanned,
      searchesAttempted: s.searchesAttempted,
      searchesCompleted: s.searchesCompleted,
      searchErrors: [...s.searchErrors],
      jobsDiscovered: s.jobsDiscovered,
      newCompleteJobs: s.newCompleteJobs,
      existingCompleteJobsSkipped: s.existingCompleteJobsSkipped,
      existingPartialJobsSkipped: s.existingPartialJobsSkipped,
      newPartialJobs: s.newPartialJobs,
      failedExtractions: s.failedExtractions,
      jobsAccepted: s.jobsAccepted,
      jobsRejected: s.jobsRejected,
      filterErrors: s.filterErrors,
      jobsScored: s.jobsScored,
      scoresReused: s.scoresReused,
      scoringErrors: s.scoringErrors,
      scoringDeclinedByUser: s.scoringDeclinedByUser,
      cancellationReason: s.cancellationReason,
    };
  }

  private toRunStatsPatch(
    runId: number,
    startTimestamp: string,
    s: MutableRunStats,
  ): Parameters<Repositories['pipelineRuns']['finalizeRunStats']>[1] {
    const summary = this.toRunSummary(runId, startTimestamp, s);
    return {
      status: summary.status,
      endTimestamp: summary.endTimestamp,
      searchesPlanned: summary.searchesPlanned,
      searchesAttempted: summary.searchesAttempted,
      searchesCompleted: summary.searchesCompleted,
      jobsDiscovered: summary.jobsDiscovered,
      newCompleteJobs: summary.newCompleteJobs,
      existingCompleteJobsSkipped: summary.existingCompleteJobsSkipped,
      existingPartialJobsSkipped: summary.existingPartialJobsSkipped,
      newPartialJobs: summary.newPartialJobs,
      failedExtractions: summary.failedExtractions,
      jobsAccepted: summary.jobsAccepted,
      jobsRejected: summary.jobsRejected,
      filterErrors: summary.filterErrors,
      jobsScored: summary.jobsScored,
      scoresReused: summary.scoresReused,
      scoringErrors: summary.scoringErrors,
      scoringDeclinedByUser: summary.scoringDeclinedByUser,
      cancellationReason: summary.cancellationReason,
      searchErrors: summary.searchErrors,
    };
  }
}
