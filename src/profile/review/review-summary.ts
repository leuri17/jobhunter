/**
 * Pure review-summary renderer.
 *
 * `renderReviewSummary` formats a `ProfessionalProfile` plus its warnings,
 * conflicts, and overrides into a single human-readable text block. Every
 * documented  section is rendered; null / empty sections render
 * as `(none)` so the review never silently drops a section.
 *
 * The function is pure: it depends only on the schema types and the
 * repository row types. No prompts, no IO, no terminal dependencies.
 *
 * Output layout:
 *
 *   ## Profile <id> (status, active flag)
 *   ## Basics
 *     headline / summary / currentLocation / totalYearsOfExperience
 *   ## Experience (n)
 *     ... per-entry ...
 *   ## Skills (n)
 *   ## Languages (n)
 *   ## Education (n)
 *   ## Certifications (n)
 *   ## Projects (n)
 *   ## Derived values
 *     field | generated | effective
 *   ## Blocking conflicts (n)
 *   ## Warnings (n)
 */

import type {
  DerivedOverrideRow,
  ProfileConflictRow,
  ProfileWarningRow,
} from '../../persistence/repositories/profile-versions.js';
import type {
  Certification,
  Education,
  Language,
  ProfessionalProfile,
  Project,
  Skill,
  WorkExperience,
} from '../schema.js';

export interface ReviewSummaryInputs {
  readonly profile: ProfessionalProfile;
  readonly warnings: readonly ProfileWarningRow[];
  readonly conflicts: readonly ProfileConflictRow[];
  readonly overrides: readonly DerivedOverrideRow[];
}

const NONE = '(none)';

function joinValues(values: readonly string[]): string {
  if (values.length === 0) return NONE;
  return values.join(', ');
}

function formatBasics(profile: ProfessionalProfile): string {
  const lines: string[] = [];
  lines.push(`headline: ${profile.basics.headline ?? NONE}`);
  lines.push(`professionalSummary: ${profile.basics.professionalSummary ?? NONE}`);
  lines.push(`currentLocation: ${profile.basics.currentLocation ?? NONE}`);
  lines.push(
    `totalYearsOfExperience: ${
      profile.basics.totalYearsOfExperience === null
        ? NONE
        : String(profile.basics.totalYearsOfExperience)
    }`,
  );
  return lines.join('\n');
}

function formatExperience(items: readonly WorkExperience[]): string {
  if (items.length === 0) return NONE;
  return items
    .map((e, i) => {
      const dates =
        e.startDate || e.endDate ? `${e.startDate ?? '?'} → ${e.endDate ?? 'present'}` : NONE;
      return `  [${i}] ${e.company} — ${e.title} (${dates})`;
    })
    .join('\n');
}

function formatSkills(items: readonly Skill[]): string {
  if (items.length === 0) return NONE;
  return items.map((s) => `  ${s.name} [${s.category}]`).join('\n');
}

function formatLanguages(items: readonly Language[]): string {
  if (items.length === 0) return NONE;
  return items.map((l) => `  ${l.name}${l.level ? ` (${l.level})` : ''}`).join('\n');
}

function formatEducation(items: readonly Education[]): string {
  if (items.length === 0) return NONE;
  return items.map((e) => `  ${e.institution} — ${e.qualification ?? '?'}`).join('\n');
}

function formatCertifications(items: readonly Certification[]): string {
  if (items.length === 0) return NONE;
  return items.map((c) => `  ${c.name}${c.issuer ? ` (${c.issuer})` : ''}`).join('\n');
}

function formatProjects(items: readonly Project[]): string {
  if (items.length === 0) return NONE;
  return items.map((p) => `  ${p.name}${p.role ? ` — ${p.role}` : ''}`).join('\n');
}

function formatDerived(
  profile: ProfessionalProfile,
  overrides: readonly DerivedOverrideRow[],
): string {
  const overridesByField = new Map(overrides.map((o) => [o.derivedField, o]));
  const fields = ['likelySeniority', 'primaryRoles', 'primaryDomains', 'strongestSkills'] as const;
  const lines: string[] = [];
  for (const field of fields) {
    const entry = profile.derived[field];
    const override = overridesByField.get(field);
    const generated =
      entry.generatedValue === null || entry.generatedValue === undefined
        ? NONE
        : Array.isArray(entry.generatedValue)
          ? joinValues(entry.generatedValue as readonly string[])
          : String(entry.generatedValue);
    const effective =
      entry.effectiveValue === null || entry.effectiveValue === undefined
        ? NONE
        : Array.isArray(entry.effectiveValue)
          ? joinValues(entry.effectiveValue as readonly string[])
          : String(entry.effectiveValue);
    const overrideMarker = override?.overrideActive ? ' (override active)' : '';
    lines.push(`  ${field}: generated=${generated} | effective=${effective}${overrideMarker}`);
  }
  return lines.join('\n');
}

function formatConflicts(
  conflicts: readonly ProfileConflictRow[],
  blockingWarnings: readonly ProfileWarningRow[],
): string {
  const lines: string[] = [];
  for (const c of conflicts) {
    lines.push(
      `  conflict[${c.id}] ${c.conflictType} — ${c.affectedField} (status=${c.resolutionStatus})${
        c.explanation ? `\n      ${c.explanation}` : ''
      }`,
    );
  }
  for (const w of blockingWarnings) {
    lines.push(`  warning[${w.id}] (${w.severity}) ${w.message}`);
  }
  return lines.length === 0 ? NONE : lines.join('\n');
}

function formatWarnings(warnings: readonly ProfileWarningRow[]): string {
  if (warnings.length === 0) return NONE;
  return warnings.map((w) => `  [${w.id}] (${w.severity}) ${w.message}`).join('\n');
}

/**
 * Render a profile and its surrounding state into the  review
 * summary. Pure function of the inputs.
 */
export function renderReviewSummary(inputs: ReviewSummaryInputs): string {
  const { profile, warnings, conflicts, overrides } = inputs;
  const blockingConflicts = conflicts.filter((c) => c.resolutionStatus === 'unresolved');
  const blockingSeverity = warnings.filter((w) => w.severity === 'blocking_conflict');
  const nonBlockingWarnings = warnings.filter((w) => w.severity === 'warning');

  return [
    `# Profile review (${profile.id})`,
    `schemaVersion: ${profile.schemaVersion}`,
    `contentHash: ${profile.contentHash}`,
    `## Basics`,
    formatBasics(profile),
    `## Experience (${profile.experience.length})`,
    formatExperience(profile.experience),
    `## Skills (${profile.skills.length})`,
    formatSkills(profile.skills),
    `## Languages (${profile.languages.length})`,
    formatLanguages(profile.languages),
    `## Education (${profile.education.length})`,
    formatEducation(profile.education),
    `## Certifications (${profile.certifications.length})`,
    formatCertifications(profile.certifications),
    `## Projects (${profile.projects.length})`,
    formatProjects(profile.projects),
    `## Derived values`,
    formatDerived(profile, overrides),
    `## Blocking conflicts (${blockingConflicts.length + blockingSeverity.length})`,
    formatConflicts(blockingConflicts, blockingSeverity),
    `## Warnings (${nonBlockingWarnings.length})`,
    formatWarnings(nonBlockingWarnings),
  ].join('\n\n');
}
