import { z } from 'zod';

import { SCORING_CATEGORIES, type ScoringCategory } from './types.js';

/**
 * Zod source of truth for the OpenAI structured-output response of one
 * scoring request.
 *
 * Shape:
 *   - `categoryScores`: 7 categories from , each with an
 *     integer 0-100 score, an explanation, and an evidence list.
 *   - `keyMatches` / `importantGaps` / `importantConcerns`: free-form
 *     short text highlights the model is expected to surface.
 *   - `inferredSeniority`: enum the model picks from; `unknown` is the
 *     explicit abstention.
 *   - `recommendationSummary`: a one- or two-sentence verdict.
 *
 * Every nested object is `.strict()` so OpenAI's strict-mode JSON-Schema
 * projection rejects unknown keys at the wire boundary (mirrors
 * `src/profile/openai/structured-output.ts`). Bump
 * `SCORING_STRUCTURED_OUTPUT_SCHEMA_VERSION` on any shape change so the
 * score fingerprint invalidates correctly.
 */
export const ScoringCategoryScoreSchema = z
  .object({
    score: z.number().int().min(0).max(100),
    explanation: z.string(),
    evidence: z.array(z.string()),
  })
  .strict();

const categoryScoresShape = Object.fromEntries(
  SCORING_CATEGORIES.map((category) => [category, ScoringCategoryScoreSchema]),
) as Record<ScoringCategory, typeof ScoringCategoryScoreSchema>;

export const ScoringStructuredOutputSchema = z
  .object({
    categoryScores: z.object(categoryScoresShape).strict(),
    keyMatches: z.array(z.string()),
    importantGaps: z.array(z.string()),
    importantConcerns: z.array(z.string()),
    inferredSeniority: z.enum(['junior', 'mid', 'senior', 'staff', 'principal', 'unknown']),
    recommendationSummary: z.string(),
  })
  .strict();

export type ScoringStructuredOutput = z.infer<typeof ScoringStructuredOutputSchema>;

export const SCORING_STRUCTURED_OUTPUT_SCHEMA_VERSION = 1 as const;
export type ScoringStructuredOutputSchemaVersion = typeof SCORING_STRUCTURED_OUTPUT_SCHEMA_VERSION;

/**
 * The response-schema name sent to OpenAI. The OpenAI client looks up
 * the matching JSON Schema in `RESPONSE_SCHEMA_REGISTRY` (see
 * `src/profile/openai/response-schemas.ts`) using this name.
 */
export const SCORING_RESPONSE_SCHEMA_NAME = 'ScoringStructuredOutput';

/**
 * JSON Schema projection of `ScoringStructuredOutputSchema` for OpenAI
 * strict-mode structured output. The projection is built once at module
 * load (mirrors `src/profile/openai/prompt.ts:STRUCTURED_OUTPUT_SCHEMA`)
 * so per-call overhead is zero.
 *
 * No strict-mode adjustments are required for the scoring shape — the
 * Zod schema is already strict and the `inferredSeniority` enum is
 * non-nullable, so nothing needs to be widened.
 */
export const SCORING_STRUCTURED_OUTPUT_JSON_SCHEMA: Record<string, unknown> =
  ScoringStructuredOutputSchema.toJSONSchema() as Record<string, unknown>;
