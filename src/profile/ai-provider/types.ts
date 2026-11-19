/**
 * Shared operation types for the AiProvider client surface.
 *
 * These interfaces are the boundary between the pure domain code (which
 * composes the request and consumes the raw response) and the AiProvider SDK
 * adapter (which performs the actual network call). The HTTP transport
 * and SDK are isolated behind `AiProviderClient`; nothing else in `src/`
 * imports `openai` directly.
 *
 * The `AiProviderClient` interface is shared by profile extraction
 * and job scoring. The shape of the request is
 * generic — the prompt template and the response schema are looked up
 * at the client via the response-schema registry, so adding a new
 * operation is purely a registry entry (see `./response-schemas.ts`).
 */

/**
 * A chat message sent to the AiProvider SDK. The model only requires the
 * two roles listed here; the client is responsible for the exact
 * ordering and the total token budget.
 */
export interface AiProviderChatMessage {
  readonly role: 'system' | 'user';
  readonly content: string;
}

/**
 * A single source supplied to the extraction prompt.
 *
 * `sourceId` is the opaque `'source_<int>'` identifier exposed to the model
 * (per ). The model is expected to echo this back inside every
 * `SourceReference.sourceId` so the post-processor can map extracted facts
 * back to the originating source.
 */
export interface AiProviderExtractionSource {
  readonly sourceId: string;
  readonly originalFilename: string;
  readonly extractedText: string;
}

/**
 * Inputs for one AiProvider request.
 *
 * `promptVersion` is the versioned prompt identifier the caller used to
 * build `messages` (e.g. `PROFILE_EXTRACTION_PROMPT_VERSION` for
 * extraction, or the scoring prompt version for scoring). It is the
 * caller's responsibility to assert the prompt version is current
 * the client transports whatever the caller supplies.
 *
 * `messages` is the pre-built chat payload the client passes through to
 * the AiProvider SDK. Building messages is a domain concern; the client is
 * a pure transport and never builds messages itself. The prompt builder
 * for profile extraction lives at `./prompt.ts`; the scoring prompt
 * builder lives at `../../scoring/prompt.ts`.
 *
 * `responseSchemaName` is the AiProvider structured-output schema identifier.
 * The client looks the name up in `RESPONSE_SCHEMA_REGISTRY` to find
 * the matching JSON Schema + version, then sends both to the SDK.
 *
 * `structuredOutputSchemaVersion` is the version of the JSON Schema we
 * project to AiProvider; it is recorded in the persisted fingerprint so a
 * result can be reused only when the schema matches.
 *
 * `maxCompletionTokens` is the per-call cap on completion tokens sent
 * to the AiProvider SDK as `max_completion_tokens`. When omitted, the SDK
 * uses its server-side default. Currently only scoring requests set
 * this (`2000`, per F9) — profile extraction inherits the default.
 *
 * `sources` is carried for compatibility with the post-extraction
 * fingerprint inputs and the existing extraction-service flow. The
 * client does NOT consume `sources` directly — the caller is
 * responsible for any source-to-prompt mapping before passing
 * `messages`. New operations are free to leave it empty.
 */
export interface AiProviderExtractionRequest {
  readonly promptVersion: string;
  readonly model: string;
  readonly reasoningEffort: 'low' | 'medium' | 'high';
  readonly messages: readonly AiProviderChatMessage[];
  readonly sources: readonly AiProviderExtractionSource[];
  readonly responseSchemaName: string;
  readonly structuredOutputSchemaVersion: number;
  readonly maxCompletionTokens?: number;
}

/**
 * Raw response from the AiProvider adapter.
 *
 * `rawJsonText` is the JSON text the model produced (the adapter does not
 * validate it — that is the caller's responsibility). `tokenUsage` is
 * `null` when the upstream response omitted usage information.
 */
export interface AiProviderExtractionRawResponse {
  readonly rawJsonText: string;
  readonly tokenUsage: { readonly promptTokens: number; readonly completionTokens: number } | null;
}

/**
 * The narrow contract every AiProvider adapter (production SDK, fake, etc.)
 * must satisfy. The adapter is responsible for transport, retry-relevant
 * error translation, and producing `rawJsonText`; the caller is responsible
 * for JSON parsing, Zod validation, and persistence.
 */
export interface AiProviderClient {
  extract(request: AiProviderExtractionRequest): Promise<AiProviderExtractionRawResponse>;

  /**
   * Cheap authenticated probe — no token cost. Resolves when the key is
   * accepted; rejects with a typed `ProfileExtractionError` family error:
   * `AiProviderAuthenticationError` / `AiProviderPermissionError` /
   * `AiProviderBillingError` mean the key is rejected; transport, timeout,
   * server, and rate-limit failures mean "cannot tell right now".
   */
  validate(): Promise<void>;

  /**
   * Free authenticated probe backed by `models.list()` — no token cost.
   * Resolves with the ids of the models the key can access, sorted
   * lexicographically; rejects with the same typed `ProfileExtractionError`
   * family errors as {@link validate}.
   */
  listModels(): Promise<readonly string[]>;
}
