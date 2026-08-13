import { describe, expect, it } from 'vitest';
import {
  buildLinkedInSearchParamMap,
  buildLinkedInSearchURL,
  type LinkedInSearchURLInput,
} from '../../src/search/url-builder.js';

const baseInput: LinkedInSearchURLInput = {
  query: 'Software Developer',
  geoId: '100467493',
  datePosted: 86400,
  workplaceTypes: ['1', '2', '3'],
};

describe('buildLinkedInSearchParamMap', () => {
  it('includes the documented parameter set', () => {
    const params = buildLinkedInSearchParamMap(baseInput);
    expect(params.get('f_TPR')).toBe('r86400');
    expect(params.get('f_WT')).toBe('1,2,3');
    expect(params.get('geoId')).toBe('100467493');
    expect(params.get('keywords')).toBe('Software Developer');
    expect(params.get('sortBy')).toBe('DD');
  });

  it('always includes sortBy=DD regardless of input', () => {
    const params = buildLinkedInSearchParamMap({
      ...baseInput,
      query: 'X',
      geoId: '1',
      datePosted: 2592000,
      workplaceTypes: ['2'],
    });
    expect(params.get('sortBy')).toBe('DD');
    expect(params.get('f_TPR')).toBe('r2592000');
    expect(params.get('f_WT')).toBe('2');
  });

  it('encodes each parameter independently (whitespace in query, comma in f_WT)', () => {
    const params = buildLinkedInSearchParamMap({
      query: 'Frontend Developer',
      geoId: '100467493',
      datePosted: 604800,
      workplaceTypes: ['1', '3'],
    });
    expect(params.toString()).toBe(
      'f_TPR=r604800&f_WT=1%2C3&geoId=100467493&keywords=Frontend+Developer&sortBy=DD',
    );
  });

  it('emits f_TPR using the r-prefix rule from labels.ts', () => {
    const params = buildLinkedInSearchParamMap({ ...baseInput, datePosted: 2592000 });
    expect(params.get('f_TPR')).toBe('r2592000');
  });
});

describe('buildLinkedInSearchURL', () => {
  it('produces a URL on the documented base with every parameter encoded independently', () => {
    const url = buildLinkedInSearchURL(baseInput);
    expect(url.startsWith('https://www.linkedin.com/jobs/search/?')).toBe(true);
    const parsed = new URL(url);
    expect(parsed.origin).toBe('https://www.linkedin.com');
    expect(parsed.pathname).toBe('/jobs/search/');
    expect(parsed.searchParams.get('sortBy')).toBe('DD');
    expect(parsed.searchParams.get('keywords')).toBe('Software Developer');
    expect(parsed.searchParams.get('geoId')).toBe('100467493');
    expect(parsed.searchParams.get('f_TPR')).toBe('r86400');
    expect(parsed.searchParams.get('f_WT')).toBe('1,2,3');
  });

  it('percent-encodes special characters in the query parameter', () => {
    const url = buildLinkedInSearchURL({ ...baseInput, query: 'C++ & Systems' });
    const parsed = new URL(url);
    expect(parsed.searchParams.get('keywords')).toBe('C++ & Systems');
  });

  it('returns deterministic output for identical input', () => {
    const a = buildLinkedInSearchURL(baseInput);
    const b = buildLinkedInSearchURL(baseInput);
    expect(a).toBe(b);
  });
});
