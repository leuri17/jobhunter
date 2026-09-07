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
 * Marker interface for errors that `runWithRetry` should classify.
 *
 * Implementations expose the OpenAI-side error `code` so the retry
 * policy can match it against `OPENAI_RETRYABLE_ERROR_CODES`, and an
 * optional `correctiveRetry` flag that opts into the "retryable once"
 * budget reserved for structured-output failures (a second invalid
 * payload aborts the call).
 *
 * `ProfileExtractionError` and its subclasses already satisfy this
 * interface via the inherited `code` field; `OpenAIInvalidOutputError`
 * sets `correctiveRetry: true`. Other OpenAI-driven modules (e.g.
 * scoring) opt in by implementing the interface on the relevant
 * subclass — see `ScoringInvalidStructuredOutputError`.
 */
export interface RetryableOpenAIError {
  readonly code: string;
  readonly correctiveRetry?: boolean;
}

/**
 * Base class for every error raised by the profile-extraction pipeline.
 *
 * Every subclass maps to exit code 5 (`ExitCode.OpenAIFailure`) at
 * the sidecar's HTTP error mapper per .
 *
 * `attempts` is populated by the retry policy (`runWithRetry`) when the
 * final attempt fails. Callers (Task 7's `ProfileExtractionService`) use
 * `caught.attempts?.length` to record the attempt count on the persisted
 * `openai_request_metadata` row.
 *
 * Implements `RetryableOpenAIError` via the inherited `code` field so
 * the retry policy can classify any subclass without an `instanceof`
 * chain that has to know about every OpenAI-driven module.
 */
export class ProfileExtractionError extends ApplicationError implements RetryableOpenAIError {
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
  // Opt into the "retryable once" budget. The retry policy treats any
  // error with `correctiveRetry: true` as eligible for exactly one
  // additional attempt before aborting; a second structured-output
  // failure aborts the call without burning the full attempt budget.
  readonly correctiveRetry = true;

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
 * silently truncate, in line with 's posture.
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
 * The model declined the request via the structured `refusal` field on
 * the chat-completion message. Retrying won't change a policy decision,
 * so this is non-retryable. The full refusal text is preserved in
 * `refusalText` so the caller can surface it (or persist it for audit)
 * verbatim.
 */
export class OpenAIRefusalError extends ProfileExtractionError {
  readonly refusalText: string;

  constructor(refusalText: string, metadata: ApplicationErrorMetadata = {}, cause?: Error) {
    super('openai_refusal', 'OpenAI declined the request.', metadata, cause);
    this.refusalText = refusalText;
  }
}

/**
 * The model returned an HTTP 200 but produced no structured content
 * (`choices[0].message.content` was empty or whitespace). Some models
 * emit an empty body on refusal-like behaviour without populating the
 * `refusal` field, or when truncation / content-filter removes the
 * completion. The caller cannot parse this as structured output, so we
 * surface it as a typed error instead of passing an empty string up
 * the stack.
 */
export class OpenAIEmptyResponseError extends ProfileExtractionError {
  constructor(metadata: ApplicationErrorMetadata = {}, cause?: Error) {
    super(
      'openai_empty_response',
      'OpenAI returned an empty structured-output body.',
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
 * Refusal detector found a refusal marker / empty body in the raw
 * `rawJsonText` returned by the model. Audit B2-M8.
 *
 * Distinct from {@link OpenAIRefusalError}: that error fires when
 * the SDK's `choices[0].message.refusal` field is non-empty, which
 * is the upstream signal that the model declined the request
 * wholesale (non-retryable, by policy). This class fires when the
 * model emits the response in `choices[0].message.content` but the
 * content itself is a refusal, an empty body, or a syntactic `{}` —
 * signals the upstream signal missed. Opt into the "retryable once"
 * budget via `correctiveRetry: true` (mirroring
 * {@link OpenAIInvalidOutputError}) so a transient content-filter
 * trigger gets one chance; the second occurrence aborts the call.
 */
export class ProfileExtractionRefusalError
  extends ProfileExtractionError
  implements RetryableOpenAIError
{
  readonly correctiveRetry = true;

  constructor(metadata: ApplicationErrorMetadata = {}, cause?: Error) {
    super(
      'profile_extraction_refusal',
      'Profile extraction model returned a refusal-marker body.',
      { ...metadata, retryable: true },
      cause,
    );
  }
}

/**
 * Set of error codes that the retry policy treats as retryable. Using a
 * Set of string codes means the retry policy does not need `instanceof` and
 * can classify errors raised by the OpenAI SDK adapter or by the retry
 * policy itself consistently.
 *
 * `scoring_invalid_structured_output` is included so the scoring layer's
 * `ScoringInvalidStructuredOutputError` (which lives outside the
 * `ProfileExtractionError` hierarchy) is classified as retryable-once.
 * The error class declares `correctiveRetry: true` via the
 * `RetryableOpenAIError` marker so the policy also enforces the
 * single-permitted retry budget for it.
 */
export const OPENAI_RETRYABLE_ERROR_CODES: ReadonlySet<string> = new Set([
  'openai_rate_limit',
  'openai_server_error',
  'openai_timeout',
  'openai_network_error',
  'openai_invalid_output',
  'scoring_invalid_structured_output',
]);
