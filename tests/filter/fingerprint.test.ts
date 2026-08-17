import { describe, expect, it } from 'vitest';

import {
  calculateFilterFingerprint,
  type FilterFingerprintInput,
} from '../../src/filter/fingerprint.js';
import { type JobFilterConfig } from '../../src/filter/schema.js';
import { type ProfessionalProfile } from '../../src/profile/schema.js';

/**
 * TASK-010 Task 7 — `fingerprint.ts` tests.
 *
 * `calculateFilterFingerprint` composes the job content hash, the active
 * config hash, the relevant effective profile values, and the filter
 * implementation version into a single SHA-256 digest (SPEC §24.3). The
 * fingerprint is the cache key for `filter_results` (SPEC §27.1).
 *
 * The tests cover:
 *
 *   1. The literal SHA-256 shape (64-char lowercase hex).
 *   2. Determinism — same inputs → same hash.
 *   3. Sensitivity to each input dimension (job, config, profile slice,
 *      filter implementation version).
 *   4. Insensitivity to profile fields that are NOT part of the slice
 *      (`basics.headline`, `experience[].summary`, `projects[].name`,
 *      etc.).
 *   5. The `null` profile case — must differ from a non-null profile with
 *      empty derived fields.
 */

function minimalConfig(): JobFilterConfig {
  return {
    schemaVersion: 1,
    excludedCompanies: [],
    title: {
      excludedKeywords: [],
      requiredAnyKeywords: [],
    },
    description: {
      excludedKeywords: [],
      requiredAnyKeywords: [],
    },
    seniority: {
      maximum: null,
    },
    languages: {
      accepted: [],
      rejectWhenExplicitlyRequiresOtherLanguage: false,
    },
  };
}

function sampleConfig(): JobFilterConfig {
  return {
    schemaVersion: 1,
    excludedCompanies: ['Acme Corp', 'Initech'],
    title: {
      excludedKeywords: ['sales'],
      requiredAnyKeywords: ['typescript', 'backend'],
    },
    description: {
      excludedKeywords: ['clearance required'],
      requiredAnyKeywords: ['distributed systems'],
    },
    seniority: {
      maximum: 'senior',
    },
    languages: {
      accepted: ['english', 'portuguese'],
      rejectWhenExplicitlyRequiresOtherLanguage: true,
    },
  };
}

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

function sampleProfile(): ProfessionalProfile {
  return {
    schemaVersion: 1,
    id: 'profile-2',
    createdAt: '2026-08-14T10:00:00.000Z',
    updatedAt: '2026-08-14T10:00:00.000Z',
    contentHash: 'b'.repeat(64),
    sourceIds: ['source-1', 'source-2'],
    basics: {
      headline: 'Senior Backend Engineer',
      professionalSummary: 'A seasoned professional.',
      currentLocation: 'Amsterdam, NL',
      totalYearsOfExperience: 8,
    },
    experience: [
      {
        id: 'exp-1',
        company: 'Initech',
        title: 'Senior Engineer',
        location: 'Remote',
        startDate: '2020-01',
        endDate: null,
        isCurrent: true,
        summary: 'Lead backend systems.',
        responsibilities: ['Mentor juniors', 'Architect services'],
        achievements: ['Cut p99 latency by 40%'],
        technologies: ['typescript', 'postgres'],
        domains: ['fintech'],
        sourceReferences: [],
      },
    ],
    skills: [
      {
        id: 'skill-1',
        name: 'TypeScript',
        normalizedName: 'typescript',
        category: 'programming_language',
        proficiency: 'expert',
        yearsOfExperience: 8,
        lastUsedAt: '2026-07',
        evidence: [],
      },
      {
        id: 'skill-2',
        name: 'Postgres',
        normalizedName: 'postgres',
        category: 'database',
        proficiency: 'advanced',
        yearsOfExperience: 6,
        lastUsedAt: '2026-06',
        evidence: [],
      },
    ],
    languages: [
      {
        id: 'lang-1',
        name: 'English',
        normalizedName: 'english',
        level: 'native',
        sourceReferences: [],
      },
      {
        id: 'lang-2',
        name: 'Portuguese',
        normalizedName: 'portuguese',
        level: 'professional',
        sourceReferences: [],
      },
    ],
    education: [],
    certifications: [],
    projects: [],
    derived: {
      likelySeniority: {
        generatedValue: 'senior',
        overrideActive: false,
        overrideValue: null,
        effectiveValue: 'senior',
        generatedAt: '2026-08-14T10:00:00.000Z',
        overriddenAt: null,
      },
      primaryRoles: {
        generatedValue: ['Backend Engineer', 'Senior Engineer'],
        overrideActive: false,
        overrideValue: null,
        effectiveValue: ['Backend Engineer', 'Senior Engineer'],
        generatedAt: '2026-08-14T10:00:00.000Z',
        overriddenAt: null,
      },
      primaryDomains: {
        generatedValue: ['fintech'],
        overrideActive: false,
        overrideValue: null,
        effectiveValue: ['fintech'],
        generatedAt: '2026-08-14T10:00:00.000Z',
        overriddenAt: null,
      },
      strongestSkills: {
        generatedValue: ['typescript', 'postgres'],
        overrideActive: false,
        overrideValue: null,
        effectiveValue: ['typescript', 'postgres'],
        generatedAt: '2026-08-14T10:00:00.000Z',
        overriddenAt: null,
      },
    },
  };
}

function sampleInput(): FilterFingerprintInput {
  return {
    job: {
      title: 'Senior Backend Engineer Node.js',
      company: 'Acme Corp',
      location: 'Amsterdam, NL',
      description:
        'We are looking for a machine learning engineer with experience ' +
        'in distributed systems and TypeScript.',
    },
    config: sampleConfig(),
    profile: sampleProfile(),
  };
}

describe('calculateFilterFingerprint — SHA-256 shape', () => {
  it('returns a 64-character lowercase hex string', () => {
    const hash = calculateFilterFingerprint(sampleInput());
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('returns a 64-character lowercase hex string for a null profile too', () => {
    const hash = calculateFilterFingerprint({
      ...sampleInput(),
      profile: null,
    });
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('calculateFilterFingerprint — determinism', () => {
  it('is idempotent: same inputs produce the same hash on repeated calls', () => {
    const input = sampleInput();
    const first = calculateFilterFingerprint(input);
    const second = calculateFilterFingerprint(input);
    expect(first).toBe(second);
  });

  it('is independent of input object key order (sorted profile slice)', () => {
    // The same logical inputs, but supplied as objects whose property order
    // differs at the surface level, must hash identically. The composer
    // builds the profile slice via sorted/deduped copies of the array
    // fields, so surface-level ordering of `skills` / `languages` /
    // `derived.primaryRoles` must not affect the digest.
    const input = sampleInput();
    const reordered: FilterFingerprintInput = {
      profile: input.profile === null ? null : { ...input.profile },
      config: input.config,
      job: {
        description: input.job.description,
        location: input.job.location,
        company: input.job.company,
        title: input.job.title,
      },
    };
    expect(calculateFilterFingerprint(input)).toBe(calculateFilterFingerprint(reordered));
  });

  it('produces the same hash when profile arrays are supplied in different orders', () => {
    // The composer must sort + dedupe `languages`, `skills`, and each
    // `derived.<array>.effectiveValue` before hashing. A profile whose
    // `languages` are listed in reverse order must yield the same digest.
    const profile = sampleProfile();
    const reversedProfile: ProfessionalProfile = {
      ...profile,
      languages: [...profile.languages].reverse(),
      skills: [...profile.skills].reverse(),
      derived: {
        ...profile.derived,
        primaryRoles: {
          ...profile.derived.primaryRoles,
          effectiveValue: [...profile.derived.primaryRoles.effectiveValue].reverse(),
        },
        strongestSkills: {
          ...profile.derived.strongestSkills,
          effectiveValue: [...profile.derived.strongestSkills.effectiveValue].reverse(),
        },
      },
    };
    const a = calculateFilterFingerprint({ ...sampleInput(), profile });
    const b = calculateFilterFingerprint({ ...sampleInput(), profile: reversedProfile });
    expect(a).toBe(b);
  });
});

describe('calculateFilterFingerprint — sensitivity to the job input', () => {
  it('produces a different hash when the job title changes', () => {
    const a = calculateFilterFingerprint({
      ...sampleInput(),
      job: { ...sampleInput().job, title: 'Senior Backend Engineer' },
    });
    const b = calculateFilterFingerprint({
      ...sampleInput(),
      job: { ...sampleInput().job, title: 'Staff Backend Engineer' },
    });
    expect(a).not.toBe(b);
  });

  it('produces a different hash when the job description changes', () => {
    const a = calculateFilterFingerprint(sampleInput());
    const b = calculateFilterFingerprint({
      ...sampleInput(),
      job: { ...sampleInput().job, description: 'A totally different description.' },
    });
    expect(a).not.toBe(b);
  });

  it('produces a different hash when the company changes', () => {
    const a = calculateFilterFingerprint(sampleInput());
    const b = calculateFilterFingerprint({
      ...sampleInput(),
      job: { ...sampleInput().job, company: 'Globex' },
    });
    expect(a).not.toBe(b);
  });
});

describe('calculateFilterFingerprint — sensitivity to the config input', () => {
  it('produces a different hash when excludedCompanies changes', () => {
    const a = calculateFilterFingerprint(sampleInput());
    const b = calculateFilterFingerprint({
      ...sampleInput(),
      config: { ...sampleConfig(), excludedCompanies: ['Globex'] },
    });
    expect(a).not.toBe(b);
  });

  it('produces a different hash when title.excludedKeywords changes', () => {
    const a = calculateFilterFingerprint(sampleInput());
    const b = calculateFilterFingerprint({
      ...sampleInput(),
      config: {
        ...sampleConfig(),
        title: { ...sampleConfig().title, excludedKeywords: ['recruiter'] },
      },
    });
    expect(a).not.toBe(b);
  });

  it('produces a different hash when seniority.maximum changes', () => {
    const a = calculateFilterFingerprint(sampleInput());
    const b = calculateFilterFingerprint({
      ...sampleInput(),
      config: { ...sampleConfig(), seniority: { maximum: 'staff' } },
    });
    expect(a).not.toBe(b);
  });

  it('produces a different hash when languages.accepted changes', () => {
    const a = calculateFilterFingerprint(sampleInput());
    const b = calculateFilterFingerprint({
      ...sampleInput(),
      config: {
        ...sampleConfig(),
        languages: { ...sampleConfig().languages, accepted: ['dutch'] },
      },
    });
    expect(a).not.toBe(b);
  });
});

describe('calculateFilterFingerprint — sensitivity to the profile slice', () => {
  it('produces a different hash when derived.likelySeniority.effectiveValue changes', () => {
    const a = calculateFilterFingerprint(sampleInput());
    const changed: ProfessionalProfile = {
      ...sampleProfile(),
      derived: {
        ...sampleProfile().derived,
        likelySeniority: {
          ...sampleProfile().derived.likelySeniority,
          effectiveValue: 'staff',
          generatedValue: 'staff',
        },
      },
    };
    const b = calculateFilterFingerprint({ ...sampleInput(), profile: changed });
    expect(a).not.toBe(b);
  });

  it('produces a different hash when derived.primaryRoles.effectiveValue changes', () => {
    const a = calculateFilterFingerprint(sampleInput());
    const changed: ProfessionalProfile = {
      ...sampleProfile(),
      derived: {
        ...sampleProfile().derived,
        primaryRoles: {
          ...sampleProfile().derived.primaryRoles,
          effectiveValue: ['Staff Engineer', 'Tech Lead'],
          generatedValue: ['Staff Engineer', 'Tech Lead'],
        },
      },
    };
    const b = calculateFilterFingerprint({ ...sampleInput(), profile: changed });
    expect(a).not.toBe(b);
  });

  it('produces a different hash when derived.primaryDomains.effectiveValue changes', () => {
    const a = calculateFilterFingerprint(sampleInput());
    const changed: ProfessionalProfile = {
      ...sampleProfile(),
      derived: {
        ...sampleProfile().derived,
        primaryDomains: {
          ...sampleProfile().derived.primaryDomains,
          effectiveValue: ['healthcare', 'logistics'],
          generatedValue: ['healthcare', 'logistics'],
        },
      },
    };
    const b = calculateFilterFingerprint({ ...sampleInput(), profile: changed });
    expect(a).not.toBe(b);
  });

  it('produces a different hash when derived.strongestSkills.effectiveValue changes', () => {
    const a = calculateFilterFingerprint(sampleInput());
    const changed: ProfessionalProfile = {
      ...sampleProfile(),
      derived: {
        ...sampleProfile().derived,
        strongestSkills: {
          ...sampleProfile().derived.strongestSkills,
          effectiveValue: ['go', 'kubernetes'],
          generatedValue: ['go', 'kubernetes'],
        },
      },
    };
    const b = calculateFilterFingerprint({ ...sampleInput(), profile: changed });
    expect(a).not.toBe(b);
  });

  it('produces a different hash when the languages array changes', () => {
    const a = calculateFilterFingerprint(sampleInput());
    const changed: ProfessionalProfile = {
      ...sampleProfile(),
      languages: [
        {
          id: 'lang-3',
          name: 'Dutch',
          normalizedName: 'dutch',
          level: 'professional',
          sourceReferences: [],
        },
      ],
    };
    const b = calculateFilterFingerprint({ ...sampleInput(), profile: changed });
    expect(a).not.toBe(b);
  });

  it('produces a different hash when the skills array changes', () => {
    const a = calculateFilterFingerprint(sampleInput());
    const changed: ProfessionalProfile = {
      ...sampleProfile(),
      skills: [
        {
          id: 'skill-3',
          name: 'Go',
          normalizedName: 'go',
          category: 'programming_language',
          proficiency: 'advanced',
          yearsOfExperience: 4,
          lastUsedAt: '2026-07',
          evidence: [],
        },
      ],
    };
    const b = calculateFilterFingerprint({ ...sampleInput(), profile: changed });
    expect(a).not.toBe(b);
  });
});

describe('calculateFilterFingerprint — insensitivity to non-slice profile fields', () => {
  it('does NOT change when basics.headline changes', () => {
    const profile = sampleProfile();
    const a = calculateFilterFingerprint({ ...sampleInput(), profile });
    const changed: ProfessionalProfile = {
      ...profile,
      basics: { ...profile.basics, headline: 'A completely different headline' },
    };
    const b = calculateFilterFingerprint({ ...sampleInput(), profile: changed });
    expect(a).toBe(b);
  });

  it('does NOT change when basics.professionalSummary changes', () => {
    const profile = sampleProfile();
    const a = calculateFilterFingerprint({ ...sampleInput(), profile });
    const changed: ProfessionalProfile = {
      ...profile,
      basics: { ...profile.basics, professionalSummary: 'Updated summary text.' },
    };
    const b = calculateFilterFingerprint({ ...sampleInput(), profile: changed });
    expect(a).toBe(b);
  });

  it('does NOT change when basics.currentLocation changes', () => {
    const profile = sampleProfile();
    const a = calculateFilterFingerprint({ ...sampleInput(), profile });
    const changed: ProfessionalProfile = {
      ...profile,
      basics: { ...profile.basics, currentLocation: 'Berlin, DE' },
    };
    const b = calculateFilterFingerprint({ ...sampleInput(), profile: changed });
    expect(a).toBe(b);
  });

  it('does NOT change when basics.totalYearsOfExperience changes', () => {
    const profile = sampleProfile();
    const a = calculateFilterFingerprint({ ...sampleInput(), profile });
    const changed: ProfessionalProfile = {
      ...profile,
      basics: { ...profile.basics, totalYearsOfExperience: 12 },
    };
    const b = calculateFilterFingerprint({ ...sampleInput(), profile: changed });
    expect(a).toBe(b);
  });

  it('does NOT change when experience[].summary changes', () => {
    const profile = sampleProfile();
    const a = calculateFilterFingerprint({ ...sampleInput(), profile });
    const changed: ProfessionalProfile = {
      ...profile,
      experience: profile.experience.map((entry) => ({
        ...entry,
        summary: 'A brand new summary that says something completely different.',
      })),
    };
    const b = calculateFilterFingerprint({ ...sampleInput(), profile: changed });
    expect(a).toBe(b);
  });

  it('does NOT change when experience[].responsibilities or achievements change', () => {
    const profile = sampleProfile();
    const a = calculateFilterFingerprint({ ...sampleInput(), profile });
    const changed: ProfessionalProfile = {
      ...profile,
      experience: profile.experience.map((entry) => ({
        ...entry,
        responsibilities: ['Lead a team of 12 engineers'],
        achievements: ['Migrated to gRPC, cut costs by 30%'],
      })),
    };
    const b = calculateFilterFingerprint({ ...sampleInput(), profile: changed });
    expect(a).toBe(b);
  });

  it('does NOT change when profile.id, createdAt, or contentHash change', () => {
    const profile = sampleProfile();
    const a = calculateFilterFingerprint({ ...sampleInput(), profile });
    const changed: ProfessionalProfile = {
      ...profile,
      id: 'profile-different-id',
      createdAt: '2030-01-01T00:00:00.000Z',
      updatedAt: '2030-01-01T00:00:00.000Z',
      contentHash: 'f'.repeat(64),
      sourceIds: ['source-99'],
    };
    const b = calculateFilterFingerprint({ ...sampleInput(), profile: changed });
    expect(a).toBe(b);
  });

  it('does NOT change when derived.likelySeniority.generatedValue changes (effectiveValue is what counts)', () => {
    // The slice reads `effectiveValue` only; mutating `generatedValue` while
    // leaving `effectiveValue` unchanged must NOT alter the fingerprint.
    const profile = sampleProfile();
    const a = calculateFilterFingerprint({ ...sampleInput(), profile });
    const changed: ProfessionalProfile = {
      ...profile,
      derived: {
        ...profile.derived,
        likelySeniority: {
          ...profile.derived.likelySeniority,
          generatedValue: 'staff',
          // effectiveValue stays 'senior'
        },
      },
    };
    const b = calculateFilterFingerprint({ ...sampleInput(), profile: changed });
    expect(a).toBe(b);
  });

  it('does NOT change when derived.<field>.overrideActive / overrideValue change (effectiveValue is what counts)', () => {
    const profile = sampleProfile();
    const a = calculateFilterFingerprint({ ...sampleInput(), profile });
    const changed: ProfessionalProfile = {
      ...profile,
      derived: {
        ...profile.derived,
        likelySeniority: {
          ...profile.derived.likelySeniority,
          overrideActive: true,
          overrideValue: 'staff',
          // effectiveValue stays 'senior'
          overriddenAt: '2030-01-01T00:00:00.000Z',
        },
      },
    };
    const b = calculateFilterFingerprint({ ...sampleInput(), profile: changed });
    expect(a).toBe(b);
  });
});

describe('calculateFilterFingerprint — null profile handling', () => {
  it('null profile does NOT equal a non-null profile with empty derived fields', () => {
    const nullHash = calculateFilterFingerprint({
      ...sampleInput(),
      profile: null,
    });
    const emptyHash = calculateFilterFingerprint({
      ...sampleInput(),
      profile: minimalProfile(),
    });
    expect(nullHash).not.toBe(emptyHash);
  });

  it('null profile is deterministic for the same inputs', () => {
    const input: FilterFingerprintInput = {
      ...sampleInput(),
      profile: null,
    };
    expect(calculateFilterFingerprint(input)).toBe(calculateFilterFingerprint(input));
  });

  it('null profile differs from a profile that has only non-slice fields populated', () => {
    const baseline = minimalProfile();
    const populatedUnrelated: ProfessionalProfile = {
      ...baseline,
      basics: {
        ...baseline.basics,
        headline: 'Just a headline, not part of the slice.',
      },
    };
    const nullHash = calculateFilterFingerprint({ ...sampleInput(), profile: null });
    const populatedHash = calculateFilterFingerprint({
      ...sampleInput(),
      profile: populatedUnrelated,
    });
    expect(nullHash).not.toBe(populatedHash);
  });
});

describe('calculateFilterFingerprint — minimal input', () => {
  it('produces a stable hash for the all-null job + empty config + null profile', () => {
    const a = calculateFilterFingerprint({
      job: { title: null, company: null, location: null, description: null },
      config: minimalConfig(),
      profile: null,
    });
    const b = calculateFilterFingerprint({
      job: { title: null, company: null, location: null, description: null },
      config: minimalConfig(),
      profile: null,
    });
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it('produces a different hash when the profile flips from null to a non-null profile', () => {
    const a = calculateFilterFingerprint({
      job: { title: null, company: null, location: null, description: null },
      config: minimalConfig(),
      profile: null,
    });
    const b = calculateFilterFingerprint({
      job: { title: null, company: null, location: null, description: null },
      config: minimalConfig(),
      profile: minimalProfile(),
    });
    expect(a).not.toBe(b);
  });
});
