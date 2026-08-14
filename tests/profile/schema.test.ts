import { describe, expect, it } from 'vitest';

import {
  LanguageLevelSchema,
  PROFILE_SCHEMA_VERSION,
  ProfessionalProfileSchema,
  SENIORITY_LEVELS,
  SeniorityLevelSchema,
  SkillCategorySchema,
  SkillProficiencySchema,
  YearMonthSchema,
  type ProfessionalProfile,
} from '../../src/profile/schema.js';

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

describe('ProfessionalProfileSchema', () => {
  it('parses a minimal valid profile', () => {
    const result = ProfessionalProfileSchema.safeParse(minimalProfile());
    expect(result.success).toBe(true);
  });

  it('parses a fully populated profile with every entity type', () => {
    const profile: ProfessionalProfile = {
      ...minimalProfile(),
      basics: {
        headline: 'Senior Backend Engineer',
        professionalSummary: 'Ten years of Node.js work.',
        currentLocation: 'Lisbon, Portugal',
        totalYearsOfExperience: 10,
      },
      experience: [
        {
          id: 'exp-1',
          company: 'Acme',
          title: 'Engineer',
          location: 'Remote',
          startDate: '2018-03',
          endDate: null,
          isCurrent: true,
          summary: 'Built services.',
          responsibilities: ['APIs'],
          achievements: ['Cut latency'],
          technologies: ['Node.js'],
          domains: ['fintech'],
          sourceReferences: [{ sourceId: 'source-1', section: 'Experience', excerpt: null }],
        },
      ],
      skills: [
        {
          id: 'skill-1',
          name: 'Node.js',
          normalizedName: 'nodejs',
          category: 'programming_language',
          proficiency: 'expert',
          yearsOfExperience: 8,
          lastUsedAt: '2026',
          evidence: [
            { sourceType: 'experience', sourceEntityId: 'exp-1', description: 'Daily use.' },
          ],
        },
      ],
      languages: [
        {
          id: 'lang-1',
          name: 'English',
          normalizedName: 'english',
          level: 'fluent',
          sourceReferences: [],
        },
      ],
      education: [
        {
          id: 'edu-1',
          institution: 'University',
          qualification: 'BSc',
          fieldOfStudy: 'CS',
          startDate: '2010',
          endDate: '2014',
          location: null,
          sourceReferences: [],
        },
      ],
      certifications: [
        {
          id: 'cert-1',
          name: 'AWS SAA',
          issuer: 'AWS',
          issuedAt: '2022-05',
          expiresAt: null,
          credentialId: null,
          credentialUrl: null,
          sourceReferences: [],
        },
      ],
      projects: [
        {
          id: 'proj-1',
          name: 'Toolkit',
          description: null,
          role: 'Maintainer',
          startDate: '2021-01',
          endDate: '2022-12',
          technologies: ['TypeScript'],
          achievements: [],
          url: null,
          sourceReferences: [],
        },
      ],
    };

    const result = ProfessionalProfileSchema.safeParse(profile);
    expect(result.success).toBe(true);
  });

  it('requires schemaVersion to equal 1', () => {
    expect(PROFILE_SCHEMA_VERSION).toBe(1);
    const result = ProfessionalProfileSchema.safeParse({ ...minimalProfile(), schemaVersion: 2 });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(['schemaVersion']);
  });

  it('rejects unknown top-level keys', () => {
    const result = ProfessionalProfileSchema.safeParse({
      ...minimalProfile(),
      preferences: { remoteOnly: true },
    });
    expect(result.success).toBe(false);
    expect(JSON.stringify(result.error?.issues)).toContain('preferences');
  });

  it('rejects unknown nested keys', () => {
    const profile = minimalProfile();
    const result = ProfessionalProfileSchema.safeParse({
      ...profile,
      basics: { ...profile.basics, nickname: 'Lee' },
    });
    expect(result.success).toBe(false);
  });

  it('rejects unknown enum values for skill category, proficiency and language level', () => {
    expect(SkillCategorySchema.safeParse('programming_language').success).toBe(true);
    expect(SkillCategorySchema.safeParse('wizardry').success).toBe(false);
    expect(SkillProficiencySchema.safeParse('expert').success).toBe(true);
    expect(SkillProficiencySchema.safeParse('godlike').success).toBe(false);
    expect(LanguageLevelSchema.safeParse('native').success).toBe(true);
    expect(LanguageLevelSchema.safeParse('perfect').success).toBe(false);
  });

  it('accepts the full SPEC seniority enum for derived.likelySeniority', () => {
    expect([...SENIORITY_LEVELS]).toEqual([
      'intern',
      'junior',
      'mid',
      'senior',
      'staff',
      'principal',
      'lead',
      'manager',
      'director',
      'executive',
    ]);

    for (const level of SENIORITY_LEVELS) {
      expect(SeniorityLevelSchema.safeParse(level).success).toBe(true);
      const profile = minimalProfile();
      const result = ProfessionalProfileSchema.safeParse({
        ...profile,
        derived: {
          ...profile.derived,
          likelySeniority: {
            ...profile.derived.likelySeniority,
            generatedValue: level,
            effectiveValue: level,
          },
        },
      });
      expect(result.success).toBe(true);
    }

    const invalid = minimalProfile();
    const result = ProfessionalProfileSchema.safeParse({
      ...invalid,
      derived: {
        ...invalid.derived,
        likelySeniority: {
          ...invalid.derived.likelySeniority,
          generatedValue: 'overlord',
          effectiveValue: 'overlord',
        },
      },
    });
    expect(result.success).toBe(false);
  });

  it('accepts year and year-month values', () => {
    expect(YearMonthSchema.safeParse('1990').success).toBe(true);
    expect(YearMonthSchema.safeParse('1990-01').success).toBe(true);
    expect(YearMonthSchema.safeParse('2026-12').success).toBe(true);
  });

  it('rejects malformed year-month values', () => {
    for (const value of ['1990-13', '1990-00', '90', 'abc', '1990-1', '1990-01-01', '']) {
      expect(YearMonthSchema.safeParse(value).success, value).toBe(false);
    }
  });

  it('rejects a malformed date inside an experience entry with a precise issue path', () => {
    const profile = minimalProfile();
    const result = ProfessionalProfileSchema.safeParse({
      ...profile,
      experience: [
        {
          id: 'exp-1',
          company: 'Acme',
          title: 'Engineer',
          location: null,
          startDate: '1990-13',
          endDate: null,
          isCurrent: false,
          summary: null,
          responsibilities: [],
          achievements: [],
          technologies: [],
          domains: [],
          sourceReferences: [],
        },
      ],
    });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(['experience', 0, 'startDate']);
  });

  it('requires derived values and rejects a profile missing them', () => {
    const { derived: _derived, ...withoutDerived } = minimalProfile();
    const result = ProfessionalProfileSchema.safeParse(withoutDerived);
    expect(result.success).toBe(false);
    expect(JSON.stringify(result.error?.issues)).toContain('derived');
  });
});
