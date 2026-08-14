import { describe, expect, it } from 'vitest';

import {
  ExtractedProfileSchema,
  STRUCTURED_OUTPUT_SCHEMA_VERSION,
  createExtractedProfileSchema,
  type ExtractedProfile,
} from '../../../src/profile/openai/structured-output.js';

function extractedProfile(): ExtractedProfile {
  return {
    basics: {
      headline: 'Senior Backend Engineer',
      professionalSummary: null,
      currentLocation: 'Lisbon, Portugal',
      totalYearsOfExperience: 10,
    },
    experience: [
      {
        company: 'Acme',
        title: 'Engineer',
        location: null,
        startDate: '2018-03',
        endDate: null,
        isCurrent: true,
        summary: null,
        responsibilities: ['APIs'],
        achievements: [],
        technologies: ['Node.js'],
        domains: [],
        sourceReferences: [{ sourceId: 'source-1', section: 'Experience', excerpt: null }],
      },
    ],
    skills: [
      {
        name: 'Node.js',
        category: 'programming_language',
        proficiency: 'expert',
        yearsOfExperience: 8,
        lastUsedAt: '2026',
        evidence: [{ sourceType: 'experience', sourceEntityId: null, description: null }],
      },
    ],
    languages: [
      {
        name: 'English',
        level: 'fluent',
        sourceReferences: [{ sourceId: 'source-1', section: null, excerpt: null }],
      },
    ],
    education: [
      {
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
        name: 'Toolkit',
        description: null,
        role: null,
        startDate: null,
        endDate: null,
        technologies: [],
        achievements: [],
        url: null,
        sourceReferences: [],
      },
    ],
    warnings: ['Employment gap between 2016 and 2018 is unexplained.'],
  };
}

describe('ExtractedProfileSchema', () => {
  it('exposes schema version 1', () => {
    expect(STRUCTURED_OUTPUT_SCHEMA_VERSION).toBe(1);
  });

  it('accepts a complete, valid extracted profile', () => {
    const result = ExtractedProfileSchema.safeParse(extractedProfile());
    expect(result.success).toBe(true);
  });

  it('rejects server-generated keys at the top level', () => {
    for (const key of ['id', 'createdAt', 'updatedAt', 'contentHash', 'derived']) {
      const result = ExtractedProfileSchema.safeParse({ ...extractedProfile(), [key]: 'x' });
      expect(result.success, key).toBe(false);
    }
  });

  it('rejects server-generated keys inside nested entities', () => {
    const base = extractedProfile();

    const withExperienceId = ExtractedProfileSchema.safeParse({
      ...base,
      experience: [{ ...base.experience[0], id: 'exp-1' }],
    });
    expect(withExperienceId.success).toBe(false);

    const withSkillNormalizedName = ExtractedProfileSchema.safeParse({
      ...base,
      skills: [{ ...base.skills[0], normalizedName: 'nodejs' }],
    });
    expect(withSkillNormalizedName.success).toBe(false);

    const withLanguageNormalizedName = ExtractedProfileSchema.safeParse({
      ...base,
      languages: [{ ...base.languages[0], normalizedName: 'english' }],
    });
    expect(withLanguageNormalizedName.success).toBe(false);
  });

  it('accepts null scalars and empty collections but rejects null collections', () => {
    const empty: ExtractedProfile = {
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
      warnings: [],
    };
    expect(ExtractedProfileSchema.safeParse(empty).success).toBe(true);

    const nullCollections = ExtractedProfileSchema.safeParse({ ...empty, skills: null });
    expect(nullCollections.success).toBe(false);
    expect(nullCollections.error?.issues[0]?.path).toEqual(['skills']);
  });

  it('treats post-processor defaulted fields as optional', () => {
    const base = extractedProfile();
    const skillWithoutCategory = {
      name: 'Node.js',
      proficiency: 'expert',
      yearsOfExperience: 8,
      lastUsedAt: '2026',
      evidence: [],
    };
    const languageWithoutLevel = { name: 'English', sourceReferences: [] };

    const result = ExtractedProfileSchema.safeParse({
      ...base,
      skills: [skillWithoutCategory],
      languages: [languageWithoutLevel],
    });
    expect(result.success).toBe(true);
  });

  it('accepts explicit null for Skill.category (post-processor replaces with a default)', () => {
    const base = extractedProfile();
    const skillWithNullCategory = {
      ...base.skills[0],
      category: null,
    };

    const result = ExtractedProfileSchema.safeParse({
      ...base,
      skills: [skillWithNullCategory],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.skills[0]?.category).toBeNull();
    }
  });

  it('accepts explicit null for Language.level (post-processor replaces with a default)', () => {
    const base = extractedProfile();
    const languageWithNullLevel = {
      ...base.languages[0],
      level: null,
    };

    const result = ExtractedProfileSchema.safeParse({
      ...base,
      languages: [languageWithNullLevel],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.languages[0]?.level).toBeNull();
    }
  });

  it('fails enum-invalid fields with a precise issue path', () => {
    const base = extractedProfile();
    const result = ExtractedProfileSchema.safeParse({
      ...base,
      skills: [{ ...base.skills[0], category: 'wizardry' }],
    });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(['skills', 0, 'category']);

    const languageResult = ExtractedProfileSchema.safeParse({
      ...base,
      languages: [{ ...base.languages[0], level: 'perfect' }],
    });
    expect(languageResult.success).toBe(false);
    expect(languageResult.error?.issues[0]?.path).toEqual(['languages', 0, 'level']);
  });

  it('fails date-invalid fields with a precise issue path', () => {
    const base = extractedProfile();
    for (const value of ['1990-13', 'abc']) {
      const result = ExtractedProfileSchema.safeParse({
        ...base,
        experience: [{ ...base.experience[0], startDate: value }],
      });
      expect(result.success, value).toBe(false);
      expect(result.error?.issues[0]?.path).toEqual(['experience', 0, 'startDate']);
    }
  });

  it('rejects a sourceReference sourceId that was not supplied in the request', () => {
    const schema = createExtractedProfileSchema(['source-1']);
    expect(schema.safeParse(extractedProfile()).success).toBe(true);

    const base = extractedProfile();
    const result = schema.safeParse({
      ...base,
      experience: [
        {
          ...base.experience[0],
          sourceReferences: [{ sourceId: 'source-9', section: null, excerpt: null }],
        },
      ],
    });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual([
      'experience',
      0,
      'sourceReferences',
      0,
      'sourceId',
    ]);
    expect(result.error?.issues[0]?.message).toContain('source-9');
  });
});
