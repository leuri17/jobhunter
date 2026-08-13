import { describe, expect, it } from 'vitest';

import {
  ExtractionFailedError,
  InvalidArgumentCountError,
  OcrRequiredError,
  ProfileImportError,
  ProfileSourceStorageError,
  SourceUnreadableError,
  UnsupportedSourceFormatError,
} from '../../src/profile/errors.js';

describe('Profile import errors', () => {
  it('UnsupportedSourceFormatError exposes unsupported_format code', () => {
    const error = new UnsupportedSourceFormatError('nope', { path: '/x' });
    expect(error).toBeInstanceOf(ProfileImportError);
    expect(error.code).toBe('unsupported_format');
    expect(error.exitCode).toBe(2);
    expect(error.metadata).toMatchObject({ path: '/x' });
  });

  it('SourceUnreadableError exposes source_unreadable code', () => {
    const error = new SourceUnreadableError('missing', { path: '/x' });
    expect(error.code).toBe('source_unreadable');
    expect(error.exitCode).toBe(2);
  });

  it('ExtractionFailedError exposes extraction_failed code', () => {
    const error = new ExtractionFailedError('boom');
    expect(error.code).toBe('extraction_failed');
    expect(error.exitCode).toBe(2);
  });

  it('OcrRequiredError exposes ocr_required code', () => {
    const error = new OcrRequiredError('image-only');
    expect(error.code).toBe('ocr_required');
    expect(error.exitCode).toBe(2);
  });

  it('InvalidArgumentCountError exposes invalid_argument_count code', () => {
    const error = new InvalidArgumentCountError('expected 1 or 2 paths');
    expect(error.code).toBe('invalid_argument_count');
    expect(error.exitCode).toBe(2);
  });

  it('ProfileSourceStorageError exposes profile_source_storage_error code', () => {
    const error = new ProfileSourceStorageError('copy failed');
    expect(error.code).toBe('profile_source_storage_error');
    expect(error.exitCode).toBe(2);
  });

  it('preserves the cause error when provided', () => {
    const cause = new Error('disk full');
    const error = new ExtractionFailedError('failed', {}, cause);
    expect(error.cause).toBe(cause);
  });
});
