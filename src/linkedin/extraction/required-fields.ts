import { isValidRequiredField } from './normalize.js';
import type { ExtractionFieldSet, RequiredField } from './state.js';

/**
 * Result of `validateRequiredFields`.
 *
 * `valid === true`  → every required field is non-empty after `normalizeText()`.
 * `valid === false` → `missing` lists every field that failed the check
 *                       (at least one entry).
 *
 * The validator is PURE: no I/O, no logging, no side effects. It
 * delegates the per-field emptiness check to
 * `isValidRequiredField` so the normalization rules live in one
 * place (`normalize.ts`).
 */
export interface RequiredFieldsValidation {
  readonly valid: boolean;
  readonly missing: readonly RequiredField[];
}

/**
 * The four required fields validated by `validateRequiredFields`.
 * Declared as a module-level constant so the iteration order is
 * stable across calls (matters for `missing` ordering).
 */
const REQUIRED_FIELDS: readonly RequiredField[] = ['title', 'company', 'location', 'description'];

/**
 * Validate every required field on an `ExtractionFieldSet`. Returns
 * `{ valid: true }` when every field is non-empty after
 * normalization, otherwise `{ valid: false, missing }` with the
 * offending field names listed in declaration order.
 *
 * Per : each text field is non-empty after `normalizeText()`.
 * `sourceJobId` is the entry-gate and is NOT checked here — its
 * presence is asserted by the orchestrator BEFORE `extractOne`.
 */
export function validateRequiredFields(fields: ExtractionFieldSet): RequiredFieldsValidation {
  const missing: RequiredField[] = [];
  for (const field of REQUIRED_FIELDS) {
    if (!isValidRequiredField(fields[field])) {
      missing.push(field);
    }
  }
  return { valid: missing.length === 0, missing };
}
