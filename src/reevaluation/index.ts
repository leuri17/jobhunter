/**
 * Public barrel for `src/reevaluation/`.
 *
 * Re-exports the public surface that the sidecar routes and
 * the test harness consume. Internal helpers stay accessible via
 * their source paths.
 *
 * Layout (end-state):
 *   - Pure layer: state, errors, plan, format, json-schemas, log.
 *   - Service-adjacent: fingerprint (read-only fingerprint helpers).
 *   - Service layer: service.ts (ReevaluationService).
 *   - Public barrel: index.ts (this file).
 */

// Pure layer — state vocabulary.
export {
  REEVALUATION_SCHEMA_VERSION,
  type ReevaluationExecuteInput,
  type ReevaluationOutcome,
  type ReevaluationPlan,
  type ReevaluationPlanAction,
  type ReevaluationPlanEntry,
  type ReevaluationSchemaVersion,
  type ReevaluationScope,
  type ReevaluationSkippedEntry,
  type ReevaluationSkipReason,
  type ReevaluationTotals,
  type ScoringPlan,
} from './state.js';

// Pure layer — typed errors.
export {
  PipelinePrerequisiteError,
  ReevaluationError,
  ReevaluationValidationError,
} from './errors.js';

// Pure layer — plan aggregation.
export { buildReevaluationPlan, type BuildReevaluationPlanInput } from './plan.js';

// Pure layer — human-readable formatters.
export {
  formatReevaluationSummary,
  formatReevaluationTable,
  formatScoringPlanForReevaluation,
} from './format.js';

// Pure layer — Zod schemas for JSON output.
export {
  REEVALUATION_JSON_SCHEMA,
  ScoringPlanJsonSchema,
  type ReevaluationJsonPayload,
  type ReevaluationPlanEntryJson,
  type ReevaluationSkippedEntryJson,
  type ScoringPlanJson,
} from './json-schemas.js';

// Pure layer — structured-logger facade.
export { noopReevaluationLogger, type ReevaluationLogger } from './log.js';

// Service-adjacent — read-only fingerprint helpers.
export { computeFilterFingerprintForJob, computeScoreFingerprintForJob } from './fingerprint.js';

// Service layer — the reevaluation orchestrator.
export { ReevaluationService, type ReevaluationServiceOptions } from './service.js';
