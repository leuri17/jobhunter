import { describe, expect, it } from 'vitest';

import type { DetectedConflict } from '../../src/profile/conflicts.js';
import {
  postProcessExtractionResponse,
  type PostProcessInputs,
} from '../../src/profile/post-process.js';
import type {
  ExtractedBasics,
  ExtractedCertification,
  ExtractedEducation,
  ExtractedLanguage,
  ExtractedProfile,
  ExtractedProject,
  ExtractedSkill,
  ExtractedWorkExperience,
} from '../../src/profile/openai/structured-output.js';
import type { SourceReference } from '../../src/profile/schema.js';

// Fixed "now" so generatedAt fields and any time-derived behavior are stable.
const fixedNow = (): Date => new Date('2026-08-14T12:00:00.000Z');
const fixedNowIso = '2026-08-14T12:00:00.000Z';

function ref(
  sourceId: string,
  section: string | null = null,
  excerpt: string | null = null,
): SourceReference {
  return { sourceId, section, excerpt };
}

function baselineBasics(): ExtractedBasics {
  return {
    headline: 'Senior Backend Engineer',
    professionalSummary: 'Built services at scale.',
    currentLocation: 'Lisbon, Portugal',
    totalYearsOfExperience: 7,
  };
}

function baselineExperience(
  overrides: Partial<ExtractedWorkExperience> = {},
): ExtractedWorkExperience {
  return {
    company: 'Acme',
    title: 'Staff Engineer',
    location: 'Remote',
    startDate: '2019-01',
    endDate: null,
    isCurrent: true,
    summary: 'Lead platform team.',
    responsibilities: ['Design APIs', ' ', 'Mentor engineers'],
    achievements: ['Cut latency 40%', ''],
    technologies: ['Node.js', 'TypeScript', 'PostgreSQL'],
    domains: ['fintech', ''],
    sourceReferences: [ref('source-1', 'Experience')],
    ...overrides,
  };
}

function baselineExtracted(overrides: Partial<ExtractedProfile> = {}): ExtractedProfile {
  return {
    basics: baselineBasics(),
    experience: [baselineExperience()],
    skills: [
      {
        name: 'Node.js',
        category: 'programming_language',
        proficiency: 'expert',
        yearsOfExperience: 8,
        lastUsedAt: '2026',
        evidence: [{ sourceType: 'experience', sourceEntityId: null, description: 'Daily use.' }],
      },
    ],
    languages: [
      {
        name: 'English',
        level: 'fluent',
        sourceReferences: [ref('source-1')],
      },
    ],
    education: [
      {
        institution: 'University of Lisbon',
        qualification: 'BSc',
        fieldOfStudy: 'Computer Science',
        startDate: '2010',
        endDate: '2014',
        location: 'Lisbon',
        sourceReferences: [ref('source-1')],
      },
    ],
    certifications: [
      {
        name: 'AWS Solutions Architect',
        issuer: 'AWS',
        issuedAt: '2022-05',
        expiresAt: null,
        credentialId: 'AWS-123',
        credentialUrl: null,
        sourceReferences: [ref('source-1')],
      },
    ],
    projects: [
      {
        name: 'Toolkit',
        description: 'Internal dev toolkit.',
        role: 'Maintainer',
        startDate: '2021-01',
        endDate: '2022-12',
        technologies: ['Node.js', 'TypeScript'],
        achievements: [],
        url: null,
        sourceReferences: [ref('source-1')],
      },
    ],
    warnings: [],
    ...overrides,
  };
}

function runPostProcess(
  extracted: ExtractedProfile,
  knownSourceIds: readonly string[] = ['source-1'],
): ReturnType<typeof postProcessExtractionResponse> {
  const inputs: PostProcessInputs = { extracted, knownSourceIds, now: fixedNow };
  return postProcessExtractionResponse(inputs);
}

describe('postProcessExtractionResponse', () => {
  it('builds a complete profile with id, normalizedName, derived populated, and a 64-char hex contentHash', () => {
    const result = runPostProcess(baselineExtracted(), ['source-1']);

    expect(result.profile.id).toMatch(/^profile_[0-9a-f]{16}$/);
    expect(result.profile.schemaVersion).toBe(1);
    expect(result.profile.createdAt).toBe(fixedNowIso);
    expect(result.profile.updatedAt).toBe(fixedNowIso);
    expect(result.profile.sourceIds).toEqual(['source-1']);

    // Skills carry normalizedName.
    expect(result.profile.skills).toHaveLength(1);
    expect(result.profile.skills[0]?.normalizedName).toBe('nodejs');

    // Languages carry normalizedName.
    expect(result.profile.languages).toHaveLength(1);
    expect(result.profile.languages[0]?.normalizedName).toBe('english');

    // derived block is fully populated.
    expect(result.profile.derived.likelySeniority.generatedValue).toBe('senior');
    expect(result.profile.derived.primaryRoles.generatedValue.length).toBeGreaterThan(0);
    expect(result.profile.derived.primaryDomains.generatedValue.length).toBeGreaterThan(0);
    expect(result.profile.derived.strongestSkills.generatedValue.length).toBeGreaterThan(0);

    for (const field of [
      result.profile.derived.likelySeniority,
      result.profile.derived.primaryRoles,
      result.profile.derived.primaryDomains,
      result.profile.derived.strongestSkills,
    ]) {
      expect(field.overrideActive).toBe(false);
      expect(field.overriddenAt).toBeNull();
      expect(field.generatedAt).toBe(fixedNowIso);
      expect(field.effectiveValue).toEqual(field.generatedValue);
    }

    // contentHash is 64-char lowercase hex.
    expect(result.profile.contentHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('defaults Skill.category to "other" when the extractor omits it', () => {
    const skillWithoutCategory = {
      name: 'Kubernetes',
      proficiency: 'intermediate',
      yearsOfExperience: 3,
      lastUsedAt: null,
      evidence: [{ sourceType: 'experience', sourceEntityId: null, description: null }],
    } satisfies ExtractedSkill;

    const result = runPostProcess(baselineExtracted({ skills: [skillWithoutCategory] }));

    expect(result.profile.skills).toHaveLength(1);
    expect(result.profile.skills[0]?.category).toBe('other');
    expect(result.warnings).toEqual([]);
  });

  it('defaults Skill.category to "other" when the extractor emits explicit null', () => {
    const skillWithNullCategory: ExtractedSkill = {
      name: 'Kubernetes',
      category: null,
      proficiency: 'intermediate',
      yearsOfExperience: 3,
      lastUsedAt: null,
      evidence: [],
    };

    const result = runPostProcess(baselineExtracted({ skills: [skillWithNullCategory] }));

    expect(result.profile.skills).toHaveLength(1);
    expect(result.profile.skills[0]?.category).toBe('other');
  });

  it('keeps a valid Skill.category verbatim (no defaulting)', () => {
    const skillWithProgrammingCategory: ExtractedSkill = {
      name: 'TypeScript',
      category: 'programming_language',
      proficiency: 'expert',
      yearsOfExperience: 5,
      lastUsedAt: '2026',
      evidence: [],
    };

    const result = runPostProcess(baselineExtracted({ skills: [skillWithProgrammingCategory] }));

    expect(result.profile.skills[0]?.category).toBe('programming_language');
  });

  it('deduplicates skills by normalizedName and merges their evidence arrays', () => {
    const skills: ExtractedSkill[] = [
      {
        name: 'Node.js',
        category: 'programming_language',
        proficiency: 'expert',
        yearsOfExperience: 8,
        lastUsedAt: '2026',
        evidence: [
          { sourceType: 'experience', sourceEntityId: null, description: 'Built services.' },
        ],
      },
      {
        name: 'NodeJS',
        category: 'programming_language',
        proficiency: 'advanced',
        yearsOfExperience: 5,
        lastUsedAt: '2025',
        evidence: [
          { sourceType: 'project', sourceEntityId: null, description: 'Refactored runtime.' },
        ],
      },
    ];

    const result = runPostProcess(baselineExtracted({ skills }));

    expect(result.profile.skills).toHaveLength(1);
    const merged = result.profile.skills[0];
    expect(merged?.name).toBe('Node.js');
    expect(merged?.normalizedName).toBe('nodejs');
    expect(merged?.proficiency).toBe('expert'); // first occurrence wins
    expect(merged?.evidence).toHaveLength(2);
    expect(merged?.evidence.map((e) => e.sourceType).sort()).toEqual(['experience', 'project']);
  });

  it('produces deterministic skill IDs from normalizedName', () => {
    const skill: ExtractedSkill = {
      name: 'Node.js',
      category: 'programming_language',
      proficiency: 'expert',
      yearsOfExperience: 8,
      lastUsedAt: '2026',
      evidence: [],
    };

    const a = runPostProcess(baselineExtracted({ skills: [skill] }));
    const b = runPostProcess(baselineExtracted({ skills: [skill] }));

    expect(a.profile.skills[0]?.id).toBe(b.profile.skills[0]?.id);
    expect(a.profile.skills[0]?.id).toMatch(/^skill_[0-9a-f]{8}$/);
  });

  it('nulls endDate and adds a warning when endDate < startDate', () => {
    const experience = baselineExperience({
      startDate: '2022-01',
      endDate: '2020-01',
      isCurrent: false,
    });
    const result = runPostProcess(baselineExtracted({ experience: [experience] }));

    expect(result.profile.experience[0]?.startDate).toBe('2022-01');
    expect(result.profile.experience[0]?.endDate).toBeNull();
    expect(result.warnings.some((w) => w.includes('endDate') && w.includes('startDate'))).toBe(
      true,
    );
  });

  it('nulls both startDate and endDate when startDate is not a valid YearMonth', () => {
    const experience = baselineExperience({
      startDate: '1990-13',
      endDate: '2022-01',
      isCurrent: false,
    });
    const result = runPostProcess(baselineExtracted({ experience: [experience] }));

    expect(result.profile.experience[0]?.startDate).toBeNull();
    expect(result.profile.experience[0]?.endDate).toBeNull();
    expect(result.warnings.some((w) => w.toLowerCase().includes('startdate'))).toBe(true);
  });

  it('nulls both startDate and endDate when endDate is not a valid YearMonth (symmetric cascade)', () => {
    // Per the brief's "set both to null" rule, an invalid endDate cascades to
    // null the entire range — even when startDate is valid.
    const experience = baselineExperience({
      startDate: '2020-01',
      endDate: 'abc',
      isCurrent: false,
    });
    const result = runPostProcess(baselineExtracted({ experience: [experience] }));

    expect(result.profile.experience[0]?.startDate).toBeNull();
    expect(result.profile.experience[0]?.endDate).toBeNull();
    expect(result.warnings.some((w) => w.toLowerCase().includes('invalid_experience_date'))).toBe(
      true,
    );
  });

  it('sets isCurrent true only when the extractor indicated isCurrent and endDate is null with a valid startDate', () => {
    const experienceWithCurrentTrue = baselineExperience({
      startDate: '2020-01',
      endDate: null,
      isCurrent: true,
    });
    const result1 = runPostProcess(baselineExtracted({ experience: [experienceWithCurrentTrue] }));
    expect(result1.profile.experience[0]?.isCurrent).toBe(true);

    // Extractor says isCurrent=false → preserve false even when dates support it.
    const experienceWithCurrentFalse = baselineExperience({
      startDate: '2020-01',
      endDate: null,
      isCurrent: false,
    });
    const result2 = runPostProcess(baselineExtracted({ experience: [experienceWithCurrentFalse] }));
    expect(result2.profile.experience[0]?.isCurrent).toBe(false);

    // Extractor says isCurrent=true but the dates rule it out → false.
    const experienceWithDatedRange = baselineExperience({
      startDate: '2018-01',
      endDate: '2022-01',
      isCurrent: true,
    });
    const result3 = runPostProcess(baselineExtracted({ experience: [experienceWithDatedRange] }));
    expect(result3.profile.experience[0]?.isCurrent).toBe(false);
  });

  it('emits a DetectedConflict when two sources disagree on endDate for the same company + title', () => {
    const experience1 = baselineExperience({
      startDate: '2020-01',
      endDate: '2022-01',
      isCurrent: false,
      sourceReferences: [ref('source-1')],
    });
    const experience2 = baselineExperience({
      startDate: '2020-01',
      endDate: '2023-06',
      isCurrent: false,
      sourceReferences: [ref('source-2')],
    });

    const result = runPostProcess(baselineExtracted({ experience: [experience1, experience2] }), [
      'source-1',
      'source-2',
    ]);

    const conflict = result.conflicts.find(
      (c: DetectedConflict) => c.conflictType === 'work_experience.end_date',
    );
    expect(conflict).toBeDefined();
    expect(conflict?.provisionalValue).toBe('2022-01');
    expect(conflict?.valueSourceA).toBe('2022-01');
    expect(conflict?.valueSourceB).toBe('2023-06');
    expect(conflict?.sourceReferences.map((r) => r.sourceId).sort()).toEqual([
      'source-1',
      'source-2',
    ]);
  });

  it('returns no spurious warnings when the extractor emits an empty warnings array and dates are valid', () => {
    const result = runPostProcess(baselineExtracted({ warnings: [] }));

    expect(result.warnings).toEqual([]);
  });

  it('preserves extractor warnings verbatim in the returned warnings array', () => {
    const result = runPostProcess(
      baselineExtracted({
        warnings: ['Employment gap between 2016 and 2018 is unexplained.'],
      }),
    );

    expect(result.warnings).toContain('Employment gap between 2016 and 2018 is unexplained.');
  });

  it('sets derived.likelySeniority.generatedValue to "senior" when totalYearsOfExperience is 7', () => {
    const result = runPostProcess(
      baselineExtracted({ basics: { ...baselineBasics(), totalYearsOfExperience: 7 } }),
    );

    expect(result.profile.derived.likelySeniority.generatedValue).toBe('senior');
    expect(result.profile.derived.likelySeniority.effectiveValue).toBe('senior');
  });

  it.each([
    [0, null],
    [1, null],
    [3, 'mid'],
    [5, 'mid'],
    [6, 'senior'],
    [9, 'senior'],
    [10, 'staff'],
    [25, 'staff'],
    [null, null],
  ])('maps totalYearsOfExperience=%s to likelySeniority=%s', (years, expected) => {
    const basics: ExtractedBasics = { ...baselineBasics(), totalYearsOfExperience: years };
    const result = runPostProcess(baselineExtracted({ basics }));
    expect(result.profile.derived.likelySeniority.generatedValue).toBe(expected);
  });

  it('derives primaryRoles as a non-empty array of unique titles from the most recent experiences', () => {
    const experiences: ExtractedWorkExperience[] = [
      baselineExperience({
        company: 'Acme',
        title: 'Staff Engineer',
        startDate: '2019-01',
        endDate: null,
        isCurrent: true,
        sourceReferences: [ref('source-1')],
      }),
      baselineExperience({
        company: 'Globex',
        title: 'Senior Engineer',
        startDate: '2015-01',
        endDate: '2018-12',
        isCurrent: false,
        sourceReferences: [ref('source-1')],
      }),
      baselineExperience({
        company: 'Initech',
        title: 'Software Engineer',
        startDate: '2012-01',
        endDate: '2014-12',
        isCurrent: false,
        sourceReferences: [ref('source-1')],
      }),
    ];

    const result = runPostProcess(baselineExtracted({ experience: experiences }));

    expect(result.profile.derived.primaryRoles.generatedValue.length).toBeGreaterThan(0);
    // Most recent title comes first.
    expect(result.profile.derived.primaryRoles.generatedValue[0]).toBe('Staff Engineer');
    // Titles are unique within the array.
    const titles = result.profile.derived.primaryRoles.generatedValue;
    expect(new Set(titles).size).toBe(titles.length);
    // Capped at three unique titles.
    expect(result.profile.derived.primaryRoles.generatedValue.length).toBeLessThanOrEqual(3);
  });

  it('derives primaryDomains as a deduplicated union of experience.domains (top 5)', () => {
    const experiences: ExtractedWorkExperience[] = [
      baselineExperience({
        company: 'Acme',
        title: 'Staff Engineer',
        domains: ['fintech', 'payments'],
        sourceReferences: [ref('source-1')],
      }),
      baselineExperience({
        company: 'Globex',
        title: 'Senior Engineer',
        startDate: '2015-01',
        endDate: '2018-12',
        domains: ['healthcare', 'fintech'],
        sourceReferences: [ref('source-1')],
      }),
    ];

    const result = runPostProcess(baselineExtracted({ experience: experiences }));

    const domains = result.profile.derived.primaryDomains.generatedValue;
    expect(domains).toContain('fintech');
    expect(domains).toContain('payments');
    expect(domains).toContain('healthcare');
    // Unique values only.
    expect(new Set(domains).size).toBe(domains.length);
    // Capped at 5.
    expect(domains.length).toBeLessThanOrEqual(5);
  });

  it('derives strongestSkills as the top 5 technologies by frequency across experiences and projects', () => {
    const experiences: ExtractedWorkExperience[] = [
      baselineExperience({
        technologies: ['Node.js', 'TypeScript', 'PostgreSQL'],
        sourceReferences: [ref('source-1')],
      }),
    ];
    const projects: ExtractedProject[] = [
      {
        name: 'Toolkit',
        description: null,
        role: null,
        startDate: '2021-01',
        endDate: '2022-12',
        technologies: ['Node.js', 'TypeScript', 'React'],
        achievements: [],
        url: null,
        sourceReferences: [ref('source-1')],
      },
      {
        name: 'Side',
        description: null,
        role: null,
        startDate: null,
        endDate: null,
        technologies: ['Node.js', 'Go'],
        achievements: [],
        url: null,
        sourceReferences: [ref('source-1')],
      },
    ];

    const result = runPostProcess(baselineExtracted({ experience: experiences, projects }));

    const strongest = result.profile.derived.strongestSkills.generatedValue;
    // Node.js appears 3 times across the two project lists and experience; must come first.
    expect(strongest[0]).toBe('Node.js');
    // Top is bounded at 5.
    expect(strongest.length).toBeLessThanOrEqual(5);
    // No duplicates.
    expect(new Set(strongest).size).toBe(strongest.length);
  });

  it('defaults Language.level to null when the extractor omits it', () => {
    const languageWithoutLevel = {
      name: 'Portuguese',
      sourceReferences: [],
    } satisfies ExtractedLanguage;
    const result = runPostProcess(baselineExtracted({ languages: [languageWithoutLevel] }));

    expect(result.profile.languages).toHaveLength(1);
    expect(result.profile.languages[0]?.level).toBeNull();
  });

  it('defaults Language.level to null when the extractor emits explicit null', () => {
    const languageWithNullLevel: ExtractedLanguage = {
      name: 'Portuguese',
      level: null,
      sourceReferences: [ref('source-1')],
    };

    const result = runPostProcess(baselineExtracted({ languages: [languageWithNullLevel] }));

    expect(result.profile.languages[0]?.level).toBeNull();
  });

  it('deduplicates languages by normalizedName and merges their sourceReferences', () => {
    const languages: ExtractedLanguage[] = [
      { name: 'English', level: 'fluent', sourceReferences: [ref('source-1')] },
      { name: 'ENGLISH', level: 'native', sourceReferences: [ref('source-2')] },
    ];

    const result = runPostProcess(baselineExtracted({ languages }), ['source-1', 'source-2']);

    expect(result.profile.languages).toHaveLength(1);
    expect(result.profile.languages[0]?.normalizedName).toBe('english');
    expect(result.profile.languages[0]?.level).toBe('fluent');
    expect(result.profile.languages[0]?.sourceReferences.map((r) => r.sourceId).sort()).toEqual([
      'source-1',
      'source-2',
    ]);
  });

  it('produces unique IDs across experience, skills, languages, education, certifications, and projects', () => {
    // Add multiple entries of each type to maximize the chance of a collision.
    const result = runPostProcess(
      baselineExtracted({
        experience: [
          baselineExperience({ company: 'A', sourceReferences: [ref('source-1')] }),
          baselineExperience({ company: 'B', sourceReferences: [ref('source-1')] }),
          baselineExperience({ company: 'C', sourceReferences: [ref('source-1')] }),
        ],
        skills: [
          {
            name: 'Node.js',
            category: 'programming_language',
            proficiency: 'expert',
            yearsOfExperience: 5,
            lastUsedAt: null,
            evidence: [],
          },
          {
            name: 'TypeScript',
            category: 'programming_language',
            proficiency: 'expert',
            yearsOfExperience: 5,
            lastUsedAt: null,
            evidence: [],
          },
          {
            name: 'PostgreSQL',
            category: 'database',
            proficiency: 'expert',
            yearsOfExperience: 5,
            lastUsedAt: null,
            evidence: [],
          },
        ],
        languages: [
          { name: 'English', level: 'fluent', sourceReferences: [ref('source-1')] },
          { name: 'Portuguese', level: 'native', sourceReferences: [ref('source-1')] },
          { name: 'Spanish', level: 'conversational', sourceReferences: [ref('source-1')] },
        ],
        education: [
          {
            institution: 'University A',
            qualification: null,
            fieldOfStudy: null,
            startDate: null,
            endDate: null,
            location: null,
            sourceReferences: [ref('source-1')],
          } satisfies ExtractedEducation,
          {
            institution: 'University B',
            qualification: null,
            fieldOfStudy: null,
            startDate: null,
            endDate: null,
            location: null,
            sourceReferences: [ref('source-1')],
          } satisfies ExtractedEducation,
        ],
        certifications: [
          {
            name: 'AWS',
            issuer: null,
            issuedAt: null,
            expiresAt: null,
            credentialId: null,
            credentialUrl: null,
            sourceReferences: [ref('source-1')],
          } satisfies ExtractedCertification,
          {
            name: 'GCP',
            issuer: null,
            issuedAt: null,
            expiresAt: null,
            credentialId: null,
            credentialUrl: null,
            sourceReferences: [ref('source-1')],
          } satisfies ExtractedCertification,
        ],
        projects: [
          {
            name: 'P1',
            description: null,
            role: null,
            startDate: null,
            endDate: null,
            technologies: [],
            achievements: [],
            url: null,
            sourceReferences: [ref('source-1')],
          } satisfies ExtractedProject,
          {
            name: 'P2',
            description: null,
            role: null,
            startDate: null,
            endDate: null,
            technologies: [],
            achievements: [],
            url: null,
            sourceReferences: [ref('source-1')],
          } satisfies ExtractedProject,
        ],
      }),
    );

    const allIds = [
      ...result.profile.experience.map((e) => e.id),
      ...result.profile.skills.map((s) => s.id),
      ...result.profile.languages.map((l) => l.id),
      ...result.profile.education.map((e) => e.id),
      ...result.profile.certifications.map((c) => c.id),
      ...result.profile.projects.map((p) => p.id),
    ];

    expect(allIds.length).toBeGreaterThan(5);
    expect(new Set(allIds).size).toBe(allIds.length);

    // ID prefix sanity.
    expect(result.profile.experience.every((e) => e.id.startsWith('exp_'))).toBe(true);
    expect(result.profile.skills.every((s) => s.id.startsWith('skill_'))).toBe(true);
    expect(result.profile.languages.every((l) => l.id.startsWith('lang_'))).toBe(true);
    expect(result.profile.education.every((e) => e.id.startsWith('edu_'))).toBe(true);
    expect(result.profile.certifications.every((c) => c.id.startsWith('cert_'))).toBe(true);
    expect(result.profile.projects.every((p) => p.id.startsWith('proj_'))).toBe(true);
  });

  it('drops empty strings from experience arrays (responsibilities, achievements, technologies, domains)', () => {
    const experience = baselineExperience({
      responsibilities: ['Real one', '', '   ', 'Another real one'],
      achievements: ['Real impact', ''],
      technologies: ['Node.js', '', 'TypeScript'],
      domains: ['fintech', ''],
      summary: '   ',
    });

    const result = runPostProcess(baselineExtracted({ experience: [experience] }));

    const processed = result.profile.experience[0];
    expect(processed?.responsibilities).toEqual(['Real one', 'Another real one']);
    expect(processed?.achievements).toEqual(['Real impact']);
    expect(processed?.technologies).toEqual(['Node.js', 'TypeScript']);
    expect(processed?.domains).toEqual(['fintech']);
    expect(processed?.summary).toBeNull();
  });

  it('validates Education dates, assigns IDs, and drops empty fields', () => {
    const education: ExtractedEducation = {
      institution: 'University A',
      qualification: '',
      fieldOfStudy: 'CS',
      startDate: '2010',
      endDate: '2014',
      location: 'Lisbon',
      sourceReferences: [ref('source-1')],
    };

    const result = runPostProcess(baselineExtracted({ education: [education] }));

    expect(result.profile.education).toHaveLength(1);
    const processed = result.profile.education[0];
    expect(processed?.id).toMatch(/^edu_[0-9a-f]{8}$/);
    expect(processed?.qualification).toBeNull();
    expect(processed?.startDate).toBe('2010');
    expect(processed?.endDate).toBe('2014');
  });

  it('nulls both Education dates when the startDate is not a valid YearMonth (cascading)', () => {
    const education: ExtractedEducation = {
      institution: 'University A',
      qualification: 'BSc',
      fieldOfStudy: null,
      startDate: '1990-13',
      endDate: '2014',
      location: null,
      sourceReferences: [ref('source-1')],
    };

    const result = runPostProcess(baselineExtracted({ education: [education] }));

    expect(result.profile.education[0]?.startDate).toBeNull();
    expect(result.profile.education[0]?.endDate).toBeNull();
    expect(result.warnings.some((w) => w.toLowerCase().includes('education'))).toBe(true);
  });

  it('nulls both Education dates when endDate is malformed (symmetric cascade)', () => {
    const education: ExtractedEducation = {
      institution: 'University A',
      qualification: 'BSc',
      fieldOfStudy: null,
      startDate: '2010',
      endDate: 'bad-date',
      location: null,
      sourceReferences: [ref('source-1')],
    };

    const result = runPostProcess(baselineExtracted({ education: [education] }));

    expect(result.profile.education[0]?.startDate).toBeNull();
    expect(result.profile.education[0]?.endDate).toBeNull();
    expect(result.warnings.some((w) => w.toLowerCase().includes('invalid_education_date'))).toBe(
      true,
    );
  });

  it('emits a warning and nulls both certification dates when issuedAt is malformed', () => {
    const certification: ExtractedCertification = {
      name: 'AWS Solutions Architect',
      issuer: 'AWS',
      issuedAt: 'not-a-date',
      expiresAt: '2025-01',
      credentialId: 'AWS-123',
      credentialUrl: null,
      sourceReferences: [ref('source-1')],
    };

    const result = runPostProcess(baselineExtracted({ certifications: [certification] }));

    expect(result.profile.certifications[0]?.issuedAt).toBeNull();
    expect(result.profile.certifications[0]?.expiresAt).toBeNull();
    expect(
      result.warnings.some((w) => w.toLowerCase().includes('invalid_certification_date')),
    ).toBe(true);
  });

  it('emits a warning and nulls both project dates when startDate is malformed', () => {
    const project: ExtractedProject = {
      name: 'Toolkit',
      description: null,
      role: null,
      startDate: 'bad-date',
      endDate: '2022-12',
      technologies: ['Node.js'],
      achievements: [],
      url: null,
      sourceReferences: [ref('source-1')],
    };

    const result = runPostProcess(baselineExtracted({ projects: [project] }));

    expect(result.profile.projects[0]?.startDate).toBeNull();
    expect(result.profile.projects[0]?.endDate).toBeNull();
    expect(result.warnings.some((w) => w.toLowerCase().includes('invalid_project_date'))).toBe(
      true,
    );
  });

  it('preserves identical sourceReferences when merging languages with the same normalizedName', () => {
    // Two language entries with identical normalizedName "english", each
    // carrying an identical sourceReference. The merge must concatenate
    // without dedup so that both references are preserved verbatim.
    const sharedRef = ref('source-1', 'Skills', 'Fluent in English');
    const languages: ExtractedLanguage[] = [
      { name: 'English', level: 'fluent', sourceReferences: [sharedRef] },
      { name: 'ENGLISH', level: 'native', sourceReferences: [sharedRef] },
    ];

    const result = runPostProcess(baselineExtracted({ languages }), ['source-1']);

    expect(result.profile.languages).toHaveLength(1);
    expect(result.profile.languages[0]?.sourceReferences).toHaveLength(2);
    expect(result.profile.languages[0]?.sourceReferences[0]).toEqual(sharedRef);
    expect(result.profile.languages[0]?.sourceReferences[1]).toEqual(sharedRef);
  });

  it('preserves two distinct sourceReferences when merging languages with the same normalizedName', () => {
    // Two language entries with identical normalizedName, each carrying a
    // distinct sourceReference (different sourceId). Both must survive the
    // merge.
    const languages: ExtractedLanguage[] = [
      { name: 'English', level: 'fluent', sourceReferences: [ref('source-1')] },
      { name: 'ENGLISH', level: 'native', sourceReferences: [ref('source-2')] },
    ];

    const result = runPostProcess(baselineExtracted({ languages }), ['source-1', 'source-2']);

    expect(result.profile.languages).toHaveLength(1);
    expect(result.profile.languages[0]?.sourceReferences.map((r) => r.sourceId).sort()).toEqual([
      'source-1',
      'source-2',
    ]);
  });
});
