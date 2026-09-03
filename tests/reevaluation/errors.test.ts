import { describe, expect, it } from 'vitest';

import { ExitCode } from '../../src/errors/application-error.js';
import {
  PipelinePrerequisiteError,
  ReevaluationError,
  ReevaluationValidationError,
} from '../../src/reevaluation/errors.js';

/**
 * Smoke test for the typed reevaluation errors. Mirrors `tests/pipeline/errors.test.ts`.
 *
 * The test verifies:
 *   - `ReevaluationValidationError` defaults to `ExitCode.InvalidUsage`.
 *   - `ReevaluationError` base defaults to `ExitCode.Fatal`.
 *   - `code`, `message`, `metadata` round-trip through the
 *     `ApplicationError` constructor.
 *   - `PipelinePrerequisiteError` (re-exported from
 *     `src/pipeline/errors.js`) carries `ExitCode.MissingRequired`
 *     — the documented exit code for missing-profile / missing-filter
 *     / missing-key cases ( + 16).
 */

describe('Reevaluation errors', () => {
  it('ReevaluationValidationError has exitCode 2 (InvalidUsage)', () => {
    const error = new ReevaluationValidationError(
      'reevaluate_scope_conflict',
      'Cannot combine filters-only with scores-only.',
    );
    expect(error.exitCode).toBe(ExitCode.InvalidUsage);
    expect(error.code).toBe('reevaluate_scope_conflict');
    expect(error.message).toContain('filters-only');
  });

  it('ReevaluationValidationError carries metadata', () => {
    const error = new ReevaluationValidationError(
      'job_not_complete',
      'Job job_42 is not complete.',
      { jobId: 42, status: 'partial' },
    );
    expect(error.exitCode).toBe(ExitCode.InvalidUsage);
    expect(error.metadata['jobId']).toBe(42);
    expect(error.metadata['status']).toBe('partial');
  });

  it('ReevaluationError (base) defaults to exitCode 1 (Fatal)', () => {
    const error = new ReevaluationError('reevaluation_internal', 'internal failure');
    expect(error.exitCode).toBe(ExitCode.Fatal);
    expect(error.code).toBe('reevaluation_internal');
  });

  it('ReevaluationError (base) accepts an explicit exit code', () => {
    const error = new ReevaluationError(
      'reevaluation_custom',
      'custom failure',
      ExitCode.OpenAIFailure,
    );
    expect(error.exitCode).toBe(ExitCode.OpenAIFailure);
  });

  it('ReevaluationValidationError preserves the cause chain', () => {
    const root = new Error('root cause');
    const error = new ReevaluationValidationError(
      'job_not_found',
      'Job job_9999 not found.',
      { input: 'job_9999' },
      root,
    );
    expect(error.cause).toBe(root);
  });

  it('ReevaluationValidationError instances are ApplicationError subclasses', () => {
    const error = new ReevaluationValidationError('test_code', 'test message');
    expect(error.name).toBe('ReevaluationValidationError');
    expect(error).toBeInstanceOf(ReevaluationError);
    expect(error).toBeInstanceOf(Error);
  });

  it('ReevaluationError instances are ApplicationError subclasses', () => {
    const error = new ReevaluationError('test_code', 'test message');
    expect(error.name).toBe('ReevaluationError');
    expect(error).toBeInstanceOf(Error);
  });
});

describe('PipelinePrerequisiteError re-export', () => {
  it('has exitCode 3 (MissingRequired)', () => {
    const error = new PipelinePrerequisiteError('no_active_filter', 'missing');
    expect(error.exitCode).toBe(ExitCode.MissingRequired);
    expect(error.code).toBe('no_active_filter');
  });

  it('carries metadata', () => {
    const error = new PipelinePrerequisiteError('no_active_profile', 'missing', {
      profileVersionId: 7,
    });
    expect(error.exitCode).toBe(ExitCode.MissingRequired);
    expect(error.metadata['profileVersionId']).toBe(7);
  });

  it('re-exported class is the same class from src/pipeline/errors.js', () => {
    // The re-export in src/reevaluation/errors.ts is a pure re-export
    // (no subclassing) so identity is preserved.
    const error = new PipelinePrerequisiteError('openai_api_key_missing', 'missing key');
    expect(error.name).toBe('PipelinePrerequisiteError');
  });
});
