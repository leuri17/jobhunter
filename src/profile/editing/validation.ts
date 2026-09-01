/**
 * Pure field-level validation for the profile editor.
 *
 * `validateScalar` is the only domain validator the editor needs. It maps a
 * (section, field) pair to the right Zod schema from `src/profile/schema.js`
 * (year-month, enum, URL shape, required string, array-of-string) and returns
 * either a normalized value or a list of human-readable issues.
 *
 * The function is pure: no IO, no prompts, no repository access. It is the
 * seam between the Inquirer adapter (which calls it on each input) and the
 * state-machine reducer (which trusts its `ok: true` verdict).
 *
 * Validation must NOT throw — callers branch on `ok`.
 */

import { z } from 'zod';

import {
  LanguageLevelSchema,
  SeniorityLevelSchema,
  SkillCategorySchema,
  YearMonthSchema,
  type ProfessionalProfile,
} from '../schema.js';

export type ScalarSection = 'basics' | 'derived';

export type CollectionSection =
  'experience' | 'skills' | 'languages' | 'education' | 'certifications' | 'projects';

export type ValidationSection = ScalarSection | CollectionSection;

/** URL shape used for `credentialUrl` and project `url` (basic validation). */
const UrlSchema = z
  .string()
  .min(1)
  .refine(
    (value) => {
      try {
        const parsed = new URL(value);
        return parsed.protocol === 'http:' || parsed.protocol === 'https:';
      } catch {
        return false;
      }
    },
    { message: 'Must be a valid http(s) URL.' },
  );

/**
 * A field whose value is a required non-empty string (e.g. `experience.company`).
 * Empty / whitespace input is rejected; `null` is rejected unless the field is
 * declared nullable.
 */
function requiredString(field: string): z.ZodType<string> {
  return z.string().min(1, { message: `${field} must not be empty.` });
}

/**
 * Build a schema that accepts `null` OR a non-empty string. Used for
 * nullable fields per .
 */
function nullableString(field: string) {
  return z.union([
    z.null(),
    z
      .string()
      .min(1, { message: `${field} must not be empty when provided.` })
      .transform((s) => s.trim())
      .pipe(z.string().min(1)),
  ]);
}

interface SafeParseFailure {
  readonly success: false;
  readonly error: {
    readonly issues: readonly { readonly path: readonly PropertyKey[]; readonly message: string }[];
  };
}

function isSafeParseFailure(value: unknown): value is SafeParseFailure {
  return (
    typeof value === 'object' &&
    value !== null &&
    'success' in value &&
    (value as { success: unknown }).success === false
  );
}

function collectIssues(result: unknown): string[] {
  if (!isSafeParseFailure(result)) return [];
  return result.error.issues.map((i) => {
    const path = i.path.length === 0 ? '' : `${i.path.join('.')}: `;
    return `${path}${i.message}`;
  });
}

interface ScalarValidator {
  readonly schema: z.ZodType<unknown>;
}

function basicsSchemaFor(field: string): ScalarValidator | null {
  switch (field) {
    case 'headline':
    case 'professionalSummary':
    case 'currentLocation':
      return { schema: nullableString(field) };
    case 'totalYearsOfExperience':
      return {
        schema: z
          .union([
            z.null(),
            z
              .number({ message: 'totalYearsOfExperience must be a number or null.' })
              .min(0, { message: 'totalYearsOfExperience must be ≥ 0.' })
              .max(80, { message: 'totalYearsOfExperience must be ≤ 80.' }),
          ])
          .refine((value) => value === null || Number.isFinite(value), {
            message: 'totalYearsOfExperience must be finite.',
          }),
      };
    default:
      return null;
  }
}

function derivedSchemaFor(field: string): ScalarValidator | null {
  switch (field) {
    case 'likelySeniority':
      return { schema: SeniorityLevelSchema.nullable() };
    case 'primaryRoles':
    case 'primaryDomains':
    case 'strongestSkills':
      return { schema: z.array(z.string().min(1)) };
    default:
      return null;
  }
}

function experienceSchemaFor(field: string): ScalarValidator | null {
  switch (field) {
    case 'company':
    case 'title':
      return { schema: requiredString(field) };
    case 'location':
    case 'summary':
      return { schema: nullableString(field) };
    case 'startDate':
    case 'endDate':
      return { schema: YearMonthSchema.nullable() };
    case 'isCurrent':
      return { schema: z.boolean() };
    default:
      return null;
  }
}

function skillsSchemaFor(field: string): ScalarValidator | null {
  switch (field) {
    case 'name':
      return { schema: requiredString(field) };
    case 'category':
      return { schema: SkillCategorySchema };
    case 'proficiency':
      return {
        schema: z.union([
          z.null(),
          z.enum(['beginner', 'intermediate', 'advanced', 'expert'] as const),
        ]),
      };
    case 'yearsOfExperience':
      return { schema: z.union([z.null(), z.number().min(0).max(80)]) };
    case 'lastUsedAt':
      return { schema: YearMonthSchema.nullable() };
    default:
      return null;
  }
}

function languagesSchemaFor(field: string): ScalarValidator | null {
  switch (field) {
    case 'name':
      return { schema: requiredString(field) };
    case 'level':
      return { schema: LanguageLevelSchema.nullable() };
    default:
      return null;
  }
}

function educationSchemaFor(field: string): ScalarValidator | null {
  switch (field) {
    case 'institution':
      return { schema: requiredString(field) };
    case 'qualification':
    case 'fieldOfStudy':
    case 'location':
      return { schema: nullableString(field) };
    case 'startDate':
    case 'endDate':
      return { schema: YearMonthSchema.nullable() };
    default:
      return null;
  }
}

function certificationsSchemaFor(field: string): ScalarValidator | null {
  switch (field) {
    case 'name':
      return { schema: requiredString(field) };
    case 'issuer':
    case 'credentialId':
      return { schema: nullableString(field) };
    case 'issuedAt':
    case 'expiresAt':
      return { schema: YearMonthSchema.nullable() };
    case 'credentialUrl':
      return { schema: z.union([z.null(), UrlSchema]) };
    default:
      return null;
  }
}

function projectsSchemaFor(field: string): ScalarValidator | null {
  switch (field) {
    case 'name':
      return { schema: requiredString(field) };
    case 'description':
    case 'role':
      return { schema: nullableString(field) };
    case 'startDate':
    case 'endDate':
      return { schema: YearMonthSchema.nullable() };
    case 'url':
      return { schema: z.union([z.null(), UrlSchema]) };
    default:
      return null;
  }
}

/** Resolve the Zod schema for `(section, field)`. Returns null for unknown pairs. */
function schemaFor(section: ValidationSection, field: string): ScalarValidator | null {
  switch (section) {
    case 'basics':
      return basicsSchemaFor(field);
    case 'derived':
      return derivedSchemaFor(field);
    case 'experience':
      return experienceSchemaFor(field);
    case 'skills':
      return skillsSchemaFor(field);
    case 'languages':
      return languagesSchemaFor(field);
    case 'education':
      return educationSchemaFor(field);
    case 'certifications':
      return certificationsSchemaFor(field);
    case 'projects':
      return projectsSchemaFor(field);
    default:
      return null;
  }
}

/**
 * Look up the editor-side field name for a section. Used by the state
 * machine and by the prompt adapter when they need to resolve a "what
 * field is the user editing?" decision. Returns null when the section
 * is meta (review, save, discard, exit, warnings).
 */
export function getValidatedFieldPath(section: ValidationSection, field: string): string | null {
  return schemaFor(section, field) === null ? null : `${section}.${field}`;
}

/**
 * Validate a scalar value the user wants to write into `(section, field)`.
 *
 * Returns `{ ok: true, value }` where `value` is the parsed / normalized
 * value (e.g. trimmed strings) on success. Returns
 * `{ ok: false, issues }` with a stable, human-readable message list on
 * failure. Unknown `(section, field)` pairs are treated as invalid input
 * with one issue: `"Unknown field <section>.<field>"`.
 */
export type ValidationResult =
  | { readonly ok: true; readonly value: unknown }
  | { readonly ok: false; readonly issues: readonly string[] };

export function validateScalar(
  section: ValidationSection,
  field: string,
  value: unknown,
): ValidationResult {
  const validator = schemaFor(section, field);
  if (validator === null) {
    return { ok: false, issues: [`Unknown field ${section}.${field}.`] };
  }
  const parsed = validator.schema.safeParse(value);
  if (parsed.success) {
    return { ok: true, value: parsed.data };
  }
  return { ok: false, issues: collectIssues(parsed) };
}

/**
 * Validate a derived override candidate. Re-uses the same per-field
 * Zod schemas as `validateScalar('derived', …)` but always requires the
 * value to be `unknown` so callers can pass either a real value or `null`.
 */
export function validateOverrideValue(
  field: 'likelySeniority' | 'primaryRoles' | 'primaryDomains' | 'strongestSkills',
  value: unknown,
): ValidationResult {
  return validateScalar('derived', field, value);
}

/**
 * Helper: validate that a value matches the year-month shape or null.
 * Exposed so the reducer (which trusts editor input for some fast paths)
 * can re-check. The reducer currently does not call this directly — the
 * Inquirer adapter does — but the helper is exported for completeness.
 */
export function isValidYearMonthOrNull(value: unknown): boolean {
  if (value === null) return true;
  const parsed = YearMonthSchema.safeParse(value);
  return parsed.success;
}

/**
 * Re-export the `ProfessionalProfile` type so callers that only import
 * from this module can still reference the profile shape without
 * reaching into `schema.ts` directly.
 */
export type { ProfessionalProfile };
