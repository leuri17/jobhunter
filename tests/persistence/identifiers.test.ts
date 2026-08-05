import { describe, expect, it } from 'vitest';

import {
  formatId,
  resolveId,
  resolveJobIdentifier,
  parsePrefixedId,
  InvalidIdentifierError,
  IDENTIFIER_PREFIXES,
  JOB_PREFIX,
  NUMERIC_JOB_PATTERN,
} from '../../src/persistence/identifiers.js';

describe('identifier prefixes', () => {
  it('exposes the documented prefixes from SPEC §32', () => {
    expect(IDENTIFIER_PREFIXES).toEqual({
      job: 'job_',
      run: 'run_',
      profile: 'profile_',
      source: 'source_',
      search: 'search_',
      filters: 'filters_',
      extraction: 'extraction_',
      score: 'score_',
      discovery_error: 'discovery_error_',
    });
    expect(JOB_PREFIX).toBe('job_');
    expect(NUMERIC_JOB_PATTERN.test('123456789')).toBe(true);
    expect(NUMERIC_JOB_PATTERN.test('not-a-number')).toBe(false);
  });
});

describe('formatId', () => {
  it('formats every entity kind with its prefix', () => {
    expect(formatId('job', 42)).toBe('job_42');
    expect(formatId('run', 18)).toBe('run_18');
    expect(formatId('profile', 3)).toBe('profile_3');
    expect(formatId('source', 2)).toBe('source_2');
    expect(formatId('search', 7)).toBe('search_7');
    expect(formatId('filters', 4)).toBe('filters_4');
    expect(formatId('extraction', 15)).toBe('extraction_15');
    expect(formatId('score', 21)).toBe('score_21');
    expect(formatId('discovery_error', 5)).toBe('discovery_error_5');
  });

  it('rejects non-integer IDs', () => {
    expect(() => formatId('job', 1.5)).toThrow(InvalidIdentifierError);
    expect(() => formatId('job', Number.NaN)).toThrow(InvalidIdentifierError);
    expect(() => formatId('job', -1)).toThrow(InvalidIdentifierError);
  });
});

describe('resolveId', () => {
  it('resolves every prefixed format', () => {
    expect(resolveId('job', 'job_42')).toBe(42);
    expect(resolveId('run', 'run_18')).toBe(18);
    expect(resolveId('profile', 'profile_3')).toBe(3);
    expect(resolveId('source', 'source_2')).toBe(2);
    expect(resolveId('search', 'search_7')).toBe(7);
    expect(resolveId('filters', 'filters_4')).toBe(4);
    expect(resolveId('extraction', 'extraction_15')).toBe(15);
    expect(resolveId('score', 'score_21')).toBe(21);
    expect(resolveId('discovery_error', 'discovery_error_5')).toBe(5);
  });

  it('rejects missing prefix', () => {
    expect(() => resolveId('job', '42')).toThrow(InvalidIdentifierError);
    expect(() => resolveId('run', 'run-18')).toThrow(InvalidIdentifierError);
  });

  it('rejects wrong-case prefixes (case-sensitive per SPEC §32)', () => {
    expect(() => resolveId('job', 'JOB_42')).toThrow(InvalidIdentifierError);
    expect(() => resolveId('run', 'Run_18')).toThrow(InvalidIdentifierError);
  });

  it('rejects non-integer payloads', () => {
    expect(() => resolveId('job', 'job_')).toThrow(InvalidIdentifierError);
    expect(() => resolveId('job', 'job_3.14')).toThrow(InvalidIdentifierError);
    expect(() => resolveId('job', 'job_abc')).toThrow(InvalidIdentifierError);
  });

  it('rejects empty or whitespace input', () => {
    expect(() => resolveId('job', '')).toThrow(InvalidIdentifierError);
    expect(() => resolveId('job', '   ')).toThrow(InvalidIdentifierError);
  });

  it('rejects numbers that overflow the safe integer range', () => {
    expect(() => resolveId('job', 'job_99999999999999999999')).toThrow(InvalidIdentifierError);
  });
});

describe('parsePrefixedId', () => {
  it('rejects cross-kind prefixes', () => {
    expect(() => parsePrefixedId('run_42', 'job')).toThrow(InvalidIdentifierError);
    expect(() => parsePrefixedId('job_42', 'run')).toThrow(InvalidIdentifierError);
  });

  it('accepts the expected prefix', () => {
    expect(parsePrefixedId('profile_3', 'profile')).toBe(3);
  });
});

describe('resolveJobIdentifier', () => {
  it('parses job_<integer> as a local ID', () => {
    expect(resolveJobIdentifier('job_42')).toEqual({ jobId: 42 });
  });

  it('parses numeric-only as a LinkedIn sourceJobId', () => {
    expect(resolveJobIdentifier('123456789')).toEqual({ sourceJobId: '123456789' });
    expect(resolveJobIdentifier('987654321')).toEqual({ sourceJobId: '987654321' });
  });

  it('rejects prefixed runs, profiles, and other kinds', () => {
    expect(() => resolveJobIdentifier('run_42')).toThrow(InvalidIdentifierError);
    expect(() => resolveJobIdentifier('profile_42')).toThrow(InvalidIdentifierError);
    expect(() => resolveJobIdentifier('job_abc')).toThrow(InvalidIdentifierError);
  });
});
