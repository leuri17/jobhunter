/**
 * Structured-logger facade for the reevaluation service.
 *
 * Mirrors the `PipelineLogger` pattern from `src/pipeline/log.ts` +
 * the `ScoringLogger` pattern from `src/scoring/log.ts`. The pure
 * reevaluation layer (state/errors/plan/format/json-schemas) does NOT
 * import this — only `ReevaluationService` does, and only through the
 * `ReevaluationLogger` interface. The Pino adapter lives at
 * `src/logging/reevaluation-logger.ts` (boundary-only).
 *
 * The logger events document every transition the service executes.
 * They are total (every method accepts the documented input shape)
 * and never throw — log failures are swallowed by the adapter.
 */

import type { ReevaluationScope, ReevaluationTotals } from './state.js';

/**
 * Structured logger interface for the reevaluation service. Every
 * method receives a typed payload — no free-form context objects
 * cross this boundary, which keeps the log output shape uniform.
 */
export interface ReevaluationLogger {
  /**
   * Emitted once at the start of `execute()`, before any selection
   * work. Records the chosen scope + the dry-run flag.
   */
  reevaluationStart(input: { scope: ReevaluationScope; dryRun: boolean }): void;

  /**
   * Emitted after the selection step. `jobCount` is the count of
   * `filtersToReevaluate.length + jobsToScore.length`; `skippedCount`
   * is the count of `skipped.length`.
   */
  reevaluationSelection(input: { jobCount: number; skippedCount: number }): void;

  /**
   * Emitted per `filtersToReevaluate` entry that the service executed
   * (live mode) — `reused: true` means the cache returned the prior
   * row, `reused: false` means a fresh filter row was activated.
   */
  reevaluationFilterRerun(input: { jobId: number; fingerprint: string; reused: boolean }): void;

  /**
   * Emitted when the filter rerun invalidated the dependent score
   * rows. `count` is the value returned by
   * `ScoreResultRepository.invalidateActiveByJob`.
   */
  reevaluationFilterInvalidatedScores(input: { jobId: number; count: number }): void;

  /**
   * Emitted per `jobsToScore` entry when `ScoringService.scoreOne()`
   * returned `kind: 'reused'`. `fingerprint` is the matched score
   * fingerprint.
   */
  reevaluationScoreReuse(input: { jobId: number; fingerprint: string }): void;

  /**
   * Emitted per `jobsToScore` entry when `ScoringService.scoreOne()`
   * returned `kind: 'complete'`. `overallScore` is the integer score
   * the service computed.
   */
  reevaluationScoreComplete(input: { jobId: number; overallScore: number }): void;

  /**
   * Emitted per `jobsToScore` entry when `ScoringService.scoreOne()`
   * returned `kind: 'failed'`. `errorCode` is the surfaced error
   * code (`openai_timeout`, `openai_unknown_failure`, etc.).
   */
  reevaluationScoreFail(input: { jobId: number; errorCode: string }): void;

  /**
   * Emitted when the user was prompted for scoring confirmation and
   * declined. The score batch is then skipped (no OpenAI calls are
   * made).
   */
  reevaluationDecline(input: { scope: ReevaluationScope }): void;

  /**
   * Emitted once at the end of `execute()`, just before the plan is
   * returned. Carries the final `totals` block from the plan.
   */
  reevaluationComplete(input: { totals: ReevaluationTotals }): void;
}

/** No-op logger for unit tests + the default when no logger is configured. */
export function noopReevaluationLogger(): ReevaluationLogger {
  return {
    reevaluationStart: () => undefined,
    reevaluationSelection: () => undefined,
    reevaluationFilterRerun: () => undefined,
    reevaluationFilterInvalidatedScores: () => undefined,
    reevaluationScoreReuse: () => undefined,
    reevaluationScoreComplete: () => undefined,
    reevaluationScoreFail: () => undefined,
    reevaluationDecline: () => undefined,
    reevaluationComplete: () => undefined,
  };
}
