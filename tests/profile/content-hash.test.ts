import { describe, expect, it } from 'vitest';

import { calculateProfileContentHash } from '../../src/profile/content-hash.js';
import type { ProfessionalProfile } from '../../src/profile/schema.js';

function minimalProfile(): ProfessionalProfile {
  return {
    schemaVersion: 1,
    id: 'profile-1',
    createdAt: '2026-08-14T10:00:00.000Z',
    updatedAt: '2026-08-14T10:00:00.000Z',
    contentHash: 'a'.repeat(64),
    sourceIds: ['source-1'],
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
        generatedValue: null,
        overrideActive: false,
        overrideValue: null,
        effectiveValue: null,
        generatedAt: null,
        overriddenAt: null,
      },
      primaryRoles: {
        generatedValue: [],
        overrideActive: false,
        overrideValue: null,
        effectiveValue: [],
        generatedAt: null,
        overriddenAt: null,
      },
      primaryDomains: {
        generatedValue: [],
        overrideActive: false,
        overrideValue: null,
        effectiveValue: [],
        generatedAt: null,
        overriddenAt: null,
      },
      strongestSkills: {
        generatedValue: [],
        overrideActive: false,
        overrideValue: null,
        effectiveValue: [],
        generatedAt: null,
        overriddenAt: null,
      },
    },
  };
}

describe('calculateProfileContentHash', () => {
  it('is deterministic for the same input', () => {
    const profile = minimalProfile();
    expect(calculateProfileContentHash(profile)).toBe(calculateProfileContentHash(profile));
  });

  it('changes when basics.headline changes', () => {
    const a = minimalProfile();
    const b: ProfessionalProfile = {
      ...a,
      basics: { ...a.basics, headline: 'Senior Backend Engineer' },
    };
    expect(calculateProfileContentHash(a)).not.toBe(calculateProfileContentHash(b));
  });

  it('returns a 64-char lowercase hex digest', () => {
    expect(calculateProfileContentHash(minimalProfile())).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is invariant to object key ordering', () => {
    const profile = minimalProfile();
    const withReorderedKeys: ProfessionalProfile = {
      id: profile.id,
      schemaVersion: profile.schemaVersion,
      updatedAt: profile.updatedAt,
      contentHash: profile.contentHash,
      sourceIds: profile.sourceIds,
      createdAt: profile.createdAt,
      basics: profile.basics,
      experience: profile.experience,
      skills: profile.skills,
      languages: profile.languages,
      education: profile.education,
      certifications: profile.certifications,
      projects: profile.projects,
      derived: profile.derived,
    };
    expect(calculateProfileContentHash(profile)).toBe(
      calculateProfileContentHash(withReorderedKeys),
    );
  });

  it('is self-consistent: re-hashing a profile that already carries its own contentHash returns the same digest', () => {
    // The helper excludes its own `contentHash` field from the hashed input
    // so callers can round-trip the hash without drift. This regression test
    // was added with the Task 6 fix to content-hash.ts.
    const profile = minimalProfile();
    const firstHash = calculateProfileContentHash(profile);
    const withFirstHash: ProfessionalProfile = { ...profile, contentHash: firstHash };
    expect(calculateProfileContentHash(withFirstHash)).toBe(firstHash);
  });
});
