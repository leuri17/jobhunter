import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * The JSON fixtures seeded for the scoring layer (TASK-014).
 *
 * Eight fixtures cover the scoring input (a complete normalized job)
 * + the assembled OpenAI request payload + six positive / negative
 * structured-output cases (the F9 §25.7 prohibited-fields oracle +
 * the Zod-validation cases for category bounds, missing fields, extra
 * fields, decimal scores, and unknown seniority).
 *
 * Two boundary fixtures (`scoring-input-payload-200000-bytes` and
 * `scoring-input-payload-200001-bytes`) sit exactly at the 200 KB
 * scoring_input_too_large cap (H1) so the per-job input-size guard
 * has a deterministic oracle to assert against.
 */
export type ScoringFixtureName =
  // Input fixtures — a complete normalized job and the assembled payload.
  | 'scoring-input-job'
  | 'scoring-input-payload'
  // Positive output — a valid scoring response (per the plan sketch).
  | 'scoring-output-valid'
  // Negative outputs — each deliberately violates the Zod schema.
  | 'scoring-output-malformed'
  | 'scoring-output-category-out-of-bounds'
  | 'scoring-output-missing-field'
  | 'scoring-output-extra-field'
  | 'scoring-output-decimal-score'
  | 'scoring-output-unknown-seniority'
  // Boundary fixtures — exact 200_000 and 200_001 byte payloads (H1).
  | 'scoring-input-payload-200000-bytes'
  | 'scoring-input-payload-200001-bytes';

/**
 * Absolute path to this directory (resolved from this module's URL at
 * module-load time, not at call time, so the loader works across
 * worktrees, pnpm hoisting, and `process.cwd()` resets).
 */
const FIXTURES_DIR = fileURLToPath(new URL('.', import.meta.url));

/**
 * Per-fixture filename map. The directory is resolved once at module
 * load; the filenames are the only per-fixture input.
 */
const FIXTURE_FILES: Readonly<Record<ScoringFixtureName, string>> = {
  'scoring-input-job': 'scoring-input-job.json',
  'scoring-input-payload': 'scoring-input-payload.json',
  'scoring-output-valid': 'scoring-output-valid.json',
  'scoring-output-malformed': 'scoring-output-malformed.json',
  'scoring-output-category-out-of-bounds': 'scoring-output-category-out-of-bounds.json',
  'scoring-output-missing-field': 'scoring-output-missing-field.json',
  'scoring-output-extra-field': 'scoring-output-extra-field.json',
  'scoring-output-decimal-score': 'scoring-output-decimal-score.json',
  'scoring-output-unknown-seniority': 'scoring-output-unknown-seniority.json',
  'scoring-input-payload-200000-bytes': 'scoring-input-payload-200000-bytes.json',
  'scoring-input-payload-200001-bytes': 'scoring-input-payload-200001-bytes.json',
};

/**
 * Read a saved JSON fixture as a raw string. Most scoring tests use
 * this so they can assert against the exact byte size (the
 * `scoring_input_too_large` guard is a UTF-8 byte check, not a
 * character count).
 */
export function loadScoringFixture(name: ScoringFixtureName): string {
  return readFileSync(join(FIXTURES_DIR, FIXTURE_FILES[name]), 'utf8');
}

/**
 * Read a saved JSON fixture and parse it via `JSON.parse`. Throws if
 * the fixture is not valid JSON. Use this when the test only cares
 * about the parsed value (most non-boundary scoring tests).
 */
export function loadScoringFixtureAsJson<T = unknown>(name: ScoringFixtureName): T {
  return JSON.parse(loadScoringFixture(name)) as T;
}
