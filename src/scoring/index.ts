/**
 * Public barrel for the scoring module.
 *
 * Consumers (the  pipeline orchestrator) import from here so
 * the import surface stays narrow and the layer boundary is enforced
 * at the type level.
 *
 * Re-exports are grouped by the module that defines the symbol.
 */

// Errors.
export {
  ScoringError,
  ScoringInputTooLargeError,
  ScoringInvalidStructuredOutputError,
  ScoringPersistenceError,
  ScoringFingerprintMismatchError,
  ScoringHardStopError,
  type ScoringInputTooLargeMetadata,
  type ScoringInvalidStructuredOutputMetadata,
  type ScoringPersistenceMetadata,
  type ScoringFingerprintMismatchMetadata,
  type ScoringHardStopMetadata,
} from './errors.js';

// State vocabulary.
export {
  LINKEDIN_SCORING_SCHEMA_VERSION,
  SCORING_CATEGORIES,
  type LinkedinScoringSchemaVersion,
  type ScoringCategory,
  type ScoringFieldSet,
  type ScoringKind,
  type ScoringMethod,
  type ScoringOutcome,
  type ScoringBatchOutcome,
  type ScoringPlan,
  type ScoringPlanEntry,
} from './state.js';

// Rubric + formula + rank + fingerprint + plan.
export {
  RUBRIC,
  RUBRIC_VERSION,
  getRubricWeight,
  getRubricDescription,
  type RubricEntry,
  type RubricVersion,
} from './rubric.js';

export { computeOverallScore, formatDisplayScore } from './score-formula.js';
export { rankResults, type RankedResult } from './rank.js';
export {
  SCORER_IMPLEMENTATION_VERSION,
  computeScoreFingerprint,
  type ScoreFingerprintInput,
} from './fingerprint.js';
export { buildScoringPlan, type BuildScoringPlanInput } from './plan.js';

// Structured-output schema (the Zod source of truth for scoring responses).
export {
  ScoringStructuredOutputSchema,
  ScoringCategoryScoreSchema,
  SCORING_STRUCTURED_OUTPUT_SCHEMA_VERSION,
  SCORING_STRUCTURED_OUTPUT_JSON_SCHEMA,
  SCORING_RESPONSE_SCHEMA_NAME,
  type ScoringStructuredOutput,
  type ScoringStructuredOutputSchemaVersion,
} from './schema.js';

// Logger facade.
export { noopScoringLogger, pinoScoringLogger, type ScoringLogger } from './log.js';

// Service layer — the scoring orchestrator (used by the reevaluation
// service via a structural type, and re-exposed here so HTTP-sidecar
// consumers can wire it up without reaching into the source file).
export {
  ScoringService,
  type ScoringServiceConfig,
  type ScoringServiceOptions,
} from './service.js';
