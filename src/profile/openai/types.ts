/**
 * Shared operation types for the OpenAI client surface.
 *
 * These interfaces are the boundary between the pure domain code (which
 * composes the request and consumes the raw response) and the OpenAI SDK
 * adapter (which performs the actual network call). The HTTP transport
 * and SDK are isolated behind `OpenAIClient`; nothing else in `src/`
 * imports `openai` directly.
 *
 * The `OpenAIClient` interface is shared by profile extraction
 * (TASK-008) and job scoring (TASK-014). The shape of the request is
 * generic — the prompt template and the response schema are looked up
 * at the client via the response-schema registry, so adding a new
 * operation is purely a registry entry (see `./response-schemas.ts`).
 */

/**
 * A chat message sent to the OpenAI SDK. The model only requires the
 * two roles listed here; the client is responsible for the exact
 * ordering and the total token budget.
 */
export interface OpenAIChatMessage {
  readonly role: 'system' | 'user';
  readonly content: string;
}

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
 * Inputs for one OpenAI request.
 *
 * `promptVersion` is the versioned prompt identifier the caller used to
 * build `messages` (e.g. `PROFILE_EXTRACTION_PROMPT_VERSION` for
 * extraction, or the scoring prompt version for scoring). It is the
 * caller's responsibility to assert the prompt version is current —
 * the client transports whatever the caller supplies.
 *
 * `messages` is the pre-built chat payload the client passes through to
 * the OpenAI SDK. Building messages is a domain concern; the client is
 * a pure transport and never builds messages itself. The prompt builder
 * for profile extraction lives at `./prompt.ts`; the scoring prompt
 * builder lives at `../../scoring/prompt.ts` (Wave A).
 *
 * `responseSchemaName` is the OpenAI structured-output schema identifier.
 * The client looks the name up in `RESPONSE_SCHEMA_REGISTRY` to find
 * the matching JSON Schema + version, then sends both to the SDK.
 *
 * `structuredOutputSchemaVersion` is the version of the JSON Schema we
 * project to OpenAI; it is recorded in the persisted fingerprint so a
 * result can be reused only when the schema matches.
 *
 * `maxCompletionTokens` is the per-call cap on completion tokens sent
 * to the OpenAI SDK as `max_completion_tokens`. When omitted, the SDK
 * uses its server-side default. Currently only scoring requests set
 * this (`2000`, per F9) — profile extraction inherits the default.
 *
 * `sources` is carried for compatibility with the post-extraction
 * fingerprint inputs and the existing extraction-service flow. The
 * client does NOT consume `sources` directly — the caller is
 * responsible for any source-to-prompt mapping before passing
 * `messages`. New operations are free to leave it empty.
 */
export interface OpenAIExtractionRequest {
  readonly promptVersion: string;
  readonly model: string;
  readonly reasoningEffort: 'low' | 'medium' | 'high';
  readonly messages: readonly OpenAIChatMessage[];
  readonly sources: readonly OpenAIExtractionSource[];
  readonly responseSchemaName: string;
  readonly structuredOutputSchemaVersion: number;
  readonly maxCompletionTokens?: number;
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
