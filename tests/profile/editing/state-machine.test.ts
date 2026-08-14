import { describe, expect, it } from 'vitest';

import {
  ProfessionalProfileSchema,
  type ProfessionalProfile,
} from '../../../src/profile/schema.js';
import {
  emptyDraftState,
  reduce,
  type CollectionEditOperation,
  type DraftState,
  type EditorOperation,
} from '../../../src/profile/editing/state-machine.js';
import { InvalidProfileStateError } from '../../../src/profile/errors.js';
import type {
  DerivedOverrideRow,
  ProfileConflictRow,
} from '../../../src/persistence/repositories/profile-versions.js';

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
    skills: [
      {
        id: 'skill_typescript',
        name: 'TypeScript',
        normalizedName: 'typescript',
        category: 'programming_language',
        proficiency: 'advanced',
        yearsOfExperience: 6,
        lastUsedAt: '2026-01',
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

function makeOverride(
  field: DerivedOverrideRow['derivedField'],
  overrideActive: boolean,
  overrideValue: unknown,
  generatedValue: unknown,
): DerivedOverrideRow {
  return {
    id: 1,
    profileVersionId: 1,
    derivedField: field,
    overrideActive,
    overrideValue,
    generatedValue,
    generatedAt: '2026-08-14T00:00:00.000Z',
    overriddenAt: overrideActive ? '2026-08-14T01:00:00.000Z' : null,
  };
}

const NOW = '2026-08-14T01:00:00.000Z';

describe('emptyDraftState', () => {
  it('returns a fresh state with empty revision list and history', () => {
    const profile = makeProfile();
    const state = emptyDraftState(profile);
    expect(state.profile).toBe(profile);
    expect(state.pendingRevisions).toEqual([]);
    expect(state.sectionHistory).toEqual([]);
    expect(state.pendingOverrides).toEqual([]);
  });

  it('applies the initial override rows to the profile', () => {
    const profile = makeProfile();
    const overrides = [makeOverride('likelySeniority', true, 'staff', 'senior')];
    const state = emptyDraftState(profile, overrides);
    expect(state.profile.derived.likelySeniority.effectiveValue).toBe('staff');
    expect(state.pendingOverrides).toHaveLength(1);
  });
});

describe('reduce: select_section', () => {
  it('appends to sectionHistory and does not mutate the profile', () => {
    const profile = makeProfile();
    const snapshot = JSON.stringify(profile);
    const state = emptyDraftState(profile);
    const next = reduce(state, { kind: 'select_section', section: 'basics' });
    expect(next.sectionHistory).toEqual(['basics']);
    expect(JSON.stringify(next.profile)).toBe(snapshot);
  });
});

describe('reduce: edit_scalar', () => {
  it('updates a basics field, records a user revision, does not mutate input', () => {
    const profile = makeProfile();
    const snapshot = JSON.stringify(profile);
    const state = emptyDraftState(profile);
    const next = reduce(state, {
      kind: 'edit_scalar',
      section: 'basics',
      field: 'headline',
      value: 'Staff Engineer',
    });
    expect(next.profile.basics.headline).toBe('Staff Engineer');
    expect(next.pendingRevisions).toHaveLength(1);
    expect(next.pendingRevisions[0]).toMatchObject({
      fieldPath: 'basics.headline',
      previousValue: null,
      newValue: 'Staff Engineer',
      source: 'user',
    });
    expect(JSON.stringify(profile)).toBe(snapshot);
  });

  it('rejects invalid scalar input via InvalidProfileStateError', () => {
    const profile = makeProfile();
    const state = emptyDraftState(profile);
    expect(() =>
      reduce(state, {
        kind: 'edit_scalar',
        section: 'basics',
        field: 'totalYearsOfExperience',
        value: 'not-a-number',
      }),
    ).toThrow(InvalidProfileStateError);
  });

  it('accepts null for nullable fields', () => {
    const profile = makeProfile();
    profile.basics.headline = 'old';
    const state = emptyDraftState(profile);
    const next = reduce(state, {
      kind: 'edit_scalar',
      section: 'basics',
      field: 'headline',
      value: null,
    });
    expect(next.profile.basics.headline).toBeNull();
  });
});

describe('reduce: edit_collection', () => {
  it('add appends an entry and records a user revision', () => {
    const profile = makeProfile();
    const state = emptyDraftState(profile);
    const next = reduce(state, {
      kind: 'edit_collection',
      section: 'experience',
      operation: {
        kind: 'add',
        entry: {
          id: 'exp_new',
          company: 'Newco',
          title: 'Lead',
          location: null,
          startDate: '2025-01',
          endDate: null,
          isCurrent: true,
          summary: null,
          responsibilities: [],
          achievements: [],
          technologies: [],
          domains: [],
          sourceReferences: [],
        },
      },
    });
    expect(next.profile.experience).toHaveLength(2);
    expect(next.profile.experience[1]?.id).toBe('exp_new');
    expect(next.pendingRevisions).toHaveLength(1);
    expect(next.pendingRevisions[0]?.source).toBe('user');
  });

  it('edit replaces the entity with the patched fields', () => {
    const profile = makeProfile();
    const state = emptyDraftState(profile);
    const next = reduce(state, {
      kind: 'edit_collection',
      section: 'experience',
      operation: {
        kind: 'edit',
        entityId: 'exp_acme_senior',
        patch: { title: 'Staff Engineer' },
      },
    });
    const updated = next.profile.experience.find((e) => e.id === 'exp_acme_senior');
    expect(updated?.title).toBe('Staff Engineer');
    expect(next.pendingRevisions[0]?.fieldPath).toContain('exp_acme_senior');
  });

  it('delete requires confirm:true', () => {
    const profile = makeProfile();
    const state = emptyDraftState(profile);
    const badOp = {
      kind: 'delete',
      entityId: 'exp_acme_senior',
      confirm: false as const,
    } as unknown as CollectionEditOperation;
    expect(() =>
      reduce(state, {
        kind: 'edit_collection',
        section: 'experience',
        operation: badOp,
      }),
    ).toThrow(InvalidProfileStateError);
  });

  it('delete removes the entry when confirmed', () => {
    const profile = makeProfile();
    const state = emptyDraftState(profile);
    const next = reduce(state, {
      kind: 'edit_collection',
      section: 'experience',
      operation: { kind: 'delete', entityId: 'exp_acme_senior', confirm: true },
    });
    expect(next.profile.experience).toHaveLength(0);
    expect(next.pendingRevisions[0]?.newValue).toBeNull();
  });

  it('reorder swaps two entries by id', () => {
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
    const state = emptyDraftState(profile);
    const next = reduce(state, {
      kind: 'edit_collection',
      section: 'experience',
      operation: {
        kind: 'reorder',
        entityIdA: 'exp_acme_senior',
        entityIdB: 'exp_other',
      },
    });
    expect(next.profile.experience[0]?.id).toBe('exp_other');
    expect(next.profile.experience[1]?.id).toBe('exp_acme_senior');
    expect(next.pendingRevisions[0]?.fieldPath).toContain('reorder');
  });
});

describe('reduce: resolve_conflict', () => {
  it('applies the choice and records a conflict_resolution revision', () => {
    const profile = makeProfile();
    const conflict = makeConflict();
    const state = emptyDraftState(profile);
    const next = reduce(state, {
      kind: 'resolve_conflict',
      conflictId: 1,
      conflict,
      entityId: 'exp_acme_senior',
      choice: { kind: 'select_source_b', resolvedAt: NOW },
    });
    const updated = next.profile.experience.find((e) => e.id === 'exp_acme_senior');
    expect(updated?.startDate).toBe('2021-06');
    expect(next.pendingRevisions).toHaveLength(1);
    expect(next.pendingRevisions[0]?.source).toBe('conflict_resolution');
  });

  it('throws on unknown conflict type prefix', () => {
    const profile = makeProfile();
    const conflict = makeConflict({ conflictType: 'unknown_entity.start_date' });
    const state = emptyDraftState(profile);
    expect(() =>
      reduce(state, {
        kind: 'resolve_conflict',
        conflictId: 1,
        conflict,
        entityId: 'exp_acme_senior',
        choice: { kind: 'select_source_a', resolvedAt: NOW },
      }),
    ).toThrow(InvalidProfileStateError);
  });
});

describe('reduce: set_override + clear_override', () => {
  it('set_override updates the derived entry and records an override revision', () => {
    const profile = makeProfile();
    const state = emptyDraftState(profile);
    const next = reduce(state, {
      kind: 'set_override',
      field: 'likelySeniority',
      value: 'staff',
      now: NOW,
    });
    expect(next.profile.derived.likelySeniority.overrideActive).toBe(true);
    expect(next.profile.derived.likelySeniority.effectiveValue).toBe('staff');
    expect(next.pendingOverrides).toHaveLength(1);
    expect(next.pendingRevisions[0]?.source).toBe('override');
  });

  it('clear_override resets the derived entry to the generated value', () => {
    const profile = makeProfile();
    const state = emptyDraftState(profile, [
      makeOverride('likelySeniority', true, 'staff', 'senior'),
    ]);
    expect(state.profile.derived.likelySeniority.effectiveValue).toBe('staff');
    const next = reduce(state, {
      kind: 'clear_override',
      field: 'likelySeniority',
      now: NOW,
    });
    expect(next.profile.derived.likelySeniority.overrideActive).toBe(false);
    expect(next.profile.derived.likelySeniority.effectiveValue).toBe('senior');
    expect(next.pendingOverrides[0]?.overrideActive).toBe(false);
  });
});

describe('reduce: discard + back', () => {
  it('discard clears pendingRevisions but keeps the profile mutations', () => {
    const profile = makeProfile();
    const state = emptyDraftState(profile);
    const afterEdit: DraftState = reduce(state, {
      kind: 'edit_scalar',
      section: 'basics',
      field: 'headline',
      value: 'Staff Engineer',
    });
    expect(afterEdit.pendingRevisions).toHaveLength(1);
    const next = reduce(afterEdit, { kind: 'discard' });
    expect(next.pendingRevisions).toEqual([]);
    // The mutated profile is preserved; the editor session consumes the revisions.
    expect(next.profile.basics.headline).toBe('Staff Engineer');
  });

  it('back pops the sectionHistory', () => {
    const profile = makeProfile();
    const state = emptyDraftState(profile);
    const s1 = reduce(state, { kind: 'select_section', section: 'basics' });
    const s2 = reduce(s1, { kind: 'select_section', section: 'skills' });
    const popped = reduce(s2, { kind: 'back' });
    expect(popped.sectionHistory).toEqual(['basics']);
  });

  it('back on an empty history is a no-op', () => {
    const profile = makeProfile();
    const state = emptyDraftState(profile);
    const next = reduce(state, { kind: 'back' });
    expect(next).toBe(state);
  });
});

describe('reduce: derived overrides are reflected in applyOverrides', () => {
  it('after set_override the effectiveValue matches overrideValue', () => {
    const profile = makeProfile();
    const state = emptyDraftState(profile);
    const next = reduce(state, {
      kind: 'set_override',
      field: 'primaryRoles',
      value: ['staff engineer'],
      now: NOW,
    });
    expect(next.profile.derived.primaryRoles.effectiveValue).toEqual(['staff engineer']);
    expect(next.profile.derived.primaryRoles.generatedValue).toEqual(['backend engineer']);
  });

  it('after clear_override the effectiveValue reverts to the generatedValue', () => {
    const profile = makeProfile();
    const state = emptyDraftState(profile);
    const set = reduce(state, {
      kind: 'set_override',
      field: 'primaryRoles',
      value: ['staff engineer'],
      now: NOW,
    });
    const cleared = reduce(set, {
      kind: 'clear_override',
      field: 'primaryRoles',
      now: NOW,
    });
    expect(cleared.profile.derived.primaryRoles.effectiveValue).toEqual(['backend engineer']);
    expect(cleared.profile.derived.primaryRoles.overrideActive).toBe(false);
  });
});

describe('reduce: multi-operation fold', () => {
  it('accumulates pendingRevisions across a sequence of operations', () => {
    const profile = makeProfile();
    const state = emptyDraftState(profile);
    const ops: readonly EditorOperation[] = [
      { kind: 'edit_scalar', section: 'basics', field: 'headline', value: 'A' },
      {
        kind: 'edit_collection',
        section: 'experience',
        operation: {
          kind: 'edit',
          entityId: 'exp_acme_senior',
          patch: { title: 'B' },
        },
      },
      { kind: 'select_section', section: 'review' },
    ];
    let s = state;
    for (const op of ops) s = reduce(s, op);
    expect(s.pendingRevisions).toHaveLength(2);
    expect(s.sectionHistory).toContain('review');
  });
});
