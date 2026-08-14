import { createHash } from 'node:crypto';

/**
 * Profile-extraction fingerprint (SPEC.md §14.5).
 *
 * The fingerprint is the lowercase hex SHA-256 digest (64 chars) of a stable
 * JSON serialization that combines the sorted source hashes with the
 * canonical profile schema version, the extraction prompt version, the model
 * identifier, the reasoning effort, the structured-output schema version, and
 * the extractor implementation version.
 *
 * Source hashes are sorted lexicographically inside the calculator so the
 * order of sources on the CLI does not affect the fingerprint.
 */

export const EXTRACTOR_IMPLEMENTATION_VERSION = '1.0.0';
export const PROFILE_EXTRACTION_PROMPT_VERSION = 'profile-extraction-prompt@v1';

export interface ExtractionFingerprintInputs {
  readonly sourceHashes: readonly string[];
  readonly schemaVersion: number;
  readonly promptVersion: string;
  readonly model: string;
  readonly reasoningEffort: 'low' | 'medium' | 'high';
  readonly structuredOutputSchemaVersion: number;
  readonly extractorImplementationVersion?: string;
}

export function calculateExtractionFingerprint(inputs: ExtractionFingerprintInputs): string {
  const ordered = {
    extractorImplementationVersion:
      inputs.extractorImplementationVersion ?? EXTRACTOR_IMPLEMENTATION_VERSION,
    model: inputs.model,
    promptVersion: inputs.promptVersion,
    reasoningEffort: inputs.reasoningEffort,
    schemaVersion: inputs.schemaVersion,
    sourceHashes: [...inputs.sourceHashes].sort(),
    structuredOutputSchemaVersion: inputs.structuredOutputSchemaVersion,
  };
  const stable = JSON.stringify(ordered, Object.keys(ordered).sort());
  return createHash('sha256').update(stable, 'utf8').digest('hex');
}
