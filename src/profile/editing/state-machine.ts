/**
 * Pure reducer for the profile editor (TASK-009, SPEC §16.6).
 *
 * `reduce(state, op)` is a pure function: it never mutates `state`, never
 * touches the database, and never calls Inquirer / OpenAI / Playwright.
 * The only IO side-effect (writing profile_revisions / derived_overrides)
 * happens in `ProfileEditingService.saveDraft`, which walks the
 * `pendingRevisions` array after the reducer is done.
 *
 * The reducer covers every editor operation the prompts interface can
 * produce:
 *
 *   - select_section  — appends to the navigation history
 *   - edit_scalar     — validates and writes a single field
 *   - edit_collection — list/view/add/edit/delete/reorder on a collection
 *   - resolve_conflict — applies a ConflictResolutionChoice
 *   - set_override    — toggles a derived-field override
 *   - clear_override  — removes a derived-field override
 *   - discard         — returns the original profile (pendingRevisions cleared)
 *   - back            — pops the section history
 *
 * The reducer relies on `src/profile/review/conflict-resolution.js` to
 * mutate conflict rows and on `src/profile/editing/validation.js` to
 * validate scalar input. Validation failures throw a typed error so the
 * caller (the editor session) can surface the issue to the user rather
 * than silently writing a bad value.
 */

import type { ProfileConflictRow } from '../../persistence/repositories/profile-versions.js';
import { InvalidProfileStateError } from '../errors.js';
import {
  resolveConflictOnProfile,
  type ConflictEntityKind,
  type ConflictResolutionChoice,
} from '../review/conflict-resolution.js';
import { applyOverrides, type DerivedFieldKey } from '../review/override-application.js';
import type { DerivedOverrideRow } from '../../persistence/repositories/profile-versions.js';
import {
  ProfessionalProfile,
  Skill,
  WorkExperience,
  Language,
  Education,
  Certification,
  Project,
} from '../schema.js';
import {
  validateScalar,
  type CollectionSection,
  type ScalarSection,
  type ValidationSection,
} from './validation.js';

export type SectionKey =
  | 'basics'
  | 'experience'
  | 'skills'
  | 'languages'
  | 'education'
  | 'certifications'
  | 'projects'
  | 'derived'
  | 'warnings'
  | 'review'
  | 'save'
  | 'discard'
  | 'exit';

export type RevisionSource = 'user' | 'conflict_resolution' | 'override';

export interface PendingRevision {
  readonly fieldPath: string;
  readonly previousValue: unknown;
  readonly newValue: unknown;
  readonly source: RevisionSource;
}

export type { DerivedFieldKey } from '../review/override-application.js';

/**
 * Override state to apply. `active: false` clears the override
 * (effective value falls back to the generated value). `active: true`
 * writes the supplied value into `effectiveValue` and `overrideValue`;
 * a `null` value represents the intentional-empty override (SPEC §16.7).
 */
export type OverrideState =
  { readonly active: false } | { readonly active: true; readonly value: unknown };

export interface DraftState {
  readonly profile: ProfessionalProfile;
  readonly pendingRevisions: readonly PendingRevision[];
  readonly sectionHistory: readonly SectionKey[];
  /**
   * In-memory snapshot of the override rows the editor has touched. The
   * repository's `DerivedOverrideRow` shape is reused so the session can
   * pass the array straight to `ProfileEditingService.saveDraft` and let
   * `upsertOverride` do the actual write.
   */
  readonly pendingOverrides: readonly DerivedOverrideRow[];
}

/**
 * Collection edit operations the editor can perform on a single entity
 * inside one of the six collection sections. `list` and `view` are
 * navigation-only — they never mutate the profile.
 */
export type CollectionEditOperation =
  | { readonly kind: 'list' }
  | { readonly kind: 'view'; readonly entityId: string }
  | { readonly kind: 'add'; readonly entry: CollectionEntry }
  | { readonly kind: 'edit'; readonly entityId: string; readonly patch: CollectionPatch }
  | { readonly kind: 'delete'; readonly entityId: string; readonly confirm: true }
  | { readonly kind: 'reorder'; readonly entityIdA: string; readonly entityIdB: string };

/**
 * The union of every per-collection entity shape the editor can add.
 * The reducer narrows on `section` to write the entry into the right
 * collection.
 */
export type CollectionEntry =
  | (WorkExperience & { readonly id: string })
  | (Skill & { readonly id: string })
  | (Language & { readonly id: string })
  | (Education & { readonly id: string })
  | (Certification & { readonly id: string })
  | (Project & { readonly id: string });

export type CollectionPatch = Readonly<Record<string, unknown>>;

export type EditorOperation =
  | { readonly kind: 'select_section'; readonly section: SectionKey }
  | {
      readonly kind: 'edit_scalar';
      readonly section: ScalarSection;
      readonly field: string;
      readonly value: unknown;
    }
  | {
      readonly kind: 'edit_collection';
      readonly section: CollectionSection;
      readonly operation: CollectionEditOperation;
    }
  | {
      readonly kind: 'resolve_conflict';
      readonly conflictId: number;
      readonly choice: ConflictResolutionChoice;
      readonly entityId: string;
      readonly conflict: ProfileConflictRow;
    }
  | {
      readonly kind: 'set_override';
      readonly field: DerivedFieldKey;
      readonly value: unknown;
      readonly now: string;
    }
  | { readonly kind: 'clear_override'; readonly field: DerivedFieldKey; readonly now: string }
  | { readonly kind: 'discard' }
  | { readonly kind: 'back' };

/** Internal section kind — used by `sectionFromKey` and reducer dispatch. */
export type SectionKind = 'scalar' | 'collection' | 'meta';

export interface SectionHandler {
  readonly kind: SectionKind;
  readonly section: SectionKey;
}

/** Lightweight section→kind routing the reducer relies on. */
export function sectionFromKey(key: SectionKey): SectionHandler {
  switch (key) {
    case 'basics':
    case 'derived':
      return { kind: 'scalar', section: key };
    case 'experience':
    case 'skills':
    case 'languages':
    case 'education':
    case 'certifications':
    case 'projects':
      return { kind: 'collection', section: key };
    case 'warnings':
    case 'review':
    case 'save':
    case 'discard':
    case 'exit':
      return { kind: 'meta', section: key };
  }
}

function getCollection(
  profile: ProfessionalProfile,
  section: CollectionSection,
): readonly { readonly id: string }[] {
  switch (section) {
    case 'experience':
      return profile.experience;
    case 'skills':
      return profile.skills;
    case 'languages':
      return profile.languages;
    case 'education':
      return profile.education;
    case 'certifications':
      return profile.certifications;
    case 'projects':
      return profile.projects;
  }
}

function replaceCollection(
  profile: ProfessionalProfile,
  section: CollectionSection,
  next: readonly { readonly id: string }[],
): ProfessionalProfile {
  switch (section) {
    case 'experience':
      return {
        ...profile,
        experience: next as unknown as ProfessionalProfile['experience'],
      };
    case 'skills':
      return { ...profile, skills: next as unknown as ProfessionalProfile['skills'] };
    case 'languages':
      return {
        ...profile,
        languages: next as unknown as ProfessionalProfile['languages'],
      };
    case 'education':
      return {
        ...profile,
        education: next as unknown as ProfessionalProfile['education'],
      };
    case 'certifications':
      return {
        ...profile,
        certifications: next as unknown as ProfessionalProfile['certifications'],
      };
    case 'projects':
      return { ...profile, projects: next as unknown as ProfessionalProfile['projects'] };
  }
}

function readScalar(profile: ProfessionalProfile, section: ScalarSection, field: string): unknown {
  if (section === 'basics') {
    return (profile.basics as unknown as Record<string, unknown>)[field];
  }
  // 'derived'
  return (profile.derived as unknown as Record<string, unknown>)[field];
}

function writeScalar(
  profile: ProfessionalProfile,
  section: ScalarSection,
  field: string,
  value: unknown,
): ProfessionalProfile {
  if (section === 'basics') {
    return {
      ...profile,
      basics: { ...profile.basics, [field]: value } as ProfessionalProfile['basics'],
    };
  }
  // 'derived'
  return {
    ...profile,
    derived: { ...profile.derived, [field]: value } as ProfessionalProfile['derived'],
  };
}

function getScalarSchemaSection(section: ScalarSection): ValidationSection {
  return section;
}

function selectConflictEntityKind(conflictType: string): ConflictEntityKind | null {
  const prefix = conflictType.split('.')[0];
  if (
    prefix === 'work_experience' ||
    prefix === 'language' ||
    prefix === 'education' ||
    prefix === 'certification' ||
    prefix === 'project'
  ) {
    return prefix;
  }
  return null;
}

/**
 * Initial state: a draft profile with empty navigation history and no
 * pending revisions. The caller (the editing service) supplies the
 * stored profile and (optionally) a snapshot of the existing override
 * rows so `applyOverrides` can be run on every reducer step.
 */
export function emptyDraftState(
  profile: ProfessionalProfile,
  initialOverrides: readonly DerivedOverrideRow[] = [],
): DraftState {
  const startProfile =
    initialOverrides.length === 0 ? profile : applyOverrides(profile, initialOverrides);
  return {
    profile: startProfile,
    pendingRevisions: [],
    sectionHistory: [],
    pendingOverrides: initialOverrides,
  };
}

function appendRevision(state: DraftState, revision: PendingRevision): readonly PendingRevision[] {
  return [...state.pendingRevisions, revision];
}

function appendOverride(state: DraftState, row: DerivedOverrideRow): readonly DerivedOverrideRow[] {
  return [...state.pendingOverrides.filter((r) => r.derivedField !== row.derivedField), row];
}

function applyOverrideStateToProfile(
  profile: ProfessionalProfile,
  field: DerivedFieldKey,
  state: OverrideState,
  now: string,
): { profile: ProfessionalProfile; generatedValue: unknown; generatedAt: string | null } {
  const entry = profile.derived[field];
  const generatedValue = entry.generatedValue;
  const generatedAt = entry.generatedAt;
  const overrideActive = state.active;
  const overrideValue = state.active ? state.value : null;
  const effectiveValue = state.active ? state.value : entry.generatedValue;
  const newEntry = {
    generatedValue,
    overrideActive,
    overrideValue,
    effectiveValue,
    generatedAt,
    overriddenAt: state.active ? now : null,
  };
  const derivedNext = {
    likelySeniority: field === 'likelySeniority' ? newEntry : profile.derived.likelySeniority,
    primaryRoles: field === 'primaryRoles' ? newEntry : profile.derived.primaryRoles,
    primaryDomains: field === 'primaryDomains' ? newEntry : profile.derived.primaryDomains,
    strongestSkills: field === 'strongestSkills' ? newEntry : profile.derived.strongestSkills,
  } as ProfessionalProfile['derived'];
  return {
    profile: { ...profile, derived: derivedNext },
    generatedValue,
    generatedAt,
  };
}

function applyCollectionEdit(
  state: DraftState,
  section: CollectionSection,
  operation: CollectionEditOperation,
): DraftState {
  switch (operation.kind) {
    case 'list':
    case 'view': {
      return {
        ...state,
        sectionHistory: [...state.sectionHistory, section as unknown as SectionKey],
      };
    }
    case 'add': {
      const entry = operation.entry;
      const existing = getCollection(state.profile, section);
      if (existing.some((e) => e.id === entry.id)) {
        throw new InvalidProfileStateError(
          'duplicate_entity_id',
          `Collection "${section}" already contains an entry with id "${entry.id}".`,
          { section, entityId: entry.id },
        );
      }
      const next = [...(existing as readonly { readonly id: string }[]), entry] as readonly {
        readonly id: string;
      }[];
      const profile = replaceCollection(state.profile, section, next as never);
      const previousValue = null;
      const newValue = entry;
      const fieldPath = `${section}.${entry.id}`;
      return {
        ...state,
        profile,
        pendingRevisions: appendRevision(state, {
          fieldPath,
          previousValue,
          newValue,
          source: 'user',
        }),
        sectionHistory: [...state.sectionHistory, section as unknown as SectionKey],
      };
    }
    case 'edit': {
      const { entityId, patch } = operation;
      const existing = getCollection(state.profile, section);
      const found = existing.find((e) => e.id === entityId);
      if (found === undefined) {
        throw new InvalidProfileStateError(
          'entity_not_found',
          `Collection "${section}" has no entry with id "${entityId}".`,
          { section, entityId },
        );
      }
      const updatedEntries: { readonly id: string }[] = [];
      let lastPrevious: unknown = undefined;
      let lastField = '';
      for (const entry of existing) {
        if (entry.id !== entityId) {
          updatedEntries.push(entry);
          continue;
        }
        const base = entry as unknown as Record<string, unknown>;
        const patched: Record<string, unknown> = { ...base };
        for (const [k, v] of Object.entries(patch)) {
          const validated = validateScalar(section, k, v);
          if (!validated.ok) {
            throw new InvalidProfileStateError(
              'invalid_collection_patch',
              `Patch for ${section}.${entityId}.${k} failed validation: ${validated.issues.join('; ')}`,
              { section, entityId, field: k, issues: validated.issues },
            );
          }
          patched[k] = validated.value;
          lastPrevious = base[k] ?? null;
          lastField = k;
        }
        updatedEntries.push(patched as unknown as { readonly id: string });
      }
      const profile = replaceCollection(state.profile, section, updatedEntries as never);
      return {
        ...state,
        profile,
        pendingRevisions: appendRevision(state, {
          fieldPath: `${section}.${entityId}.${lastField}`,
          previousValue: lastPrevious ?? null,
          newValue: (patch as Record<string, unknown>)[lastField] ?? null,
          source: 'user',
        }),
        sectionHistory: [...state.sectionHistory, section as unknown as SectionKey],
      };
    }
    case 'delete': {
      if (!operation.confirm) {
        throw new InvalidProfileStateError(
          'delete_not_confirmed',
          `Delete on collection "${section}" requires confirm: true.`,
          { section, entityId: operation.entityId },
        );
      }
      const existing = getCollection(state.profile, section);
      const target = existing.find((e) => e.id === operation.entityId);
      if (target === undefined) {
        throw new InvalidProfileStateError(
          'entity_not_found',
          `Collection "${section}" has no entry with id "${operation.entityId}".`,
          { section, entityId: operation.entityId },
        );
      }
      const next = existing.filter((e) => e.id !== operation.entityId);
      const profile = replaceCollection(state.profile, section, next as never);
      return {
        ...state,
        profile,
        pendingRevisions: appendRevision(state, {
          fieldPath: `${section}.${operation.entityId}`,
          previousValue: target,
          newValue: null,
          source: 'user',
        }),
        sectionHistory: [...state.sectionHistory, section as unknown as SectionKey],
      };
    }
    case 'reorder': {
      const { entityIdA, entityIdB } = operation;
      const existing = getCollection(state.profile, section);
      const idxA = existing.findIndex((e) => e.id === entityIdA);
      const idxB = existing.findIndex((e) => e.id === entityIdB);
      if (idxA === -1 || idxB === -1) {
        throw new InvalidProfileStateError(
          'entity_not_found',
          `Reorder references unknown id(s) in "${section}".`,
          { section, entityIdA, entityIdB },
        );
      }
      const next = [...existing];
      const a = next[idxA];
      const b = next[idxB];
      if (a === undefined || b === undefined) {
        throw new InvalidProfileStateError(
          'entity_not_found',
          `Reorder could not swap entries in "${section}".`,
          { section, entityIdA, entityIdB },
        );
      }
      next[idxA] = b;
      next[idxB] = a;
      const profile = replaceCollection(state.profile, section, next as never);
      return {
        ...state,
        profile,
        pendingRevisions: appendRevision(state, {
          fieldPath: `${section}.reorder`,
          previousValue: existing.map((e) => e.id),
          newValue: next.map((e) => e.id),
          source: 'user',
        }),
        sectionHistory: [...state.sectionHistory, section as unknown as SectionKey],
      };
    }
  }
}

/**
 * Pure reducer. Always returns a new DraftState. Throws
 * `InvalidProfileStateError` when the operation cannot be applied.
 */
export function reduce(state: DraftState, op: EditorOperation): DraftState {
  switch (op.kind) {
    case 'select_section': {
      return {
        ...state,
        sectionHistory: [...state.sectionHistory, op.section],
      };
    }
    case 'edit_scalar': {
      const validated = validateScalar(getScalarSchemaSection(op.section), op.field, op.value);
      if (!validated.ok) {
        throw new InvalidProfileStateError(
          'invalid_scalar_edit',
          `edit_scalar(${op.section}.${op.field}) failed validation: ${validated.issues.join('; ')}`,
          { section: op.section, field: op.field, issues: validated.issues },
        );
      }
      const previousValue = readScalar(state.profile, op.section, op.field) ?? null;
      const profile = writeScalar(state.profile, op.section, op.field, validated.value);
      return {
        ...state,
        profile,
        pendingRevisions: appendRevision(state, {
          fieldPath: `${op.section}.${op.field}`,
          previousValue,
          newValue: validated.value,
          source: 'user',
        }),
      };
    }
    case 'edit_collection': {
      return applyCollectionEdit(state, op.section, op.operation);
    }
    case 'resolve_conflict': {
      const entityKind = selectConflictEntityKind(op.conflict.conflictType);
      if (entityKind === null) {
        throw new InvalidProfileStateError(
          'unknown_conflict_type',
          `Conflict type "${op.conflict.conflictType}" is not supported by the editor.`,
          { conflictType: op.conflict.conflictType },
        );
      }
      const profile = resolveConflictOnProfile(state.profile, op.conflict, op.entityId, op.choice);
      const previousValue = (op.conflict.provisionalValue as unknown) ?? null;
      const newValue =
        op.choice.kind === 'select_source_a'
          ? (op.conflict.valueSourceA ?? null)
          : op.choice.kind === 'select_source_b'
            ? (op.conflict.valueSourceB ?? null)
            : op.choice.kind === 'manual'
              ? op.choice.value
              : null;
      return {
        ...state,
        profile,
        pendingRevisions: appendRevision(state, {
          fieldPath: `conflict:${op.conflictId}.${op.conflict.affectedField}`,
          previousValue,
          newValue,
          source: 'conflict_resolution',
        }),
      };
    }
    case 'set_override': {
      const result = applyOverrideStateToProfile(
        state.profile,
        op.field,
        { active: true, value: op.value },
        op.now,
      );
      const entryBefore = state.profile.derived[op.field];
      const previousValue = entryBefore.effectiveValue;
      const newRow: DerivedOverrideRow = {
        id: 0,
        profileVersionId: 0,
        derivedField: op.field,
        overrideActive: true,
        overrideValue: op.value,
        generatedValue: result.generatedValue,
        generatedAt: result.generatedAt,
        overriddenAt: op.now,
      };
      return {
        profile: result.profile,
        pendingRevisions: appendRevision(state, {
          fieldPath: `derived.${op.field}.override`,
          previousValue,
          newValue: op.value,
          source: 'override',
        }),
        pendingOverrides: appendOverride(state, newRow),
        sectionHistory: state.sectionHistory,
      };
    }
    case 'clear_override': {
      const entryBefore = state.profile.derived[op.field];
      const result = applyOverrideStateToProfile(
        state.profile,
        op.field,
        { active: false },
        op.now,
      );
      const newRow: DerivedOverrideRow = {
        id: 0,
        profileVersionId: 0,
        derivedField: op.field,
        overrideActive: false,
        overrideValue: null,
        generatedValue: result.generatedValue,
        generatedAt: result.generatedAt,
        overriddenAt: null,
      };
      return {
        profile: result.profile,
        pendingRevisions: appendRevision(state, {
          fieldPath: `derived.${op.field}.override`,
          previousValue: entryBefore.effectiveValue,
          newValue: entryBefore.generatedValue,
          source: 'override',
        }),
        pendingOverrides: appendOverride(state, newRow),
        sectionHistory: state.sectionHistory,
      };
    }
    case 'discard': {
      return {
        ...state,
        pendingRevisions: [],
      };
    }
    case 'back': {
      if (state.sectionHistory.length === 0) {
        return state;
      }
      return {
        ...state,
        sectionHistory: state.sectionHistory.slice(0, -1),
      };
    }
  }
}

/**
 * Convenience helper for callers that want to wrap a sequence of
 * operations in a single immutable fold. Equivalent to
 * `ops.reduce(reduce, initial)` but with stronger typing.
 */
export function reduceAll(initial: DraftState, ops: readonly EditorOperation[]): DraftState {
  let state = initial;
  for (const op of ops) {
    state = reduce(state, op);
  }
  return state;
}
