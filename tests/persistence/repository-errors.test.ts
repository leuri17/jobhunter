import { describe, expect, it } from 'vitest';

import {
  ApplicationError,
  ExitCode,
  RecordNotFoundError,
} from '../../src/persistence/repository-errors.js';

describe('RecordNotFoundError', () => {
  it('extends ApplicationError', () => {
    expect(RecordNotFoundError.prototype).toBeInstanceOf(ApplicationError);
  });

  it('defaults to InvalidUsage exit code and includes the entity and id in metadata', () => {
    const error = new RecordNotFoundError('job_not_found', 'No job with id 42.', {
      entity: 'job',
      id: 42,
    });
    expect(error.exitCode).toBe(ExitCode.InvalidUsage);
    expect(error.code).toBe('job_not_found');
    expect(error.metadata).toEqual({ entity: 'job', id: 42 });
    expect(error.name).toBe('RecordNotFoundError');
  });
});
