import { createHash } from 'node:crypto';

import {
  calculateFilterConfigContentHash,
  calculateJobContentHash,
  normalizeForHashing,
  stableStringify,
  type JobContentHashInput,
} from './content-hash.js';
import { type JobFilterConfig } from './schema.js';
import { FILTER_IMPLEMENTATION_VERSION } from './version.js';
import { type ProfessionalProfile } from '../profile/schema.js';

/**
 * Filter fingerprint composer (TASK-010 Task 7, SPEC §24.3).
 *
 * The fingerprint is a stable SHA-256 digest that combines:
 *
 *   - the SHA-256 of the normalized job content (title, company, location,
 *     description), via `calculateJobContentHash`;
 *   - the SHA-256 of the normalized filter configuration, via
 *     `calculateFilterConfigContentHash`;
 *   - the relevant effective profile values (the "profile slice"), trimmed
 *     to the fields the SPEC §24.3 + Decision 7 fingerprint must reflect:
 *       - `derived.likelySeniority.effectiveValue`
 *       - `derived.primaryRoles.effectiveValue`
 *       - `derived.primaryDomains.effectiveValue`
 *       - `derived.strongestSkills.effectiveValue`
 *       - `languages[].normalizedName`
 *       - `skills[].normalizedName`
 *     Each array is sorted alphabetically (case-folded) and case-insensitive
 *     duplicates are collapsed; non-slice profile fields (e.g.
 *     `basics.headline`, `experience[].summary`) are ignored;
 *   - the filter implementation version (`FILTER_IMPLEMENTATION_VERSION`)
 *     so any behavioural change in the engine naturally produces a
 *     different fingerprint.
 *
 * The four pieces are composed into one plain object and passed through
 * `stableStringify` (the same recursive JSON serializer used by the config
 * hash) before being hashed with SHA-256. The output is the lowercase hex
 * digest — exactly 64 characters.
 *
 * When `input.profile === null` (no active approved profile) the profile
 * slice is the literal `null`, and the fingerprint is still deterministic.
 * The composer NEVER throws and NEVER calls into IO, network, OpenAI, or
 * the persistence layer.
 *
 * Domain-boundary note (AGENTS.md §5, §9): this module imports only
 * `node:crypto`, `src/filter/version.js`, `src/filter/content-hash.js`,
 * `src/filter/schema.js`, and `src/profile/schema.js` (for the
 * `ProfessionalProfile` type). It does not import Commander, Inquirer,
 * Playwright, Drizzle, OpenAI, or Pino. The
 * `tests/filter/boundaries.test.ts` guard enforces this.
 */

export interface FilterFingerprintInput {
  readonly job: JobContentHashInput;
  readonly config: JobFilterConfig;
  readonly profile: ProfessionalProfile | null;
}

/** The slice of the profile that participates in the fingerprint. */
interface ProfileSlice {
  readonly likelySeniority: ProfessionalProfile['derived']['likelySeniority']['effectiveValue'];
  readonly primaryRoles: readonly string[];
  readonly primaryDomains: readonly string[];
  readonly strongestSkills: readonly string[];
  readonly languages: readonly string[];
  readonly skills: readonly string[];
}

/**
 * Sort + dedupe a string array using the canonical normalization the
 * fingerprint applies. Empty-after-normalization entries are dropped; the
 * first-seen normalized-then-trimmed value wins on ties; the output is
 * sorted by the case-folded key so the result is deterministic regardless
 * of input order.
 */
function sortAndDedupe(values: readonly string[]): string[] {
  const seenKeys = new Set<string>();
  const deduped: string[] = [];
  for (const raw of values) {
    const normalized = normalizeForHashing(raw);
    if (normalized.length === 0) {
      continue;
    }
    if (seenKeys.has(normalized)) {
      continue;
    }
    seenKeys.add(normalized);
    deduped.push(normalized);
  }
  deduped.sort((a, b) => {
    if (a < b) return -1;
    if (a > b) return 1;
    return 0;
  });
  return deduped;
}

/** Extract the deterministic profile slice used by the fingerprint. */
function buildProfileSlice(profile: ProfessionalProfile): ProfileSlice {
  return {
    likelySeniority: profile.derived.likelySeniority.effectiveValue,
    primaryRoles: sortAndDedupe(profile.derived.primaryRoles.effectiveValue),
    primaryDomains: sortAndDedupe(profile.derived.primaryDomains.effectiveValue),
    strongestSkills: sortAndDedupe(profile.derived.strongestSkills.effectiveValue),
    languages: sortAndDedupe(profile.languages.map((language) => language.normalizedName)),
    skills: sortAndDedupe(profile.skills.map((skill) => skill.normalizedName)),
  };
}

/**
 * Compose the four-part fingerprint input and return its SHA-256 hex
 * digest. Pure: identical inputs always produce the same digest; the
 * function never throws.
 */
export function calculateFilterFingerprint(input: FilterFingerprintInput): string {
  const jobContentHash = calculateJobContentHash(input.job);
  const configContentHash = calculateFilterConfigContentHash(input.config);
  const profileSlice: ProfileSlice | null =
    input.profile === null ? null : buildProfileSlice(input.profile);
  const composed = {
    jobContentHash,
    configContentHash,
    profileSlice,
    filterImplementationVersion: FILTER_IMPLEMENTATION_VERSION,
  };
  const serialized = stableStringify(composed);
  return createHash('sha256').update(serialized, 'utf8').digest('hex');
}
