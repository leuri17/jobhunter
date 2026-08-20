import { describe, expect, it } from 'vitest';

import {
  RUBRIC,
  RUBRIC_VERSION,
  getRubricDescription,
  getRubricWeight,
} from '../../src/scoring/rubric.js';
import { SCORING_CATEGORIES } from '../../src/scoring/types.js';

describe('RUBRIC_VERSION', () => {
  it('is exactly 1', () => {
    expect(RUBRIC_VERSION).toBe(1);
  });
});

describe('RUBRIC', () => {
  it('has an entry for every category in SCORING_CATEGORIES', () => {
    for (const category of SCORING_CATEGORIES) {
      expect(RUBRIC[category]).toBeDefined();
      expect(typeof RUBRIC[category].weight).toBe('number');
      expect(typeof RUBRIC[category].description).toBe('string');
      expect(RUBRIC[category].description.length).toBeGreaterThan(10);
    }
  });

  it('weights sum to exactly 1.0 (with floating-point tolerance)', () => {
    const total = SCORING_CATEGORIES.reduce((sum, category) => sum + RUBRIC[category].weight, 0);
    expect(Math.abs(total - 1.0)).toBeLessThan(1e-9);
  });

  it('uses the SPEC §26.2 weights (30/25/20/10/5/5/5)', () => {
    expect(RUBRIC.technicalSkills.weight).toBe(0.3);
    expect(RUBRIC.relevantExperience.weight).toBe(0.25);
    expect(RUBRIC.roleResponsibilityFit.weight).toBe(0.2);
    expect(RUBRIC.seniorityFit.weight).toBe(0.1);
    expect(RUBRIC.domainIndustryFit.weight).toBe(0.05);
    expect(RUBRIC.spokenLanguageCompatibility.weight).toBe(0.05);
    expect(RUBRIC.locationWorkplaceCompatibility.weight).toBe(0.05);
  });
});

describe('getRubricWeight', () => {
  it('returns the weight for a given category', () => {
    expect(getRubricWeight('technicalSkills')).toBe(0.3);
    expect(getRubricWeight('seniorityFit')).toBe(0.1);
  });
});

describe('getRubricDescription', () => {
  it('returns the description for a given category', () => {
    expect(getRubricDescription('technicalSkills')).toBe(
      "Match between job requirements and the candidate's technical skills.",
    );
  });
});
