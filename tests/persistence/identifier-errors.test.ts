import { describe, expect, it } from 'vitest';

import {
  ApplicationError,
  ExitCode,
  InvalidIdentifierError,
} from '../../src/persistence/identifier-errors.js';

describe('InvalidIdentifierError', () => {
  it('extends ApplicationError', () => {
    expect(InvalidIdentifierError.prototype).toBeInstanceOf(ApplicationError);
  });

  it('defaults to the InvalidUsage exit code', () => {
    const error = new InvalidIdentifierError(
      'invalid_identifier',
      'Identifier "foo" is not a recognized format.',
      { input: 'foo' },
    );
    expect(error.exitCode).toBe(ExitCode.InvalidUsage);
    expect(error.code).toBe('invalid_identifier');
    expect(error.metadata).toEqual({ input: 'foo' });
    expect(error.name).toBe('InvalidIdentifierError');
  });

  it('serializes via toJSON()', () => {
    const error = new InvalidIdentifierError('invalid_identifier', 'bad');
    expect(error.toJSON()).toEqual({
      name: 'InvalidIdentifierError',
      code: 'invalid_identifier',
      message: 'bad',
      exitCode: ExitCode.InvalidUsage,
      metadata: {},
    });
  });
});
