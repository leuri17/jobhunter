import { describe, it, expect } from 'vitest';
import { ApplicationError, ExitCode } from '@jobhunter/core/errors';
import { runErrorFrom } from '../src/routes/pipeline.js';

describe('runErrorFrom', () => {
  it('keeps the code and message of an ApplicationError', () => {
    const err = new ApplicationError(
      'no_active_profile',
      'No active approved profile.',
      ExitCode.MissingRequired,
    );
    expect(runErrorFrom(err)).toEqual({
      code: 'no_active_profile',
      message: 'No active approved profile.',
    });
  });

  it('wraps plain errors as pipeline_failed with their message', () => {
    expect(runErrorFrom(new Error('boom'))).toEqual({
      code: 'pipeline_failed',
      message: 'boom',
    });
  });

  it('stringifies non-error throws', () => {
    expect(runErrorFrom('nope')).toEqual({ code: 'pipeline_failed', message: 'nope' });
  });
});
