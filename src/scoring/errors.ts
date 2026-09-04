import { ApplicationError, ExitCode } from '../errors/application-error.js';
import { RetryableOpenAIError } from '../profile/openai/errors.js';

/**
 * Typed error family for the scoring layer.
 *
 * Every subclass extends `ScoringError`, which extends
 * `ApplicationError`. The base class pins the exit code to
 * `ExitCode.OpenAIFailure = 5` so a scoring-layer failure surfaces
 * a single, predictable HTTP response at the sidecar boundary.
 *
 * Per-job failures are NOT thrown across the `scoreOne` boundary
 * they are surfaced as `ScoringOutcome.kind: 'failed'` and persisted
 * to `openaiMetadata` with `success: false`. The errors defined here
 * are reserved for:
 *   1. Hard-stop conditions that abort the whole batch
 *      (e.g. `ScoringHardStopError`).
 *   2. Internal data corruption that should never happen
 *      (e.g. `ScoringFingerprintMismatchError`).
 *   3. Pre-call guard conditions the service wants to surface
 *      explicitly (e.g. `ScoringInputTooLargeError`).
 */
export class ScoringError extends ApplicationError {
  constructor(
    code: string,
    message: string,
    metadata: Readonly<Record<string, unknown>> = {},
    cause?: Error,
  ) {
    super(code, message, ExitCode.OpenAIFailure, metadata, cause);
  }
}

export interface ScoringInputTooLargeMetadata {
  readonly estimatedInputBytes: number;
  readonly maxInputBytes: number;
}

/** Non-retryable per  — the scoring payload exceeds the 200 KB cap. */
export class ScoringInputTooLargeError extends ScoringError {
  constructor(metadata: ScoringInputTooLargeMetadata, cause?: Error) {
    super(
      'scoring_input_too_large',
      `Scoring input size ${metadata.estimatedInputBytes} bytes exceeds the ${metadata.maxInputBytes} byte cap.`,
      { ...metadata, retryable: false },
      cause,
    );
  }
}

export interface ScoringInvalidStructuredOutputMetadata {
  readonly attemptNumber: number;
  readonly validationError: string;
}

/**
 * Retryable once per  — OpenAI returned JSON that failed Zod validation.
 *
 * Implements the `RetryableOpenAIError` marker so `runWithRetry`
 * classifies this error outside the `ProfileExtractionError` hierarchy
 * (the scoring layer keeps its own error taxonomy). The
 * `correctiveRetry` flag opts the error into the "retryable once"
 * budget that the retry policy enforces for structured-output
 * failures — a second invalid payload aborts the call instead of
 * burning the full attempt budget. The semantic `code` passed to the
 * `ApplicationError` base stays as `scoring_invalid_structured_output`
 * for logs and persistence; the retry policy reads the same field
 * via the marker.
 */
export class ScoringInvalidStructuredOutputError
  extends ScoringError
  implements RetryableOpenAIError
{
  // Opt into the "retryable once" budget. See `RetryableOpenAIError`
  // and `OpenAIInvalidOutputError` for the same pattern on the
  // profile-extraction side.
  readonly correctiveRetry = true;

  constructor(metadata: ScoringInvalidStructuredOutputMetadata, cause?: Error) {
    super(
      'scoring_invalid_structured_output',
      `Scoring structured output failed validation on attempt ${metadata.attemptNumber}: ${metadata.validationError}`,
      { ...metadata, retryable: true },
      cause,
    );
  }
}

export interface ScoringPersistenceMetadata {
  readonly table: string;
  readonly operation: string;
}

/** Non-retryable — the database write failed. */
export class ScoringPersistenceError extends ScoringError {
  constructor(metadata: ScoringPersistenceMetadata, cause?: Error) {
    super(
      'scoring_persistence_error',
      `Scoring persistence failed in ${metadata.table}.${metadata.operation}.`,
      { ...metadata, retryable: false },
      cause,
    );
  }
}

export interface ScoringFingerprintMismatchMetadata {
  readonly expectedFingerprint: string;
  readonly actualFingerprint: string;
}

/** Internal — a fingerprint comparison surfaced an unexpected mismatch. */
export class ScoringFingerprintMismatchError extends ScoringError {
  constructor(metadata: ScoringFingerprintMismatchMetadata, cause?: Error) {
    super(
      'scoring_fingerprint_mismatch',
      `Scoring fingerprint mismatch: expected ${metadata.expectedFingerprint}, got ${metadata.actualFingerprint}.`,
      { ...metadata, retryable: false },
      cause,
    );
  }
}

export interface ScoringHardStopMetadata {
  readonly consecutiveAuthFailures: number;
}

/**
 * Hard-stop — aborts the whole batch when 3 consecutive jobs fail with
 * `openai_authentication`. The orchestrator catches this and maps it
 * to a clean exit; remaining jobs in the batch are marked `kind: 'skipped'`.
 */
export class ScoringHardStopError extends ScoringError {
  constructor(metadata: ScoringHardStopMetadata, cause?: Error) {
    super(
      'scoring_hard_stop_consecutive_auth_failures',
      `Scoring batch aborted after ${metadata.consecutiveAuthFailures} consecutive authentication failures.`,
      { ...metadata, retryable: false },
      cause,
    );
  }
}
