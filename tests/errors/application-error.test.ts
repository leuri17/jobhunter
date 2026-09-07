import { describe, expect, it } from 'vitest';

import {
  ApplicationError,
  ConfigError,
  ExitCode,
  LogConfigError,
  PathError,
  UnknownConfigError,
  ValidationError,
} from '../../src/errors/application-error.js';

describe('ApplicationError', () => {
  it('stores code, exit code, and metadata', () => {
    const cause = new Error('boom');
    const error = new ApplicationError('custom', 'failure', ExitCode.Fatal, { foo: 'bar' }, cause);

    expect(error).toBeInstanceOf(Error);
    expect(error.code).toBe('custom');
    expect(error.exitCode).toBe(ExitCode.Fatal);
    expect(error.metadata).toEqual({ foo: 'bar' });
    expect(error.cause).toBe(cause);
    expect(error.name).toBe('ApplicationError');
  });

  it('serializes to a plain CLI-boundary object', () => {
    const error = new ApplicationError('custom', 'failure', ExitCode.Fatal, { foo: 'bar' });
    const serialized = error.toJSON();

    expect(serialized).toEqual({
      name: 'ApplicationError',
      code: 'custom',
      message: 'failure',
      exitCode: ExitCode.Fatal,
      metadata: { foo: 'bar' },
    });
  });

  it('preserves the full cause chain in toJSON (audit H2 / B1-H2)', () => {
    // The pre-fix shape flattened `cause` to `{name, message}`;
    // toJSON now delegates to formatError so the chain (code +
    // metadata + nested causes) round-trips through any consumer of
    // the JSON envelope.
    const root = new ApplicationError('root_code', 'root', ExitCode.Fatal);
    const middle = new ApplicationError('middle_code', 'middle', ExitCode.Fatal, {}, root);
    const top = new ApplicationError(
      'top_code',
      'top',
      ExitCode.Fatal,
      { hint: 'transient' },
      middle,
    );

    const serialized = top.toJSON();

    expect(serialized.code).toBe('top_code');
    expect(serialized.metadata).toEqual({ hint: 'transient' });
    expect(serialized.cause?.code).toBe('middle_code');
    expect(serialized.cause?.cause?.code).toBe('root_code');
    // The leaf has no further cause.
    expect(serialized.cause?.cause?.cause).toBeUndefined();
  });
});

describe('PathError', () => {
  it('uses the fatal exit code', () => {
    const error = new PathError('directory_create_failed', 'cannot create', { directory: '/x' });
    expect(error.exitCode).toBe(ExitCode.Fatal);
    expect(error.code).toBe('directory_create_failed');
  });
});

describe('ConfigError', () => {
  it('uses the invalid-usage exit code', () => {
    const error = new ConfigError('config_io_error', 'cannot read', { path: '/x/config.json' });
    expect(error.exitCode).toBe(ExitCode.InvalidUsage);
  });
});

describe('ValidationError', () => {
  it('uses the invalid-usage exit code and carries issue paths', () => {
    const error = new ValidationError('zod_failed', 'invalid', {
      issues: [{ path: ['logging', 'level'], message: 'invalid enum value' }],
    });
    expect(error.exitCode).toBe(ExitCode.InvalidUsage);
    expect(error.metadata).toEqual({
      issues: [{ path: ['logging', 'level'], message: 'invalid enum value' }],
    });
  });
});

describe('UnknownConfigError', () => {
  it('uses the invalid-usage exit code and carries unknown keys', () => {
    const error = new UnknownConfigError('unknown_keys', 'unknown properties', {
      keys: ['search', 'bogus'],
    });
    expect(error.exitCode).toBe(ExitCode.InvalidUsage);
    expect(error.code).toBe('unknown_keys');
  });
});

describe('LogConfigError', () => {
  it('uses the fatal exit code and carries the offending level', () => {
    const error = new LogConfigError('invalid_level', 'bad level', { level: 'verbose' });
    expect(error.exitCode).toBe(ExitCode.Fatal);
    expect(error.metadata).toEqual({ level: 'verbose' });
  });

  it('forwards the optional cause to Error', () => {
    const cause = new Error('underlying config parse failure');
    const error = new LogConfigError('invalid_level', 'bad level', { level: 'verbose' }, cause);
    expect(error.cause).toBe(cause);
  });
});
