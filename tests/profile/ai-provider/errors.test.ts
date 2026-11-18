import { describe, expect, it } from 'vitest';

import { ExitCode } from '../../../src/errors/application-error.js';
import {
  AiProviderAuthenticationError,
  AiProviderBillingError,
  OPENAI_RETRYABLE_ERROR_CODES,
  AiProviderInvalidOutputError,
  AiProviderInvalidRequestError,
  AiProviderNetworkError,
  AiProviderPermissionError,
  AiProviderRateLimitError,
  AiProviderServerError,
  AiProviderTimeoutError,
  AiProviderUnsupportedModelError,
  ProfileExtractionError,
  ProfileExtractionInputTooLargeError,
  ProfileExtractionSourceUnusableError,
} from '../../../src/profile/ai-provider/errors.js';

describe('AiProvider retryable errors', () => {
  it('AiProviderRateLimitError preserves code, exitCode, retryAfterMs, and metadata', () => {
    const cause = new Error('upstream 429');
    const error = new AiProviderRateLimitError(2_500, { hint: 'slow down' }, cause);

    expect(error).toBeInstanceOf(ProfileExtractionError);
    expect(error.code).toBe('openai_rate_limit');
    expect(error.exitCode).toBe(ExitCode.AiProviderFailure);
    expect(error.retryAfterMs).toBe(2_500);
    expect(error.metadata).toEqual({ hint: 'slow down' });
    expect(error.cause).toBe(cause);
  });

  it('AiProviderRateLimitError accepts null retryAfterMs when the server omits Retry-After', () => {
    const error = new AiProviderRateLimitError(null);
    expect(error.retryAfterMs).toBeNull();
    expect(error.code).toBe('openai_rate_limit');
  });

  it('AiProviderServerError always reports null retryAfterMs', () => {
    const error = new AiProviderServerError({ status: 503 });
    expect(error.code).toBe('openai_server_error');
    expect(error.exitCode).toBe(ExitCode.AiProviderFailure);
    expect(error.retryAfterMs).toBeNull();
    expect(error.metadata).toEqual({ status: 503 });
  });

  it('AiProviderTimeoutError exposes openai_timeout with exit code 5', () => {
    const error = new AiProviderTimeoutError();
    expect(error.code).toBe('openai_timeout');
    expect(error.exitCode).toBe(ExitCode.AiProviderFailure);
    expect(error.retryAfterMs).toBeNull();
  });

  it('AiProviderNetworkError exposes openai_network_error with exit code 5', () => {
    const error = new AiProviderNetworkError();
    expect(error.code).toBe('openai_network_error');
    expect(error.exitCode).toBe(ExitCode.AiProviderFailure);
    expect(error.retryAfterMs).toBeNull();
  });
});

describe('AiProviderInvalidOutputError', () => {
  it('exposes openai_invalid_output with exit code 5', () => {
    const error = new AiProviderInvalidOutputError();
    expect(error.code).toBe('openai_invalid_output');
    expect(error.exitCode).toBe(ExitCode.AiProviderFailure);
    expect(error.retryAfterMs).toBeNull();
    expect(error.metadata).toEqual({});
  });

  it('round-trips metadata and the underlying cause', () => {
    const cause = new Error('zod issues: skills.0.name: Required');
    const error = new AiProviderInvalidOutputError({ issues: ['skills.0.name: Required'] }, cause);

    expect(error.code).toBe('openai_invalid_output');
    expect(error.exitCode).toBe(ExitCode.AiProviderFailure);
    expect(error.retryAfterMs).toBeNull();
    expect(error.metadata).toEqual({ issues: ['skills.0.name: Required'] });
    expect(error.cause).toBe(cause);
  });
});

describe('AiProvider non-retryable errors', () => {
  it.each([
    [AiProviderAuthenticationError, 'openai_authentication', 'AiProvider authentication failed.'],
    [AiProviderPermissionError, 'openai_permission', 'AiProvider permission denied.'],
    [AiProviderBillingError, 'openai_billing', 'AiProvider billing or quota configuration error.'],
    [
      AiProviderInvalidRequestError,
      'openai_invalid_request',
      'AiProvider rejected the request as invalid.',
    ],
    [
      AiProviderUnsupportedModelError,
      'openai_unsupported_model',
      'AiProvider rejected the model or configuration.',
    ],
    [
      ProfileExtractionInputTooLargeError,
      'profile_extraction_input_too_large',
      'Source text exceeds the AiProvider request size limit.',
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
    expect(error.exitCode).toBe(ExitCode.AiProviderFailure);
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

  it('does not contain non-retryable AiProvider error codes', () => {
    expect(OPENAI_RETRYABLE_ERROR_CODES.has('openai_authentication')).toBe(false);
    expect(OPENAI_RETRYABLE_ERROR_CODES.has('openai_billing')).toBe(false);
    expect(OPENAI_RETRYABLE_ERROR_CODES.has('openai_invalid_request')).toBe(false);
    expect(OPENAI_RETRYABLE_ERROR_CODES.has('profile_extraction_input_too_large')).toBe(false);
  });
});
