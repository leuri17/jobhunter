import type { Logger } from '../logging/logger.js';

/**
 * Structured-logger seam for the pipeline orchestrator (TASK-015).
 *
 * The orchestrator calls each method on transition events with
 * no secrets, no prompt transcripts, no raw OpenAI responses.
 */
export interface PipelineLogger {
  runStart(input: { runId: number }): void;
  runComplete(input: { runId: number; status: string }): void;
  runFail(input: { runId: number; errorCode: string; message: string }): void;
  searchStart(input: { searchId: number; url: string }): void;
  searchComplete(input: { searchId: number; jobsDiscovered: number }): void;
  searchFail(input: { searchId: number; errorCode: string; message: string }): void;
  cancelStart(input: { runId: number }): void;
  cancelComplete(input: { runId: number }): void;
  scoringPlanDisplayed(input: {
    runId: number;
    jobsDiscovered: number;
    newRequests: number;
  }): void;
  scoringConfirmed(input: { runId: number }): void;
  scoringDeclined(input: { runId: number }): void;
}

/** No-op logger for unit tests. */
export function noopPipelineLogger(): PipelineLogger {
  return {
    runStart: () => undefined,
    runComplete: () => undefined,
    runFail: () => undefined,
    searchStart: () => undefined,
    searchComplete: () => undefined,
    searchFail: () => undefined,
    cancelStart: () => undefined,
    cancelComplete: () => undefined,
    scoringPlanDisplayed: () => undefined,
    scoringConfirmed: () => undefined,
    scoringDeclined: () => undefined,
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
  };
}