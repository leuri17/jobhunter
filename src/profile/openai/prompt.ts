import { PROFILE_EXTRACTION_PROMPT_VERSION } from './fingerprint.js';
import { ExtractedProfileSchema, STRUCTURED_OUTPUT_SCHEMA_VERSION } from './structured-output.js';
import type { OpenAIExtractionSource } from './types.js';

/**
 * JSON Schema sent to OpenAI in `response_format.json_schema.schema`.
 *
 * The shape is the JSON Schema projection of `ExtractedProfileSchema` with
 * the strict-mode quirks worked around at the request boundary:
 *
 * 1. `ExtractedSkill.category` and `ExtractedLanguage.level` are `.optional()`
 *    in the Zod schema (the post-processor substitutes `'other'` and
 *    `null` defaults), but OpenAI's strict mode requires every property
 *    to be present in `required`. We move those keys into `required` and
 *    also widen their type to `['string', 'null']` plus add `null` to
 *    the enum so the model can still signal "I don't know" without
 *    fabricating a value (per AGENTS.md §7, "Do not invent facts").
 *
 * 2. The Zod schema itself is untouched. The conversion happens here,
 *    only on the projected JSON Schema, so post-Task-6 callers can
 *    continue to parse the model's output with the original schemas.
 *
 * Built once at module load so the per-call overhead is zero.
 */
export const STRUCTURED_OUTPUT_SCHEMA: Record<string, unknown> = buildStructuredOutputSchema();

function buildStructuredOutputSchema(): Record<string, unknown> {
  const base = ExtractedProfileSchema.toJSONSchema() as Record<string, unknown>;
  applyStrictModeAdjustments(base);
  return base;
}

/**
 * Transforms the projected JSON Schema so the two fields we know are
 * post-processor-defaulted in `ExtractedProfileSchema` are both
 * **required** (per OpenAI strict mode) and **nullable** (so the model
 * can still emit `null` when the sources do not state the field).
 *
 * Touched fields:
 * - `skills.items.properties.category` — required, type `[string, null]`, enum `[..., null]`
 * - `languages.items.properties.level` — required, type `[string, null]`, enum `[..., null]`
 */
function applyStrictModeAdjustments(schema: Record<string, unknown>): void {
  const properties = schema['properties'] as Record<string, unknown> | undefined;
  if (!properties) return;

  const skills = properties['skills'] as Record<string, unknown> | undefined;
  const skillsItems = skills?.['items'] as Record<string, unknown> | undefined;
  if (skillsItems) {
    const skillsRequired = skillsItems['required'] as string[] | undefined;
    if (skillsRequired && !skillsRequired.includes('category')) {
      skillsRequired.push('category');
    }
    const categoryProps = skillsItems['properties'] as Record<string, unknown> | undefined;
    const category = categoryProps?.['category'] as Record<string, unknown> | undefined;
    if (category) {
      makeNullableStringWithNullEnum(category);
    }
  }

  const languages = properties['languages'] as Record<string, unknown> | undefined;
  const languagesItems = languages?.['items'] as Record<string, unknown> | undefined;
  if (languagesItems) {
    const languagesRequired = languagesItems['required'] as string[] | undefined;
    if (languagesRequired && !languagesRequired.includes('level')) {
      languagesRequired.push('level');
    }
    const levelProps = languagesItems['properties'] as Record<string, unknown> | undefined;
    const level = levelProps?.['level'] as Record<string, unknown> | undefined;
    if (level) {
      makeNullableStringWithNullEnum(level);
    }
  }
}

/**
 * Helper: widens a `string` field to `string | null` so the model can
 * emit `null`. Specifically:
 * - `type` becomes `['string', 'null']`.
 * - the existing `enum` array gets `null` appended (deduped).
 *
 * The post-processor (`postProcessExtractionResponse`, Task 6) substitutes
 * the final default: `'other'` for missing `category`, `null` for
 * missing `level`.
 */
function makeNullableStringWithNullEnum(field: Record<string, unknown>): void {
  if (field['type'] === 'string') {
    field['type'] = ['string', 'null'];
  }
  const enumValue = field['enum'];
  if (Array.isArray(enumValue) && !enumValue.includes(null)) {
    enumValue.push(null);
  }
}

/**
 * Inputs the profile-extraction prompt builder actually reads.
 *
 * The full `OpenAIExtractionRequest` includes the pre-built `messages`
 * field, but the prompt builder runs BEFORE the caller knows the
 * messages. Declaring a narrow input type here keeps the request
 * contract (`messages` is required) and the prompt builder contract
 * (only the two fields it needs) honest. The full request is still
 * accepted at runtime because every other field is ignored.
 */
export interface ProfileExtractionPromptInput {
  readonly promptVersion: string;
  readonly sources: readonly OpenAIExtractionSource[];
}

/**
 * Versioned profile-extraction prompt (SPEC §14.2, prompt version
 * `profile-extraction-prompt@v1`).
 *
 * Returns the `systemMessage` and `userMessage` that the OpenAI SDK
 * adapter sends to the model. The system message instructs the model
 * to return JSON matching the response schema, to use `null` for missing
 * scalars and empty arrays for missing collections, to never invent
 * facts, and to attach source references using the supplied `sourceId`
 * values. The user message includes the JSON-encoded source manifest
 * and each source's normalized text, delimited by a banner line that
 * uses the convention `--- sourceId: source_<int> (<originalFilename>) ---`.
 */
export function buildProfileExtractionPrompt(request: ProfileExtractionPromptInput): {
  systemMessage: string;
  userMessage: string;
} {
  if (request.promptVersion !== PROFILE_EXTRACTION_PROMPT_VERSION) {
    throw new Error(
      `buildProfileExtractionPrompt received promptVersion "${request.promptVersion}" but the module is pinned to "${PROFILE_EXTRACTION_PROMPT_VERSION}".`,
    );
  }

  const sourceManifest = {
    sourceManifestVersion: STRUCTURED_OUTPUT_SCHEMA_VERSION,
    sources: request.sources.map((source) => ({
      sourceId: source.sourceId,
      originalFilename: source.originalFilename,
    })),
  };

  const sourcesText = request.sources
    .map(
      (source) =>
        `--- sourceId: ${source.sourceId} (${source.originalFilename}) ---\n${source.extractedText}`,
    )
    .join('\n\n');

  const userMessage = `${JSON.stringify(sourceManifest, null, 2)}\n\n${sourcesText}`;

  return { systemMessage: SYSTEM_MESSAGE, userMessage };
}

const SYSTEM_MESSAGE = `You are a deterministic structured-data extractor. You read the supplied source documents (one or more CVs, résumés, portfolios in plain text) and return a single JSON object that matches the provided JSON Schema exactly.

Rules — read carefully:

1. Output ONLY the JSON object. No prose, no markdown fences, no commentary.
2. Use the JSON Schema's structure. Do not add keys that are not in the schema. Do not omit required keys.
3. Missing scalars (e.g. a profile with no listed headline) MUST be \`null\`. Missing collections (e.g. no languages listed) MUST be empty arrays. Never use \`null\` for collections.
4. NEVER invent facts. If a field is not explicitly supported by the sources, leave it \`null\` or empty. If two sources disagree, prefer the more recent or more authoritative one and emit a warning string in the top-level \`warnings\` array explaining the discrepancy.
5. For every fact you extract, attach at least one entry in the matching \`sourceReferences\` array (or \`evidence\` array for skills). Each entry MUST use the \`sourceId\` value supplied in the user message's source manifest. Never invent a \`sourceId\`.
6. \`extractedSkill.category\` and \`extractedLanguage.level\` are optional. If the sources do not state them, supply \`null\` (the post-processor substitutes defaults).
7. Dates MUST be in \`YYYY\` or \`YYYY-MM\` form. If the source has only a year, use \`YYYY\`. If the month is unclear, prefer \`YYYY-01\`.
8. Treat the sources as factual; do not retell them, summarize them, or add color. The output is a structured candidate profile; a human will review it before approval.`;
