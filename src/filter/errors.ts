import {
  ApplicationError,
  type ApplicationErrorMetadata,
  ExitCode,
  type ExitCodeValue,
} from '../errors/application-error.js';

/**
 * Base class for errors raised by the filter configuration / evaluation
 * lifecycle. Mirrors the
 * `ProfileLifecycleError` pattern: the base accepts an explicit exit code so
 * subclasses can pick the documented failure-class mapping.
 *
 * The evaluator itself never throws — it records
 * `overallOutcome: 'error'` on the result row. These errors are
 * raised by the configuration, storage and sidecar layers, and the
 * HTTP error mapper translates them to HTTP status responses
 * (AGENTS.md §10).
 */
export class FilterLifecycleError extends ApplicationError {
  constructor(
    code: string,
    message: string,
    exitCode: ExitCodeValue,
    metadata: ApplicationErrorMetadata = {},
    cause?: Error,
  ) {
    super(code, message, exitCode, metadata, cause);
  }
}

/**
 * Raised when a user-supplied filter configuration fails Zod validation
 * (structural rejection by `JobFilterConfigSchema`, ).
 *
 * Exit code: `ExitCode.InvalidUsage` (2).
 */
export class InvalidFilterConfigError extends FilterLifecycleError {
  constructor(message: string, metadata: ApplicationErrorMetadata = {}, cause?: Error) {
    super('invalid_filter_config', message, ExitCode.InvalidUsage, metadata, cause);
  }
}

/**
 * Raised when an incoming job payload or evaluation input is malformed
 * (e.g. shape mismatch, missing required fields).
 *
 * Exit code: `ExitCode.InvalidUsage` (2).
 */
export class InvalidFilterPayloadError extends FilterLifecycleError {
  constructor(message: string, metadata: ApplicationErrorMetadata = {}, cause?: Error) {
    super('invalid_filter_payload', message, ExitCode.InvalidUsage, metadata, cause);
  }
}

/**
 * Raised when `configure filters` is invoked before the first profile approval
 * ( first-run gate).
 *
 * Exit code: `ExitCode.MissingRequired` (3).
 */
export class NoActiveProfileError extends FilterLifecycleError {
  constructor(message: string, metadata: ApplicationErrorMetadata = {}, cause?: Error) {
    super('no_active_profile', message, ExitCode.MissingRequired, metadata, cause);
  }
}

/**
 * Raised when the user explicitly cancels an in-flight filter configuration
 * session via the editor (Discard / Exit actions, ).
 *
 * Exit code: `ExitCode.UserCancellation` (130).
 */
export class UserCancelledFilterConfigError extends FilterLifecycleError {
  constructor(message: string, metadata: ApplicationErrorMetadata = {}, cause?: Error) {
    super('filter_config_cancelled', message, ExitCode.UserCancellation, metadata, cause);
  }
}

/**
 * Raised when reading, writing or atomically upgrading the persisted filter
 * configuration or its version history fails (SQLite errors, IO errors,
 * migrations, transactions).
 *
 * Exit code: `ExitCode.Fatal` (1).
 */
export class FilterStorageError extends FilterLifecycleError {
  constructor(message: string, metadata: ApplicationErrorMetadata = {}, cause?: Error) {
    super('filter_storage_error', message, ExitCode.Fatal, metadata, cause);
  }
}

/**
 * Raised when a filter pipeline is run before any
 * `filter_configuration_versions` row has been marked active ( — a filter pipeline without an active global configuration is
 * meaningless and the orchestrator must refuse to run).
 *
 * Distinct from `FilterStorageError`: this signals "no configuration has
 * been set up yet", not "the storage layer failed to answer". The exit
 * code is `Fatal` because the orchestrator cannot proceed; the operator
 * must run `configure filters` and save a baseline before re-running.
 *
 * Exit code: `ExitCode.Fatal` (1).
 */
export class NoActiveFilterConfigError extends FilterLifecycleError {
  constructor(metadata: ApplicationErrorMetadata = {}, cause?: Error) {
    super(
      'no_active_filter_config',
      'No active filter configuration is set.',
      ExitCode.Fatal,
      metadata,
      cause,
    );
  }
}
