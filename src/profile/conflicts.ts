import type { SourceReference } from './schema.js';
import type {
  ExtractedCertification,
  ExtractedEducation,
  ExtractedLanguage,
  ExtractedProfile,
  ExtractedProject,
  ExtractedWorkExperience,
} from './openai/structured-output.js';

/**
 * Multi-source conflict detection for extracted profiles (SPEC.md §14.3, §15.1).
 *
 * For each entity group (e.g. work experiences sharing `company + title`),
 * if the group contains references to two or more distinct sources that are
 * part of `knownSourceIds` and a comparable field differs between them, a
 * `DetectedConflict` is emitted. References to sourceIds not in
 * `knownSourceIds` are ignored, which guards against phantom sources the
 * model may have invented. One-source groups never produce conflicts.
 */

export interface DetectedConflict {
  readonly conflictType: string;
  readonly affectedField: string;
  readonly valueSourceA: unknown;
  readonly valueSourceB: unknown;
  readonly sourceReferences: readonly SourceReference[];
  readonly provisionalValue: unknown | null;
  readonly explanation: string;
}

type SourceReferencedEntry = { readonly sourceReferences: readonly SourceReference[] };

function isEmptyValue(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === 'string' && value.length === 0) return true;
  if (Array.isArray(value) && value.length === 0) return true;
  return false;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object') return false;
  if (Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/**
 * Value-equality helper for conflict detection. Recurses into arrays and
 * plain objects (sorted-key iteration). Profile data is JSON-shaped, so
 * reference cycles are not possible in practice; the function does not guard
 * against them.
 */
function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) {
    return false;
  }

  const aIsArray = Array.isArray(a);
  const bIsArray = Array.isArray(b);
  if (aIsArray !== bIsArray) return false;

  if (aIsArray && bIsArray) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (!deepEqual(a[i], b[i])) return false;
    }
    return true;
  }

  if (!isPlainObject(a) || !isPlainObject(b)) return false;

  const keysA = Object.keys(a).sort();
  const keysB = Object.keys(b).sort();
  if (keysA.length !== keysB.length) return false;
  for (let i = 0; i < keysA.length; i++) {
    if (keysA[i] !== keysB[i]) return false;
  }
  for (const key of keysA) {
    if (!deepEqual(a[key], b[key])) return false;
  }
  return true;
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined) return 'null';
  if (typeof value === 'string') return value;
  return JSON.stringify(value);
}

function distinctSourceIds(entries: readonly SourceReferencedEntry[]): string[] {
  const ids = new Set<string>();
  for (const entry of entries) {
    for (const ref of entry.sourceReferences) {
      ids.add(ref.sourceId);
    }
  }
  return [...ids].sort();
}

function findEntryForSource<T extends SourceReferencedEntry>(
  group: readonly T[],
  sourceId: string,
): T | undefined {
  for (const entry of group) {
    for (const ref of entry.sourceReferences) {
      if (ref.sourceId === sourceId) return entry;
    }
  }
  return undefined;
}

function detectGroupConflicts<T extends SourceReferencedEntry>(
  group: readonly T[],
  groupKey: string,
  conflictTypePrefix: string,
  fields: Readonly<Record<string, (entry: T) => unknown>>,
  knownSourceIds: ReadonlySet<string>,
): readonly DetectedConflict[] {
  if (group.length < 2) return [];

  // Drop phantom sourceIds that were not part of the request. The remaining
  // set is the universe of legitimate pair candidates.
  const distinctIds = distinctSourceIds(group).filter((id) => knownSourceIds.has(id));
  if (distinctIds.length < 2) return [];

  const sourceAId = distinctIds[0];
  const sourceBId = distinctIds[1];
  if (sourceAId === undefined || sourceBId === undefined) return [];

  const entryA = findEntryForSource(group, sourceAId);
  const entryB = findEntryForSource(group, sourceBId);
  if (!entryA || !entryB) return [];

  const conflicts: DetectedConflict[] = [];
  for (const [field, extractor] of Object.entries(fields)) {
    const a = extractor(entryA);
    const b = extractor(entryB);
    if (isEmptyValue(a) || isEmptyValue(b)) continue;
    if (deepEqual(a, b)) continue;
    conflicts.push({
      conflictType: `${conflictTypePrefix}.${toSnakeCase(field)}`,
      affectedField: field,
      valueSourceA: a,
      valueSourceB: b,
      sourceReferences: [...entryA.sourceReferences, ...entryB.sourceReferences],
      provisionalValue: a,
      explanation: `Sources disagree on ${field} for ${conflictTypePrefix} "${groupKey}": source "${sourceAId}" reports "${formatValue(a)}", source "${sourceBId}" reports "${formatValue(b)}".`,
    });
  }
  return conflicts;
}

function groupAndDetect<T extends SourceReferencedEntry>(
  entries: readonly T[],
  keyOf: (entry: T) => string,
  conflictTypePrefix: string,
  fields: Readonly<Record<string, (entry: T) => unknown>>,
  knownSourceIds: ReadonlySet<string>,
): readonly DetectedConflict[] {
  const groups = new Map<string, T[]>();
  for (const entry of entries) {
    const key = keyOf(entry);
    const existing = groups.get(key);
    if (existing) {
      existing.push(entry);
    } else {
      groups.set(key, [entry]);
    }
  }
  const conflicts: DetectedConflict[] = [];
  for (const [key, group] of groups) {
    for (const conflict of detectGroupConflicts(
      group,
      key,
      conflictTypePrefix,
      fields,
      knownSourceIds,
    )) {
      conflicts.push(conflict);
    }
  }
  return conflicts;
}

function toSnakeCase(input: string): string {
  return input.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
}

const EXPERIENCE_FIELDS = {
  location: (e: ExtractedWorkExperience) => e.location,
  startDate: (e: ExtractedWorkExperience) => e.startDate,
  endDate: (e: ExtractedWorkExperience) => e.endDate,
  isCurrent: (e: ExtractedWorkExperience) => e.isCurrent,
  summary: (e: ExtractedWorkExperience) => e.summary,
  responsibilities: (e: ExtractedWorkExperience) => e.responsibilities,
  achievements: (e: ExtractedWorkExperience) => e.achievements,
  technologies: (e: ExtractedWorkExperience) => e.technologies,
  domains: (e: ExtractedWorkExperience) => e.domains,
} as const;

// Skills carry `SkillEvidence` (with `sourceEntityId`, not `SourceReference`),
// so source-level conflict detection does not walk them — post-processor merges
// evidence arrays for skills with the same normalized name.

const LANGUAGE_FIELDS = {
  level: (l: ExtractedLanguage) => l.level,
} as const;

const EDUCATION_FIELDS = {
  qualification: (e: ExtractedEducation) => e.qualification,
  fieldOfStudy: (e: ExtractedEducation) => e.fieldOfStudy,
  startDate: (e: ExtractedEducation) => e.startDate,
  endDate: (e: ExtractedEducation) => e.endDate,
  location: (e: ExtractedEducation) => e.location,
} as const;

const CERTIFICATION_FIELDS = {
  issuer: (c: ExtractedCertification) => c.issuer,
  issuedAt: (c: ExtractedCertification) => c.issuedAt,
  expiresAt: (c: ExtractedCertification) => c.expiresAt,
  credentialId: (c: ExtractedCertification) => c.credentialId,
  credentialUrl: (c: ExtractedCertification) => c.credentialUrl,
} as const;

const PROJECT_FIELDS = {
  description: (p: ExtractedProject) => p.description,
  role: (p: ExtractedProject) => p.role,
  startDate: (p: ExtractedProject) => p.startDate,
  endDate: (p: ExtractedProject) => p.endDate,
  technologies: (p: ExtractedProject) => p.technologies,
  achievements: (p: ExtractedProject) => p.achievements,
  url: (p: ExtractedProject) => p.url,
} as const;

export function detectProfileConflicts(
  profile: ExtractedProfile,
  knownSourceIds: readonly string[],
): readonly DetectedConflict[] {
  const known = new Set(knownSourceIds);
  const conflicts: DetectedConflict[] = [];

  for (const c of groupAndDetect(
    profile.experience,
    (e) => `${e.company}::${e.title}`,
    'work_experience',
    EXPERIENCE_FIELDS,
    known,
  )) {
    conflicts.push(c);
  }

  for (const c of groupAndDetect(
    profile.languages,
    (l) => l.name,
    'language',
    LANGUAGE_FIELDS,
    known,
  )) {
    conflicts.push(c);
  }

  for (const c of groupAndDetect(
    profile.education,
    (e) => `${e.institution}::${e.qualification ?? ''}`,
    'education',
    EDUCATION_FIELDS,
    known,
  )) {
    conflicts.push(c);
  }

  for (const c of groupAndDetect(
    profile.certifications,
    (c) => `${c.name}::${c.issuer ?? ''}`,
    'certification',
    CERTIFICATION_FIELDS,
    known,
  )) {
    conflicts.push(c);
  }

  for (const c of groupAndDetect(
    profile.projects,
    (p) => p.name,
    'project',
    PROJECT_FIELDS,
    known,
  )) {
    conflicts.push(c);
  }

  return conflicts;
}
