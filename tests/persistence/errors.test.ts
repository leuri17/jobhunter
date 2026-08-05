import { describe, expect, it } from 'vitest';

import {
  ApplicationError,
  DatabaseError,
  ExitCode,
  MigrationError,
} from '../../src/persistence/errors.js';

describe('persistence errors', () => {
  it('exports typed database and migration errors extending ApplicationError', () => {
    expect(DatabaseError.prototype).toBeInstanceOf(ApplicationError);
    expect(MigrationError.prototype).toBeInstanceOf(ApplicationError);
  });

  it('maps DatabaseError to the Fatal exit code by default', () => {
    const cause = new Error('disk full');
    const error = new DatabaseError(
      'disk_write_failed',
      'Cannot write to database.',
      {
        path: '/tmp/jobhunter.sqlite',
      },
      cause,
    );
    expect(error.exitCode).toBe(ExitCode.Fatal);
    expect(error.code).toBe('disk_write_failed');
    expect(error.metadata).toEqual({ path: '/tmp/jobhunter.sqlite' });
    expect(error.cause).toBe(cause);
    expect(error.name).toBe('DatabaseError');
  });

  it('maps MigrationError to the Fatal exit code by default', () => {
    const error = new MigrationError('migration_apply_failed', 'Migration 0001 failed.', {
      migration: '0001_add_profiles',
    });
    expect(error.exitCode).toBe(ExitCode.Fatal);
    expect(error.code).toBe('migration_apply_failed');
    expect(error.metadata).toEqual({ migration: '0001_add_profiles' });
    expect(error.name).toBe('MigrationError');
  });

  it('serializes errors with toJSON() matching the ApplicationError contract', () => {
    const error = new MigrationError('migration_apply_failed', 'Boom.');
    const json = error.toJSON();
    expect(json).toEqual({
      name: 'MigrationError',
      code: 'migration_apply_failed',
      message: 'Boom.',
      exitCode: ExitCode.Fatal,
      metadata: {},
    });
  });
});
