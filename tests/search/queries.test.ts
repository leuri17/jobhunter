import { describe, expect, it } from 'vitest';
import {
  dedupeQueries,
  isNonEmptyQuery,
  normalizeQuery,
  normalizeQueries,
} from '../../src/search/queries.js';

describe('normalizeQuery', () => {
  it('trims leading and trailing whitespace', () => {
    expect(normalizeQuery('   Frontend developer   ')).toBe('Frontend developer');
  });
  it('collapses repeated internal whitespace', () => {
    expect(normalizeQuery('Software\t\tDeveloper\n Engineer')).toBe('Software Developer Engineer');
  });
  it('preserves the original casing of the first occurrence', () => {
    expect(normalizeQuery('Software Developer')).toBe('Software Developer');
    expect(normalizeQuery('software developer')).toBe('software developer');
  });
});

describe('dedupeQueries / normalizeQueries', () => {
  it('drops case-insensitive duplicates after whitespace normalization', () => {
    expect(
      normalizeQueries(['Software Developer', 'software developer', 'Software  Developer']),
    ).toEqual(['Software Developer']);
  });

  it('preserves the first-occurrence display value for every duplicate', () => {
    expect(
      normalizeQueries(['Frontend developer', 'BACKEND developer', 'Frontend Developer']),
    ).toEqual(['Frontend developer', 'BACKEND developer']);
  });

  it('keeps deterministic insertion order', () => {
    expect(
      normalizeQueries(['B', 'A', 'C', 'a', 'b']),
    ).toEqual(['B', 'A', 'C']);
  });

  it('skips empty or whitespace-only values without throwing', () => {
    expect(normalizeQueries(['', '  ', 'Software Developer'])).toEqual(['Software Developer']);
  });

  it('returns an empty array when nothing valid is provided', () => {
    expect(dedupeQueries([])).toEqual([]);
    expect(dedupeQueries(['', '   '])).toEqual([]);
  });
});

describe('isNonEmptyQuery', () => {
  it('returns true for non-empty whitespace-trimmed strings', () => {
    expect(isNonEmptyQuery('Software Developer')).toBe(true);
    expect(isNonEmptyQuery('   x   ')).toBe(true);
  });
  it('returns false for empty or whitespace-only strings', () => {
    expect(isNonEmptyQuery('')).toBe(false);
    expect(isNonEmptyQuery('   ')).toBe(false);
  });
});
