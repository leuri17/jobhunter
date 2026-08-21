/**
 * Typed reevaluation errors for TASK-017 (SPEC §37).
 *
 * Mirrors the `InspectionError` / `InspectionValidationError` pattern
 * from `src/inspection/errors.ts`. The two-class hierarchy maps to the
 * documented exit codes:
 *
 *   - `ReevaluationError`           (base)     → Fatal (1)
 *   - `ReevaluationValidationError`             → InvalidUsage (2)
 *
 * The missing-prerequisite cases (no active profile, no active filter
 * config, missing `OPENAI_API_KEY`) reuse `PipelinePrerequisiteError`
 * from `src/pipeline/errors.ts` (Decision 16) — the class is
 * re-exported here for consumer convenience. The existing
 * `exitWithError` helper already maps `MissingRequired = 3` for it,
 * so no new error class is needed.
 *
 * No new exit codes are introduced (Decision 15).
 *
 * The `ReevaluationError` base accepts an explicit exit code so
 * subclasses can pick the documented failure-class mapping,
 * mirroring `InspectionError` exactly. Subclasses that only ever map
 * to one exit code pre-fill that code in their own constructor and
 * ignore the parameter.
 */

import {
  ApplicationError,
  type ApplicationErrorMetadata,
  ExitCode,
  type ExitCodeValue,
} from '../errors/application-error.js';

/**
 * Re-export of `PipelinePrerequisiteError` for the
 * missing-profile / missing-filter / missing-`OPENAI_API_KEY`
 * cases (Decision 16). The class is owned by `src/pipeline/errors.ts`
 * — re-exports keep the reevaluation consumer surface narrow.
 */
export { PipelinePrerequisiteError } from '../pipeline/errors.js';

/**
 * Base class for every reevaluation-layer error. Defaults to
 * `ExitCode.Fatal`; subclasses can override via the `exitCode`
 * parameter.
 */
export class ReevaluationError extends ApplicationError {
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
 * Raised when a CLI argument, scope flag, or identifier is invalid
 * (SPEC §37 + Decision 9 + Decision 7). Maps to
 * `ExitCode.InvalidUsage` (2). The `code` field distinguishes the
 * failure mode so the CLI handler can produce precise stderr
 * messages:
 *
 *   - `reevaluate_scope_conflict` — `--filters-only` + `--scores-only`
 *                                   OR `--job` + `--filters-only` +
 *                                   `--scores-only` (invalid combo).
 *   - `job_not_found`            — `--job <id>` resolved no row.
 *   - `job_not_complete`         — `--job <id>` resolved a partial /
 *                                   failed row (Decision 7).
 */
export class ReevaluationValidationError extends ReevaluationError {
  constructor(
    code: string,
    message: string,
    metadata: ApplicationErrorMetadata = {},
    cause?: Error,
  ) {
    super(code, message, ExitCode.InvalidUsage, metadata, cause);
  }
}
