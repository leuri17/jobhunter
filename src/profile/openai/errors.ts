import {
  ApplicationError,
  type ApplicationErrorMetadata,
  ExitCode,
} from '../../errors/application-error.js';

/**
 * Structural summary of a single retry attempt. The full `AttemptRecord`
 * type lives in `retry.ts`; this interface is the minimum shape needed
 * by `ProfileExtractionError.attempts` so that `errors.ts` does not need
 * to import from `retry.ts` (which would create a circular dependency).
 */
export interface RetryAttemptSummary {
  readonly attemptNumber: number;
  readonly succeeded: boolean;
  readonly errorCode: string | null;
  readonly errorMessage: string | null;
  readonly retryAfterMs: number | null;
}

/**
 * Base class for every error raised by the profile-extraction pipeline.
 *
 * Every subclass maps to exit code 5 (`ExitCode.OpenAIFailure`) at the CLI
 * boundary per SPEC §25.
 *
 * `attempts` is populated by the retry policy (`runWithRetry`) when the
 * final attempt fails. Callers (Task 7's `ProfileExtractionService`) use
 * `caught.attempts?.length` to record the attempt count on the persisted
 * `openai_request_metadata` row.
 */
export class ProfileExtractionError extends ApplicationError {
  readonly attempts?: readonly RetryAttemptSummary[];

  constructor(
    code: string,
    message: string,
    metadata: ApplicationErrorMetadata = {},
    cause?: Error,
  ) {
    super(code, message, ExitCode.OpenAIFailure, metadata, cause);
  }
}

/**
 * Retryable OpenAI failures. These carry an optional `retryAfterMs` derived
 * from the server (e.g. `Retry-After` header on a 429) so the retry policy
 * can honor it without re-parsing the response.
 */
export class OpenAITransientError extends ProfileExtractionError {
  readonly retryAfterMs: number | null;

  constructor(
    code: string,
    message: string,
    retryAfterMs: number | null,
    metadata: ApplicationErrorMetadata = {},
    cause?: Error,
  ) {
    super(code, message, metadata, cause);
    this.retryAfterMs = retryAfterMs;
  }
}

export class OpenAIRateLimitError extends OpenAITransientError {
  constructor(retryAfterMs: number | null, metadata: ApplicationErrorMetadata = {}, cause?: Error) {
    super('openai_rate_limit', 'OpenAI rate limit reached.', retryAfterMs, metadata, cause);
  }
}

export class OpenAIServerError extends OpenAITransientError {
  constructor(metadata: ApplicationErrorMetadata = {}, cause?: Error) {
    super('openai_server_error', 'OpenAI server error.', null, metadata, cause);
  }
}

export class OpenAITimeoutError extends OpenAITransientError {
  constructor(metadata: ApplicationErrorMetadata = {}, cause?: Error) {
    super('openai_timeout', 'OpenAI request timed out.', null, metadata, cause);
  }
}

export class OpenAINetworkError extends OpenAITransientError {
  constructor(metadata: ApplicationErrorMetadata = {}, cause?: Error) {
    super('openai_network_error', 'OpenAI network failure.', null, metadata, cause);
  }
}

/**
 * The structured output failed Zod validation. The retry policy treats
 * this error class as retryable but enforces a single permitted
 * corrective retry internally; callers do not need to track that state.
 * See `runWithRetry` in `./retry.ts` for the corrective-retry budget.
 */
export class OpenAIInvalidOutputError extends OpenAITransientError {
  constructor(metadata: ApplicationErrorMetadata = {}, cause?: Error) {
    super(
      'openai_invalid_output',
      'OpenAI returned output that failed Zod validation.',
      null,
      metadata,
      cause,
    );
  }
}

/**
 * Non-retryable OpenAI failures. These signal that retries will not help
 * (bad credentials, account-state problems, programmer errors, etc.).
 */
export class OpenAIAuthenticationError extends ProfileExtractionError {
  constructor(metadata: ApplicationErrorMetadata = {}, cause?: Error) {
    super('openai_authentication', 'OpenAI authentication failed.', metadata, cause);
  }
}

export class OpenAIPermissionError extends ProfileExtractionError {
  constructor(metadata: ApplicationErrorMetadata = {}, cause?: Error) {
    super('openai_permission', 'OpenAI permission denied.', metadata, cause);
  }
}

export class OpenAIBillingError extends ProfileExtractionError {
  constructor(metadata: ApplicationErrorMetadata = {}, cause?: Error) {
    super('openai_billing', 'OpenAI billing or quota configuration error.', metadata, cause);
  }
}

export class OpenAIInvalidRequestError extends ProfileExtractionError {
  constructor(metadata: ApplicationErrorMetadata = {}, cause?: Error) {
    super('openai_invalid_request', 'OpenAI rejected the request as invalid.', metadata, cause);
  }
}

export class OpenAIUnsupportedModelError extends ProfileExtractionError {
  constructor(metadata: ApplicationErrorMetadata = {}, cause?: Error) {
    super(
      'openai_unsupported_model',
      'OpenAI rejected the model or configuration.',
      metadata,
      cause,
    );
  }
}

/**
 * Raised before any OpenAI call when the source text — across all stored
 * sources — cannot fit into the request size limit. We fail loud rather than
 * silently truncate, in line with SPEC §25.8's posture.
 */
export class ProfileExtractionInputTooLargeError extends ProfileExtractionError {
  constructor(metadata: ApplicationErrorMetadata = {}, cause?: Error) {
    super(
      'profile_extraction_input_too_large',
      'Source text exceeds the OpenAI request size limit.',
      metadata,
      cause,
    );
  }
}

/**
 * Raised when one or more required sources have unusable extracted text
 * (e.g. OCR-only images with no text). The extraction cannot proceed.
 */
export class ProfileExtractionSourceUnusableError extends ProfileExtractionError {
  constructor(metadata: ApplicationErrorMetadata = {}, cause?: Error) {
    super(
      'profile_extraction_source_unusable',
      'One or more required sources have unusable extracted text.',
      metadata,
      cause,
    );
  }
}

/**
 * Set of error codes that the retry policy treats as retryable. Using a
 * Set of string codes means the retry policy does not need `instanceof` and
 * can classify errors raised by the OpenAI SDK adapter or by the retry
 * policy itself consistently.
 */
export const OPENAI_RETRYABLE_ERROR_CODES: ReadonlySet<string> = new Set([
  'openai_rate_limit',
  'openai_server_error',
  'openai_timeout',
  'openai_network_error',
  'openai_invalid_output',
]);
