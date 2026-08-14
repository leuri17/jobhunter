import { createHash } from 'node:crypto';

import type { ProfessionalProfile } from './schema.js';

/**
 * Stable content-hash helper for canonical profile versions (SPEC.md §14.3).
 *
 * Builds a deterministic JSON serialization of the profile (sorted object keys,
 * no whitespace) and returns the lowercase hex SHA-256 digest (64 chars).
 *
 * The hash is invariant to object-key ordering and to any other JSON
 * formatting noise. It is computed only from the on-disk profile shape so
 * approval-and-edit cycles that change only `derived` overrides can still
 * reuse an existing draft when the source content is unchanged.
 *
 * The function is self-consistent: the `contentHash` field is excluded from
 * the hashed input (the helper resets it to an empty string on a shallow
 * clone before serializing). This means
 * `calculateProfileContentHash({...profile, contentHash: hash}) === hash` for
 * any valid profile — round-tripping the hash always returns the same
 * digest, and approval/edit cycles that touch only `derived` overrides can
 * recompute the canonical hash without drift.
 */

function stableStringify(value: unknown): string {
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

export function calculateProfileContentHash(profile: ProfessionalProfile): string {
  // Exclude `contentHash` from the hashed input so the function is
  // self-consistent: re-hashing a profile that already carries its own
  // contentHash produces the same digest. Shallow clone is sufficient because
  // `contentHash` is a top-level primitive.
  const hashable: ProfessionalProfile = { ...profile, contentHash: '' };
  const serialized = stableStringify(hashable);
  return createHash('sha256').update(serialized, 'utf8').digest('hex');
}
