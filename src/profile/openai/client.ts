import OpenAI from 'openai';
import {
  APIConnectionError,
  APIConnectionTimeoutError,
  AuthenticationError,
  BadRequestError,
  InternalServerError,
  NotFoundError,
  PermissionDeniedError,
  RateLimitError,
} from 'openai/error';

import {
  OpenAIAuthenticationError,
  OpenAIBillingError,
  OpenAINetworkError,
  OpenAIInvalidRequestError,
  OpenAIRateLimitError,
  OpenAIPermissionError,
  OpenAIServerError,
  OpenAITimeoutError,
  OpenAIUnsupportedModelError,
  ProfileExtractionError,
} from './errors.js';
import { getResponseSchema } from './response-schemas.js';
import type {
  OpenAIExtractionRawResponse,
  OpenAIClient,
  OpenAIExtractionRequest,
} from './types.js';

const DEFAULT_TIMEOUT_MS = 60_000;

const DEFAULT_RETRY_AFTER_SECONDS = 1;

/**
 * Error codes that the OpenAI API uses to signal quota / billing
 * exhaustion. We treat these as **non-retryable billing failures** even
 * when they arrive on a 429 (rate-limit) response, otherwise we would
 * burn the entire retry budget on a permanent billing problem.
 */
const QUOTA_ERROR_CODES: ReadonlySet<string> = new Set([
  'insufficient_quota',
  'billing_not_active',
  'billing_hard_limit_reached',
  'account_deactivated',
  'plan_upgrade_required',
]);

/**
 * Build the production `OpenAIClient` backed by the official `openai`
 * SDK. The SDK is imported only inside this module — every other file
 * in `src/profile/` (and all tests) sees the `OpenAIClient` interface
 * only, so the dependency boundary stays clean.
 *
 * The client is a pure transport: it forwards the pre-built `messages`
 * from the request, looks up the response schema in
 * `RESPONSE_SCHEMA_REGISTRY`, and forwards an optional
 * `maxCompletionTokens` cap to the SDK. Prompt building is the
 * caller's responsibility (see `buildProfileExtractionPrompt` for
 * profile extraction; `buildScoringPrompt` will land in Wave A).
 */
export function createDefaultOpenAIClient(options: {
  readonly apiKey: string;
  readonly timeoutMs?: number;
}): OpenAIClient {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const sdk = new OpenAI({ apiKey: options.apiKey, timeout: timeoutMs });

  return {
    async extract(request: OpenAIExtractionRequest): Promise<OpenAIExtractionRawResponse> {
      const responseSchema = getResponseSchema(
        request.responseSchemaName,
        request.structuredOutputSchemaVersion,
      );
      try {
        const completion = await sdk.chat.completions.create({
          model: request.model,
          reasoning_effort: request.reasoningEffort,
          messages: [...request.messages],
          response_format: {
            type: 'json_schema',
            json_schema: {
              name: request.responseSchemaName,
              schema: responseSchema.schema,
              strict: true,
            },
          },
          ...(request.maxCompletionTokens !== undefined && {
            max_completion_tokens: request.maxCompletionTokens,
          }),
        });

        const choice = completion.choices[0];
        const rawJsonText = choice?.message?.content ?? '';
        const usage = completion.usage;
        const tokenUsage =
          usage === null || usage === undefined
            ? null
            : { promptTokens: usage.prompt_tokens, completionTokens: usage.completion_tokens };

        return { rawJsonText, tokenUsage };
      } catch (error) {
        throw translateSdkError(error);
      }
    },
  };
}

/**
 * Translate an arbitrary `openai` SDK error into the typed
 * `ProfileExtractionError` family. Existing `ProfileExtractionError`
 * subclasses are re-thrown unchanged so the retry policy can still
 * classify them via `OPENAI_RETRYABLE_ERROR_CODES`.
 *
 * The check order matters:
 * 1. `ProfileExtractionError` first (idempotent re-throw).
 * 2. Quota/billing errors on a 429 take precedence over the rate-limit
 *    mapping so we don't retry permanent billing failures.
 * 3. Otherwise match the SDK's documented status -> typed error mapping.
 * 4. Fall back to duck-typed status code for synthetic errors that
 *    happen to look like SDK errors.
 * 5. Anything else is a transport failure.
 */
function translateSdkError(error: unknown): unknown {
  if (error instanceof ProfileExtractionError) {
    return error;
  }

  if (error instanceof AuthenticationError) {
    return new OpenAIAuthenticationError({ status: error.status }, error);
  }
  if (error instanceof PermissionDeniedError) {
    return new OpenAIPermissionError({ status: error.status }, error);
  }
  if (error instanceof RateLimitError) {
    return translateRateLimitError(error);
  }
  if (error instanceof BadRequestError) {
    return translateBadRequestError(error);
  }
  if (error instanceof NotFoundError) {
    return translateNotFoundError(error);
  }
  if (error instanceof APIConnectionTimeoutError) {
    return new OpenAITimeoutError({ status: null }, error);
  }
  if (error instanceof APIConnectionError) {
    return new OpenAINetworkError({ status: null }, error);
  }
  if (error instanceof InternalServerError) {
    return new OpenAIServerError({ status: error.status }, error);
  }

  const status = (error as { status?: number } | null)?.status;
  if (typeof status === 'number') {
    return translateByStatus(status, error);
  }

  // Treat anything else (TypeError from fetch, network reset, etc.) as a
  // transport failure.
  return new OpenAINetworkError({ status: null }, asError(error));
}

/**
 * 429 with a quota/billing code is a permanent failure — no amount of
 * retrying will fix it. 429 without a quota code is a transient rate
 * limit and is retried by the retry policy.
 */
function translateRateLimitError(error: RateLimitError): ProfileExtractionError {
  const code = readErrorCode((error as { error?: unknown }).error);
  if (code !== undefined && QUOTA_ERROR_CODES.has(code)) {
    return new OpenAIBillingError({ status: error.status, code }, error);
  }
  const retryAfterMs = parseRetryAfterMs(error.headers);
  return new OpenAIRateLimitError(retryAfterMs, { status: error.status, code }, error);
}

function translateBadRequestError(error: BadRequestError): ProfileExtractionError {
  const errorBody = (error as { error?: unknown }).error;
  const code = readErrorCode(errorBody);
  const type = readErrorType(errorBody);

  if (code === 'insufficient_quota' || type === 'insufficient_quota') {
    return new OpenAIBillingError({ status: error.status, code, type }, error);
  }
  if (
    code === 'model_not_found' ||
    type === 'model_not_found' ||
    code === 'unsupported_model' ||
    type === 'unsupported_model'
  ) {
    return new OpenAIUnsupportedModelError({ status: error.status, code, type }, error);
  }
  return new OpenAIInvalidRequestError({ status: error.status, code, type }, error);
}

/**
 * 404 is `OpenAIUnsupportedModelError` only when the upstream
 * explicitly tags the response as `model_not_found`. Any other 404
 * (e.g. an unknown endpoint) is a generic invalid request so the
 * caller can surface the precise code.
 */
function translateNotFoundError(error: NotFoundError): ProfileExtractionError {
  const errorBody = (error as { error?: unknown }).error;
  const code = readErrorCode(errorBody);
  const type = readErrorType(errorBody);
  if (code === 'model_not_found' || type === 'model_not_found') {
    return new OpenAIUnsupportedModelError({ status: error.status, code, type }, error);
  }
  return new OpenAIInvalidRequestError({ status: error.status, code, type }, error);
}

/**
 * Duck-typed fallback for synthetic errors that carry a `status` field
 * but no SDK class. Quota codes on a 429 take precedence over the
 * rate-limit mapping; unmatched 4xx codes map to `OpenAIInvalidRequestError`
 * (non-retryable), not to `OpenAINetworkError` (which would be retried).
 */
function translateByStatus(status: number, error: unknown): ProfileExtractionError {
  if (status === 401) return new OpenAIAuthenticationError({ status }, asError(error));
  if (status === 403) return new OpenAIPermissionError({ status }, asError(error));
  if (status === 429) {
    const code = readErrorCode((error as { error?: unknown }).error);
    if (code !== undefined && QUOTA_ERROR_CODES.has(code)) {
      return new OpenAIBillingError({ status, code }, asError(error));
    }
    const retryAfterMs = parseRetryAfterMsFromUnknown(error);
    return new OpenAIRateLimitError(retryAfterMs, { status, code }, asError(error));
  }
  if (status === 400) return new OpenAIInvalidRequestError({ status }, asError(error));
  if (status === 402) return new OpenAIBillingError({ status }, asError(error));
  if (status === 408) return new OpenAITimeoutError({ status }, asError(error));
  if (status === 404) {
    const code = readErrorCode((error as { error?: unknown }).error);
    if (code === 'model_not_found') {
      return new OpenAIUnsupportedModelError({ status, code }, asError(error));
    }
    return new OpenAIInvalidRequestError({ status, code }, asError(error));
  }
  if (status >= 500) return new OpenAIServerError({ status }, asError(error));
  // 4xx without a specific mapping (409, 422, 451, etc.) — non-retryable
  // client error, not a network failure.
  if (status >= 400 && status < 500) {
    return new OpenAIInvalidRequestError({ status }, asError(error));
  }
  return new OpenAINetworkError({ status }, asError(error));
}

function asError(value: unknown): Error {
  if (value instanceof Error) return value;
  return new Error(typeof value === 'string' ? value : 'OpenAI SDK error');
}

function parseRetryAfterMs(headers: Headers | undefined): number | null {
  if (!headers) return null;
  const raw = headers.get('retry-after');
  if (raw === null) return null;
  const seconds = Number.parseFloat(raw);
  if (Number.isFinite(seconds)) return Math.round(seconds * 1000);
  return DEFAULT_RETRY_AFTER_SECONDS * 1000;
}

function parseRetryAfterMsFromUnknown(error: unknown): number | null {
  const headers = (error as { headers?: Headers } | null)?.headers;
  if (headers && typeof (headers as Headers).get === 'function') {
    return parseRetryAfterMs(headers as Headers);
  }
  return null;
}

function readErrorCode(body: unknown): string | undefined {
  if (typeof body !== 'object' || body === null) return undefined;
  const record = body as Record<string, unknown>;
  const code = record['code'];
  return typeof code === 'string' ? code : undefined;
}

function readErrorType(body: unknown): string | undefined {
  if (typeof body !== 'object' || body === null) return undefined;
  const record = body as Record<string, unknown>;
  const type = record['type'];
  return typeof type === 'string' ? type : undefined;
}
