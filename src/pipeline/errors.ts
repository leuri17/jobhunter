import {
  ApplicationError,
  ExitCode,
  type ApplicationErrorMetadata,
  type ExitCodeValue,
} from '../errors/application-error.js';

/**
 * Base class for pipeline-lifecycle errors.
 *
 * Lifecycle errors are typed + exit-code-mapped. They cross the
 * orchestrator boundary only for unrecoverable conditions;
 * per-job or per-search errors are surfaced as `RunSummary`
 * counters and never reach the sidecar as thrown errors.
 *
 * Subclasses can override the exit code by passing an explicit value
 * as the fourth positional argument; the default is {@link ExitCode.Fatal}.
 */
export class PipelineLifecycleError extends ApplicationError {
  constructor(
    code: string,
    message: string,
    metadata: ApplicationErrorMetadata = {},
    cause?: Error,
    exitCode: ExitCodeValue = ExitCode.Fatal,
  ) {
    super(code, message, exitCode, metadata, cause);
  }
}

/**
 * Thrown when a prerequisite (config / active profile / active filter
 * config) is missing or invalid before the run starts.
 *
 * Exit code: 3 (MissingRequired).
 */
export class PipelinePrerequisiteError extends PipelineLifecycleError {
  constructor(
    code: string,
    message: string,
    metadata: ApplicationErrorMetadata = {},
    cause?: Error,
  ) {
    super(code, message, metadata, cause, ExitCode.MissingRequired);
  }
}

/**
 * Thrown when OPENAI_API_KEY is missing — the run cannot proceed.
 *
 * Exit code: 3 (MissingRequired) — per .
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
