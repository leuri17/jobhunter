import {
  ApplicationError,
  ExitCode,
  type ApplicationErrorMetadata,
} from '../errors/application-error.js';

/**
 * Base class for pipeline-lifecycle errors (TASK-015).
 *
 * Lifecycle errors are typed + exit-code-mapped. They cross the
 * orchestrator boundary only for unrecoverable conditions;
 * per-job or per-search errors are surfaced as `RunSummary`
 * counters and never reach the CLI boundary as thrown errors.
 */
export class PipelineLifecycleError extends ApplicationError {
  constructor(
    code: string,
    message: string,
    metadata: ApplicationErrorMetadata = {},
    cause?: Error,
  ) {
    super(code, message, ExitCode.Fatal, metadata, cause);
  }
}

/**
 * Thrown when a prerequisite (config / active profile / active filter
 * config) is missing or invalid before the run starts.
 *
 * Exit code: 3 (MissingRequired) — per SPEC §37 + §42.
 */
export class PipelinePrerequisiteError extends PipelineLifecycleError {
  constructor(
    code: string,
    message: string,
    metadata: ApplicationErrorMetadata = {},
    cause?: Error,
  ) {
    super(code, message, metadata, cause);
    // Override exit code to 3 (MissingRequired).
    (this as { exitCode: number }).exitCode = ExitCode.MissingRequired;
  }
}

/**
 * Thrown when OPENAI_API_KEY is missing — the run cannot proceed.
 *
 * Exit code: 3 (MissingRequired) — per SPEC §9.2 + §37.
 */
export class PipelineOpenAIKeyMissingError extends PipelinePrerequisiteError {
  constructor(
    code: string,
    message: string,
    metadata: ApplicationErrorMetadata = {},
    cause?: Error,
  ) {
    super(code, message, metadata, cause);
  }
}
