import { describe, expect, it } from 'vitest';

import { rankResults } from '../../src/scoring/rank.js';

describe('rankResults', () => {
  it('returns an empty array for an empty input', () => {
    expect(rankResults([])).toEqual([]);
  });

  it('returns rank 1 for a single entry', () => {
    expect(rankResults([{ sourceJobId: 'j1', overallScore: 50 }])).toEqual([
      { sourceJobId: 'j1', overallScore: 50, rank: 1 },
    ]);
  });

  it('sorts 3 entries with different scores descending', () => {
    const ranked = rankResults([
      { sourceJobId: 'low', overallScore: 30 },
      { sourceJobId: 'high', overallScore: 80 },
      { sourceJobId: 'mid', overallScore: 50 },
    ]);
    expect(ranked).toEqual([
      { sourceJobId: 'high', overallScore: 80, rank: 1 },
      { sourceJobId: 'mid', overallScore: 50, rank: 2 },
      { sourceJobId: 'low', overallScore: 30, rank: 3 },
    ]);
  });

  it('breaks ties by sourceJobId ascending', () => {
    const ranked = rankResults([
      { sourceJobId: 'b', overallScore: 50 },
      { sourceJobId: 'a', overallScore: 50 },
      { sourceJobId: 'c', overallScore: 50 },
    ]);
    expect(ranked).toEqual([
      { sourceJobId: 'a', overallScore: 50, rank: 1 },
      { sourceJobId: 'b', overallScore: 50, rank: 2 },
      { sourceJobId: 'c', overallScore: 50, rank: 3 },
    ]);
  });

  it('orders float scores correctly (no precision loss)', () => {
    const ranked = rankResults([
      { sourceJobId: 'a', overallScore: 84.5374 },
      { sourceJobId: 'b', overallScore: 84.5375 },
    ]);
    expect(ranked[0]?.sourceJobId).toBe('b');
    expect(ranked[1]?.sourceJobId).toBe('a');
  });

  it('preserves stable order for identical scores + IDs (duplicates)', () => {
    const ranked = rankResults([
      { sourceJobId: 'a', overallScore: 50 },
      { sourceJobId: 'a', overallScore: 50 },
    ]);
    expect(ranked).toEqual([
      { sourceJobId: 'a', overallScore: 50, rank: 1 },
      { sourceJobId: 'a', overallScore: 50, rank: 2 },
    ]);
  });

  it('does not mutate the input array', () => {
    const input = [
      { sourceJobId: 'b', overallScore: 30 },
      { sourceJobId: 'a', overallScore: 80 },
    ];
    const before = JSON.stringify(input);
    rankResults(input);
    expect(JSON.stringify(input)).toBe(before);
  });
});
