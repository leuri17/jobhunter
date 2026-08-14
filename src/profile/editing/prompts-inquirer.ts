/**
 * Default `ProfileEditorPrompts` adapter for the Inquirer CLI (TASK-009,
 * SPEC §16.6 + §16.7).
 *
 * This module is the only file in the JobHunter codebase allowed to import
 * `@inquirer/prompts`. Every other module talks to the editor through
 * the `ProfileEditorPrompts` interface defined in `./prompts.ts`.
 *
 * The adapter:
 *
 *   - selectSection       → @inquirer/select with the SPEC §16.6 menu
 *   - editScalar          → @inquirer/input with current value as default
 *                           + a literal `(clear)` sentinel for nullable
 *                           fields
 *   - editCollection      → @inquirer/select sub-menu (list / view / add /
 *                           edit / delete / reorder / back)
 *   - resolveConflict     → @inquirer/select between source A, source B,
 *                           manual entry, clear
 *   - manageOverrides     → @inquirer/select between set, change, clear,
 *                           keep per derived field
 *   - showReview          → prints the rendered review and waits for
 *                           the user to press Enter
 *   - confirmSave         → @inquirer/confirm
 *   - confirmDiscard      → @inquirer/confirm
 *
 * Pure helper code lives in `state-machine.ts` and `validation.ts`. This
 * file is intentionally thin: it converts user input into the structured
 * results the reducer / service understand.
 */

import { confirm, input, select } from '@inquirer/prompts';

import {
  LANGUAGE_LEVELS,
  SENIORITY_LEVELS,
  SKILL_CATEGORIES,
  type LanguageLevel,
  type ProfessionalProfile,
  type SeniorityLevel,
  type SkillCategory,
} from '../schema.js';
import { renderReviewSummary } from '../review/review-summary.js';
import { type ConflictResolutionChoice } from '../review/conflict-resolution.js';
import type {
  CollectionEditPrompt,
  CollectionEditResult,
  ConflictResolutionPrompt,
  DiscardConfirmation,
  DiscardPrompt,
  OverridePrompt,
  OverridePromptResult,
  ProfileEditorPrompts,
  ReviewPrompt,
  ReviewPromptResult,
  SaveConfirmation,
  SavePrompt,
  ScalarEditPrompt,
  ScalarEditResult,
} from './prompts.js';
import type { DerivedFieldKey, SectionKey } from './state-machine.js';

const CLEAR_SENTINEL = '(clear)';

interface DerivedFieldMeta {
  readonly key: DerivedFieldKey;
  readonly label: string;
  readonly description: string;
}

const DERIVED_FIELDS: readonly DerivedFieldMeta[] = [
  {
    key: 'likelySeniority',
    label: 'Likely seniority',
    description: 'Override the inferred seniority level.',
  },
  {
    key: 'primaryRoles',
    label: 'Primary roles',
    description: 'Override the inferred primary roles.',
  },
  {
    key: 'primaryDomains',
    label: 'Primary domains',
    description: 'Override the inferred primary domains.',
  },
  {
    key: 'strongestSkills',
    label: 'Strongest skills',
    description: 'Override the inferred strongest skills.',
  },
];

/** Labels for the top-level section menu (SPEC §16.6). */
const SECTION_LABELS: Readonly<Record<SectionKey, string>> = {
  basics: 'Basic information',
  experience: 'Work experience',
  skills: 'Skills',
  languages: 'Languages',
  education: 'Education',
  certifications: 'Certifications',
  projects: 'Projects',
  derived: 'Derived profile information',
  warnings: 'Extraction warnings',
  review: 'Review changes',
  save: 'Save draft',
  discard: 'Discard changes',
  exit: 'Exit',
};

const SCALAR_SECTIONS = new Set<SectionKey>(['basics', 'derived']);
const COLLECTION_SECTIONS = new Set<SectionKey>([
  'experience',
  'skills',
  'languages',
  'education',
  'certifications',
  'projects',
]);

function sectionKindLabel(section: SectionKey): 'scalar' | 'collection' | 'meta' {
  if (SCALAR_SECTIONS.has(section)) return 'scalar';
  if (COLLECTION_SECTIONS.has(section)) return 'collection';
  return 'meta';
}

/** Decide whether a `(section, field)` scalar field accepts null. */
function isNullableField(section: ScalarEditPrompt['section'], field: string): boolean {
  if (section === 'basics') {
    return field === 'headline' || field === 'professionalSummary' || field === 'currentLocation';
  }
  // 'derived' — array and seniority fields accept null intentionally.
  return true;
}

async function promptForDerivedValue(field: DerivedFieldKey, current: unknown): Promise<unknown> {
  if (field === 'likelySeniority') {
    const choices: { name: string; value: SeniorityLevel | '(clear)' }[] = SENIORITY_LEVELS.map(
      (lvl) => ({ name: lvl, value: lvl }),
    );
    choices.push({ name: '(clear — set to null)', value: '(clear)' });
    const def =
      typeof current === 'string' && SENIORITY_LEVELS.includes(current as SeniorityLevel)
        ? (current as SeniorityLevel)
        : undefined;
    const picked = await select<SeniorityLevel | '(clear)'>({
      message: 'Set seniority to:',
      choices,
      default: def,
    });
    return picked === '(clear)' ? null : picked;
  }
  // Array field.
  const currentList = Array.isArray(current) ? (current as readonly string[]).join(', ') : '';
  const raw = await input({
    message: `${field} (comma-separated, or "${CLEAR_SENTINEL}" to set empty):`,
    default: currentList,
  });
  if (raw.trim() === CLEAR_SENTINEL) return [];
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

export class InquirerProfileEditorPrompts implements ProfileEditorPrompts {
  async selectSection(currentSection: SectionKey | null): Promise<SectionKey> {
    const keys = Object.keys(SECTION_LABELS) as SectionKey[];
    const choices = keys.map<{ name: string; value: SectionKey; disabled?: string }>((key) => ({
      name: SECTION_LABELS[key],
      value: key,
      ...(key === currentSection ? { disabled: 'Already here' as const } : {}),
    }));
    return select<SectionKey>({
      message: 'Select a section:',
      choices,
      pageSize: choices.length,
    });
  }

  async editScalar(input_: ScalarEditPrompt): Promise<ScalarEditResult> {
    const { section, field, currentValue } = input_;
    const nullable = isNullableField(section, field);
    const defaultValue =
      currentValue === null || currentValue === undefined
        ? ''
        : typeof currentValue === 'string'
          ? currentValue
          : String(currentValue);
    const prompt = nullable
      ? `${section}.${field} (Enter to keep, "${CLEAR_SENTINEL}" to clear):`
      : `${section}.${field} (Enter to keep):`;
    const raw = await input({
      message: prompt,
      default: defaultValue,
    });
    const trimmed = raw.trim();
    if (trimmed === defaultValue.trim()) {
      return { kind: 'keep' };
    }
    if (nullable && trimmed === CLEAR_SENTINEL) {
      return { kind: 'cleared' };
    }
    // Coerce booleans / numbers back to their typed shape.
    if (typeof currentValue === 'number') {
      const parsed = Number(trimmed);
      if (Number.isFinite(parsed)) return { kind: 'set', value: parsed };
      return { kind: 'cancelled' };
    }
    if (typeof currentValue === 'boolean') {
      if (trimmed === 'true') return { kind: 'set', value: true };
      if (trimmed === 'false') return { kind: 'set', value: false };
      return { kind: 'cancelled' };
    }
    if (Array.isArray(currentValue)) {
      const items = trimmed
        .split(',')
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
      return { kind: 'set', value: items };
    }
    return { kind: 'set', value: trimmed };
  }

  async editCollection(input_: CollectionEditPrompt): Promise<CollectionEditResult> {
    const { section, entries, supportsReorder } = input_;
    const listChoice: CollectionEditResult = { kind: 'list' };
    const addChoice: CollectionEditResult = { kind: 'add' };
    const reorderChoice: CollectionEditResult = { kind: 'reorder' };
    const backChoice: CollectionEditResult = { kind: 'back' };
    const choices: { name: string; value: CollectionEditResult }[] = [
      { name: 'List entries', value: listChoice },
      ...entries.map<{ name: string; value: CollectionEditResult }>((e) => ({
        name: `View ${e.summary} (${e.id})`,
        value: { kind: 'view', entityId: e.id },
      })),
      { name: 'Add new entry', value: addChoice },
      ...entries.map<{ name: string; value: CollectionEditResult }>((e) => ({
        name: `Edit ${e.summary} (${e.id})`,
        value: { kind: 'edit', entityId: e.id },
      })),
      ...entries.map<{ name: string; value: CollectionEditResult }>((e) => ({
        name: `Delete ${e.summary} (${e.id})`,
        value: { kind: 'delete', entityId: e.id },
      })),
    ];
    if (supportsReorder) {
      choices.push({ name: 'Reorder entries', value: reorderChoice });
    }
    choices.push({ name: 'Back to section menu', value: backChoice });
    const picked = await select<CollectionEditResult>({
      message: `Collection action for "${section}":`,
      choices,
      pageSize: choices.length,
    });
    if (picked.kind === 'delete') {
      const ok = await confirm({
        message: `Confirm delete ${picked.entityId} from ${section}?`,
        default: false,
      });
      if (!ok) {
        return backChoice;
      }
    }
    return picked;
  }

  async resolveConflict(input_: ConflictResolutionPrompt): Promise<ConflictResolutionChoice> {
    const { conflict, provisionalValue } = input_;
    const sourceA = conflict.valueSourceA;
    const sourceB = conflict.valueSourceB;
    const choice = await select<'source_a' | 'source_b' | 'manual' | 'clear'>({
      message: `Conflict on ${conflict.affectedField}: choose a resolution`,
      choices: [
        { name: `Use source A (${JSON.stringify(sourceA)})`, value: 'source_a' },
        { name: `Use source B (${JSON.stringify(sourceB)})`, value: 'source_b' },
        {
          name: `Enter another value (provisional: ${JSON.stringify(provisionalValue)})`,
          value: 'manual',
        },
        { name: 'Clear the field', value: 'clear' },
      ],
    });
    const resolvedAt = new Date().toISOString();
    if (choice === 'source_a') return { kind: 'select_source_a', resolvedAt };
    if (choice === 'source_b') return { kind: 'select_source_b', resolvedAt };
    if (choice === 'clear') return { kind: 'clear', resolvedAt };
    const manual = await input({
      message: `Manual value for ${conflict.affectedField}:`,
      default:
        provisionalValue === null || provisionalValue === undefined
          ? ''
          : typeof provisionalValue === 'string'
            ? provisionalValue
            : JSON.stringify(provisionalValue),
    });
    return { kind: 'manual', value: manual, resolvedAt };
  }

  async manageOverrides(input_: OverridePrompt): Promise<OverridePromptResult> {
    const { field, generatedValue, currentEffective, overrideActive } = input_;
    const action = await select<'set' | 'change' | 'clear' | 'keep'>({
      message: `Override for ${field} (generated: ${JSON.stringify(generatedValue)}, current effective: ${JSON.stringify(currentEffective)}, overrideActive: ${overrideActive})`,
      choices: [
        { name: 'Set override', value: 'set' },
        { name: 'Change override', value: 'change' },
        { name: 'Clear override', value: 'clear' },
        { name: 'Keep current', value: 'keep' },
      ],
    });
    if (action === 'clear') return { kind: 'clear', field };
    if (action === 'keep') return { kind: 'keep' };
    const value = await promptForDerivedValue(field, currentEffective);
    return { kind: action, field, value };
  }

  async showReview(input_: ReviewPrompt): Promise<ReviewPromptResult> {
    console.error(input_.rendered);
    await input({ message: 'Press Enter to continue.' });
    return { kind: 'continue' };
  }

  async confirmSave(input_: SavePrompt): Promise<SaveConfirmation> {
    const ok = await confirm({
      message: `Save draft with ${input_.state.pendingRevisions.length} pending changes${input_.remainingWarnings > 0 ? ` and ${input_.remainingWarnings} warning(s)` : ''}?`,
      default: true,
    });
    return ok ? { kind: 'save' } : { kind: 'cancel' };
  }

  async confirmDiscard(input_: DiscardPrompt): Promise<DiscardConfirmation> {
    const ok = await confirm({
      message: `Discard ${input_.state.pendingRevisions.length} pending change(s)?`,
      default: false,
    });
    return ok ? { kind: 'discard' } : { kind: 'cancel' };
  }
}

/* --------------------------- Internal helpers ---------------------------- */

/** Public helpers used by tests / future CLI hooks. */

/**
 * Render a quick, terminal-friendly summary of a `ProfessionalProfile`.
 * Mirrors `renderReviewSummary` but is intent-specific for the editor's
 * per-section screens.
 */
export function renderEditorPreview(profile: ProfessionalProfile): string {
  return renderReviewSummary({
    profile,
    warnings: [],
    conflicts: [],
    overrides: [],
  });
}

/** Exposed for tests / CLI to render the section menu. */
export function sectionLabels(): Readonly<Record<SectionKey, string>> {
  return SECTION_LABELS;
}

/** Exposed for tests / CLI to render the derived-field metadata. */
export function derivedFields(): readonly DerivedFieldMeta[] {
  return DERIVED_FIELDS;
}

/** Exposed for tests / CLI to render the clear sentinel. */
export function clearSentinel(): string {
  return CLEAR_SENTINEL;
}

/** Light wrapper to enumerate the skill categories for tests / CLI. */
export function skillCategories(): readonly SkillCategory[] {
  return SKILL_CATEGORIES;
}

/** Light wrapper to enumerate the language levels for tests / CLI. */
export function languageLevels(): readonly LanguageLevel[] {
  return LANGUAGE_LEVELS;
}

/** Light wrapper to enumerate the seniority levels for tests / CLI. */
export function seniorityLevels(): readonly SeniorityLevel[] {
  return SENIORITY_LEVELS;
}

/** Re-export the clear sentinel / level arrays as data, not just accessors. */
export {
  CLEAR_SENTINEL as InquirerClearSentinel,
  SENIORITY_LEVELS as InquirerSeniorityLevels,
  LANGUAGE_LEVELS as InquirerLanguageLevels,
  SKILL_CATEGORIES as InquirerSkillCategories,
};

/** Section-key classification helper, exposed for tests. */
export function sectionKind(section: SectionKey): 'scalar' | 'collection' | 'meta' {
  return sectionKindLabel(section);
}

/** Default Inquirer adapter (no constructor args required). */
export const defaultInquirerEditorPrompts: ProfileEditorPrompts =
  new InquirerProfileEditorPrompts();
