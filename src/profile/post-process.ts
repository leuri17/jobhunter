import { createHash, randomBytes } from 'node:crypto';

import { calculateProfileContentHash } from './content-hash.js';
import { detectProfileConflicts, type DetectedConflict } from './conflicts.js';
import { isValidYearMonth } from './dates.js';
import { normalizeLanguageName, normalizeSkillName } from './name-normalize.js';
import type {
  ExtractedCertification,
  ExtractedEducation,
  ExtractedLanguage,
  ExtractedProfile,
  ExtractedProject,
  ExtractedSkill,
  ExtractedWorkExperience,
} from './openai/structured-output.js';
import {
  PROFILE_SCHEMA_VERSION,
  type Certification,
  type Education,
  type Language,
  type ProfessionalProfile,
  type ProfileDerived,
  type Project,
  type Skill,
  type SkillCategory,
  type WorkExperience,
} from './schema.js';

/**
 * Deterministic post-processor that turns a validated OpenAI
 * `ExtractedProfile` into a canonical `ProfessionalProfile`.
 *
 * Pure domain module: depends only on `zod`, `node:crypto`, and the helper
 * modules in `src/profile/` (no Commander, Inquirer, Playwright, Drizzle,
 * the `openai` SDK, or Pino).
 */

// ---------- Inputs / Outputs ----------

export interface PostProcessInputs {
  readonly extracted: ExtractedProfile;
  /** `'source_<int>'` values supplied in the request — used for conflict detection. */
  readonly knownSourceIds: readonly string[];
  /** Injected clock so generated timestamps and IDs are deterministic in tests. */
  readonly now: () => Date;
}

export interface PostProcessResult {
  readonly profile: ProfessionalProfile;
  readonly conflicts: readonly DetectedConflict[];
  readonly warnings: readonly string[];
}

// ---------- Internal helpers ----------

function randomId(prefix: string): string {
  return `${prefix}_${randomBytes(4).toString('hex')}`;
}

function deterministicId(prefix: string, normalizedName: string): string {
  const digest = createHash('sha256').update(normalizedName, 'utf8').digest('hex');
  return `${prefix}_${digest.slice(0, 8)}`;
}

function dropEmpty(values: readonly string[]): string[] {
  const out: string[] = [];
  for (const value of values) {
    if (typeof value !== 'string') continue;
    if (value.trim().length === 0) continue;
    out.push(value);
  }
  return out;
}

function nullableText(value: string | null): string | null {
  if (value === null) return null;
  if (value.trim().length === 0) return null;
  return value;
}

// ---------- Experience ----------

function processExperience(
  extracted: ExtractedWorkExperience,
  warnings: string[],
  index: number,
): WorkExperience {
  let startDate: string | null = extracted.startDate;
  let endDate: string | null = extracted.endDate;

  const startInvalid = startDate !== null && !isValidYearMonth(startDate);
  const endInvalid = endDate !== null && !isValidYearMonth(endDate);

  if (startInvalid || endInvalid) {
    // Symmetric cascade per the brief: a YearMonth failure on either side
    // invalidates the entire range — drop both, not just the failing field.
    warnings.push(
      `invalid_experience_date: experience[${index}] dates are invalid (startDate="${startDate ?? ''}", endDate="${endDate ?? ''}"); cleared both to null.`,
    );
    startDate = null;
    endDate = null;
  } else if (startDate !== null && endDate !== null && compareYearMonth(startDate, endDate) > 0) {
    warnings.push(
      `invalid_experience_date: experience[${index}].endDate "${endDate}" is earlier than startDate "${startDate}"; cleared endDate to null.`,
    );
    endDate = null;
  }

  const isCurrent =
    extracted.isCurrent === true ? endDate === null && startDate !== null : extracted.isCurrent;

  return {
    id: randomId('exp'),
    company: extracted.company,
    title: extracted.title,
    location: nullableText(extracted.location),
    startDate,
    endDate,
    isCurrent,
    summary: nullableText(extracted.summary),
    responsibilities: dropEmpty(extracted.responsibilities),
    achievements: dropEmpty(extracted.achievements),
    technologies: dropEmpty(extracted.technologies),
    domains: dropEmpty(extracted.domains),
    sourceReferences: [...extracted.sourceReferences],
  };
}

function compareYearMonth(a: string, b: string): number {
  const aMonth = a.includes('-') ? Number.parseInt(a.slice(a.indexOf('-') + 1), 10) : 0;
  const bMonth = b.includes('-') ? Number.parseInt(b.slice(b.indexOf('-') + 1), 10) : 0;
  const aYear = Number.parseInt(a.slice(0, 4), 10);
  const bYear = Number.parseInt(b.slice(0, 4), 10);
  if (aYear !== bYear) return aYear - bYear;
  return aMonth - bMonth;
}

// ---------- Skills ----------

function processSkill(extracted: ExtractedSkill): Skill {
  const normalized = normalizeSkillName(extracted.name);
  const category: SkillCategory = extracted.category ?? 'other';
  const proficiency = extracted.proficiency;
  const yearsOfExperience = extracted.yearsOfExperience;
  const lastUsedAt = extracted.lastUsedAt;

  return {
    id: deterministicId('skill', normalized.normalizedName),
    name: normalized.name,
    normalizedName: normalized.normalizedName,
    category,
    proficiency,
    yearsOfExperience,
    lastUsedAt,
    evidence: extracted.evidence.map((e) => ({ ...e })),
  };
}

function dedupeSkills(skills: readonly Skill[]): Skill[] {
  const byNormalized = new Map<string, Skill>();
  for (const skill of skills) {
    const existing = byNormalized.get(skill.normalizedName);
    if (existing === undefined) {
      byNormalized.set(skill.normalizedName, skill);
      continue;
    }
    // Merge evidence; first occurrence keeps every other field.
    byNormalized.set(skill.normalizedName, {
      ...existing,
      evidence: [...existing.evidence, ...skill.evidence],
    });
  }
  return [...byNormalized.values()];
}

// ---------- Languages ----------

function processLanguage(extracted: ExtractedLanguage): Language {
  const normalized = normalizeLanguageName(extracted.name);
  return {
    id: deterministicId('lang', normalized.normalizedName),
    name: normalized.name,
    normalizedName: normalized.normalizedName,
    level: extracted.level ?? null,
    sourceReferences: [...extracted.sourceReferences],
  };
}

function dedupeLanguages(languages: readonly Language[]): Language[] {
  const byNormalized = new Map<string, Language>();
  for (const language of languages) {
    const existing = byNormalized.get(language.normalizedName);
    if (existing === undefined) {
      byNormalized.set(language.normalizedName, language);
      continue;
    }
    // We deliberately preserve duplicate sourceReferences verbatim so the
    // audit trail records every place a language was attested, even when
    // the model emits identical references across duplicate language
    // entries. Consumers that need exact-once dedup (e.g. for display)
    // must do it themselves.
    byNormalized.set(language.normalizedName, {
      ...existing,
      sourceReferences: [...existing.sourceReferences, ...language.sourceReferences],
    });
  }
  return [...byNormalized.values()];
}

// ---------- Education ----------

function processEducation(
  extracted: ExtractedEducation,
  warnings: string[],
  index: number,
): Education {
  let startDate: string | null = extracted.startDate;
  let endDate: string | null = extracted.endDate;

  const startInvalid = startDate !== null && !isValidYearMonth(startDate);
  const endInvalid = endDate !== null && !isValidYearMonth(endDate);

  if (startInvalid || endInvalid) {
    warnings.push(
      `invalid_education_date: education[${index}] dates are invalid (startDate="${startDate ?? ''}", endDate="${endDate ?? ''}"); cleared both to null.`,
    );
    startDate = null;
    endDate = null;
  } else if (startDate !== null && endDate !== null && compareYearMonth(startDate, endDate) > 0) {
    warnings.push(
      `invalid_education_date: education[${index}].endDate "${endDate}" is earlier than startDate "${startDate}"; cleared endDate to null.`,
    );
    endDate = null;
  }

  return {
    id: randomId('edu'),
    institution: extracted.institution,
    qualification: nullableText(extracted.qualification),
    fieldOfStudy: nullableText(extracted.fieldOfStudy),
    startDate,
    endDate,
    location: nullableText(extracted.location),
    sourceReferences: [...extracted.sourceReferences],
  };
}

// ---------- Certifications ----------

function processCertification(
  extracted: ExtractedCertification,
  warnings: string[],
  index: number,
): Certification {
  let issuedAt: string | null = extracted.issuedAt;
  let expiresAt: string | null = extracted.expiresAt;

  const issuedInvalid = issuedAt !== null && !isValidYearMonth(issuedAt);
  const expiresInvalid = expiresAt !== null && !isValidYearMonth(expiresAt);

  if (issuedInvalid || expiresInvalid) {
    warnings.push(
      `invalid_certification_date: certification[${index}] dates are invalid (issuedAt="${issuedAt ?? ''}", expiresAt="${expiresAt ?? ''}"); cleared both to null.`,
    );
    issuedAt = null;
    expiresAt = null;
  }

  return {
    id: randomId('cert'),
    name: extracted.name,
    issuer: nullableText(extracted.issuer),
    issuedAt,
    expiresAt,
    credentialId: nullableText(extracted.credentialId),
    credentialUrl: nullableText(extracted.credentialUrl),
    sourceReferences: [...extracted.sourceReferences],
  };
}

// ---------- Projects ----------

function processProject(extracted: ExtractedProject, warnings: string[], index: number): Project {
  let startDate: string | null = extracted.startDate;
  let endDate: string | null = extracted.endDate;

  const startInvalid = startDate !== null && !isValidYearMonth(startDate);
  const endInvalid = endDate !== null && !isValidYearMonth(endDate);

  if (startInvalid || endInvalid) {
    warnings.push(
      `invalid_project_date: project[${index}] dates are invalid (startDate="${startDate ?? ''}", endDate="${endDate ?? ''}"); cleared both to null.`,
    );
    startDate = null;
    endDate = null;
  } else if (startDate !== null && endDate !== null && compareYearMonth(startDate, endDate) > 0) {
    warnings.push(
      `invalid_project_date: project[${index}].endDate "${endDate}" is earlier than startDate "${startDate}"; cleared endDate to null.`,
    );
    endDate = null;
  }

  return {
    id: randomId('proj'),
    name: extracted.name,
    description: nullableText(extracted.description),
    role: nullableText(extracted.role),
    startDate,
    endDate,
    technologies: dropEmpty(extracted.technologies),
    achievements: dropEmpty(extracted.achievements),
    url: nullableText(extracted.url),
    sourceReferences: [...extracted.sourceReferences],
  };
}

// ---------- Derived ----------

function buildDerived(
  experiences: readonly WorkExperience[],
  projects: readonly Project[],
  totalYearsOfExperience: number | null,
  generatedAt: string,
): ProfileDerived {
  return {
    likelySeniority: {
      generatedValue: deriveLikelySeniority(totalYearsOfExperience),
      overrideActive: false,
      overrideValue: null,
      effectiveValue: deriveLikelySeniority(totalYearsOfExperience),
      generatedAt,
      overriddenAt: null,
    },
    primaryRoles: {
      generatedValue: derivePrimaryRoles(experiences),
      overrideActive: false,
      overrideValue: null,
      effectiveValue: derivePrimaryRoles(experiences),
      generatedAt,
      overriddenAt: null,
    },
    primaryDomains: {
      generatedValue: derivePrimaryDomains(experiences),
      overrideActive: false,
      overrideValue: null,
      effectiveValue: derivePrimaryDomains(experiences),
      generatedAt,
      overriddenAt: null,
    },
    strongestSkills: {
      generatedValue: deriveStrongestSkills(experiences, projects),
      overrideActive: false,
      overrideValue: null,
      effectiveValue: deriveStrongestSkills(experiences, projects),
      generatedAt,
      overriddenAt: null,
    },
  };
}

function deriveLikelySeniority(
  years: number | null,
): ProfileDerived['likelySeniority']['generatedValue'] {
  if (years === null) return null;
  if (years >= 10) return 'staff';
  if (years >= 6) return 'senior';
  if (years >= 3) return 'mid';
  return null;
}

function derivePrimaryRoles(experiences: readonly WorkExperience[]): string[] {
  if (experiences.length === 0) return [];
  // Sort by recency: current roles first (by startDate desc), then non-current
  // (by endDate desc). Nulls sort last within each group.
  const sorted = [...experiences].sort((a, b) => {
    if (a.isCurrent !== b.isCurrent) return a.isCurrent ? -1 : 1;
    const aAnchor = a.isCurrent ? a.startDate : (a.endDate ?? a.startDate);
    const bAnchor = b.isCurrent ? b.startDate : (b.endDate ?? b.startDate);
    if (aAnchor === null && bAnchor === null) return 0;
    if (aAnchor === null) return 1;
    if (bAnchor === null) return -1;
    return compareYearMonth(bAnchor, aAnchor);
  });

  const titles: string[] = [];
  for (const experience of sorted) {
    if (titles.length >= 3) break;
    if (!titles.includes(experience.title)) {
      titles.push(experience.title);
    }
  }
  return titles;
}

function derivePrimaryDomains(experiences: readonly WorkExperience[]): string[] {
  const counts = new Map<string, number>();
  const order: string[] = [];
  for (const experience of experiences) {
    for (const domain of experience.domains) {
      if (!counts.has(domain)) {
        order.push(domain);
        counts.set(domain, 0);
      }
      counts.set(domain, (counts.get(domain) ?? 0) + 1);
    }
  }
  return order
    .sort((a, b) => {
      const diff = (counts.get(b) ?? 0) - (counts.get(a) ?? 0);
      return diff !== 0 ? diff : order.indexOf(a) - order.indexOf(b);
    })
    .slice(0, 5);
}

function deriveStrongestSkills(
  experiences: readonly WorkExperience[],
  projects: readonly Project[],
): string[] {
  const counts = new Map<string, number>();
  const order: string[] = [];
  const record = (tech: string): void => {
    if (!counts.has(tech)) {
      order.push(tech);
      counts.set(tech, 0);
    }
    counts.set(tech, (counts.get(tech) ?? 0) + 1);
  };
  for (const experience of experiences) {
    for (const tech of experience.technologies) record(tech);
  }
  for (const project of projects) {
    for (const tech of project.technologies) record(tech);
  }
  return order
    .sort((a, b) => {
      const diff = (counts.get(b) ?? 0) - (counts.get(a) ?? 0);
      return diff !== 0 ? diff : order.indexOf(a) - order.indexOf(b);
    })
    .slice(0, 5);
}

// ---------- Public entrypoint ----------

export function postProcessExtractionResponse(inputs: PostProcessInputs): PostProcessResult {
  const { extracted, knownSourceIds, now } = inputs;
  const generatedAt = now().toISOString();
  const postProcessorWarnings: string[] = [];

  const experience = extracted.experience.map((entry, index) =>
    processExperience(entry, postProcessorWarnings, index),
  );
  const skills = dedupeSkills(extracted.skills.map(processSkill));
  const languages = dedupeLanguages(extracted.languages.map(processLanguage));
  const education = extracted.education.map((entry, index) =>
    processEducation(entry, postProcessorWarnings, index),
  );
  const certifications = extracted.certifications.map((entry, index) =>
    processCertification(entry, postProcessorWarnings, index),
  );
  const projects = extracted.projects.map((entry, index) =>
    processProject(entry, postProcessorWarnings, index),
  );

  const conflicts = detectProfileConflicts(extracted, knownSourceIds);

  const profile: ProfessionalProfile = {
    schemaVersion: PROFILE_SCHEMA_VERSION,
    id: `profile_${randomBytes(8).toString('hex')}`,
    createdAt: generatedAt,
    updatedAt: generatedAt,
    contentHash: '', // placeholder; filled below.
    sourceIds: [...knownSourceIds],
    basics: {
      headline: nullableText(extracted.basics.headline),
      professionalSummary: nullableText(extracted.basics.professionalSummary),
      currentLocation: nullableText(extracted.basics.currentLocation),
      totalYearsOfExperience: extracted.basics.totalYearsOfExperience,
    },
    experience,
    skills,
    languages,
    education,
    certifications,
    projects,
    derived: buildDerived(
      experience,
      projects,
      extracted.basics.totalYearsOfExperience,
      generatedAt,
    ),
  };

  const contentHash = calculateProfileContentHash(profile);
  const profileWithHash: ProfessionalProfile = { ...profile, contentHash };

  const warnings = [...extracted.warnings, ...postProcessorWarnings];

  return {
    profile: profileWithHash,
    conflicts,
    warnings,
  };
}
