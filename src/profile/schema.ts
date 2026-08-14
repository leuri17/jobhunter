import { z } from 'zod';

/**
 * Canonical on-disk professional profile schema (SPEC.md §12.1).
 *
 * This module describes the persisted shape, including server-generated fields
 * (`id`, `createdAt`, `updatedAt`, `contentHash`, `derived`, `normalizedName`).
 * The OpenAI structured-output shape lives in `./openai/structured-output.ts`.
 */

export const PROFILE_SCHEMA_VERSION = 1;

/** "YYYY" or "YYYY-MM". */
export const YearMonthSchema = z
  .string()
  .regex(/^\d{4}(-\d{2})?$/, 'Expected a year "YYYY" or year-month "YYYY-MM" value.')
  .refine((value) => {
    const [, month] = value.split('-');
    if (month === undefined) {
      return true;
    }
    const parsed = Number.parseInt(month, 10);
    return parsed >= 1 && parsed <= 12;
  }, 'Month must be between 01 and 12.');

export const SKILL_CATEGORIES = [
  'programming_language',
  'framework',
  'library',
  'database',
  'cloud',
  'devops',
  'testing',
  'architecture',
  'tool',
  'methodology',
  'domain',
  'soft_skill',
  'other',
] as const;

export const SKILL_PROFICIENCIES = ['beginner', 'intermediate', 'advanced', 'expert'] as const;

export const LANGUAGE_LEVELS = [
  'basic',
  'conversational',
  'professional',
  'fluent',
  'native',
] as const;

export const SENIORITY_LEVELS = [
  'intern',
  'junior',
  'mid',
  'senior',
  'staff',
  'principal',
  'lead',
  'manager',
  'director',
  'executive',
] as const;

export const SKILL_EVIDENCE_SOURCE_TYPES = [
  'experience',
  'project',
  'certification',
  'explicit_cv_section',
] as const;

export const SkillCategorySchema = z.enum(SKILL_CATEGORIES);
export const SkillProficiencySchema = z.enum(SKILL_PROFICIENCIES);
export const LanguageLevelSchema = z.enum(LANGUAGE_LEVELS);
export const SeniorityLevelSchema = z.enum(SENIORITY_LEVELS);
export const SkillEvidenceSourceTypeSchema = z.enum(SKILL_EVIDENCE_SOURCE_TYPES);

export type SkillCategory = z.infer<typeof SkillCategorySchema>;
export type SkillProficiency = z.infer<typeof SkillProficiencySchema>;
export type LanguageLevel = z.infer<typeof LanguageLevelSchema>;
export type SeniorityLevel = z.infer<typeof SeniorityLevelSchema>;
export type SkillEvidenceSourceType = z.infer<typeof SkillEvidenceSourceTypeSchema>;

export const SourceReferenceSchema = z
  .object({
    sourceId: z.string().min(1),
    section: z.string().nullable(),
    excerpt: z.string().nullable(),
  })
  .strict();
export type SourceReference = z.infer<typeof SourceReferenceSchema>;

export const WorkExperienceSchema = z
  .object({
    id: z.string().min(1),
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
export type WorkExperience = z.infer<typeof WorkExperienceSchema>;

export const SkillEvidenceSchema = z
  .object({
    sourceType: SkillEvidenceSourceTypeSchema,
    sourceEntityId: z.string().nullable(),
    description: z.string().nullable(),
  })
  .strict();
export type SkillEvidence = z.infer<typeof SkillEvidenceSchema>;

export const SkillSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    normalizedName: z.string().min(1),
    category: SkillCategorySchema,
    proficiency: SkillProficiencySchema.nullable(),
    yearsOfExperience: z.number().nullable(),
    lastUsedAt: YearMonthSchema.nullable(),
    evidence: z.array(SkillEvidenceSchema),
  })
  .strict();
export type Skill = z.infer<typeof SkillSchema>;

export const LanguageSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    normalizedName: z.string().min(1),
    level: LanguageLevelSchema.nullable(),
    sourceReferences: z.array(SourceReferenceSchema),
  })
  .strict();
export type Language = z.infer<typeof LanguageSchema>;

export const EducationSchema = z
  .object({
    id: z.string().min(1),
    institution: z.string().min(1),
    qualification: z.string().nullable(),
    fieldOfStudy: z.string().nullable(),
    startDate: YearMonthSchema.nullable(),
    endDate: YearMonthSchema.nullable(),
    location: z.string().nullable(),
    sourceReferences: z.array(SourceReferenceSchema),
  })
  .strict();
export type Education = z.infer<typeof EducationSchema>;

export const CertificationSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    issuer: z.string().nullable(),
    issuedAt: YearMonthSchema.nullable(),
    expiresAt: YearMonthSchema.nullable(),
    credentialId: z.string().nullable(),
    credentialUrl: z.string().nullable(),
    sourceReferences: z.array(SourceReferenceSchema),
  })
  .strict();
export type Certification = z.infer<typeof CertificationSchema>;

export const ProjectSchema = z
  .object({
    id: z.string().min(1),
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
export type Project = z.infer<typeof ProjectSchema>;

export function DerivedValueSchema<Value extends z.ZodTypeAny>(value: Value) {
  return z
    .object({
      generatedValue: value,
      overrideActive: z.boolean(),
      overrideValue: value.nullable(),
      effectiveValue: value,
      generatedAt: z.string().nullable(),
      overriddenAt: z.string().nullable(),
    })
    .strict();
}

export const ProfileBasicsSchema = z
  .object({
    headline: z.string().nullable(),
    professionalSummary: z.string().nullable(),
    currentLocation: z.string().nullable(),
    totalYearsOfExperience: z.number().nullable(),
  })
  .strict();
export type ProfileBasics = z.infer<typeof ProfileBasicsSchema>;

export const ProfileDerivedSchema = z
  .object({
    likelySeniority: DerivedValueSchema(SeniorityLevelSchema.nullable()),
    primaryRoles: DerivedValueSchema(z.array(z.string())),
    primaryDomains: DerivedValueSchema(z.array(z.string())),
    strongestSkills: DerivedValueSchema(z.array(z.string())),
  })
  .strict();
export type ProfileDerived = z.infer<typeof ProfileDerivedSchema>;

export const ProfessionalProfileSchema = z
  .object({
    schemaVersion: z.literal(PROFILE_SCHEMA_VERSION),
    id: z.string().min(1),
    createdAt: z.string().min(1),
    updatedAt: z.string().min(1),
    contentHash: z.string().min(1),
    sourceIds: z.array(z.string()),
    basics: ProfileBasicsSchema,
    experience: z.array(WorkExperienceSchema),
    skills: z.array(SkillSchema),
    languages: z.array(LanguageSchema),
    education: z.array(EducationSchema),
    certifications: z.array(CertificationSchema),
    projects: z.array(ProjectSchema),
    derived: ProfileDerivedSchema,
  })
  .strict();
export type ProfessionalProfile = z.infer<typeof ProfessionalProfileSchema>;
