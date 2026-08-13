import { describe, expect, it } from 'vitest';

import {
  calculateExtractedTextStats,
  hashExtractedText,
  normalizeExtractedText,
} from '../../src/profile/text-normalize.js';

describe('normalizeExtractedText', () => {
  it('strips a UTF-8 BOM at the start of the input', () => {
    expect(normalizeExtractedText('\uFEFFhello world')).toBe('hello world');
  });

  it('canonicalizes mixed line endings to \\n', () => {
    expect(normalizeExtractedText('a\r\nb\rc\nd')).toBe('a\nb\nc\nd');
  });

  it('collapses runs of three or more blank lines to two blank lines', () => {
    expect(normalizeExtractedText('a\n\n\n\n\nb')).toBe('a\n\n\nb');
  });

  it('preserves two blank lines (paragraph separation)', () => {
    expect(normalizeExtractedText('a\n\n\nb')).toBe('a\n\n\nb');
  });

  it('trims trailing whitespace on each line', () => {
    expect(normalizeExtractedText('a  \n  b\t\nc')).toBe('a\n  b\nc');
  });

  it('trims trailing whitespace from the final line', () => {
    expect(normalizeExtractedText('hello   ')).toBe('hello');
  });

  it('returns the empty string for whitespace-only input', () => {
    expect(normalizeExtractedText('   \n\n\t  \n')).toBe('');
  });

  it('returns the empty string for empty input', () => {
    expect(normalizeExtractedText('')).toBe('');
  });

  it('is deterministic across repeated invocations', () => {
    const input = 'multi\n\nline\nvalue  \n\n\nagain';
    expect(normalizeExtractedText(input)).toBe(normalizeExtractedText(input));
  });
});

describe('hashExtractedText', () => {
  it('returns the SHA-256 of the normalized text', () => {
    const text = 'café résumé';
    const expected = hashExtractedText(text);
    expect(expected).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is stable for the same input', () => {
    expect(hashExtractedText('hello')).toBe(hashExtractedText('hello'));
  });
});

describe('calculateExtractedTextStats', () => {
  it('returns the character length and line count', () => {
    expect(calculateExtractedTextStats('a\nb\nc')).toEqual({
      normalizedLength: 5,
      lineCount: 3,
    });
  });

  it('treats empty text as zero length and zero lines', () => {
    expect(calculateExtractedTextStats('')).toEqual({
      normalizedLength: 0,
      lineCount: 0,
    });
  });

  it('does not count trailing newlines as extra lines', () => {
    expect(calculateExtractedTextStats('a\nb\n')).toEqual({
      normalizedLength: 3,
      lineCount: 2,
    });
  });
});
