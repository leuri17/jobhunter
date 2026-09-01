/**
 * Pino adapter for the reevaluation structured logger.
 *
 * Mirrors the `pinoPipelineLogger` adapter from `src/pipeline/log.ts`
 * and `pinoScoringLogger` from `src/scoring/log.ts`
 * Every event method:
 *
 *   - calls the matching Pino level (`info` for normal events, `warn`
 *     for `reevaluationScoreFail`);
 *   - stringifies numeric `*Id` fields (e.g. `jobId`) to align with
 *     the project's `LogContext` convention (IDs are strings);
 *   - tags the event with `event: 'reevaluation.<verb>'` so log
 *     consumers can grep the boundary cleanly.
 *
 * The adapter is the ONLY place the reevaluation event stream meets
 * the runtime Pino client. Domain code (`src/reevaluation/`) NEVER
 * imports `pino` directly.
 */

import type { Logger } from './logger.js';
import type { ReevaluationLogger } from '../reevaluation/log.js';

/**
 * Build a Pino-backed `ReevaluationLogger`. Numeric IDs are
 * stringified so the structured log output stays `LogContext`-
 * compatible (the boundary contract from `src/logging/logger.ts`).
 */
export function pinoReevaluationLogger(pino: Logger): ReevaluationLogger {
  return {
    reevaluationStart: (input) =>
      pino.info(
        {
          event: 'reevaluation.start',
          scope: input.scope,
          dryRun: input.dryRun,
        },
        'reevaluation.start',
      ),
    reevaluationSelection: (input) =>
      pino.info(
        {
          event: 'reevaluation.selection',
          jobCount: input.jobCount,
          skippedCount: input.skippedCount,
        },
        'reevaluation.selection',
      ),
    reevaluationFilterRerun: (input) =>
      pino.info(
        {
          event: 'reevaluation.filter.rerun',
          jobId: String(input.jobId),
          fingerprint: input.fingerprint,
          reused: input.reused,
        },
        'reevaluation.filter.rerun',
      ),
    reevaluationFilterInvalidatedScores: (input) =>
      pino.info(
        {
          event: 'reevaluation.filter.invalidated_scores',
          jobId: String(input.jobId),
          count: input.count,
        },
        'reevaluation.filter.invalidated_scores',
      ),
    reevaluationScoreReuse: (input) =>
      pino.info(
        {
          event: 'reevaluation.score.reuse',
          jobId: String(input.jobId),
          fingerprint: input.fingerprint,
        },
        'reevaluation.score.reuse',
      ),
    reevaluationScoreComplete: (input) =>
      pino.info(
        {
          event: 'reevaluation.score.complete',
          jobId: String(input.jobId),
          overallScore: input.overallScore,
        },
        'reevaluation.score.complete',
      ),
    reevaluationScoreFail: (input) =>
      pino.warn(
        {
          event: 'reevaluation.score.fail',
          jobId: String(input.jobId),
          errorCode: input.errorCode,
        },
        'reevaluation.score.fail',
      ),
    reevaluationDecline: (input) =>
      pino.info({ event: 'reevaluation.decline', scope: input.scope }, 'reevaluation.decline'),
    reevaluationComplete: (input) =>
      pino.info(
        {
          event: 'reevaluation.complete',
          filtersRerun: input.totals.filtersRerun,
          scoresRerun: input.totals.scoresRerun,
          scoresInvalidated: input.totals.scoresInvalidated,
          skipped: input.totals.skipped,
          scoringDeclinedByUser: input.totals.scoringDeclinedByUser,
        },
        'reevaluation.complete',
      ),
  };
}
