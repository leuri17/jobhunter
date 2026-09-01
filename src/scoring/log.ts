import type { Logger } from '../logging/logger.js';
import type { ScoringKind } from './state.js';

/**
 * Logger facade for the scoring layer. Mirrors the
 * `LinkedInScraperLogger` + `LinkedInExtractionLogger` pattern from
 * /013. The pure scoring layer (rubric, score-formula, rank,
 * fingerprint, plan, state, errors) does not import this — only the
 * orchestrator (`service.ts`) does, and only through the `ScoringLogger`
 * interface. The pino adapter stays at the boundary.
 */
export interface ScoringLogger {
  scoringStart(args: { jobId: number; sourceJobId: string; fingerprint: string }): void;
  scoringComplete(args: {
    jobId: number;
    kind: ScoringKind;
    overallScore?: number;
    displayScore?: string;
  }): void;
  scoringSkip(args: { jobId: number; reason: string }): void;
  scoringFail(args: { jobId: number; errorCode: string }): void;
  scoringReuse(args: { jobId: number; fingerprint: string; previousScoreTimestamp: string }): void;
}

/** No-op logger for tests + the default when no logger is configured. */
export function noopScoringLogger(): ScoringLogger {
  return {
    scoringStart: () => undefined,
    scoringComplete: () => undefined,
    scoringSkip: () => undefined,
    scoringFail: () => undefined,
    scoringReuse: () => undefined,
  };
}

/**
 * Pino-backed adapter. Numeric IDs (`jobId` etc.) are stringified to
 * align with the project's `LogContext` conventions (IDs are strings;
 * non-ID numerics like `overallScore` remain numbers so they stay
 * readable in structured log output).
 */
export function pinoScoringLogger(logger: Logger): ScoringLogger {
  return {
    scoringStart: (a) =>
      logger.info({ event: 'scoring.start', ...stringifyIds(a) }, 'scoring.start'),
    scoringComplete: (a) =>
      logger.info({ event: 'scoring.complete', ...stringifyIds(a) }, 'scoring.complete'),
    scoringSkip: (a) => logger.info({ event: 'scoring.skip', ...stringifyIds(a) }, 'scoring.skip'),
    scoringFail: (a) => logger.warn({ event: 'scoring.fail', ...stringifyIds(a) }, 'scoring.fail'),
    scoringReuse: (a) =>
      logger.info({ event: 'scoring.reuse', ...stringifyIds(a) }, 'scoring.reuse'),
  };
}

/**
 * Stringify numeric `*Id` fields (e.g. `jobId`) for `LogContext`
 * compatibility. Non-ID numerics (e.g. `overallScore`) are left as
 * numbers so the structured log output stays readable.
 */
function stringifyIds<T extends Record<string, unknown>>(args: T): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(args)) {
    if (typeof v === 'number' && k.endsWith('Id')) {
      out[k] = String(v);
    } else {
      out[k] = v;
    }
  }
  return out;
}
