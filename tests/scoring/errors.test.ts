import { describe, expect, it } from 'vitest';

import { ExitCode } from '../../src/errors/application-error.js';
import {
  ScoringError,
  ScoringFingerprintMismatchError,
  ScoringHardStopError,
  ScoringInputTooLargeError,
  ScoringInvalidStructuredOutputError,
  ScoringPersistenceError,
} from '../../src/scoring/errors.js';

describe('ScoringError', () => {
  it('inherits from Error and uses ExitCode.OpenAIFailure (5)', () => {
    const error = new ScoringError('test_code', 'test message');
    expect(error).toBeInstanceOf(Error);
    expect(error.exitCode).toBe(ExitCode.OpenAIFailure);
    expect(error.exitCode).toBe(5);
    expect(error.code).toBe('test_code');
    expect(error.message).toBe('test message');
    expect(error.name).toBe('ScoringError');
    expect(error.metadata).toEqual({});
  });

  it('attaches metadata when provided', () => {
    const error = new ScoringError('test_code', 'msg', { foo: 1, bar: 'two' });
    expect(error.metadata).toEqual({ foo: 1, bar: 'two' });
  });

  it('attaches cause when provided', () => {
    const cause = new Error('underlying');
    const error = new ScoringError('test_code', 'msg', {}, cause);
    expect(error.cause).toBe(cause);
  });
});

describe('ScoringInputTooLargeError', () => {
  it('exposes code, exitCode, and metadata per ', () => {
    const error = new ScoringInputTooLargeError({
      estimatedInputBytes: 250_000,
      maxInputBytes: 200_000,
    });
    expect(error.code).toBe('scoring_input_too_large');
    expect(error.exitCode).toBe(5);
    expect(error.name).toBe('ScoringInputTooLargeError');
    expect(error.metadata['estimatedInputBytes']).toBe(250_000);
    expect(error.metadata['maxInputBytes']).toBe(200_000);
    expect(error.metadata['retryable']).toBe(false);
    expect(error.message).toContain('250000');
    expect(error.message).toContain('200000');
  });
});

describe('ScoringInvalidStructuredOutputError', () => {
  it('exposes code, exitCode, and metadata per ', () => {
    const error = new ScoringInvalidStructuredOutputError({
      attemptNumber: 2,
      validationError: 'categoryScores.technicalSkills.score must be <= 100',
    });
    expect(error.code).toBe('scoring_invalid_structured_output');
    expect(error.exitCode).toBe(5);
    expect(error.name).toBe('ScoringInvalidStructuredOutputError');
    expect(error.metadata['attemptNumber']).toBe(2);
    expect(error.metadata['validationError']).toBe(
      'categoryScores.technicalSkills.score must be <= 100',
    );
    expect(error.metadata['retryable']).toBe(true);
  });
});

describe('ScoringPersistenceError', () => {
  it('exposes code, exitCode, and metadata', () => {
    const error = new ScoringPersistenceError({
      table: 'scoreResults',
      operation: 'activateResult',
    });
    expect(error.code).toBe('scoring_persistence_error');
    expect(error.exitCode).toBe(5);
    expect(error.name).toBe('ScoringPersistenceError');
    expect(error.metadata['table']).toBe('scoreResults');
    expect(error.metadata['operation']).toBe('activateResult');
    expect(error.metadata['retryable']).toBe(false);
  });
});

describe('ScoringFingerprintMismatchError', () => {
  it('exposes code, exitCode, and metadata', () => {
    const error = new ScoringFingerprintMismatchError({
      expectedFingerprint: 'a'.repeat(64),
      actualFingerprint: 'b'.repeat(64),
    });
    expect(error.code).toBe('scoring_fingerprint_mismatch');
    expect(error.exitCode).toBe(5);
    expect(error.name).toBe('ScoringFingerprintMismatchError');
    expect(error.metadata['expectedFingerprint']).toBe('a'.repeat(64));
    expect(error.metadata['actualFingerprint']).toBe('b'.repeat(64));
    expect(error.metadata['retryable']).toBe(false);
  });
});

describe('ScoringHardStopError', () => {
  it('exposes code, exitCode, and metadata', () => {
    const error = new ScoringHardStopError({ consecutiveAuthFailures: 3 });
    expect(error.code).toBe('scoring_hard_stop_consecutive_auth_failures');
    expect(error.exitCode).toBe(5);
    expect(error.name).toBe('ScoringHardStopError');
    expect(error.metadata['consecutiveAuthFailures']).toBe(3);
    expect(error.metadata['retryable']).toBe(false);
  });
});
