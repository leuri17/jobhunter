import type { Logger } from '../logging/logger.js';

/**
 * Structured-logger seam for the pipeline orchestrator.
 *
 * The orchestrator calls each method on transition events with
 * no secrets, no prompt transcripts, no raw OpenAI responses.
 */
export interface PipelineLogger {
  runStart(input: { runId: number }): void;
  runComplete(input: { runId: number; status: string }): void;
  runFail(input: { runId: number; errorCode: string; message: string }): void;
  runSummary(input: {
    runId: number;
    status: string;
    durationMs: number;
    searchesPlanned: number;
    searchesCompleted: number;
    jobsDiscovered: number;
    newCompleteJobs: number;
    jobsAccepted: number;
    jobsRejected: number;
    jobsScored: number;
    scoresReused: number;
    failedExtractions: number;
    filterErrors: number;
    scoringErrors: number;
    promptTokens: number;
    completionTokens: number;
  }): void;
  searchStart(input: { searchId: number; url: string }): void;
  searchComplete(input: { searchId: number; jobsDiscovered: number }): void;
  searchFail(input: { searchId: number; errorCode: string; message: string }): void;
  cancelStart(input: { runId: number }): void;
  cancelComplete(input: { runId: number }): void;
  scoringPlanDisplayed(input: { runId: number; jobsDiscovered: number; newRequests: number }): void;
  scoringConfirmed(input: { runId: number }): void;
  scoringDeclined(input: { runId: number }): void;
  jobFiltered(input: {
    runId: number;
    jobId: number;
    outcome: 'accepted' | 'rejected' | 'error';
    rejectionReasons: readonly string[];
    reused: boolean;
  }): void;
  jobFilterFail(input: { runId: number; jobId: number; errorCode: string; message: string }): void;
}

/** No-op logger for unit tests. */
export function noopPipelineLogger(): PipelineLogger {
  return {
    runStart: () => undefined,
    runComplete: () => undefined,
    runFail: () => undefined,
    runSummary: () => undefined,
    searchStart: () => undefined,
    searchComplete: () => undefined,
    searchFail: () => undefined,
    cancelStart: () => undefined,
    cancelComplete: () => undefined,
    scoringPlanDisplayed: () => undefined,
    scoringConfirmed: () => undefined,
    scoringDeclined: () => undefined,
    jobFiltered: () => undefined,
    jobFilterFail: () => undefined,
  };
}

/** Production adapter from a Pino Logger. */
export function pinoPipelineLogger(logger: Logger): PipelineLogger {
  return {
    runStart: (input) =>
      logger.info({ event: 'run.start', runId: String(input.runId) }, 'run started'),
    runComplete: (input) =>
      logger.info(
        { event: 'run.complete', runId: String(input.runId), status: input.status },
        'run complete',
      ),
    runFail: (input) =>
      logger.error(
        {
          event: 'run.fail',
          runId: String(input.runId),
          errorCode: input.errorCode,
          message: input.message,
        },
        'run failed',
      ),
    runSummary: (input) =>
      logger.info(
        {
          event: 'run.summary',
          runId: String(input.runId),
          status: input.status,
          durationMs: input.durationMs,
          searchesPlanned: input.searchesPlanned,
          searchesCompleted: input.searchesCompleted,
          jobsDiscovered: input.jobsDiscovered,
          newCompleteJobs: input.newCompleteJobs,
          jobsAccepted: input.jobsAccepted,
          jobsRejected: input.jobsRejected,
          jobsScored: input.jobsScored,
          scoresReused: input.scoresReused,
          failedExtractions: input.failedExtractions,
          filterErrors: input.filterErrors,
          scoringErrors: input.scoringErrors,
          promptTokens: input.promptTokens,
          completionTokens: input.completionTokens,
        },
        'run summary',
      ),
    searchStart: (input) =>
      logger.info(
        { event: 'search.start', searchId: String(input.searchId), url: input.url },
        'search start',
      ),
    searchComplete: (input) =>
      logger.info(
        {
          event: 'search.complete',
          searchId: String(input.searchId),
          jobsDiscovered: input.jobsDiscovered,
        },
        'search complete',
      ),
    searchFail: (input) =>
      logger.warn(
        {
          event: 'search.fail',
          searchId: String(input.searchId),
          errorCode: input.errorCode,
          message: input.message,
        },
        'search failed',
      ),
    cancelStart: (input) =>
      logger.info({ event: 'cancel.start', runId: String(input.runId) }, 'cancel start'),
    cancelComplete: (input) =>
      logger.info({ event: 'cancel.complete', runId: String(input.runId) }, 'cancel complete'),
    scoringPlanDisplayed: (input) =>
      logger.info(
        {
          event: 'scoring.plan.displayed',
          runId: String(input.runId),
          jobsDiscovered: input.jobsDiscovered,
          newRequests: input.newRequests,
        },
        'scoring plan displayed',
      ),
    scoringConfirmed: (input) =>
      logger.info({ event: 'scoring.confirmed', runId: String(input.runId) }, 'scoring confirmed'),
    scoringDeclined: (input) =>
      logger.info({ event: 'scoring.declined', runId: String(input.runId) }, 'scoring declined'),
    jobFiltered: (input) =>
      logger.info(
        {
          event: `job.filter.${input.outcome}`,
          runId: String(input.runId),
          jobId: String(input.jobId),
          outcome: input.outcome,
          rejectionReasons: [...input.rejectionReasons],
          reused: input.reused,
        },
        `job filter ${input.outcome}`,
      ),
    jobFilterFail: (input) =>
      logger.warn(
        {
          event: 'job.filter.fail',
          runId: String(input.runId),
          jobId: String(input.jobId),
          errorCode: input.errorCode,
          message: input.message,
        },
        'job filter failed',
      ),
  };
}
