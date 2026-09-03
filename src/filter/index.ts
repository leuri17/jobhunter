/**
 * Public surface for the global deterministic filter engine.
 *
 * This barrel re-exports every public symbol from `src/filter/**`. The
 * desktop sidecar consumes the filter engine through this barrel;
 * downstream tasks (Phase B / Phase E) import the orchestration
 * services (`FilterApplyService`, `ConfigureFiltersService`) from here.
 *
 * Module layout (the source files live next to this barrel):
 *
 *   schema.ts                       → JobFilterConfig + normalization
 *   version.ts                      → FILTER_IMPLEMENTATION_VERSION
 *   errors.ts                       → FilterLifecycleError + subclasses
 *   content-hash.ts                 → job + config content hashes
 *   keyword-normalize.ts            → keyword canonical normalization
 *   keyword-aliases.ts              → versioned alias map (KEYWORD_ALIAS_VERSION)
 *   keyword-matcher.ts              → token-stream matcher
 *   seniority-detector.ts           → title-only seniority detection
 *   seniority-rule.ts               → max-seniority rule
 *   language-patterns.ts            → versioned phrase dictionary (LANGUAGE_PATTERN_VERSION)
 *   language-detector.ts            → phrase-based language requirement detection
 *   evaluate.ts                     → composite rule evaluator
 *   fingerprint.ts                  → fingerprint composer (cache key)
 *   service.ts                      → FilterApplyService (cache ledger)
 *   prompts.ts                      → seam (interface + scripted test adapters)
 *   configure-service.ts            → ConfigureFiltersService (interactive flow)
 */

export {
  FILTER_SCHEMA_VERSION,
  JobFilterConfigSchema,
  normalizeJobFilterConfig,
  type JobFilterConfig,
} from './schema.js';
export { FILTER_IMPLEMENTATION_VERSION, type FilterImplementationVersion } from './version.js';
export {
  FilterLifecycleError,
  InvalidFilterConfigError,
  InvalidFilterPayloadError,
  NoActiveProfileError,
  UserCancelledFilterConfigError,
  FilterStorageError,
} from './errors.js';
export {
  calculateJobContentHash,
  calculateFilterConfigContentHash,
  normalizeForHashing,
} from './content-hash.js';
export { normalizeKeyword, keywordMatches } from './keyword-normalize.js';
export { matchKeywords, type KeywordMatchHit, type KeywordMatchResult } from './keyword-matcher.js';
export { ALIAS_MAP, KEYWORD_ALIAS_VERSION } from './keyword-aliases.js';
export {
  detectSeniority,
  type DetectedSeniority,
  type SeniorityDetectionResult,
} from './seniority-detector.js';
export {
  applySeniorityRule,
  type SeniorityRuleOutcome,
  type SeniorityRuleResult,
} from './seniority-rule.js';
export {
  LANGUAGE_REQUIRED_PHRASES,
  LANGUAGE_REFERENCE_PHRASES,
  LANGUAGE_PATTERN_VERSION,
} from './language-patterns.js';
export {
  detectLanguageRequirements,
  type LanguageRequirement,
  type LanguageDetectionResult,
} from './language-detector.js';
export {
  evaluateJob,
  type JobInput,
  type RuleEvaluation,
  type FilterEvaluationResult,
} from './evaluate.js';
export { calculateFilterFingerprint, type FilterFingerprintInput } from './fingerprint.js';
export {
  FilterApplyService,
  type FilterApplyServiceOptions,
  type FilterApplyInput,
  type FilterApplyResult,
} from './service.js';
export {
  ConfigureFiltersService,
  type ConfigureFiltersServiceOptions,
  type ConfigureFiltersOutcome,
} from './configure-service.js';
export {
  createFailingFilterPrompts,
  ScriptedFilterPrompts,
  type FilterConfigurationPreview,
  type FilterPrompts,
} from './prompts.js';
