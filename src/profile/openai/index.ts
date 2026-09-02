/**
 * Public barrel for the OpenAI profile-extraction module.
 *
 * Every consumer that wants to operate against the extraction pipeline
 * (callers, tests, downstream apps) should import from here so the import
 * surface stays narrow and the dependency on the `openai` SDK never leaks
 * beyond `client.ts`.
 *
 * Re-exports are grouped by the module that defines the symbol. When a
 * constant is shared by more than one module (e.g. `PROFILE_EXTRACTION_PROMPT_VERSION`
 * is consumed by both the prompt builder and the fingerprint calculator),
 * we keep the canonical definition in one module and re-export it here
 * rather than redefining it.
 */

// Error family.
export {
  ProfileExtractionError,
  OpenAITransientError,
  OpenAIRateLimitError,
  OpenAIServerError,
  OpenAITimeoutError,
  OpenAINetworkError,
  OpenAIInvalidOutputError,
  OpenAIAuthenticationError,
  OpenAIPermissionError,
  OpenAIBillingError,
  OpenAIInvalidRequestError,
  OpenAIUnsupportedModelError,
  ProfileExtractionInputTooLargeError,
  ProfileExtractionSourceUnusableError,
  OPENAI_RETRYABLE_ERROR_CODES,
  type RetryAttemptSummary,
} from './errors.js';

// Operation types.
export type {
  OpenAIChatMessage,
  OpenAIExtractionSource,
  OpenAIExtractionRequest,
  OpenAIExtractionRawResponse,
  OpenAIClient,
} from './types.js';

// Response schema registry — looks up the JSON Schema the OpenAI SDK
// sends in `response_format.json_schema.schema`. The scoring schema
// (`ScoringStructuredOutput`) is registered here so the same client
// surface serves both profile extraction and job scoring.
export {
  getResponseSchema,
  RESPONSE_SCHEMA_REGISTRY,
  RESPONSE_SCHEMA_NAMES,
  UnknownResponseSchemaError,
  ResponseSchemaVersionMismatchError,
  type ResponseSchemaEntry,
} from './response-schemas.js';

// Production client (the only module that imports the `openai` SDK).
export { createDefaultOpenAIClient } from './client.js';

// Test double.
export { FakeOpenAIClient, type FakeOpenAIClientScript } from './fake-client.js';

// Retry policy.
export { runWithRetry, type RetryOptions, type AttemptRecord } from './retry.js';

// Prompt builder.
export { buildProfileExtractionPrompt, STRUCTURED_OUTPUT_SCHEMA } from './prompt.js';

// Fingerprint + version constants.
export {
  calculateExtractionFingerprint,
  EXTRACTOR_IMPLEMENTATION_VERSION,
  PROFILE_EXTRACTION_PROMPT_VERSION,
  type ExtractionFingerprintInputs,
} from './fingerprint.js';

// Structured-output schema.
export {
  STRUCTURED_OUTPUT_SCHEMA_VERSION,
  ExtractedBasicsSchema,
  ExtractedWorkExperienceSchema,
  ExtractedSkillSchema,
  ExtractedLanguageSchema,
  ExtractedEducationSchema,
  ExtractedCertificationSchema,
  ExtractedProjectSchema,
  ExtractedProfileSchema,
  createExtractedProfileSchema,
  type ExtractedBasics,
  type ExtractedWorkExperience,
  type ExtractedSkill,
  type ExtractedLanguage,
  type ExtractedEducation,
  type ExtractedCertification,
  type ExtractedProject,
  type ExtractedProfile,
} from './structured-output.js';
