import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { STRUCTURED_OUTPUT_SCHEMA_VERSION } from '../../../src/profile/ai-provider/structured-output.js';
import {
  AiProviderAuthenticationError,
  AiProviderBillingError,
  AiProviderEmptyResponseError,
  AiProviderNetworkError,
  AiProviderInvalidRequestError,
  AiProviderRateLimitError,
  AiProviderRefusalError,
  AiProviderServerError,
  AiProviderUnsupportedModelError,
  ProfileExtractionError,
  ProfileExtractionRefusalError,
} from '../../../src/profile/ai-provider/errors.js';

import type { AiProviderExtractionRequest } from '../../../src/profile/ai-provider/types.js';

const REQUEST: AiProviderExtractionRequest = {
  promptVersion: 'profile-extraction-prompt@v2',
  model: 'gpt-5.6-sol',
  reasoningEffort: 'medium',
  responseSchemaName: 'ExtractedProfile',
  structuredOutputSchemaVersion: STRUCTURED_OUTPUT_SCHEMA_VERSION,
  sources: [{ sourceId: 'source_1', originalFilename: 'cv.md', extractedText: 'Hello' }],
  messages: [
    { role: 'system', content: 'system prompt' },
    { role: 'user', content: 'user prompt' },
  ],
};

// Hoisted so the `openai` mock below can close over it.
const fakeCreate = vi.hoisted(() => vi.fn());

// Hoisted so the `openai` mock below can close over it.
const fakeModelsList = vi.hoisted(() => vi.fn());

// Spy on the real SDK constructor so we can assert the options we pass.
const fakeConstructor = vi.hoisted(() => vi.fn());

vi.mock('openai', async (importOriginal) => {
  const actual = await importOriginal<typeof import('openai')>();
  return {
    ...actual,
    default: class FakeAiProvider {
      constructor(options: Record<string, unknown>) {
        fakeConstructor(options);
      }
      chat = {
        completions: {
          create: fakeCreate,
        },
      };
      models = {
        list: fakeModelsList,
      };
    },
  };
});

let createDefaultAiProviderClient: typeof import('../../../src/profile/ai-provider/client.js').createDefaultAiProviderClient;
let ApiError: typeof import('openai').APIError;
let AuthenticationError: typeof import('openai').AuthenticationError;
let PermissionDeniedError: typeof import('openai').PermissionDeniedError;
let RateLimitError: typeof import('openai').RateLimitError;
let BadRequestError: typeof import('openai').BadRequestError;
let NotFoundError: typeof import('openai').NotFoundError;
let InternalServerError: typeof import('openai').InternalServerError;
let APIConnectionError: typeof import('openai').APIConnectionError;

beforeEach(async () => {
  vi.clearAllMocks();
  fakeCreate.mockReset();
  fakeConstructor.mockReset();
  fakeModelsList.mockReset();
  const sdk = await import('openai');
  ({
    APIError: ApiError,
    AuthenticationError,
    PermissionDeniedError,
    RateLimitError,
    BadRequestError,
    NotFoundError,
    InternalServerError,
    APIConnectionError,
  } = sdk);
  ({ createDefaultAiProviderClient } = await import('../../../src/profile/ai-provider/client.js'));
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('createDefaultAiProviderClient', () => {
  it('returns the raw response text and the token usage on 200', async () => {
    fakeCreate.mockResolvedValueOnce({
      choices: [
        { message: { content: '{"basics":{"headline":"x"}}' }, finish_reason: 'stop', index: 0 },
      ],
      usage: {
        prompt_tokens: 12,
        completion_tokens: 34,
        total_tokens: 46,
      },
    });

    const client = createDefaultAiProviderClient({ apiKey: 'sk-test' });
    const result = await client.extract(REQUEST);

    expect(result.rawJsonText).toBe('{"basics":{"headline":"x"}}');
    expect(result.tokenUsage).toEqual({ promptTokens: 12, completionTokens: 34 });
  });

  it('returns null tokenUsage when the upstream omits usage', async () => {
    fakeCreate.mockResolvedValueOnce({
      choices: [{ message: { content: '{"ok":true}' }, finish_reason: 'stop', index: 0 }],
      usage: null,
    });

    const client = createDefaultAiProviderClient({ apiKey: 'sk-test' });
    const result = await client.extract(REQUEST);

    expect(result.tokenUsage).toBeNull();
  });

  it('passes apiKey and timeout into the AiProvider SDK constructor', async () => {
    fakeCreate.mockResolvedValueOnce({
      choices: [{ message: { content: '{"ok":true}' }, finish_reason: 'stop', index: 0 }],
      usage: null,
    });

    createDefaultAiProviderClient({ apiKey: 'sk-test', timeoutMs: 12_345 });
    expect(fakeConstructor).toHaveBeenCalledWith({ apiKey: 'sk-test', timeout: 12_345 });
  });

  it('passes request.messages through to the AiProvider SDK unchanged', async () => {
    fakeCreate.mockResolvedValueOnce({
      choices: [{ message: { content: '{"ok":true}' }, finish_reason: 'stop', index: 0 }],
      usage: null,
    });

    const client = createDefaultAiProviderClient({ apiKey: 'sk-test' });
    await client.extract(REQUEST);

    expect(fakeCreate).toHaveBeenCalledTimes(1);
    const call = fakeCreate.mock.calls[0]?.[0] as {
      messages: { role: string; content: string }[];
    };
    // The client is a pure transport — it must forward the caller's
    // pre-built messages exactly. Prompt construction is the caller's
    // job (see `buildProfileExtractionPrompt` for profile extraction
    // and `buildScoringPrompt` for scoring, ).
    expect(call.messages).toEqual(REQUEST.messages);
  });

  it('passes max_completion_tokens to the SDK when the request sets it', async () => {
    fakeCreate.mockResolvedValueOnce({
      choices: [{ message: { content: '{"ok":true}' }, finish_reason: 'stop', index: 0 }],
      usage: null,
    });

    const client = createDefaultAiProviderClient({ apiKey: 'sk-test' });
    await client.extract({ ...REQUEST, maxCompletionTokens: 2000 });

    const call = fakeCreate.mock.calls[0]?.[0] as { max_completion_tokens?: number };
    expect(call.max_completion_tokens).toBe(2000);
  });

  it('omits max_completion_tokens from the SDK call when the request does not set it', async () => {
    fakeCreate.mockResolvedValueOnce({
      choices: [{ message: { content: '{"ok":true}' }, finish_reason: 'stop', index: 0 }],
      usage: null,
    });

    const client = createDefaultAiProviderClient({ apiKey: 'sk-test' });
    await client.extract(REQUEST);

    const call = fakeCreate.mock.calls[0]?.[0] as Record<string, unknown>;
    expect('max_completion_tokens' in call).toBe(false);
  });

  it('looks up the response schema in RESPONSE_SCHEMA_REGISTRY and sends it to the SDK', async () => {
    fakeCreate.mockResolvedValueOnce({
      choices: [{ message: { content: '{"ok":true}' }, finish_reason: 'stop', index: 0 }],
      usage: null,
    });

    const client = createDefaultAiProviderClient({ apiKey: 'sk-test' });
    await client.extract(REQUEST);

    const call = fakeCreate.mock.calls[0]?.[0] as {
      response_format: {
        type: string;
        json_schema: { name: string; schema: Record<string, unknown>; strict: boolean };
      };
    };
    expect(call.response_format.type).toBe('json_schema');
    expect(call.response_format.json_schema.name).toBe('ExtractedProfile');
    expect(call.response_format.json_schema.strict).toBe(true);
    // The schema sent to the SDK is the JSON Schema projection of
    // `ExtractedProfileSchema`, not the Zod source.
    expect(call.response_format.json_schema.schema['type']).toBe('object');
    expect(call.response_format.json_schema.schema['properties']).toBeDefined();
  });

  it('throws UnknownResponseSchemaError when the request uses an unregistered name', async () => {
    const client = createDefaultAiProviderClient({ apiKey: 'sk-test' });
    await expect(
      client.extract({ ...REQUEST, responseSchemaName: 'NoSuchSchema' }),
    ).rejects.toThrow(/Unknown response schema name/);
  });

  it('throws ResponseSchemaVersionMismatchError when the request version does not match', async () => {
    const client = createDefaultAiProviderClient({ apiKey: 'sk-test' });
    await expect(
      client.extract({ ...REQUEST, structuredOutputSchemaVersion: 999 }),
    ).rejects.toThrow(/version mismatch/);
  });

  it('translates 401 / AuthenticationError to AiProviderAuthenticationError', async () => {
    const sdkError = new AuthenticationError(
      401,
      { type: 'invalid_request_error', message: 'bad api key' },
      'upstream',
      new Headers(),
    );
    fakeCreate.mockRejectedValueOnce(sdkError);

    const client = createDefaultAiProviderClient({ apiKey: 'sk-test' });
    await expect(client.extract(REQUEST)).rejects.toBeInstanceOf(AiProviderAuthenticationError);
  });

  it('translates 403 / PermissionDeniedError to AiProviderPermissionError', async () => {
    const sdkError = new PermissionDeniedError(
      403,
      { type: 'invalid_request_error', message: 'no access' },
      'upstream',
      new Headers(),
    );
    fakeCreate.mockRejectedValueOnce(sdkError);

    const client = createDefaultAiProviderClient({ apiKey: 'sk-test' });
    await expect(client.extract(REQUEST)).rejects.toMatchObject({
      code: 'openai_permission',
      name: 'AiProviderPermissionError',
    });
  });

  it('translates 429 with Retry-After: 2 to AiProviderRateLimitError(retryAfterMs = 2000)', async () => {
    const sdkError = new RateLimitError(
      429,
      { type: 'rate_limit_error', message: 'slow down' },
      'upstream',
      new Headers({ 'retry-after': '2' }),
    );
    fakeCreate.mockRejectedValueOnce(sdkError);

    const client = createDefaultAiProviderClient({ apiKey: 'sk-test' });
    const rejected = await client.extract(REQUEST).catch((err: unknown) => err);
    expect(rejected).toBeInstanceOf(AiProviderRateLimitError);
    expect((rejected as AiProviderRateLimitError).retryAfterMs).toBe(2000);
  });

  it('translates 429 with insufficient_quota to AiProviderBillingError (not retryable)', async () => {
    const sdkError = new RateLimitError(
      429,
      { type: 'insufficient_quota', code: 'insufficient_quota', message: 'no more credits' },
      'upstream',
      new Headers(),
    );
    fakeCreate.mockRejectedValueOnce(sdkError);

    const client = createDefaultAiProviderClient({ apiKey: 'sk-test' });
    const rejected = await client.extract(REQUEST).catch((err: unknown) => err);
    expect(rejected).toBeInstanceOf(AiProviderBillingError);
    expect(rejected).not.toBeInstanceOf(AiProviderRateLimitError);
  });

  it('translates 400 invalid_request_error to AiProviderInvalidRequestError', async () => {
    const sdkError = new BadRequestError(
      400,
      { type: 'invalid_request_error', message: 'bad schema' },
      'upstream',
      new Headers(),
    );
    fakeCreate.mockRejectedValueOnce(sdkError);

    const client = createDefaultAiProviderClient({ apiKey: 'sk-test' });
    await expect(client.extract(REQUEST)).rejects.toBeInstanceOf(AiProviderInvalidRequestError);
  });

  it('translates 404 model_not_found to AiProviderUnsupportedModelError', async () => {
    const sdkError = new NotFoundError(
      404,
      { type: 'model_not_found', code: 'model_not_found', message: 'unknown model' },
      'upstream',
      new Headers(),
    );
    fakeCreate.mockRejectedValueOnce(sdkError);

    const client = createDefaultAiProviderClient({ apiKey: 'sk-test' });
    await expect(client.extract(REQUEST)).rejects.toBeInstanceOf(AiProviderUnsupportedModelError);
  });

  it('translates 404 without model_not_found to AiProviderInvalidRequestError', async () => {
    const sdkError = new NotFoundError(
      404,
      { type: 'invalid_request_error', message: 'no such endpoint' },
      'upstream',
      new Headers(),
    );
    fakeCreate.mockRejectedValueOnce(sdkError);

    const client = createDefaultAiProviderClient({ apiKey: 'sk-test' });
    const rejected = await client.extract(REQUEST).catch((err: unknown) => err);
    expect(rejected).toBeInstanceOf(AiProviderInvalidRequestError);
    expect(rejected).not.toBeInstanceOf(AiProviderUnsupportedModelError);
  });

  it('translates 402 / quota to AiProviderBillingError', async () => {
    // The AiProvider SDK has no dedicated 402 class; `APIError` is the
    // base class for any status code without a more specific subclass.
    const sdkError = new ApiError(
      402,
      { type: 'insufficient_quota', code: 'insufficient_quota', message: 'no more credits' },
      'upstream',
      new Headers(),
    );
    fakeCreate.mockRejectedValueOnce(sdkError);

    const client = createDefaultAiProviderClient({ apiKey: 'sk-test' });
    await expect(client.extract(REQUEST)).rejects.toBeInstanceOf(AiProviderBillingError);
  });

  it('translates 500 server errors to AiProviderServerError', async () => {
    const sdkError = new InternalServerError(
      500,
      { type: 'server_error', message: 'kaboom' },
      'upstream',
      new Headers(),
    );
    fakeCreate.mockRejectedValueOnce(sdkError);

    const client = createDefaultAiProviderClient({ apiKey: 'sk-test' });
    await expect(client.extract(REQUEST)).rejects.toBeInstanceOf(AiProviderServerError);
  });

  it('translates transport failures to AiProviderNetworkError', async () => {
    const sdkError = new APIConnectionError({ message: 'ECONNRESET', cause: new Error('reset') });
    fakeCreate.mockRejectedValueOnce(sdkError);

    const client = createDefaultAiProviderClient({ apiKey: 'sk-test' });
    await expect(client.extract(REQUEST)).rejects.toBeInstanceOf(AiProviderNetworkError);
  });

  it('re-throws existing ProfileExtractionError subclasses unchanged', async () => {
    const preserved = new AiProviderAuthenticationError();
    fakeCreate.mockRejectedValueOnce(preserved);

    const client = createDefaultAiProviderClient({ apiKey: 'sk-test' });
    let caught: unknown;
    try {
      await client.extract(REQUEST);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBe(preserved);
    expect(caught).toBeInstanceOf(ProfileExtractionError);
  });

  it('raises AiProviderRefusalError when the model returns a refusal', async () => {
    // The AiProvider SDK returns HTTP 200 on refusal; the model signals the
    // decline via `choices[0].message.refusal` (with `content: null`).
    // The client must surface this as a typed `AiProviderRefusalError`
    // instead of letting the caller parse an empty body as a real
    // extraction.
    fakeCreate.mockResolvedValueOnce({
      choices: [
        {
          message: { content: null, refusal: 'I cannot help with that request.' },
          finish_reason: 'stop',
          index: 0,
        },
      ],
      usage: null,
    });

    const client = createDefaultAiProviderClient({ apiKey: 'sk-test' });
    const rejected = await client.extract(REQUEST).catch((err: unknown) => err);
    expect(rejected).toBeInstanceOf(AiProviderRefusalError);
    expect(rejected).toBeInstanceOf(ProfileExtractionError);
    // Refusals are policy decisions — retrying won't help, so the error
    // must NOT carry the corrective-retry marker.
    expect((rejected as AiProviderRefusalError).refusalText).toBe(
      'I cannot help with that request.',
    );
    expect((rejected as ProfileExtractionError).code).toBe('openai_refusal');
  });

  it('raises AiProviderEmptyResponseError when the model returns an empty content', async () => {
    // Some models emit `content: ""` on refusal-like behaviour without
    // populating the `refusal` field, or when truncation /
    // content-filter removes the completion. The client must fail loud
    // instead of returning an empty string that would later fail Zod
    // validation as a generic `AiProviderInvalidOutputError`.
    fakeCreate.mockResolvedValueOnce({
      choices: [
        { message: { content: '', refusal: null }, finish_reason: 'content_filter', index: 0 },
      ],
      usage: null,
    });

    const client = createDefaultAiProviderClient({ apiKey: 'sk-test' });
    const rejected = await client.extract(REQUEST).catch((err: unknown) => err);
    expect(rejected).toBeInstanceOf(AiProviderEmptyResponseError);
    expect(rejected).toBeInstanceOf(ProfileExtractionError);
    expect((rejected as AiProviderEmptyResponseError).code).toBe('openai_empty_response');
  });

  it('raises AiProviderEmptyResponseError when the completion is missing choices', async () => {
    // Defensive: an SDK response with no `choices` array should be
    // treated identically to an empty content, not surfaced as `{}` or
    // `null` upstream.
    fakeCreate.mockResolvedValueOnce({
      choices: [],
      usage: null,
    });

    const client = createDefaultAiProviderClient({ apiKey: 'sk-test' });
    await expect(client.extract(REQUEST)).rejects.toBeInstanceOf(AiProviderEmptyResponseError);
  });

  it('treats a whitespace-only content as empty', async () => {
    // Trimming guards against models that emit only whitespace (e.g.
    // a single newline) which `rawJsonText` validation would otherwise
    // surface as a misleading Zod failure.
    fakeCreate.mockResolvedValueOnce({
      choices: [
        { message: { content: '   \n  ', refusal: null }, finish_reason: 'stop', index: 0 },
      ],
      usage: null,
    });

    const client = createDefaultAiProviderClient({ apiKey: 'sk-test' });
    await expect(client.extract(REQUEST)).rejects.toBeInstanceOf(AiProviderEmptyResponseError);
  });
});

describe('createDefaultAiProviderClient — refusal detector (audit B2-M8)', () => {
  it('raises ProfileExtractionRefusalError when the raw content contains a default refusal marker', async () => {
    // Pre-fix this would have returned the refusal text as a successful
    // (but empty) extraction; post-fix it surfaces as a typed refusal
    // so the retry classifier (`runWithRetry`'s correctiveRetry
    // budget) can pick it up.
    fakeCreate.mockResolvedValueOnce({
      choices: [
        {
          message: {
            content: 'I cannot help with that request.',
            refusal: null,
          },
          finish_reason: 'stop',
          index: 0,
        },
      ],
      usage: null,
    });

    const client = createDefaultAiProviderClient({ apiKey: 'sk-test' });
    const rejected = await client.extract(REQUEST).catch((err: unknown) => err);
    expect(rejected).toBeInstanceOf(ProfileExtractionRefusalError);
    expect(rejected).toBeInstanceOf(ProfileExtractionError);
    expect((rejected as ProfileExtractionRefusalError).code).toBe('profile_extraction_refusal');
    // Refusal detection is retryable-once (correctiveRetry = true)
    // — the model may not refuse next time, so a single corrective
    // retry is appropriate.
    expect((rejected as ProfileExtractionRefusalError).correctiveRetry).toBe(true);
    // The reason + matched marker are surfaced in the metadata so
    // operators can audit which phrase tripped the detector.
    const metadata = (rejected as ProfileExtractionError).metadata as Record<string, unknown>;
    expect(metadata['reason']).toBe('refusal_marker');
    expect(metadata['matchedMarker']).toBe('I cannot');
  });

  it('raises ProfileExtractionRefusalError when the raw content is `{}`', async () => {
    // An empty JSON object is a strong refusal signal — the upstream
    // model filled the content slot but emitted no data.
    fakeCreate.mockResolvedValueOnce({
      choices: [{ message: { content: '{}', refusal: null }, finish_reason: 'stop', index: 0 }],
      usage: null,
    });

    const client = createDefaultAiProviderClient({ apiKey: 'sk-test' });
    const rejected = await client.extract(REQUEST).catch((err: unknown) => err);
    expect(rejected).toBeInstanceOf(ProfileExtractionRefusalError);
    const metadata = (rejected as ProfileExtractionError).metadata as Record<string, unknown>;
    expect(metadata['reason']).toBe('empty_json_object');
  });

  it('honours a custom marker list passed via `refusal.markers`', async () => {
    fakeCreate.mockResolvedValueOnce({
      choices: [
        {
          message: {
            content: 'Custom refusal phrase XYZ',
            refusal: null,
          },
          finish_reason: 'stop',
          index: 0,
        },
      ],
      usage: null,
    });

    const client = createDefaultAiProviderClient({
      apiKey: 'sk-test',
      refusal: {
        refusalMarkers: ['Custom refusal phrase XYZ'],
        flagEmptyBodies: false,
      },
    });
    const rejected = await client.extract(REQUEST).catch((err: unknown) => err);
    expect(rejected).toBeInstanceOf(ProfileExtractionRefusalError);
    const metadata = (rejected as ProfileExtractionError).metadata as Record<string, unknown>;
    expect(metadata['matchedMarker']).toBe('Custom refusal phrase XYZ');
  });

  it('does NOT raise a refusal when the custom marker list is empty (and content is non-empty)', async () => {
    fakeCreate.mockResolvedValueOnce({
      choices: [
        {
          message: {
            content: 'I cannot help with that request.',
            refusal: null,
          },
          finish_reason: 'stop',
          index: 0,
        },
      ],
      usage: null,
    });

    const client = createDefaultAiProviderClient({
      apiKey: 'sk-test',
      refusal: { refusalMarkers: [], flagEmptyBodies: true },
    });
    // No refusal-marker match — the model returned a refusal-like
    // string, but the (deliberately empty) custom marker list opts
    // out of the refusal scan. Empty-body detection is still on.
    const result = await client.extract(REQUEST);
    expect(result.rawJsonText).toBe('I cannot help with that request.');
  });

  it('lets a valid non-empty response through unchanged', async () => {
    fakeCreate.mockResolvedValueOnce({
      choices: [
        {
          message: {
            content: '{"basics":{"headline":"Senior Engineer"}}',
            refusal: null,
          },
          finish_reason: 'stop',
          index: 0,
        },
      ],
      usage: null,
    });

    const client = createDefaultAiProviderClient({ apiKey: 'sk-test' });
    const result = await client.extract(REQUEST);
    expect(result.rawJsonText).toBe('{"basics":{"headline":"Senior Engineer"}}');
  });
});

describe('createDefaultAiProviderClient — listModels', () => {
  /**
   * Minimal stand-in for the SDK's `ModelsPage`: an object that is only
   * async-iterable, exactly the surface `listModels()` consumes.
   */
  function fakeModelsPage(ids: readonly string[]): AsyncIterable<{ id: string }> {
    const queue = ids.map((id) => ({ id }));
    return {
      [Symbol.asyncIterator]() {
        return {
          next: (): Promise<IteratorResult<{ id: string }>> =>
            Promise.resolve(
              queue.length > 0
                ? { done: false, value: queue.shift()! }
                : { done: true, value: undefined },
            ),
        };
      },
    };
  }

  it('returns the collected model ids sorted lexicographically', async () => {
    fakeModelsList.mockResolvedValueOnce(
      fakeModelsPage(['gpt-5.6-sol', 'gpt-4.1-nano', 'gpt-5.6-mini']),
    );

    const client = createDefaultAiProviderClient({ apiKey: 'sk-test' });
    await expect(client.listModels()).resolves.toEqual([
      'gpt-4.1-nano',
      'gpt-5.6-mini',
      'gpt-5.6-sol',
    ]);
  });

  it('translates an SDK authentication error from models.list to AiProviderAuthenticationError', async () => {
    const sdkError = new AuthenticationError(
      401,
      { type: 'invalid_request_error', message: 'bad api key' },
      'upstream',
      new Headers(),
    );
    fakeModelsList.mockRejectedValueOnce(sdkError);

    const client = createDefaultAiProviderClient({ apiKey: 'sk-test' });
    await expect(client.listModels()).rejects.toBeInstanceOf(AiProviderAuthenticationError);
  });
});
