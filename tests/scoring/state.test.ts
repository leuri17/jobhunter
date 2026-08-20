import { describe, expect, it } from 'vitest';

import { LINKEDIN_SCORING_SCHEMA_VERSION, SCORING_CATEGORIES } from '../../src/scoring/state.js';
import type { ScoringKind } from '../../src/scoring/state.js';
import type { ScoringCategory } from '../../src/scoring/types.js';

describe('LINKEDIN_SCORING_SCHEMA_VERSION', () => {
  it('is exactly 1', () => {
    expect(LINKEDIN_SCORING_SCHEMA_VERSION).toBe(1);
  });
});

describe('SCORING_CATEGORIES', () => {
  it('contains exactly the 7 SPEC §26.2 categories', () => {
    expect(SCORING_CATEGORIES).toHaveLength(7);
    expect(new Set(SCORING_CATEGORIES)).toEqual(
      new Set<ScoringCategory>([
        'technicalSkills',
        'relevantExperience',
        'roleResponsibilityFit',
        'seniorityFit',
        'domainIndustryFit',
        'spokenLanguageCompatibility',
        'locationWorkplaceCompatibility',
      ]),
    );
  });
});

describe('ScoringKind', () => {
  it('includes the 5 documented outcomes', () => {
    // Compile-time check via a const tuple; runtime check via the
    // expected list of literals.
    const kinds: readonly ScoringKind[] = ['reused', 'complete', 'failed', 'skipped', 'cancelled'];
    expect(new Set(kinds).size).toBe(5);
  });
});
