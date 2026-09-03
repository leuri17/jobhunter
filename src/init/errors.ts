import {
  ApplicationError,
  type ApplicationErrorMetadata,
  type ExitCodeValue,
  ExitCode,
} from '../errors/application-error.js';

/**
 * Base class for every error raised by the init lifecycle. Subclasses
 * pin a specific exit code so the sidecar's HTTP error mapper needs
 * no `instanceof` cascade. Step-level `failed` outcomes are NOT
 * represented here — they live on `SetupSummary.steps[].errorCode`.
 */
export class InitLifecycleError extends ApplicationError {
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

/** Filesystem / path resolution failure during init. Exit 1. */
export class InitPathsFailedError extends InitLifecycleError {
  constructor(metadata: ApplicationErrorMetadata = {}, cause?: Error) {
    super(
      'init_paths_failed',
      'Failed to resolve OS-specific runtime paths during init.',
      ExitCode.Fatal,
      metadata,
      cause,
    );
  }
}

/**
 * `updateConfig` no-op patch failed to materialize `config.json`.
 * Exit 1. Distinct from the load-time `config_invalid` error code
 * (which is reported on the `config` step's `SetupSummary` and does NOT
 * throw) — this error fires only when `updateConfig` itself throws after
 * `loadConfig` succeeded (write-failure path; Finding 8).
 */
export class InitConfigSeedingFailedError extends InitLifecycleError {
  constructor(metadata: ApplicationErrorMetadata = {}, cause?: Error) {
    super(
      'init_config_seeding_failed',
      'Failed to materialize default config.json during init.',
      ExitCode.Fatal,
      metadata,
      cause,
    );
  }
}

/** SQLite handle open / migration failure. Exit 1. */
export class InitMigrationsFailedError extends InitLifecycleError {
  constructor(metadata: ApplicationErrorMetadata = {}, cause?: Error) {
    super(
      'init_migrations_failed',
      'Failed to initialize SQLite or apply Drizzle migrations during init.',
      ExitCode.Fatal,
      metadata,
      cause,
    );
  }
}

/** Search configuration service threw a non-cancellation error. Exit 2. */
export class InitSearchFailedError extends InitLifecycleError {
  constructor(
    code: string,
    message: string,
    metadata: ApplicationErrorMetadata = {},
    cause?: Error,
  ) {
    super(code, message, ExitCode.InvalidUsage, metadata, cause);
  }
}

/** Profile import failed for every supplied source. Exit 1. */
export class InitImportFailedError extends InitLifecycleError {
  constructor(metadata: ApplicationErrorMetadata = {}, cause?: Error) {
    super(
      'init_import_failed',
      'Profile import failed for every supplied source.',
      ExitCode.Fatal,
      metadata,
      cause,
    );
  }
}

/** OpenAI extraction failed at the runtime layer (auth / billing / server). Exit 5. */
export class InitExtractRuntimeFailedError extends InitLifecycleError {
  constructor(
    code: string,
    message: string,
    metadata: ApplicationErrorMetadata = {},
    cause?: Error,
  ) {
    super(code, message, ExitCode.OpenAIFailure, metadata, cause);
  }
}

/** Approval gate reached without a draft to approve. Exit 3. */
export class InitApprovalFailedError extends InitLifecycleError {
  constructor(metadata: ApplicationErrorMetadata = {}, cause?: Error) {
    super(
      'init_approval_failed',
      'Profile approval could not be performed because no draft is available.',
      ExitCode.MissingRequired,
      metadata,
      cause,
    );
  }
}

/** Filter configuration failed. Exit 2. */
export class InitFiltersFailedError extends InitLifecycleError {
  constructor(
    code: string,
    message: string,
    metadata: ApplicationErrorMetadata = {},
    cause?: Error,
  ) {
    super(code, message, ExitCode.InvalidUsage, metadata, cause);
  }
}

/** SetupSummary rendering failed (rare; only triggered by a bug). Exit 1. */
export class InitSummaryFailedError extends InitLifecycleError {
  constructor(metadata: ApplicationErrorMetadata = {}, cause?: Error) {
    super(
      'init_summary_failed',
      'Failed to render the init setup summary.',
      ExitCode.Fatal,
      metadata,
      cause,
    );
  }
}
