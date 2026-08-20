import { describe, expect, it } from 'vitest';
import { ExitCode } from '../../src/errors/application-error.js';
import {
  PipelinePrerequisiteError,
  PipelineOpenAIKeyMissingError,
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
});
