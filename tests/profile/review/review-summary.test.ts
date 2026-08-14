import { describe, expect, it } from 'vitest';

import type {
  DerivedOverrideRow,
  ProfileConflictRow,
  ProfileWarningRow,
} from '../../../src/persistence/repositories/profile-versions.js';
import {
  ProfessionalProfileSchema,
  type ProfessionalProfile,
} from '../../../src/profile/schema.js';
import { renderReviewSummary } from '../../../src/profile/review/review-summary.js';

function makeProfile(): ProfessionalProfile {
  return ProfessionalProfileSchema.parse({
    schemaVersion: 1,
    id: 'prf_summary',
    createdAt: '2026-08-14T00:00:00.000Z',
    updatedAt: '2026-08-14T00:00:00.000Z',
    contentHash: 'hash-summary',
    sourceIds: [],
    basics: {
      headline: 'Senior Engineer',
      professionalSummary: null,
      currentLocation: 'Berlin',
      totalYearsOfExperience: 7,
    },
    experience: [
      {
        id: 'exp_acme',
        company: 'Acme',
        title: 'Senior Engineer',
        location: 'Berlin',
        startDate: '2022-01',
        endDate: null,
        isCurrent: true,
        summary: null,
        responsibilities: [],
        achievements: [],
        technologies: [],
        domains: [],
        sourceReferences: [],
      },
    ],
    skills: [
      {
        id: 'skill_ts',
        name: 'TypeScript',
        normalizedName: 'typescript',
        category: 'programming_language',
        proficiency: 'expert',
        yearsOfExperience: 6,
        lastUsedAt: null,
        evidence: [],
      },
    ],
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
        generatedValue: [],
        overrideActive: false,
        overrideValue: null,
        effectiveValue: [],
        generatedAt: '2026-08-14T00:00:00.000Z',
        overriddenAt: null,
      },
      primaryDomains: {
        generatedValue: [],
        overrideActive: false,
        overrideValue: null,
        effectiveValue: [],
        generatedAt: '2026-08-14T00:00:00.000Z',
        overriddenAt: null,
      },
      strongestSkills: {
        generatedValue: [],
        overrideActive: false,
        overrideValue: null,
        effectiveValue: [],
        generatedAt: '2026-08-14T00:00:00.000Z',
        overriddenAt: null,
      },
    },
  });
}

function makeWarning(overrides: Partial<ProfileWarningRow> = {}): ProfileWarningRow {
  return {
    id: 1,
    profileVersionId: 1,
    severity: 'warning',
    warningType: 'extraction_warning',
    fieldPath: null,
    message: 'Some warning',
    createdAt: '2026-08-14T00:00:00.000Z',
    ...overrides,
  };
}

function makeConflict(overrides: Partial<ProfileConflictRow> = {}): ProfileConflictRow {
  return {
    id: 1,
    profileVersionId: 1,
    conflictType: 'work_experience.start_date',
    affectedField: 'startDate',
    valueSourceA: '2022-01',
    valueSourceB: '2021-06',
    sourceReferences: [],
    provisionalValue: '2022-01',
    explanation: 'sources disagree',
    resolutionStatus: 'unresolved',
    resolvedAt: null,
    resolvedValue: null,
    ...overrides,
  };
}

function makeOverride(overrides: Partial<DerivedOverrideRow> = {}): DerivedOverrideRow {
  return {
    id: 1,
    profileVersionId: 1,
    derivedField: 'likelySeniority',
    overrideActive: true,
    overrideValue: 'staff',
    generatedValue: 'senior',
    generatedAt: '2026-08-14T00:00:00.000Z',
    overriddenAt: '2026-08-14T01:00:00.000Z',
    ...overrides,
  };
}

describe('renderReviewSummary', () => {
  it('renders every SPEC §16.2 section header', () => {
    const out = renderReviewSummary({
      profile: makeProfile(),
      warnings: [],
      conflicts: [],
      overrides: [],
    });
    expect(out).toContain('## Basics');
    expect(out).toContain('## Experience');
    expect(out).toContain('## Skills');
    expect(out).toContain('## Languages');
    expect(out).toContain('## Education');
    expect(out).toContain('## Certifications');
    expect(out).toContain('## Projects');
    expect(out).toContain('## Derived values');
    expect(out).toContain('## Blocking conflicts');
    expect(out).toContain('## Warnings');
  });

  it('renders (none) for empty collections instead of dropping the section', () => {
    const out = renderReviewSummary({
      profile: makeProfile(),
      warnings: [],
      conflicts: [],
      overrides: [],
    });
    expect(out).toContain('## Languages (0)');
    expect(out).toMatch(/## Languages \(0\)\n+\(none\)/);
  });

  it('renders each conflict grouped under the Blocking conflicts heading', () => {
    const out = renderReviewSummary({
      profile: makeProfile(),
      warnings: [],
      conflicts: [makeConflict()],
      overrides: [],
    });
    expect(out).toContain('work_experience.start_date');
    expect(out).toContain('sources disagree');
  });

  it('groups non-blocking warnings under the Warnings heading', () => {
    const out = renderReviewSummary({
      profile: makeProfile(),
      warnings: [makeWarning({ message: 'low-quality OCR' })],
      conflicts: [],
      overrides: [],
    });
    expect(out).toContain('## Warnings');
    expect(out).toContain('low-quality OCR');
  });

  it('marks an active override in the Derived values section', () => {
    const out = renderReviewSummary({
      profile: makeProfile(),
      warnings: [],
      conflicts: [],
      overrides: [makeOverride()],
    });
    expect(out).toContain('likelySeniority');
    expect(out).toContain('(override active)');
  });

  it('includes the profile id and content hash', () => {
    const out = renderReviewSummary({
      profile: makeProfile(),
      warnings: [],
      conflicts: [],
      overrides: [],
    });
    expect(out).toContain('prf_summary');
    expect(out).toContain('hash-summary');
  });

  it('separates blocking-severity warnings from non-blocking warnings', () => {
    const out = renderReviewSummary({
      profile: makeProfile(),
      warnings: [
        makeWarning({ id: 1, severity: 'blocking_conflict', message: 'blocker-1' }),
        makeWarning({ id: 2, severity: 'warning', message: 'soft-1' }),
      ],
      conflicts: [],
      overrides: [],
    });
    expect(out).toMatch(/## Blocking conflicts \(1\)/);
    expect(out).toContain('blocker-1');
    expect(out).toMatch(/## Warnings \(1\)/);
    expect(out).toContain('soft-1');
  });
});
