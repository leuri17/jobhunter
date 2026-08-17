import { createHash } from 'node:crypto';

import { type JobFilterConfig, normalizeJobFilterConfig } from './schema.js';

/**
 * Pure deterministic hash helpers used by the filter engine (TASK-010,
 * SPEC §17–§24).
 *
 * Two helpers are exported:
 *
 *   - `calculateJobContentHash` — SHA-256 over the normalized title, company,
 *     location, and description joined by `\n`. The four fields are read in
 *     this fixed order: `title`, `company`, `location`, `description`. The
 *     input object key order does not matter; the function destructures the
 *     values into a fixed 4-tuple before hashing.
 *   - `calculateFilterConfigContentHash` — SHA-256 over the stable-JSON
 *     serialization of the normalized `JobFilterConfig`. Stable JSON means
 *     object keys are sorted alphabetically and no whitespace is emitted, so
 *     two configs that differ only in key order serialize byte-for-byte
 *     identically.
 *
 * Both helpers operate exclusively on data: no IO, no time, no randomness.
 * They are deterministic and pure.
 *
 * The normalization helper `normalizeForHashing` is exported because Task 3
 * (the keyword matcher) reuses it for the same canonical normalization the
 * hash applies. Normalization order (per SPEC §18, applied to the hash input):
 *
 *   1. Unicode NFKC (`String.prototype.normalize('NFKC')`)
 *   2. Lowercase
 *   3. Trim
 *   4. Collapse internal whitespace runs (`\s+` → single space)
 *
 * Null values normalize to the empty string and hash as an empty segment.
 */

/** Input shape for `calculateJobContentHash`. */
export interface JobContentHashInput {
  readonly title: string | null;
  readonly company: string | null;
  readonly location: string | null;
  readonly description: string | null;
}

/**
 * Canonical normalization for a single hash input string. Returns the empty
 * string for `null`.
 */
export function normalizeForHashing(value: string | null): string {
  if (value === null) {
    return '';
  }
  return value.normalize('NFKC').toLowerCase().trim().replace(/\s+/g, ' ');
}

/**
 * SHA-256 (lowercase hex) over the normalized title, company, location, and
 * description, joined by `\n`. The field order is fixed: `title`, `company`,
 * `location`, `description`.
 */
export function calculateJobContentHash(input: JobContentHashInput): string {
  const segments = [
    normalizeForHashing(input.title),
    normalizeForHashing(input.company),
    normalizeForHashing(input.location),
    normalizeForHashing(input.description),
  ];
  const joined = `${segments[0]}\n${segments[1]}\n${segments[2]}\n${segments[3]}`;
  return createHash('sha256').update(joined, 'utf8').digest('hex');
}

/**
 * SHA-256 (lowercase hex) over the stable-JSON serialization of the
 * normalized `JobFilterConfig`. The helper normalizes the input first (so
 * whitespace / case / ordering differences collapse) and then serializes
 * through a self-contained `stableStringify` that sorts every object key
 * alphabetically and emits no whitespace.
 *
 * `JobFilterConfig` has no `contentHash` field, so the helper does not need
 * to exclude any self-reference. The hash is bound to the `schemaVersion`
 * literal, so a future schema bump will naturally produce a different digest.
 */
export function calculateFilterConfigContentHash(config: JobFilterConfig): string {
  const normalized = normalizeJobFilterConfig(config);
  const serialized = stableStringify(normalized);
  return createHash('sha256').update(serialized, 'utf8').digest('hex');
}

/**
 * Recursive JSON serialization with object keys sorted alphabetically and no
 * whitespace. This is a standalone re-implementation of the algorithm used in
 * `src/profile/content-hash.ts` — the Global Constraints keep `src/filter/`
 * self-contained, so the small helper is intentionally duplicated rather than
 * lifted.
 *
 * Exported so `src/filter/fingerprint.ts` (Task 7) can reuse the exact same
 * serialization rules. Keeping a single source of truth inside `src/filter/`
 * prevents the config hash and the fingerprint from drifting apart.
 */
export function stableStringify(value: unknown): string {
  if (value === null || value === undefined) return 'null';
  if (typeof value === 'number' || typeof value === 'boolean') {
    return JSON.stringify(value);
  }
  if (typeof value === 'string') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    const parts: string[] = [];
    for (const item of value) {
      parts.push(stableStringify(item));
    }
    return `[${parts.join(',')}]`;
  }
  // Plain object: sort keys.
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  const parts: string[] = [];
  for (const key of keys) {
    parts.push(`${JSON.stringify(key)}:${stableStringify(record[key])}`);
  }
  return `{${parts.join(',')}}`;
}
