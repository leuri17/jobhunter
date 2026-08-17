import { describe, expect, it } from 'vitest';

import { ApplicationError, ExitCode } from '../../src/errors/application-error.js';
import {
  FilterLifecycleError,
  FilterStorageError,
  InvalidFilterConfigError,
  InvalidFilterPayloadError,
  NoActiveProfileError,
  UserCancelledFilterConfigError,
} from '../../src/filter/errors.js';

describe('Filter lifecycle errors', () => {
  it('every documented subclass extends FilterLifecycleError (and ApplicationError)', () => {
    const errors = [
      new InvalidFilterConfigError('msg'),
      new InvalidFilterPayloadError('msg'),
      new NoActiveProfileError('msg'),
      new UserCancelledFilterConfigError('msg'),
      new FilterStorageError('msg'),
    ];
    for (const error of errors) {
      expect(error).toBeInstanceOf(FilterLifecycleError);
      expect(error).toBeInstanceOf(ApplicationError);
      expect(error).toBeInstanceOf(Error);
    }
  });

  it('allows the base lifecycle error to use an arbitrary exit code', () => {
    const error = new FilterLifecycleError(
      'custom_filter_error',
      'custom failure',
      ExitCode.Success,
    );
    expect(error.code).toBe('custom_filter_error');
    expect(error.exitCode).toBe(ExitCode.Success);
  });
  it('InvalidFilterConfigError exits with InvalidUsage and uses the documented code', () => {
    const error = new InvalidFilterConfigError('bad config');
    expect(error.code).toBe('invalid_filter_config');
    expect(error.exitCode).toBe(ExitCode.InvalidUsage);
    expect(error.exitCode).toBe(2);
  });

  it('InvalidFilterPayloadError exits with InvalidUsage and uses the documented code', () => {
    const error = new InvalidFilterPayloadError('bad payload');
    expect(error.code).toBe('invalid_filter_payload');
    expect(error.exitCode).toBe(ExitCode.InvalidUsage);
    expect(error.exitCode).toBe(2);
  });

  it('NoActiveProfileError exits with MissingRequired and uses the documented code', () => {
    const error = new NoActiveProfileError('no profile yet');
    expect(error.code).toBe('no_active_profile');
    expect(error.exitCode).toBe(ExitCode.MissingRequired);
    expect(error.exitCode).toBe(3);
  });

  it('UserCancelledFilterConfigError exits with UserCancellation and uses the documented code', () => {
    const error = new UserCancelledFilterConfigError('user said no');
    expect(error.code).toBe('filter_config_cancelled');
    expect(error.exitCode).toBe(ExitCode.UserCancellation);
    expect(error.exitCode).toBe(130);
  });

  it('FilterStorageError exits with Fatal and uses the documented code', () => {
    const error = new FilterStorageError('disk write failed');
    expect(error.code).toBe('filter_storage_error');
    expect(error.exitCode).toBe(ExitCode.Fatal);
    expect(error.exitCode).toBe(1);
  });

  it('preserves the supplied message verbatim', () => {
    const error = new InvalidFilterConfigError('the message is what the user sees');
    expect(error.message).toBe('the message is what the user sees');
  });

  it('stores metadata when supplied and exposes it on the instance', () => {
    const error = new InvalidFilterConfigError('bad shape', { path: 'filters.json' });
    expect(error.metadata).toEqual({ path: 'filters.json' });
  });

  it('preserves the underlying cause error when supplied', () => {
    const cause = new Error('eacces');
    const error = new FilterStorageError('disk full', {}, cause);
    expect(error.cause).toBe(cause);
  });

  it('toJSON returns the documented ApplicationErrorJSON shape', () => {
    const error = new InvalidFilterConfigError('bad shape', { path: 'filters.json' });
    const json = error.toJSON();
    expect(json.name).toBe('InvalidFilterConfigError');
    expect(json.code).toBe('invalid_filter_config');
    expect(json.message).toBe('bad shape');
    expect(json.exitCode).toBe(ExitCode.InvalidUsage);
    expect(json.metadata).toEqual({ path: 'filters.json' });
    expect(json.cause).toBeUndefined();
  });

  it('toJSON includes the cause fields when a cause error is attached', () => {
    const cause = new Error('eacces');
    const error = new FilterStorageError('disk full', {}, cause);
    const json = error.toJSON();
    expect(json.cause).toEqual({ name: 'Error', message: 'eacces' });
  });
});
