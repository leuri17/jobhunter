import { describe, expect, it } from 'vitest';
import {
  parseLinkedInJobsSearchURL,
} from '../../src/search/url-parser.js';
import { LinkedInURLParseError } from '../../src/search/errors.js';

const VALID_URL =
  'https://www.linkedin.com/jobs/search/?keywords=Software%20developer&geoId=100467493&f_TPR=r86400';

describe('parseLinkedInJobsSearchURL', () => {
  it('extracts the geoId from a supported jobs-search URL', () => {
    const parsed = parseLinkedInJobsSearchURL(VALID_URL);
    expect(parsed.geoId).toBe('100467493');
    expect(parsed.hostname).toBe('www.linkedin.com');
    expect(parsed.originalURL).toBe(VALID_URL);
  });

  it('trims whitespace around the URL before parsing', () => {
    const parsed = parseLinkedInJobsSearchURL(`   ${VALID_URL}   `);
    expect(parsed.geoId).toBe('100467493');
  });

  it('accepts the bare jobs/search path with just geoId', () => {
    const parsed = parseLinkedInJobsSearchURL('https://www.linkedin.com/jobs/search/?geoId=42');
    expect(parsed.geoId).toBe('42');
  });

  it('preserves query strings with extra parameters', () => {
    const parsed = parseLinkedInJobsSearchURL(
      'https://www.linkedin.com/jobs/search/?geoId=7&f_WT=1%2C2&keywords=x',
    );
    expect(parsed.geoId).toBe('7');
  });

  it('rejects wrong scheme', () => {
    expect(() => parseLinkedInJobsSearchURL(`http://${VALID_URL.slice(8)}`)).toThrow(
      LinkedInURLParseError,
    );
  });

  it('rejects wrong hostname', () => {
    expect(() =>
      parseLinkedInJobsSearchURL('https://www.linkedin-eu.com/jobs/search/?geoId=100467493'),
    ).toThrow(LinkedInURLParseError);
  });

  it('rejects bare hostname variants', () => {
    expect(() => parseLinkedInJobsSearchURL('https://linkedin.com/jobs/search/?geoId=1')).toThrow(
      LinkedInURLParseError,
    );
  });

  it('rejects an unsupported path', () => {
    expect(() =>
      parseLinkedInJobsSearchURL('https://www.linkedin.com/jobs/collections/recommended/?geoId=1'),
    ).toThrow(LinkedInURLParseError);
  });

  it('rejects missing geoId', () => {
    expect(() =>
      parseLinkedInJobsSearchURL('https://www.linkedin.com/jobs/search/?keywords=Software'),
    ).toThrow(LinkedInURLParseError);
  });

  it('rejects empty geoId', () => {
    expect(() => parseLinkedInJobsSearchURL('https://www.linkedin.com/jobs/search/?geoId=')).toThrow(
      LinkedInURLParseError,
    );
  });

  it('rejects malformed URLs', () => {
    expect(() => parseLinkedInJobsSearchURL('not a url')).toThrow(LinkedInURLParseError);
    expect(() => parseLinkedInJobsSearchURL('://www.linkedin.com')).toThrow(LinkedInURLParseError);
  });

  it('embeds the original URL in the error metadata', () => {
    try {
      parseLinkedInJobsSearchURL('https://example.com/jobs/search/?geoId=1');
      throw new Error('expected throw');
    } catch (error) {
      expect(error).toBeInstanceOf(LinkedInURLParseError);
      const e = error as LinkedInURLParseError;
      expect(e.metadata.url).toBe('https://example.com/jobs/search/?geoId=1');
      expect(typeof e.metadata.reason).toBe('string');
    }
  });
});

