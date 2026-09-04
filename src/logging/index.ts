/**
 * Public barrel for `src/logging/`.
 *
 * Re-exports the Pino-backed structured logger and the
 * domain-specific adapter (reevaluation) that wrap it. Consumers
 * (the orchestrator and sidecar) construct a `Logger` via
 * `createLogger` and pass it down via the existing dependency-
 * injection seams; no `src/logging/` caller imports `pino`
 * directly except through this barrel.
 */

export {
  LOG_LEVELS,
  createLogger,
  DEFAULT_REDACT_PATHS,
  type LogLevel,
  type LoggerOptions,
  type Logger,
  type LogContext,
  type LoggerDestinations,
} from './logger.js';

export { pinoReevaluationLogger } from './reevaluation-logger.js';
