import { describe, expect, it } from 'vitest';

import { DetailUrlBuildError } from '../../src/linkedin/extraction/errors.js';
import { buildDetailUrl } from '../../src/linkedin/extraction/detail-url.js';

/**
 * Tests for `src/linkedin/extraction/detail-url.ts`
 * (TASK-013 Plan Task 4).
 *
 * Asserts:
 *   - Valid 6+ digit IDs produce the canonical URL.
 *   - Empty / non-numeric / under-6-digit IDs throw
 *     `DetailUrlBuildError`.
 */
describe('src/linkedin/extraction/detail-url — Wave A', () => {
  it('builds the canonical URL for a 6-digit sourceJobId', () => {
    expect(buildDetailUrl('123456')).toBe('https://www.linkedin.com/jobs/view/123456/');
  });

  it('builds the canonical URL for a 7-digit sourceJobId', () => {
    expect(buildDetailUrl('1234567')).toBe('https://www.linkedin.com/jobs/view/1234567/');
  });

  it('builds the canonical URL for a 10-digit sourceJobId', () => {
    expect(buildDetailUrl('1234567890')).toBe('https://www.linkedin.com/jobs/view/1234567890/');
  });

  it('throws DetailUrlBuildError for the empty string', () => {
    expect(() => buildDetailUrl('')).toThrow(DetailUrlBuildError);
  });

  it('throws DetailUrlBuildError for a 5-digit ID (under the 6-digit floor)', () => {
    expect(() => buildDetailUrl('12345')).toThrow(DetailUrlBuildError);
  });

  it('throws DetailUrlBuildError for a 1-digit ID', () => {
    expect(() => buildDetailUrl('1')).toThrow(DetailUrlBuildError);
  });

  it('throws DetailUrlBuildError for a non-numeric ID', () => {
    expect(() => buildDetailUrl('abc')).toThrow(DetailUrlBuildError);
  });

  it('throws DetailUrlBuildError for an ID with leading whitespace', () => {
    expect(() => buildDetailUrl(' 123456')).toThrow(DetailUrlBuildError);
  });

  it('throws DetailUrlBuildError for an ID with trailing whitespace', () => {
    expect(() => buildDetailUrl('123456 ')).toThrow(DetailUrlBuildError);
  });

  it('throws DetailUrlBuildError for an ID with internal whitespace', () => {
    expect(() => buildDetailUrl('123 456')).toThrow(DetailUrlBuildError);
  });

  it('throws DetailUrlBuildError for an ID with a leading zero (regex anchored at start)', () => {
    // The regex is /^\d{6,}$/ — the ID must be all digits. A
    // zero-padded ID like "00123456" still matches because every
    // character is a digit; verify it does NOT throw.
    expect(() => buildDetailUrl('00123456')).not.toThrow();
    expect(buildDetailUrl('00123456')).toBe('https://www.linkedin.com/jobs/view/00123456/');
  });

  it('throws DetailUrlBuildError for an alphanumeric mixed ID', () => {
    expect(() => buildDetailUrl('123abc456')).toThrow(DetailUrlBuildError);
    expect(() => buildDetailUrl('123456!')).toThrow(DetailUrlBuildError);
    expect(() => buildDetailUrl('123-456')).toThrow(DetailUrlBuildError);
  });

  it('throws DetailUrlBuildError for a non-string input', () => {
    expect(() => buildDetailUrl(null as unknown as string)).toThrow(DetailUrlBuildError);
    expect(() => buildDetailUrl(undefined as unknown as string)).toThrow(DetailUrlBuildError);
    expect(() => buildDetailUrl(123456 as unknown as string)).toThrow(DetailUrlBuildError);
  });

  it('the thrown error carries the offending sourceJobId in metadata', () => {
    try {
      buildDetailUrl('abc');
      throw new Error('expected throw');
    } catch (error) {
      expect(error).toBeInstanceOf(DetailUrlBuildError);
      const err = error as DetailUrlBuildError;
      expect(err.code).toBe('detail_url_build_failed');
      expect(err.metadata).toEqual({ sourceJobId: 'abc' });
    }
  });

  it('the URL always ends with a trailing slash', () => {
    expect(buildDetailUrl('123456')).toMatch(/\/$/);
  });

  it('the URL always uses the www.linkedin.com host (https)', () => {
    expect(buildDetailUrl('123456')).toMatch(/^https:\/\/www\.linkedin\.com\//);
  });
});
