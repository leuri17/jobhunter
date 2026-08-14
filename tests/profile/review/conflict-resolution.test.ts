import { describe, expect, it } from 'vitest';

import type { ProfileConflictRow } from '../../../src/persistence/repositories/profile-versions.js';
import {
  ProfessionalProfileSchema,
  type ProfessionalProfile,
} from '../../../src/profile/schema.js';
import {
  resolveConflictOnProfile,
  type ConflictResolutionChoice,
} from '../../../src/profile/review/conflict-resolution.js';
import { InvalidProfileStateError } from '../../../src/profile/errors.js';

function makeProfile(): ProfessionalProfile {
  return ProfessionalProfileSchema.parse({
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
    experience: [
      {
        id: 'exp_acme_senior',
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
    skills: [],
    languages: [
      {
        id: 'lang_english',
        name: 'English',
        normalizedName: 'english',
        level: 'professional',
        sourceReferences: [],
      },
    ],
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
  });
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
    explanation: 'Sources disagree on startDate for Acme Senior Engineer.',
    resolutionStatus: 'unresolved',
    resolvedAt: null,
    resolvedValue: null,
    ...overrides,
  };
}

const NOW = '2026-08-14T01:00:00.000Z';

describe('resolveConflictOnProfile', () => {
  it('does not mutate the input profile', () => {
    const profile = makeProfile();
    const conflict = makeConflict();
    const originalSnapshot = JSON.stringify(profile);
    const choice: ConflictResolutionChoice = { kind: 'select_source_a', resolvedAt: NOW };
    resolveConflictOnProfile(profile, conflict, 'exp_acme_senior', choice);
    expect(JSON.stringify(profile)).toBe(originalSnapshot);
  });

  it('select_source_a writes valueSourceA onto the targeted field', () => {
    const profile = makeProfile();
    const conflict = makeConflict();
    const out = resolveConflictOnProfile(profile, conflict, 'exp_acme_senior', {
      kind: 'select_source_a',
      resolvedAt: NOW,
    });
    const updated = out.experience.find((e) => e.id === 'exp_acme_senior');
    expect(updated?.startDate).toBe('2022-01');
  });

  it('select_source_b writes valueSourceB onto the targeted field', () => {
    const profile = makeProfile();
    const conflict = makeConflict();
    const out = resolveConflictOnProfile(profile, conflict, 'exp_acme_senior', {
      kind: 'select_source_b',
      resolvedAt: NOW,
    });
    const updated = out.experience.find((e) => e.id === 'exp_acme_senior');
    expect(updated?.startDate).toBe('2021-06');
  });

  it('manual writes the supplied value onto the targeted field', () => {
    const profile = makeProfile();
    const conflict = makeConflict();
    const out = resolveConflictOnProfile(profile, conflict, 'exp_acme_senior', {
      kind: 'manual',
      value: '2021-12',
      resolvedAt: NOW,
    });
    const updated = out.experience.find((e) => e.id === 'exp_acme_senior');
    expect(updated?.startDate).toBe('2021-12');
  });

  it('clear writes null onto the targeted field', () => {
    const profile = makeProfile();
    const conflict = makeConflict();
    const out = resolveConflictOnProfile(profile, conflict, 'exp_acme_senior', {
      kind: 'clear',
      resolvedAt: NOW,
    });
    const updated = out.experience.find((e) => e.id === 'exp_acme_senior');
    expect(updated?.startDate).toBeNull();
  });

  it('targets language entities via language.<field> conflictType', () => {
    const profile = makeProfile();
    const conflict = makeConflict({
      conflictType: 'language.level',
      affectedField: 'level',
      valueSourceA: 'fluent',
      valueSourceB: 'native',
      provisionalValue: 'fluent',
      explanation: 'Sources disagree on level for English.',
    });
    const out = resolveConflictOnProfile(profile, conflict, 'lang_english', {
      kind: 'select_source_b',
      resolvedAt: NOW,
    });
    const updated = out.languages.find((l) => l.id === 'lang_english');
    expect(updated?.level).toBe('native');
  });

  it('preserves sibling entities in the same collection', () => {
    const profile = makeProfile();
    profile.experience.push({
      id: 'exp_other',
      company: 'Other',
      title: 'Junior',
      location: null,
      startDate: '2018-01',
      endDate: '2019-12',
      isCurrent: false,
      summary: null,
      responsibilities: [],
      achievements: [],
      technologies: [],
      domains: [],
      sourceReferences: [],
    });
    const conflict = makeConflict();
    const out = resolveConflictOnProfile(profile, conflict, 'exp_acme_senior', {
      kind: 'clear',
      resolvedAt: NOW,
    });
    expect(out.experience.find((e) => e.id === 'exp_other')?.startDate).toBe('2018-01');
  });

  it('throws InvalidProfileStateError when the entity id is unknown', () => {
    const profile = makeProfile();
    const conflict = makeConflict();
    expect(() =>
      resolveConflictOnProfile(profile, conflict, 'exp_unknown', {
        kind: 'select_source_a',
        resolvedAt: NOW,
      }),
    ).toThrow(InvalidProfileStateError);
  });

  it('throws InvalidProfileStateError for unknown conflict type prefix', () => {
    const profile = makeProfile();
    const conflict = makeConflict({ conflictType: 'unknown_entity.start_date' });
    expect(() =>
      resolveConflictOnProfile(profile, conflict, 'exp_acme_senior', {
        kind: 'select_source_a',
        resolvedAt: NOW,
      }),
    ).toThrow(InvalidProfileStateError);
  });
});
