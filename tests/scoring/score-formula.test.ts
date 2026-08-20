import { describe, expect, it } from 'vitest';

import { computeOverallScore, formatDisplayScore } from '../../src/scoring/score-formula.js';

const ALL_ZERO = {
  technicalSkills: 0,
  relevantExperience: 0,
  roleResponsibilityFit: 0,
  seniorityFit: 0,
  domainIndustryFit: 0,
  spokenLanguageCompatibility: 0,
  locationWorkplaceCompatibility: 0,
} as const;

const ALL_HUNDRED = {
  technicalSkills: 100,
  relevantExperience: 100,
  roleResponsibilityFit: 100,
  seniorityFit: 100,
  domainIndustryFit: 100,
  spokenLanguageCompatibility: 100,
  locationWorkplaceCompatibility: 100,
} as const;

describe('computeOverallScore', () => {
  it('returns 0 when every category is 0', () => {
    expect(computeOverallScore(ALL_ZERO)).toBe(0);
  });

  it('returns 100 when every category is 100', () => {
    expect(computeOverallScore(ALL_HUNDRED)).toBeCloseTo(100, 10);
  });

  it('returns the weighted sum for mixed scores', () => {
    // 80*0.30 + 60*0.25 + 70*0.20 + 50*0.10 + 40*0.05 + 30*0.05 + 20*0.05
    // = 24 + 15 + 14 + 5 + 2 + 1.5 + 1
    // = 62.5
    const scores = {
      technicalSkills: 80,
      relevantExperience: 60,
      roleResponsibilityFit: 70,
      seniorityFit: 50,
      domainIndustryFit: 40,
      spokenLanguageCompatibility: 30,
      locationWorkplaceCompatibility: 20,
    } as const;
    expect(computeOverallScore(scores)).toBeCloseTo(62.5, 10);
  });

  it('throws when a category score is missing', () => {
    expect(() =>
      computeOverallScore({ ...ALL_ZERO, technicalSkills: undefined as unknown as number }),
    ).toThrow(/missing score for category "technicalSkills"/);
  });

  it('accepts non-integer scores (the Zod validator enforces integer at parse time)', () => {
    const scores = {
      ...ALL_HUNDRED,
      technicalSkills: 87.5,
    };
    // 87.5*0.30 + 100*(0.25 + 0.20 + 0.10 + 0.05 + 0.05 + 0.05) = 26.25 + 70 = 96.25
    expect(computeOverallScore(scores)).toBeCloseTo(96.25, 10);
  });

  it('preserves full precision (no rounding)', () => {
    const scores = {
      technicalSkills: 33,
      relevantExperience: 33,
      roleResponsibilityFit: 100,
      seniorityFit: 100,
      domainIndustryFit: 100,
      spokenLanguageCompatibility: 100,
      locationWorkplaceCompatibility: 100,
    };
    // 33*0.30 + 33*0.25 + 100*0.45 = 9.9 + 8.25 + 45 = 63.15
    const result = computeOverallScore(scores);
    expect(result).toBeCloseTo(63.15, 10);
    // Verify the formula does not round — the absolute difference vs the
    // manually-computed value must be smaller than the IEEE 754 epsilon.
    expect(Math.abs(result - 63.15) < 1e-9).toBe(true);
  });
});

describe('formatDisplayScore', () => {
  it('formats 84.5375 as "84.5" (one decimal)', () => {
    expect(formatDisplayScore(84.5375)).toBe('84.5');
  });

  it('formats 0 as "0.0"', () => {
    expect(formatDisplayScore(0)).toBe('0.0');
  });

  it('formats 100 as "100.0"', () => {
    expect(formatDisplayScore(100)).toBe('100.0');
  });

  it('formats 62.5 as "62.5" (no rounding error)', () => {
    expect(formatDisplayScore(62.5)).toBe('62.5');
  });

  it('formats 0.05 as "0.1" (rounds up)', () => {
    expect(formatDisplayScore(0.05)).toBe('0.1');
  });

  it('throws on NaN', () => {
    expect(() => formatDisplayScore(Number.NaN)).toThrow(/invalid number/);
  });

  it('throws on Infinity', () => {
    expect(() => formatDisplayScore(Number.POSITIVE_INFINITY)).toThrow(/invalid number/);
  });

  it('throws on -Infinity', () => {
    expect(() => formatDisplayScore(Number.NEGATIVE_INFINITY)).toThrow(/invalid number/);
  });
});
