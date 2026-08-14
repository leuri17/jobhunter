import { describe, expect, it } from 'vitest';

import type { DerivedOverrideRow } from '../../../src/persistence/repositories/profile-versions.js';
import {
  ProfessionalProfileSchema,
  type ProfessionalProfile,
} from '../../../src/profile/schema.js';
import { applyOverrides } from '../../../src/profile/review/override-application.js';

function makeProfile(overrides: Partial<ProfessionalProfile> = {}): ProfessionalProfile {
  const base: ProfessionalProfile = ProfessionalProfileSchema.parse({
    schemaVersion: 1,
    id: 'prf_test',
    createdAt: '2026-08-14T00:00:00.000Z',
    updatedAt: '2026-08-14T00:00:00.000Z',
    contentHash: 'hash-empty',
    sourceIds: [],
    basics: {
      headline: null,
      professionalSummary: null,
      currentLocation: null,
      totalYearsOfExperience: null,
    },
    experience: [],
    skills: [],
    languages: [],
    education: [],
    certifications: [],
    projects: [],
    derived: {
      likelySeniority: {
        generatedValue: 'senior',
        overrideActive: false,
        overrideValue: null,
        effectiveValue: 'senior',
        generatedAt: '2026-08-14T00:00:00.000Z',
        overriddenAt: null,
      },
      primaryRoles: {
        generatedValue: ['backend engineer'],
        overrideActive: false,
        overrideValue: null,
        effectiveValue: ['backend engineer'],
        generatedAt: '2026-08-14T00:00:00.000Z',
        overriddenAt: null,
      },
      primaryDomains: {
        generatedValue: ['fintech'],
        overrideActive: false,
        overrideValue: null,
        effectiveValue: ['fintech'],
        generatedAt: '2026-08-14T00:00:00.000Z',
        overriddenAt: null,
      },
      strongestSkills: {
        generatedValue: ['typescript'],
        overrideActive: false,
        overrideValue: null,
        effectiveValue: ['typescript'],
        generatedAt: '2026-08-14T00:00:00.000Z',
        overriddenAt: null,
      },
    },
  });
  return { ...base, ...overrides };
}

function makeOverride(
  derivedField: DerivedOverrideRow['derivedField'],
  overrideActive: boolean,
  overrideValue: unknown,
  generatedValue: unknown,
): DerivedOverrideRow {
  return {
    id: 1,
    profileVersionId: 1,
    derivedField,
    overrideActive,
    overrideValue,
    generatedValue,
    generatedAt: '2026-08-14T00:00:00.000Z',
    overriddenAt: overrideActive ? '2026-08-14T01:00:00.000Z' : null,
  };
}

describe('applyOverrides', () => {
  it('returns a profile equal to the input when no overrides apply', () => {
    const profile = makeProfile();
    const out = applyOverrides(profile, []);
    expect(out.derived.likelySeniority.effectiveValue).toBe('senior');
    expect(out.derived.primaryRoles.effectiveValue).toEqual(['backend engineer']);
  });

  it('does not mutate the input profile or its derived entries', () => {
    const profile = makeProfile();
    const originalSnapshot = JSON.stringify(profile);
    applyOverrides(profile, [makeOverride('likelySeniority', true, 'staff', 'senior')]);
    expect(JSON.stringify(profile)).toBe(originalSnapshot);
  });

  it('returns a valued override as the effective value', () => {
    const profile = makeProfile();
    const out = applyOverrides(profile, [makeOverride('likelySeniority', true, 'staff', 'senior')]);
    expect(out.derived.likelySeniority.effectiveValue).toBe('staff');
    expect(out.derived.likelySeniority.generatedValue).toBe('senior');
    expect(out.derived.likelySeniority.overrideActive).toBe(true);
    expect(out.derived.likelySeniority.overrideValue).toBe('staff');
  });

  it('returns an intentional null override as the effective null', () => {
    const profile = makeProfile();
    const out = applyOverrides(profile, [
      makeOverride('primaryRoles', true, null, ['backend engineer']),
    ]);
    expect(out.derived.primaryRoles.effectiveValue).toBeNull();
    expect(out.derived.primaryRoles.overrideActive).toBe(true);
    expect(out.derived.primaryRoles.overrideValue).toBeNull();
  });

  it('returns the generated value when overrideActive is false', () => {
    const profile = makeProfile();
    const out = applyOverrides(profile, [
      makeOverride('likelySeniority', false, 'staff', 'senior'),
    ]);
    expect(out.derived.likelySeniority.effectiveValue).toBe('senior');
  });

  it('ignores override rows for unknown derived fields', () => {
    const profile = makeProfile();
    // Cast through unknown to simulate a malformed row that bypasses the
    // repository enum guard.
    const out = applyOverrides(profile, [
      makeOverride('not_a_real_field' as DerivedOverrideRow['derivedField'], true, 'x', 'y'),
    ]);
    expect(out.derived.likelySeniority.effectiveValue).toBe('senior');
  });

  it('handles every derived field independently in one call', () => {
    const profile = makeProfile();
    const out = applyOverrides(profile, [
      makeOverride('likelySeniority', true, 'staff', 'senior'),
      makeOverride('primaryRoles', true, ['staff engineer'], ['backend engineer']),
      makeOverride('primaryDomains', true, null, ['fintech']),
      makeOverride('strongestSkills', false, ['go'], ['typescript']),
    ]);
    expect(out.derived.likelySeniority.effectiveValue).toBe('staff');
    expect(out.derived.primaryRoles.effectiveValue).toEqual(['staff engineer']);
    expect(out.derived.primaryDomains.effectiveValue).toBeNull();
    expect(out.derived.strongestSkills.effectiveValue).toEqual(['typescript']);
  });
});
