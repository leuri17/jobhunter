import { describe, expect, it } from 'vitest';

import { computeExtractionStatus } from '../../src/linkedin/extraction/status.js';
import type { ExtractionFieldSet } from '../../src/linkedin/extraction/state.js';

/**
 * Tests for `src/linkedin/extraction/status.ts`
 * Asserts every combination of the four
 * required fields being present/absent (16 cases total — `2^4`).
 *
 * The function is `validateRequiredFields` + ternary. The 16-case
 * assertion exhaustively checks the truth table.
 */

const FULL: ExtractionFieldSet = {
  title: 'Senior Engineer',
  company: 'Acme',
  location: 'Remote',
  description: 'Build cool stuff.',
};

const EMPTY: ExtractionFieldSet = {
  title: null,
  company: null,
  location: null,
  description: null,
};

/**
 * Enumerate the 16 possible combinations of present/absent for
 * the four required fields. The expected status is `'complete'`
 * only when all 4 fields are populated; otherwise `'partial'`.
 */
function enumerateCombinations(): ReadonlyArray<{
  readonly fields: ExtractionFieldSet;
  readonly expected: 'complete' | 'partial';
}> {
  const labels = ['title', 'company', 'location', 'description'] as const;
  const out: Array<{ fields: ExtractionFieldSet; expected: 'complete' | 'partial' }> = [];
  for (let mask = 0; mask < 16; mask++) {
    const mutableFields: { -readonly [K in keyof ExtractionFieldSet]: ExtractionFieldSet[K] } = {
      title: null,
      company: null,
      location: null,
      description: null,
    };
    let allPresent = true;
    for (let i = 0; i < 4; i++) {
      const bit = (mask >> i) & 1;
      const label = labels[i] as (typeof labels)[number];
      if (bit === 1) {
        mutableFields[label] = `${label}-value`;
      } else {
        mutableFields[label] = null;
        allPresent = false;
      }
    }
    out.push({ fields: mutableFields, expected: allPresent ? 'complete' : 'partial' });
  }
  return out;
}

describe('src/linkedin/extraction/status — ', () => {
  it('returns complete when every field is present', () => {
    expect(computeExtractionStatus(FULL)).toBe('complete');
  });

  it('returns partial when every field is null', () => {
    expect(computeExtractionStatus(EMPTY)).toBe('partial');
  });

  it('returns partial when exactly one field is missing', () => {
    expect(
      computeExtractionStatus({
        title: null,
        company: 'Acme',
        location: 'Remote',
        description: 'd',
      }),
    ).toBe('partial');
    expect(
      computeExtractionStatus({ title: 't', company: null, location: 'Remote', description: 'd' }),
    ).toBe('partial');
    expect(
      computeExtractionStatus({ title: 't', company: 'Acme', location: null, description: 'd' }),
    ).toBe('partial');
    expect(
      computeExtractionStatus({
        title: 't',
        company: 'Acme',
        location: 'Remote',
        description: null,
      }),
    ).toBe('partial');
  });

  it('returns partial when exactly three fields are missing', () => {
    expect(
      computeExtractionStatus({ title: 't', company: null, location: null, description: null }),
    ).toBe('partial');
    expect(
      computeExtractionStatus({ title: null, company: 'Acme', location: null, description: null }),
    ).toBe('partial');
    expect(
      computeExtractionStatus({
        title: null,
        company: null,
        location: 'Remote',
        description: null,
      }),
    ).toBe('partial');
    expect(
      computeExtractionStatus({ title: null, company: null, location: null, description: 'd' }),
    ).toBe('partial');
  });

  it('returns partial when exactly two fields are missing (adjacent + non-adjacent)', () => {
    expect(
      computeExtractionStatus({ title: null, company: null, location: 'Remote', description: 'd' }),
    ).toBe('partial');
    expect(
      computeExtractionStatus({ title: null, company: 'Acme', location: null, description: 'd' }),
    ).toBe('partial');
    expect(
      computeExtractionStatus({ title: 't', company: 'Acme', location: null, description: null }),
    ).toBe('partial');
    expect(
      computeExtractionStatus({ title: 't', company: null, location: null, description: 'd' }),
    ).toBe('partial');
    expect(
      computeExtractionStatus({ title: 't', company: null, location: 'Remote', description: null }),
    ).toBe('partial');
    expect(
      computeExtractionStatus({
        title: null,
        company: 'Acme',
        location: 'Remote',
        description: null,
      }),
    ).toBe('partial');
  });

  it('never returns failed — failed is reserved for the no-sourceJobId path', () => {
    // The status calculator never returns 'failed'. Per Decision
    // 4: 'failed' is reserved for the no-sourceJobId case (
    // owns the discoveryErrors row). This is a regression guard.
    const cases = enumerateCombinations();
    for (const { fields, expected } of cases) {
      const result = computeExtractionStatus(fields);
      expect(result).toBe(expected);
      expect(result).not.toBe('failed');
    }
  });

  it('exhaustive 16-case truth table', () => {
    const cases = enumerateCombinations();
    expect(cases).toHaveLength(16);
    let completeCount = 0;
    for (const { fields, expected } of cases) {
      const result = computeExtractionStatus(fields);
      expect(result).toBe(expected);
      if (expected === 'complete') completeCount++;
    }
    // Exactly one of the 16 combinations has all four fields
    // present: mask === 0b1111 === 15.
    expect(completeCount).toBe(1);
  });
});
