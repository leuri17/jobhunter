import { z } from 'zod';

import {
  LanguageLevelSchema,
  SkillCategorySchema,
  SkillEvidenceSchema,
  SkillProficiencySchema,
  SourceReferenceSchema,
  YearMonthSchema,
} from '../schema.js';

/**
 * Versioned OpenAI structured-output schema for profile extraction (SPEC.md §14.2).
 *
 * This shape omits every server-generated field of the canonical profile
 * (`id`, `createdAt`, `updatedAt`, `contentHash`, `derived`, `normalizedName`).
 * Missing scalars are `null`; missing collections are empty arrays.
 */

export const STRUCTURED_OUTPUT_SCHEMA_VERSION = 1;

export const ExtractedBasicsSchema = z
  .object({
    headline: z.string().nullable(),
    professionalSummary: z.string().nullable(),
    currentLocation: z.string().nullable(),
    totalYearsOfExperience: z.number().nullable(),
  })
  .strict();
export type ExtractedBasics = z.infer<typeof ExtractedBasicsSchema>;

export const ExtractedWorkExperienceSchema = z
  .object({
    company: z.string().min(1),
    title: z.string().min(1),
    location: z.string().nullable(),
    startDate: YearMonthSchema.nullable(),
    endDate: YearMonthSchema.nullable(),
    isCurrent: z.boolean(),
    summary: z.string().nullable(),
    responsibilities: z.array(z.string()),
    achievements: z.array(z.string()),
    technologies: z.array(z.string()),
    domains: z.array(z.string()),
    sourceReferences: z.array(SourceReferenceSchema),
  })
  .strict();
export type ExtractedWorkExperience = z.infer<typeof ExtractedWorkExperienceSchema>;

export const ExtractedSkillSchema = z
  .object({
    name: z.string().min(1),
    /**
     * `category` is supplied by the post-processor (Task 6 defaults to
     * `'other'` when missing). The model can emit `null` explicitly to
     * signal "no category stated" — the system prompt instructs it to
     * do so rather than fabricate a value. Allowed values: any of the
     * `SKILL_CATEGORIES`, `null`, or absent.
     *
     * Schema asymmetry note: OpenAI's strict-mode `json_schema` requires
     * every property to appear in `required`, so the projected JSON
     * Schema in `./prompt.ts` makes `category` **required** and widens
     * its `type` to `['string', 'null']`. Zod keeps `.nullable().optional()`
     * here as defence in depth so a downstream caller parsing raw output
     * with this canonical schema is not surprised by the strict-mode
     * mechanics. See `applyStrictModeAdjustments` in `./prompt.ts`.
     */
    category: SkillCategorySchema.nullable().optional(),
    proficiency: SkillProficiencySchema.nullable(),
    yearsOfExperience: z.number().nullable(),
    lastUsedAt: YearMonthSchema.nullable(),
    evidence: z.array(SkillEvidenceSchema),
  })
  .strict();
export type ExtractedSkill = z.infer<typeof ExtractedSkillSchema>;

export const ExtractedLanguageSchema = z
  .object({
    name: z.string().min(1),
    /**
     * `level` is supplied by the post-processor (Task 6 defaults to
     * `null` when missing). The model can emit `null` explicitly. See
     * `ExtractedSkillSchema.category` for the rationale; the same strict-
     * mode projection in `./prompt.ts` flips this field to **required**
     * with a `null`-widened type.
     */
    level: LanguageLevelSchema.nullable().optional(),
    sourceReferences: z.array(SourceReferenceSchema),
  })
  .strict();
export type ExtractedLanguage = z.infer<typeof ExtractedLanguageSchema>;

export const ExtractedEducationSchema = z
  .object({
    institution: z.string().min(1),
    qualification: z.string().nullable(),
    fieldOfStudy: z.string().nullable(),
    startDate: YearMonthSchema.nullable(),
    endDate: YearMonthSchema.nullable(),
    location: z.string().nullable(),
    sourceReferences: z.array(SourceReferenceSchema),
  })
  .strict();
export type ExtractedEducation = z.infer<typeof ExtractedEducationSchema>;

export const ExtractedCertificationSchema = z
  .object({
    name: z.string().min(1),
    issuer: z.string().nullable(),
    issuedAt: YearMonthSchema.nullable(),
    expiresAt: YearMonthSchema.nullable(),
    credentialId: z.string().nullable(),
    credentialUrl: z.string().nullable(),
    sourceReferences: z.array(SourceReferenceSchema),
  })
  .strict();
export type ExtractedCertification = z.infer<typeof ExtractedCertificationSchema>;

export const ExtractedProjectSchema = z
  .object({
    name: z.string().min(1),
    description: z.string().nullable(),
    role: z.string().nullable(),
    startDate: YearMonthSchema.nullable(),
    endDate: YearMonthSchema.nullable(),
    technologies: z.array(z.string()),
    achievements: z.array(z.string()),
    url: z.string().nullable(),
    sourceReferences: z.array(SourceReferenceSchema),
  })
  .strict();
export type ExtractedProject = z.infer<typeof ExtractedProjectSchema>;

export const ExtractedProfileSchema = z
  .object({
    basics: ExtractedBasicsSchema,
    experience: z.array(ExtractedWorkExperienceSchema),
    skills: z.array(ExtractedSkillSchema),
    languages: z.array(ExtractedLanguageSchema),
    education: z.array(ExtractedEducationSchema),
    certifications: z.array(ExtractedCertificationSchema),
    projects: z.array(ExtractedProjectSchema),
    warnings: z.array(z.string()),
  })
  .strict();
export type ExtractedProfile = z.infer<typeof ExtractedProfileSchema>;

function collectSourceReferencePaths(profile: ExtractedProfile): {
  path: (string | number)[];
  sourceId: string;
}[] {
  const collected: { path: (string | number)[]; sourceId: string }[] = [];
  const collections: [keyof ExtractedProfile, { sourceReferences: { sourceId: string }[] }[]][] = [
    ['experience', profile.experience],
    ['languages', profile.languages],
    ['education', profile.education],
    ['certifications', profile.certifications],
    ['projects', profile.projects],
  ];

  for (const [key, entries] of collections) {
    entries.forEach((entry, entryIndex) => {
      entry.sourceReferences.forEach((reference, referenceIndex) => {
        collected.push({
          path: [key, entryIndex, 'sourceReferences', referenceIndex, 'sourceId'],
          sourceId: reference.sourceId,
        });
      });
    });
  }

  return collected;
}

/**
 * Builds an extracted-profile schema that also verifies every
 * `SourceReference.sourceId` refers to a source supplied in the request.
 */
export function createExtractedProfileSchema(knownSourceIds: readonly string[]) {
  const known = new Set(knownSourceIds);
  return ExtractedProfileSchema.superRefine((profile, ctx) => {
    for (const { path, sourceId } of collectSourceReferencePaths(profile)) {
      if (!known.has(sourceId)) {
        ctx.addIssue({
          code: 'custom',
          path,
          message: `Unknown sourceId "${sourceId}". Expected one of: ${knownSourceIds.join(', ')}.`,
        });
      }
    }
  });
}
