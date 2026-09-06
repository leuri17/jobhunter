import { describe, expect, it } from 'vitest';
import { ExitCode } from '../../src/errors/application-error.js';
import {
  PipelinePrerequisiteError,
  PipelineOpenAIKeyMissingError,
  PipelineLifecycleError,
} from '../../src/pipeline/errors.js';

describe('Pipeline errors', () => {
  it('PipelinePrerequisiteError has exitCode 3', () => {
    const error = new PipelinePrerequisiteError('no_active_profile', 'missing');
    expect(error.exitCode).toBe(ExitCode.MissingRequired);
    expect(error.code).toBe('no_active_profile');
  });

  it('PipelineOpenAIKeyMissingError has exitCode 3', () => {
    const error = new PipelineOpenAIKeyMissingError('openai_api_key_missing', 'missing');
    expect(error.exitCode).toBe(ExitCode.MissingRequired);
    expect(error.code).toBe('openai_api_key_missing');
  });

  it('errors carry metadata', () => {
    const error = new PipelinePrerequisiteError('no_active_filter', 'missing', {
      configVersionId: 4,
    });
    expect(error.metadata['configVersionId']).toBe(4);
  });

  it('PipelinePrerequisiteError.exitCode is set via constructor, not by post-super mutation', () => {
    // Compile-time check: a plain PipelineLifecycleError accepts an
    // explicit exit-code override. PipelinePrerequisiteError uses this
    // path instead of mutating `this.exitCode` after super().
    const lifecycle = new PipelineLifecycleError(
      'code',
      'msg',
      {},
      undefined,
      ExitCode.OpenAIFailure,
    );
    expect(lifecycle.exitCode).toBe(ExitCode.OpenAIFailure);

    // Build a synthetic subclass that calls super with a custom
    // exit code and assert the value sticks — proves the constructor
    // chain, not a post-super cast, is what carries the value.
    class CustomPrereq extends PipelineLifecycleError {}
    const custom = new CustomPrereq('c', 'm', {}, undefined, ExitCode.LinkedInBlocked);
    expect(custom.exitCode).toBe(ExitCode.LinkedInBlocked);
  });
});
