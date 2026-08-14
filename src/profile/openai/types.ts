/**
 * Shared operation types for the OpenAI profile-extraction pipeline.
 *
 * These interfaces are the boundary between the pure domain code (which
 * composes the request and consumes the raw response) and the OpenAI SDK
 * adapter (which performs the actual network call). The HTTP transport
 * and SDK are isolated behind `OpenAIClient`; nothing else in `src/`
 * imports `openai` directly.
 */

/**
 * A single source supplied to the extraction prompt.
 *
 * `sourceId` is the opaque `'source_<int>'` identifier exposed to the model
 * (per SPEC §32). The model is expected to echo this back inside every
 * `SourceReference.sourceId` so the post-processor can map extracted facts
 * back to the originating source.
 */
export interface OpenAIExtractionSource {
  readonly sourceId: string;
  readonly originalFilename: string;
  readonly extractedText: string;
}

/**
 * Inputs for one profile-extraction request.
 *
 * `promptVersion` is the versioned prompt identifier (the value exported
 * from `./fingerprint.ts` as `PROFILE_EXTRACTION_PROMPT_VERSION`). It must
 * be supplied explicitly so the extraction fingerprint and the prompt
 * template are guaranteed to be in sync.
 *
 * `responseSchemaName` is the OpenAI structured-output schema identifier
 * (e.g. `'professional_profile_extraction_v1'`).
 *
 * `structuredOutputSchemaVersion` is the version of the JSON Schema we
 * project to OpenAI; it is recorded in the persisted extraction
 * fingerprint so a draft can be reused only when the schema matches.
 */
export interface OpenAIExtractionRequest {
  readonly promptVersion: string;
  readonly model: string;
  readonly reasoningEffort: 'low' | 'medium' | 'high';
  readonly sources: readonly OpenAIExtractionSource[];
  readonly responseSchemaName: string;
  readonly structuredOutputSchemaVersion: number;
}

/**
 * Raw response from the OpenAI adapter.
 *
 * `rawJsonText` is the JSON text the model produced (the adapter does not
 * validate it — that is the caller's responsibility). `tokenUsage` is
 * `null` when the upstream response omitted usage information.
 */
export interface OpenAIExtractionRawResponse {
  readonly rawJsonText: string;
  readonly tokenUsage: { readonly promptTokens: number; readonly completionTokens: number } | null;
}

/**
 * The narrow contract every OpenAI adapter (production SDK, fake, etc.)
 * must satisfy. The adapter is responsible for transport, retry-relevant
 * error translation, and producing `rawJsonText`; the caller is responsible
 * for JSON parsing, Zod validation, and persistence.
 */
export interface OpenAIClient {
  extract(request: OpenAIExtractionRequest): Promise<OpenAIExtractionRawResponse>;
}
