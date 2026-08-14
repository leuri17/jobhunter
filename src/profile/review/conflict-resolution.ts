/**
 * Pure conflict resolution helpers (TASK-009, SPEC §15.2 + §15.3).
 *
 * `resolveConflictOnProfile` applies a single resolution choice to a
 * `ProfessionalProfile` and returns a NEW profile. The original claims
 * (valueSourceA / valueSourceB) are NOT mutated — they live on the
 * `ProfileConflictRow`. Only the affected field on the profile is updated.
 *
 * Conflict rows do not carry an entity id at the persistence layer (the
 * schema's `affectedField` is just the field name, e.g. `startDate`).
 * Resolution therefore requires the editor to pass the affected entity
 * id explicitly via the `entityId` parameter.
 *
 * Conflict types covered (TASK-008 post-processor prefixes):
 *
 *   - work_experience.*     → profile.experience[i]
 *   - language.*            → profile.languages[i]
 *   - education.*           → profile.education[i]
 *   - certification.*       → profile.certifications[i]
 *   - project.*             → profile.projects[i]
 *
 * Conflict types outside this set throw `InvalidProfileStateError` —
 * they should never reach the editor.
 *
 * The helper is pure domain code: no persistence, no prompts, no IO.
 */

import type { ProfileConflictRow } from '../../persistence/repositories/profile-versions.js';
import type {
  ProfessionalProfile,
  WorkExperience,
  Language,
  Education,
  Certification,
  Project,
} from '../schema.js';
import { InvalidProfileStateError } from '../errors.js';

export type ConflictResolutionChoice =
  | { readonly kind: 'select_source_a'; readonly resolvedAt: string }
  | { readonly kind: 'select_source_b'; readonly resolvedAt: string }
  | { readonly kind: 'manual'; readonly value: unknown; readonly resolvedAt: string }
  | { readonly kind: 'clear'; readonly resolvedAt: string };

export type ConflictEntityKind =
  'work_experience' | 'language' | 'education' | 'certification' | 'project';

interface UpdateResult<T> {
  readonly updated: T[];
}

function replaceById<T extends { readonly id: string }>(
  collection: readonly T[],
  id: string,
  updater: (entity: T) => T,
): UpdateResult<T> {
  let found = false;
  const next = collection.map((entity) => {
    if (entity.id !== id) return entity;
    found = true;
    return updater(entity);
  });
  if (!found) {
    throw new InvalidProfileStateError(
      'conflict_entity_not_found',
      `Conflict resolution could not locate entity "${id}" in the profile.`,
      { entityId: id },
    );
  }
  return { updated: next };
}

function selectSourceValue(
  conflict: ProfileConflictRow,
  choice: ConflictResolutionChoice,
): unknown {
  switch (choice.kind) {
    case 'select_source_a':
      return conflict.valueSourceA ?? null;
    case 'select_source_b':
      return conflict.valueSourceB ?? null;
    case 'manual':
      return choice.value;
    case 'clear':
      return null;
  }
}

/**
 * Apply a resolution choice to the profile and return a new profile with
 * the affected entity's `affectedField` set to the chosen value.
 *
 * @param profile        The profile to mutate.
 * @param conflict       The persisted conflict row.
 * @param entityId       The id of the entity inside the profile (e.g.
 *                       `profile.experience[i].id`).
 * @param choice         The resolution decision.
 */
export function resolveConflictOnProfile(
  profile: ProfessionalProfile,
  conflict: ProfileConflictRow,
  entityId: string,
  choice: ConflictResolutionChoice,
): ProfessionalProfile {
  const entityKind = parseConflictTypePrefix(conflict.conflictType);
  const field = conflict.affectedField;
  const resolvedValue = selectSourceValue(conflict, choice);

  switch (entityKind) {
    case 'work_experience': {
      const { updated } = replaceById<WorkExperience>(profile.experience, entityId, (entity) => ({
        ...entity,
        [field]: resolvedValue,
      }));
      return { ...profile, experience: updated };
    }
    case 'language': {
      const { updated } = replaceById<Language>(profile.languages, entityId, (entity) => ({
        ...entity,
        [field]: resolvedValue,
      }));
      return { ...profile, languages: updated };
    }
    case 'education': {
      const { updated } = replaceById<Education>(profile.education, entityId, (entity) => ({
        ...entity,
        [field]: resolvedValue,
      }));
      return { ...profile, education: updated };
    }
    case 'certification': {
      const { updated } = replaceById<Certification>(
        profile.certifications,
        entityId,
        (entity) => ({
          ...entity,
          [field]: resolvedValue,
        }),
      );
      return { ...profile, certifications: updated };
    }
    case 'project': {
      const { updated } = replaceById<Project>(profile.projects, entityId, (entity) => ({
        ...entity,
        [field]: resolvedValue,
      }));
      return { ...profile, projects: updated };
    }
  }
}

function parseConflictTypePrefix(conflictType: string): ConflictEntityKind {
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
  throw new InvalidProfileStateError(
    'unknown_conflict_type',
    `Conflict type "${conflictType}" does not map to a known entity prefix.`,
    { conflictType },
  );
}
