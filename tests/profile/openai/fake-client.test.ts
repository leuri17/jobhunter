import { beforeEach, describe, expect, it } from 'vitest';

import { FakeOpenAIClient } from '../../../src/profile/openai/fake-client.js';
import type {
  OpenAIExtractionRawResponse,
  OpenAIExtractionRequest,
} from '../../../src/profile/openai/types.js';

const REQUEST: OpenAIExtractionRequest = {
  promptVersion: 'profile-extraction-prompt@v1',
  model: 'gpt-5.6-sol',
  reasoningEffort: 'medium',
  responseSchemaName: 'ExtractedProfile',
  structuredOutputSchemaVersion: 1,
  sources: [{ sourceId: 'source_1', originalFilename: 'cv.md', extractedText: 'Hello' }],
  messages: [
    { role: 'system', content: 'system prompt' },
    { role: 'user', content: 'user prompt' },
  ],
};

function response(rawJsonText: string): OpenAIExtractionRawResponse {
  return {
    rawJsonText,
    tokenUsage: { promptTokens: 10, completionTokens: 20 },
  };
}

describe('FakeOpenAIClient', () => {
  let client: FakeOpenAIClient;

  beforeEach(() => {
    client = new FakeOpenAIClient({
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
    const failing = new FakeOpenAIClient({ error: new Error('boom') });
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
