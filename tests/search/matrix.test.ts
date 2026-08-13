import { describe, expect, it } from 'vitest';
import {
  countSearches,
  generateSearchMatrix,
  matrixEntryToSearchExecutionInsert,
} from '../../src/search/matrix.js';

const START = '2026-08-13T10:00:00.000Z';

describe('countSearches', () => {
  it('returns the Cartesian product size', () => {
    expect(countSearches(['a'], ['x'])).toBe(1);
    expect(countSearches(['a', 'b', 'c'], ['x', 'y'])).toBe(6);
    expect(countSearches([], ['x'])).toBe(0);
    expect(countSearches(['a'], [])).toBe(0);
    expect(countSearches([], [])).toBe(0);
  });
});

describe('generateSearchMatrix', () => {
  it('emits every (query, location) pair exactly once with the same global datePosted/workplaceTypes', () => {
    const matrix = generateSearchMatrix({
      searchQueries: ['Software Developer', 'Frontend Developer'],
      locations: [
        { name: 'Rotterdam', geoId: '100467493' },
        { name: 'Amsterdam', geoId: '101889610' },
      ],
      datePosted: 86400,
      workplaceTypes: ['1', '2', '3'],
      startTimestamp: START,
    });
    expect(matrix.length).toBe(4);
    const urls = matrix.map((m) => m.generatedUrl);
    expect(new Set(urls).size).toBe(4);
    for (const entry of matrix) {
      expect(entry.startTimestamp).toBe(START);
      const parsed = new URL(entry.generatedUrl);
      expect(parsed.searchParams.get('sortBy')).toBe('DD');
      expect(parsed.searchParams.get('f_TPR')).toBe('r86400');
      expect(parsed.searchParams.get('f_WT')).toBe('1,2,3');
    }
  });

  it('produces entries in deterministic (query, location) insertion order', () => {
    const matrix = generateSearchMatrix({
      searchQueries: ['Q1', 'Q2'],
      locations: [
        { name: 'L1', geoId: '1' },
        { name: 'L2', geoId: '2' },
      ],
      datePosted: 604800,
      workplaceTypes: ['2'],
      startTimestamp: START,
    });
    expect(matrix.map((m) => [m.query, m.locationName, m.geoId])).toEqual([
      ['Q1', 'L1', '1'],
      ['Q1', 'L2', '2'],
      ['Q2', 'L1', '1'],
      ['Q2', 'L2', '2'],
    ]);
  });

  it('returns an empty array when there are no queries or no locations', () => {
    expect(
      generateSearchMatrix({
        searchQueries: [],
        locations: [{ name: 'X', geoId: '1' }],
        datePosted: 86400,
        workplaceTypes: ['1'],
        startTimestamp: START,
      }),
    ).toEqual([]);
    expect(
      generateSearchMatrix({
        searchQueries: ['Q'],
        locations: [],
        datePosted: 86400,
        workplaceTypes: ['1'],
        startTimestamp: START,
      }),
    ).toEqual([]);
  });

  it('every generated URL contains sortBy=DD', () => {
    const matrix = generateSearchMatrix({
      searchQueries: ['Q'],
      locations: [{ name: 'L', geoId: '1' }],
      datePosted: 86400,
      workplaceTypes: ['1', '3'],
      startTimestamp: START,
    });
    for (const entry of matrix) {
      const parsed = new URL(entry.generatedUrl);
      expect(parsed.searchParams.get('sortBy')).toBe('DD');
    }
  });
});

describe('matrixEntryToSearchExecutionInsert', () => {
  it('maps every required field and omits finalStatus so the repo applies its default', () => {
    const entry = {
      query: 'Software Developer',
      locationName: 'Rotterdam',
      geoId: '100467493',
      generatedUrl: 'https://www.linkedin.com/jobs/search/?sortBy=DD',
      startTimestamp: START,
    };
    const insert = matrixEntryToSearchExecutionInsert(42, entry);
    expect(insert).toEqual({
      pipelineRunId: 42,
      searchQuery: 'Software Developer',
      locationName: 'Rotterdam',
      geoId: '100467493',
      generatedUrl: 'https://www.linkedin.com/jobs/search/?sortBy=DD',
      startTimestamp: START,
    });
    expect('finalStatus' in insert).toBe(false);
  });
});
