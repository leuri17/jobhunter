import { z } from 'zod';

import { SeniorityLevelSchema } from '../profile/schema.js';

/**
 * On-disk global filter configuration schema.
 *
 * The schema pins `schemaVersion` to the literal `1` and is `.strict()` per
 * AGENTS.md §6 — unknown fields are rejected at the persisted boundary.
 *
 * `seniority.maximum` is `SeniorityLevel | null` (`null` means "no cap"). The
 * enum itself is re-exported from `src/profile/schema.ts`: we
 * intentionally do NOT define a duplicate enum here.
 */

export { SeniorityLevelSchema } from '../profile/schema.js';

/** Literal version of the on-disk `JobFilterConfig` shape. */
export const FILTER_SCHEMA_VERSION = 1;

export const JobFilterConfigSchema = z
  .object({
    schemaVersion: z.literal(FILTER_SCHEMA_VERSION),
    excludedCompanies: z.array(z.string()),
    title: z
      .object({
        excludedKeywords: z.array(z.string()),
        requiredAnyKeywords: z.array(z.string()),
      })
      .strict(),
    description: z
      .object({
        excludedKeywords: z.array(z.string()),
        requiredAnyKeywords: z.array(z.string()),
      })
      .strict(),
    seniority: z
      .object({
        maximum: SeniorityLevelSchema.nullable(),
      })
      .strict(),
    languages: z
      .object({
        accepted: z.array(z.string()),
        rejectWhenExplicitlyRequiresOtherLanguage: z.boolean(),
      })
      .strict(),
  })
  .strict();

export type JobFilterConfig = z.infer<typeof JobFilterConfigSchema>;

/**
 * The array paths that receive canonical string normalization. Other
 * fields (`seniority.maximum`, `languages.rejectWhenExplicitlyRequiresOtherLanguage`)
 * pass through untouched.
 */
const NORMALIZED_STRING_ARRAYS = [
  'excludedCompanies',
  'title.excludedKeywords',
  'title.requiredAnyKeywords',
  'description.excludedKeywords',
  'description.requiredAnyKeywords',
  'languages.accepted',
] as const;

type StringArrayPath = (typeof NORMALIZED_STRING_ARRAYS)[number];

function normalizeStringArray(values: readonly string[]): string[] {
  const seenKeys = new Set<string>();
  const deduped: string[] = [];
  for (const raw of values) {
    const trimmed = raw.trim();
    const key = trimmed.toLowerCase();
    if (key.length === 0 || seenKeys.has(key)) {
      // Empty-after-trim entries are intentionally dropped; downstream Task 5
      // should not depend on literal empty-string entries.
      // Duplicates (case-insensitive) are folded. The first-seen trimmed value
      // is preserved verbatim.

      continue;
    }
    seenKeys.add(key);
    deduped.push(trimmed);
  }
  // Sort deterministically on the case-folded key. Because the dedupe step
  // already ensured every key is unique, the comparator never hits the tie
  // branch; the `originalIndex` fallback exists only to keep the comparator
  // total and the output stable.
  const indexed = deduped.map((value, originalIndex) => ({
    value,
    key: value.toLowerCase(),
    originalIndex,
  }));
  indexed.sort((a, b) => {
    if (a.key < b.key) return -1;
    if (a.key > b.key) return 1;
    // Identical keys are impossible after dedupe; this branch is a defensive
    // fallback to keep the comparator total.
    return a.originalIndex - b.originalIndex;
  });
  return indexed.map((entry) => entry.value);
}

function setAtPath(
  config: JobFilterConfig,
  path: StringArrayPath,
  values: string[],
): JobFilterConfig {
  switch (path) {
    case 'excludedCompanies':
      return { ...config, excludedCompanies: values };
    case 'title.excludedKeywords':
      return {
        ...config,
        title: { ...config.title, excludedKeywords: values },
      };
    case 'title.requiredAnyKeywords':
      return {
        ...config,
        title: { ...config.title, requiredAnyKeywords: values },
      };
    case 'description.excludedKeywords':
      return {
        ...config,
        description: { ...config.description, excludedKeywords: values },
      };
    case 'description.requiredAnyKeywords':
      return {
        ...config,
        description: { ...config.description, requiredAnyKeywords: values },
      };
    case 'languages.accepted':
      return {
        ...config,
        languages: { ...config.languages, accepted: values },
      };
  }
}

/**
 * Canonical normalization for a parsed `JobFilterConfig`.
 *
 * For each known string array (`excludedCompanies`, every `excludedKeywords`
 * / `requiredAnyKeywords` list, `languages.accepted`) the helper:
 *
 *   1. trims each entry,
 *   2. drops entries that are empty after trimming,
 *   3. dedupes case-insensitively (first-seen trimmed value wins),
 *   4. sorts deterministically by the case-folded key (so test snapshots are
 *      stable across runs and platforms).
 *
 * Non-string-array fields (`seniority.maximum`,
 * `languages.rejectWhenExplicitlyRequiresOtherLanguage`) are returned
 * unchanged.
 *
 * The input is not mutated; a new `JobFilterConfig` object is returned.
 */
export function normalizeJobFilterConfig(input: JobFilterConfig): JobFilterConfig {
  let result = input;
  for (const path of NORMALIZED_STRING_ARRAYS) {
    const current = readStringArray(result, path);
    const normalized = normalizeStringArray(current);
    if (!arraysShallowEqual(current, normalized)) {
      result = setAtPath(result, path, normalized);
    }
  }
  return result;
}

function readStringArray(config: JobFilterConfig, path: StringArrayPath): readonly string[] {
  switch (path) {
    case 'excludedCompanies':
      return config.excludedCompanies;
    case 'title.excludedKeywords':
      return config.title.excludedKeywords;
    case 'title.requiredAnyKeywords':
      return config.title.requiredAnyKeywords;
    case 'description.excludedKeywords':
      return config.description.excludedKeywords;
    case 'description.requiredAnyKeywords':
      return config.description.requiredAnyKeywords;
    case 'languages.accepted':
      // Config normalization intentionally uses generic case-folding; Task 5's
      // matcher applies normalizeLanguageName for language-specific matching.
      return config.languages.accepted;
  }
}

function arraysShallowEqual(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}
