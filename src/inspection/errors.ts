/**
 * Typed inspection errors for TASK-016 (SPEC §31 + §37).
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
 * No new exit codes are introduced (Decision 12).
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
 * (SPEC §34.1 / §34.3 / §34.6). Maps to `ExitCode.InvalidUsage` (2).
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
 * `InvalidUsage` mapping (SPEC §37). The error code distinguishes
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
 * deleted). Mirrors TASK-009's `Fatal` pattern for data-integrity
 * bugs (SPEC §37).
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
