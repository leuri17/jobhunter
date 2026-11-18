import { beforeEach, describe, expect, it } from 'vitest';

import { STRUCTURED_OUTPUT_SCHEMA_VERSION } from '../../../src/profile/ai-provider/structured-output.js';
import { FakeAiProviderClient } from '../../../src/profile/ai-provider/fake-client.js';
import type {
  AiProviderExtractionRawResponse,
  AiProviderExtractionRequest,
} from '../../../src/profile/ai-provider/types.js';

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

function response(rawJsonText: string): AiProviderExtractionRawResponse {
  return {
    rawJsonText,
    tokenUsage: { promptTokens: 10, completionTokens: 20 },
  };
}

describe('FakeAiProviderClient', () => {
  let client: FakeAiProviderClient;

  beforeEach(() => {
    client = new FakeAiProviderClient({
      responses: [response('{"hello":"world"}'), response('{"good":"bye"}')],
    });
  });

  it('drains queued responses in order', async () => {
    await expect(client.extract(REQUEST)).resolves.toEqual({
      rawJsonText: '{"hello":"world"}',
      tokenUsage: { promptTokens: 10, completionTokens: 20 },
    });
    await expect(client.extract(REQUEST)).resolves.toEqual({
      rawJsonText: '{"good":"bye"}',
      tokenUsage: { promptTokens: 10, completionTokens: 20 },
    });
  });

  it('rejects with script.error when provided', async () => {
    const failing = new FakeAiProviderClient({ error: new Error('boom') });
    await expect(failing.extract(REQUEST)).rejects.toThrow('boom');
  });

  it('records every extract call in the requests array', async () => {
    await client.extract(REQUEST);
    await client.extract(REQUEST);
    expect(client.getRequestCount()).toBe(2);
    expect(client.requests).toHaveLength(2);
    expect(client.requests[0]).toBe(REQUEST);
    expect(client.requests[1]).toBe(REQUEST);
  });

  it('keeps returning the last queued response after the queue is exhausted', async () => {
    await client.extract(REQUEST);
    await client.extract(REQUEST);
    // Third call has no queued response — should fall back to the last one.
    await expect(client.extract(REQUEST)).resolves.toEqual({
      rawJsonText: '{"good":"bye"}',
      tokenUsage: { promptTokens: 10, completionTokens: 20 },
    });
    expect(client.getRequestCount()).toBe(3);
  });
});

describe('FakeAiProviderClient — listModels', () => {
  it('returns the default models sorted', async () => {
    const fake = new FakeAiProviderClient({ responses: [response('{"ok":true}')] });
    await expect(fake.listModels()).resolves.toEqual(['gpt-5.6-mini', 'gpt-5.6-sol']);
  });

  it('honors a custom models list', async () => {
    const fake = new FakeAiProviderClient({ responses: [response('{"ok":true}')] });
    fake.models = ['zeta-model', 'alpha-model'];
    await expect(fake.listModels()).resolves.toEqual(['alpha-model', 'zeta-model']);
  });

  it('rejects with modelsError when set', async () => {
    const fake = new FakeAiProviderClient({ responses: [response('{"ok":true}')] });
    fake.modelsError = new Error('models boom');
    await expect(fake.listModels()).rejects.toThrow('models boom');
  });
});
