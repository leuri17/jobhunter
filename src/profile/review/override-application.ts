/**
 * Pure derived-value override application (TASK-009, SPEC §16.7).
 *
 * `applyOverrides(profile, overrides)` walks the four derived fields on
 * `ProfessionalProfile.derived` (likelySeniority, primaryRoles,
 * primaryDomains, strongestSkills) and recomputes each `effectiveValue`
 * from the persisted `overrideActive` / `overrideValue` pair.
 *
 * Three override states are explicitly distinguished (SPEC §16.7):
 *
 *   - `overrideActive = false`              → effectiveValue = generatedValue
 *   - `overrideActive = true`, valued       → effectiveValue = overrideValue
 *   - `overrideActive = true`, value = null → effectiveValue = null
 *     (intentional empty / null override)
 *
 * The function never mutates the input profile or its derived entries —
 * it returns a brand-new `ProfessionalProfile` with the same shape, just
 * with `effectiveValue` recomputed for the four derived entries.
 *
 * Internally each derived entry is treated as a generic `{ generatedValue,
 * overrideActive, overrideValue, effectiveValue, generatedAt, overriddenAt }`
 * record so the function can cover all four derived fields uniformly. The
 * output is cast back to `ProfessionalProfile` and the runtime value is
 * validated by `ProfessionalProfileSchema` at the persistence boundary.
 *
 * This module is pure domain code: it depends on `src/profile/schema.js`
 * only, never on the persistence repositories or on the editor state.
 */

import type { DerivedOverrideRow } from '../../persistence/repositories/profile-versions.js';
import type { ProfessionalProfile } from '../schema.js';

export type DerivedFieldKey =
  'likelySeniority' | 'primaryRoles' | 'primaryDomains' | 'strongestSkills';

const DERIVED_FIELD_KEYS: readonly DerivedFieldKey[] = [
  'likelySeniority',
  'primaryRoles',
  'primaryDomains',
  'strongestSkills',
] as const;

interface DerivedEntry {
  readonly generatedValue: unknown;
  readonly overrideActive: boolean;
  readonly overrideValue: unknown;
  readonly effectiveValue: unknown;
  readonly generatedAt: string | null;
  readonly overriddenAt: string | null;
}

function isDerivedFieldKey(value: string): value is DerivedFieldKey {
  return (DERIVED_FIELD_KEYS as readonly string[]).includes(value);
}

function effectiveValueFor(
  entry: DerivedEntry,
  overrideActive: boolean,
  overrideValue: unknown,
): unknown {
  if (!overrideActive) return entry.generatedValue;
  return overrideValue;
}

function applyOverrideToEntry(
  entry: DerivedEntry,
  overrideActive: boolean,
  overrideValue: unknown,
): DerivedEntry {
  return {
    ...entry,
    overrideActive,
    overrideValue,
    effectiveValue: effectiveValueFor(entry, overrideActive, overrideValue),
  };
}

/**
 * Apply the supplied override rows to the profile and return a new profile
 * whose `derived.<field>.effectiveValue` matches the override rules above.
 *
 * Override rows whose `derivedField` is not one of the four documented
 * derived keys are silently ignored — they cannot affect any visible
 * profile state. Override rows for fields not present on the profile
 * (defensive: should never happen, but the schema makes derived required)
 * are also ignored.
 */
export function applyOverrides(
  profile: ProfessionalProfile,
  overrides: readonly DerivedOverrideRow[],
): ProfessionalProfile {
  // Shallow-clone the derived block so the rest of the profile is untouched.
  const derivedRecord: Record<string, DerivedEntry> = {
    likelySeniority: profile.derived.likelySeniority as unknown as DerivedEntry,
    primaryRoles: profile.derived.primaryRoles as unknown as DerivedEntry,
    primaryDomains: profile.derived.primaryDomains as unknown as DerivedEntry,
    strongestSkills: profile.derived.strongestSkills as unknown as DerivedEntry,
  };
  for (const override of overrides) {
    if (!isDerivedFieldKey(override.derivedField)) continue;
    const current = derivedRecord[override.derivedField];
    if (current === undefined) continue;
    derivedRecord[override.derivedField] = applyOverrideToEntry(
      current,
      override.overrideActive,
      override.overrideValue,
    );
  }
  return {
    ...profile,
    derived: {
      likelySeniority: derivedRecord[
        'likelySeniority'
      ] as ProfessionalProfile['derived']['likelySeniority'],
      primaryRoles: derivedRecord['primaryRoles'] as ProfessionalProfile['derived']['primaryRoles'],
      primaryDomains: derivedRecord[
        'primaryDomains'
      ] as ProfessionalProfile['derived']['primaryDomains'],
      strongestSkills: derivedRecord[
        'strongestSkills'
      ] as ProfessionalProfile['derived']['strongestSkills'],
    },
  };
}
