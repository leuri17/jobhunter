import { validateRequiredFields } from './required-fields.js';
import type { ExtractionFieldSet } from './state.js';

/**
 * Compute the extraction status (TASK-013 Plan Task 4, SPEC §22.8).
 *
 *   - `'complete'` → all 4 required fields are valid (non-empty
 *                    after `normalizeText()`).
 *   - `'partial'`  → at least one required field is missing/invalid.
 *                    The job is preserved on the canonical record
 *                    with the populated fields and a `'partial'`
 *                    status — no automatic retry (SPEC §22.10).
 *
 * `'failed'` is reserved for the no-`sourceJobId` case (TASK-012
 * owns this — no `jobs` row is ever created). The status
 * calculator never returns `'failed'`; the orchestrator surfaces
 * it for hard per-job failures (panel + dedicated both broken).
 *
 * The function is PURE: no I/O, no logging, no side effects.
 */
export function computeExtractionStatus(fields: ExtractionFieldSet): 'complete' | 'partial' {
  const validation = validateRequiredFields(fields);
  return validation.valid ? 'complete' : 'partial';
}
