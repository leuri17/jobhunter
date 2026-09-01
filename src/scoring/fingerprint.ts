import { hashString } from '../profile/hashing.js';

/**
 * Inputs that go into the score fingerprint.
 *
 * The fingerprint is the SHA-256 hash of the canonical JSON
 * serialization of these inputs. Any change to any field
 * invalidates the cached score and forces a fresh OpenAI call.
 */
export interface ScoreFingerprintInput {
  readonly jobContentHash: string;
  readonly profileVersionId: number;
  readonly profileFingerprint: string;
  readonly effectiveDerivedValuesHash: string;
  readonly promptVersion: number;
  readonly rubricVersion: number;
  readonly model: string;
  readonly reasoningEffort: string;
  readonly modelConfig: Readonly<Record<string, string | number | boolean | null>>;
  readonly scorerImplementationVersion: number;
}

/**
 * Implementation version of the scoring layer. Bump on any change to
 * `computeScoreFingerprint` (the canonical JSON shape, the default
 * substitution policy, the key-order rules, etc.) so cached scores
 * that depend on the new behavior are invalidated.
 */
export const SCORER_IMPLEMENTATION_VERSION = 1 as const;

/**
 * Compute the score fingerprint.
 *
 * SHA-256 of canonical JSON with sorted keys (RFC 8785 / JCS pattern).
 * Returns a lowercase hex string (64 chars). Defaults are substituted
 * for optional fields before serialization so two inputs that differ
 * only in absent-vs-explicit-empty values produce the same fingerprint.
 */
export function computeScoreFingerprint(input: ScoreFingerprintInput): string {
  const ordered = {
    jobContentHash: input.jobContentHash,
    profileVersionId: input.profileVersionId,
    profileFingerprint: input.profileFingerprint,
    effectiveDerivedValuesHash: input.effectiveDerivedValuesHash,
    model: input.model,
    modelConfig: sortObjectKeys(input.modelConfig),
    promptVersion: input.promptVersion,
    reasoningEffort: input.reasoningEffort,
    rubricVersion: input.rubricVersion,
    scorerImplementationVersion: input.scorerImplementationVersion,
  };
  // The replacer array locks the top-level key order to alphabetical
  // regardless of how the object literal was written. Nested objects
  // are pre-sorted by `sortObjectKeys` so the entire serialization is
  // canonical.
  const canonical = JSON.stringify(ordered, Object.keys(ordered).sort());
  return hashString(canonical);
}

function sortObjectKeys<T>(obj: T): T {
  if (obj === null || typeof obj !== 'object' || Array.isArray(obj)) return obj;
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(obj as Record<string, unknown>).sort()) {
    sorted[key] = (obj as Record<string, unknown>)[key];
  }
  return sorted as T;
}
