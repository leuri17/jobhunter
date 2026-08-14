import { describe, expect, it } from 'vitest';

import {
  calculateDurationMonths,
  isValidYearMonth,
  parseYearMonth,
} from '../../src/profile/dates.js';

describe('parseYearMonth', () => {
  it('parses "1990" (year only) to { year: 1990, month: null }', () => {
    expect(parseYearMonth('1990')).toEqual({ year: 1990, month: null });
  });

  it('parses "1990-01" to { year: 1990, month: 1 }', () => {
    expect(parseYearMonth('1990-01')).toEqual({ year: 1990, month: 1 });
  });

  it('throws on an out-of-range month value', () => {
    expect(() => parseYearMonth('1990-13')).toThrow();
  });
});

describe('isValidYearMonth', () => {
  it('returns true for "YYYY" and "YYYY-MM" within 01..12', () => {
    expect(isValidYearMonth('1990')).toBe(true);
    expect(isValidYearMonth('1990-01')).toBe(true);
    expect(isValidYearMonth('1990-12')).toBe(true);
  });

  it('returns false for an out-of-range month', () => {
    expect(isValidYearMonth('1990-13')).toBe(false);
  });

  it('returns false for short-year and non-numeric input', () => {
    expect(isValidYearMonth('90')).toBe(false);
    expect(isValidYearMonth('abc')).toBe(false);
  });
});

describe('calculateDurationMonths', () => {
  it('returns 24 for a 2020-01..2022-01 range', () => {
    expect(calculateDurationMonths('2020-01', '2022-01', false)).toBe(24);
  });

  it('returns 80 for "2020" → null/current with `now = 2026-08-01` injected', () => {
    const now = new Date('2026-08-01T00:00:00Z');
    expect(calculateDurationMonths('2020', null, true, now)).toBe(80);
  });

  it('returns null for an inverted range (start > end)', () => {
    expect(calculateDurationMonths('2022-01', '2020-01', false)).toBeNull();
  });

  it('returns null when `end === null && isCurrent === false`', () => {
    expect(calculateDurationMonths('2020-01', null, false)).toBeNull();
  });
});
