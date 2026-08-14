import { describe, expect, it } from 'vitest';

import { ExitCode } from '../../../src/errors/application-error.js';
import {
  OpenAIAuthenticationError,
  OpenAIBillingError,
  OPENAI_RETRYABLE_ERROR_CODES,
  OpenAIInvalidOutputError,
  OpenAIInvalidRequestError,
  OpenAINetworkError,
  OpenAIPermissionError,
  OpenAIRateLimitError,
  OpenAIServerError,
  OpenAITimeoutError,
  OpenAIUnsupportedModelError,
  ProfileExtractionError,
  ProfileExtractionInputTooLargeError,
  ProfileExtractionSourceUnusableError,
} from '../../../src/profile/openai/errors.js';

describe('OpenAI retryable errors', () => {
  it('OpenAIRateLimitError preserves code, exitCode, retryAfterMs, and metadata', () => {
    const cause = new Error('upstream 429');
    const error = new OpenAIRateLimitError(2_500, { hint: 'slow down' }, cause);

    expect(error).toBeInstanceOf(ProfileExtractionError);
    expect(error.code).toBe('openai_rate_limit');
    expect(error.exitCode).toBe(ExitCode.OpenAIFailure);
    expect(error.retryAfterMs).toBe(2_500);
    expect(error.metadata).toEqual({ hint: 'slow down' });
    expect(error.cause).toBe(cause);
  });

  it('OpenAIRateLimitError accepts null retryAfterMs when the server omits Retry-After', () => {
    const error = new OpenAIRateLimitError(null);
    expect(error.retryAfterMs).toBeNull();
    expect(error.code).toBe('openai_rate_limit');
  });

  it('OpenAIServerError always reports null retryAfterMs', () => {
    const error = new OpenAIServerError({ status: 503 });
    expect(error.code).toBe('openai_server_error');
    expect(error.exitCode).toBe(ExitCode.OpenAIFailure);
    expect(error.retryAfterMs).toBeNull();
    expect(error.metadata).toEqual({ status: 503 });
  });

  it('OpenAITimeoutError exposes openai_timeout with exit code 5', () => {
    const error = new OpenAITimeoutError();
    expect(error.code).toBe('openai_timeout');
    expect(error.exitCode).toBe(ExitCode.OpenAIFailure);
    expect(error.retryAfterMs).toBeNull();
  });

  it('OpenAINetworkError exposes openai_network_error with exit code 5', () => {
    const error = new OpenAINetworkError();
    expect(error.code).toBe('openai_network_error');
    expect(error.exitCode).toBe(ExitCode.OpenAIFailure);
    expect(error.retryAfterMs).toBeNull();
  });
});

describe('OpenAIInvalidOutputError', () => {
  it('exposes openai_invalid_output with exit code 5', () => {
    const error = new OpenAIInvalidOutputError();
    expect(error.code).toBe('openai_invalid_output');
    expect(error.exitCode).toBe(ExitCode.OpenAIFailure);
    expect(error.retryAfterMs).toBeNull();
    expect(error.metadata).toEqual({});
  });

  it('round-trips metadata and the underlying cause', () => {
    const cause = new Error('zod issues: skills.0.name: Required');
    const error = new OpenAIInvalidOutputError({ issues: ['skills.0.name: Required'] }, cause);

    expect(error.code).toBe('openai_invalid_output');
    expect(error.exitCode).toBe(ExitCode.OpenAIFailure);
    expect(error.retryAfterMs).toBeNull();
    expect(error.metadata).toEqual({ issues: ['skills.0.name: Required'] });
    expect(error.cause).toBe(cause);
  });
});

describe('OpenAI non-retryable errors', () => {
  it.each([
    [OpenAIAuthenticationError, 'openai_authentication', 'OpenAI authentication failed.'],
    [OpenAIPermissionError, 'openai_permission', 'OpenAI permission denied.'],
    [OpenAIBillingError, 'openai_billing', 'OpenAI billing or quota configuration error.'],
    [
      OpenAIInvalidRequestError,
      'openai_invalid_request',
      'OpenAI rejected the request as invalid.',
    ],
    [
      OpenAIUnsupportedModelError,
      'openai_unsupported_model',
      'OpenAI rejected the model or configuration.',
    ],
    [
      ProfileExtractionInputTooLargeError,
      'profile_extraction_input_too_large',
      'Source text exceeds the OpenAI request size limit.',
    ],
    [
      ProfileExtractionSourceUnusableError,
      'profile_extraction_source_unusable',
      'One or more required sources have unusable extracted text.',
    ],
  ] as const)('%s exposes %s with exit code 5', (Ctor, expectedCode, expectedMessage) => {
    const error = new Ctor();
    expect(error).toBeInstanceOf(ProfileExtractionError);
    expect(error.code).toBe(expectedCode);
    expect(error.message).toBe(expectedMessage);
    expect(error.exitCode).toBe(ExitCode.OpenAIFailure);
  });
});

describe('OPENAI_RETRYABLE_ERROR_CODES', () => {
  it('contains the five retryable error codes', () => {
    expect(OPENAI_RETRYABLE_ERROR_CODES.has('openai_rate_limit')).toBe(true);
    expect(OPENAI_RETRYABLE_ERROR_CODES.has('openai_server_error')).toBe(true);
    expect(OPENAI_RETRYABLE_ERROR_CODES.has('openai_timeout')).toBe(true);
    expect(OPENAI_RETRYABLE_ERROR_CODES.has('openai_network_error')).toBe(true);
    expect(OPENAI_RETRYABLE_ERROR_CODES.has('openai_invalid_output')).toBe(true);
  });

  it('does not contain non-retryable OpenAI error codes', () => {
    expect(OPENAI_RETRYABLE_ERROR_CODES.has('openai_authentication')).toBe(false);
    expect(OPENAI_RETRYABLE_ERROR_CODES.has('openai_billing')).toBe(false);
    expect(OPENAI_RETRYABLE_ERROR_CODES.has('openai_invalid_request')).toBe(false);
    expect(OPENAI_RETRYABLE_ERROR_CODES.has('profile_extraction_input_too_large')).toBe(false);
  });
});
