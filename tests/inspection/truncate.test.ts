import { describe, expect, it } from 'vitest';

import { InspectionValidationError } from '../../src/inspection/errors.js';
import { truncateWithEllipsis } from '../../src/inspection/truncate.js';

describe('truncateWithEllipsis (TASK-016 Wave A Task 4, SPEC §34.6)', () => {
  it('returns text unchanged when text.length <= maxWidth', () => {
    expect(truncateWithEllipsis('hello', 5)).toBe('hello');
    expect(truncateWithEllipsis('hi', 5)).toBe('hi');
    expect(truncateWithEllipsis('', 5)).toBe('');
  });

  it('returns the text + … (U+2026) when text.length === maxWidth + 1', () => {
    expect(truncateWithEllipsis('hello!', 5)).toBe('hell\u2026');
    expect(truncateWithEllipsis('helloo', 5)).toBe('hell\u2026');
  });

  it('replaces the tail with U+2026 HORIZONTAL ELLIPSIS, not three dots', () => {
    const out = truncateWithEllipsis('abcdefgh', 5);
    expect(out.endsWith('\u2026')).toBe(true);
    expect(out.endsWith('...')).toBe(false);
    expect(out.length).toBe(5);
    expect(out).toBe('abcd\u2026');
  });

  it('returns empty string when maxWidth <= 0', () => {
    expect(truncateWithEllipsis('anything', 0)).toBe('');
    expect(truncateWithEllipsis('', 0)).toBe('');
  });

  it('returns empty string when text is empty (positive maxWidth)', () => {
    expect(truncateWithEllipsis('', 5)).toBe('');
    expect(truncateWithEllipsis('', 1)).toBe('');
  });

  it('throws InspectionValidationError for non-integer maxWidth', () => {
    expect(() => truncateWithEllipsis('hello', 3.5)).toThrow(InspectionValidationError);
    expect(() => truncateWithEllipsis('hello', Number.NaN)).toThrow(InspectionValidationError);
    expect(() => truncateWithEllipsis('hello', Number.POSITIVE_INFINITY)).toThrow(
      InspectionValidationError,
    );
  });

  it('throws InspectionValidationError for negative maxWidth', () => {
    expect(() => truncateWithEllipsis('hello', -1)).toThrow(InspectionValidationError);
    expect(() => truncateWithEllipsis('hello', -100)).toThrow(InspectionValidationError);
  });

  it('error.code is "truncate_invalid_max_width"', () => {
    try {
      truncateWithEllipsis('hello', -1);
      throw new Error('expected truncateWithEllipsis to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(InspectionValidationError);
      expect((error as InspectionValidationError).code).toBe('truncate_invalid_max_width');
      expect((error as InspectionValidationError).exitCode).toBe(2);
    }
  });
});
