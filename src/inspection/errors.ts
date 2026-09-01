/**
 * Typed inspection errors for .
 *
 * Mirrors the existing `ProfileLifecycleError` /
 * `InvalidProfileIdentifierError` pattern from
 * `src/profile/errors.ts`. The four-class hierarchy maps to the
 * documented exit codes:
 *
 *   - `InspectionValidationError`           → InvalidUsage (2)
 *   - `InspectionNotFoundError`             → InvalidUsage (2) — unknown identifier / row
 *   - `InspectionResourceNotFoundError`     → Fatal (1) — referenced dependent row missing
 *   - `InspectionError` (base)              → Fatal (1) — default
 *
 * No new exit codes are introduced.
 *
 * The `InspectionError` base accepts an explicit exit code so
 * subclasses can pick the documented failure-class mapping,
 * mirroring `ProfileLifecycleError` exactly. Subclasses that only
 * ever map to one exit code pre-fill that code in their own
 * constructor and ignore the parameter.
 */

import {
  ApplicationError,
  type ApplicationErrorMetadata,
  ExitCode,
  type ExitCodeValue,
} from '../errors/application-error.js';

/**
 * Base class for every inspection-layer error. Defaults to
 * `ExitCode.Fatal`; subclasses can override via the `exitCode`
 * parameter.
 */
export class InspectionError extends ApplicationError {
  constructor(
    code: string,
    message: string,
    exitCode: ExitCodeValue = ExitCode.Fatal,
    metadata: ApplicationErrorMetadata = {},
    cause?: Error,
  ) {
    super(code, message, exitCode, metadata, cause);
  }
}

/**
 * Raised when a CLI argument or refinement is invalid
 * Maps to `ExitCode.InvalidUsage` (2).
 */
export class InspectionValidationError extends InspectionError {
  constructor(
    code: string,
    message: string,
    metadata: ApplicationErrorMetadata = {},
    cause?: Error,
  ) {
    super(code, message, ExitCode.InvalidUsage, metadata, cause);
  }
}

/**
 * Raised when a referenced row (job, run) is unknown or the
 * identifier is malformed. Mirrors `InvalidProfileIdentifierError`'s
 * `InvalidUsage` mapping. The error code distinguishes
 * "identifier is malformed" from "row does not exist" so the CLI
 * handler can produce precise stderr messages.
 */
export class InspectionNotFoundError extends InspectionError {
  constructor(
    code: string,
    message: string,
    metadata: ApplicationErrorMetadata = {},
    cause?: Error,
  ) {
    super(code, message, ExitCode.InvalidUsage, metadata, cause);
  }
}

/**
 * Raised when a referenced row's dependent row is missing
 * (e.g. a job row references a `pipelineRunId` that has been
 * deleted). Mirrors 's `Fatal` pattern for data-integrity
 * bugs.
 */
export class InspectionResourceNotFoundError extends InspectionError {
  constructor(
    code: string,
    message: string,
    metadata: ApplicationErrorMetadata = {},
    cause?: Error,
  ) {
    super(code, message, ExitCode.Fatal, metadata, cause);
  }
}
