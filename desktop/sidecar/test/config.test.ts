import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildServer } from '../src/server.js';
import { OpenAIAuthenticationError, OpenAINetworkError } from '@jobhunter/core/profile';
import { maskSecret } from '@jobhunter/core/config';

describe('config endpoints', () => {
  let server: Awaited<ReturnType<typeof buildServer>>;
  let baseUrl: string;

  beforeAll(async () => {
    server = await buildServer({ env: { port: 0, host: '127.0.0.1' } });
    baseUrl = await server.listen();
  });

  afterAll(async () => {
    await server.close();
  });

  it('GET /api/config returns the loaded config', async () => {
    const res = await fetch(`${baseUrl}/api/config`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { schemaVersion: number };
    expect(body.schemaVersion).toBe(1);
  });

  it('POST /api/config/validate responds', async () => {
    const res = await fetch(`${baseUrl}/api/config/validate`, { method: 'POST' });
    expect([200, 400]).toContain(res.status);
  });
});

interface ApiKeyState {
  readonly configured: boolean;
  readonly source: 'stored' | 'environment' | 'none';
  readonly masked: string;
}

interface ErrorEnvelope {
  readonly schemaVersion: number;
  readonly error: { readonly code: string; readonly message: string; readonly details: unknown };
}

describe('PUT /api/secrets/api-key', () => {
  const OLD_KEY = 'sk-old-key-123456';
  const NEW_KEY = 'sk-new-key-654321';

  let configHome: string;
  const servers: Awaited<ReturnType<typeof buildServer>>[] = [];

  beforeEach(() => {
    configHome = mkdtempSync(join(tmpdir(), 'jobhunter-secrets-test-'));
    vi.stubEnv('XDG_CONFIG_HOME', configHome);
    vi.stubEnv('HOME', configHome);
    vi.stubEnv('OPENAI_API_KEY', '');
  });

  afterEach(async () => {
    for (const server of servers.splice(0)) {
      await server.close();
    }
    vi.unstubAllEnvs();
    rmSync(configHome, { recursive: true, force: true });
  });

  async function startServer(validateApiKey: (apiKey: string) => Promise<void>): Promise<string> {
    const server = await buildServer({
      env: { port: 0, host: '127.0.0.1' },
      validateApiKey,
    });
    servers.push(server);
    return server.listen();
  }

  async function putKey(baseUrl: string, apiKey: string): Promise<Response> {
    return fetch(`${baseUrl}/api/secrets/api-key`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ apiKey }),
    });
  }

  async function getKey(baseUrl: string): Promise<ApiKeyState> {
    const res = await fetch(`${baseUrl}/api/secrets/api-key`);
    expect(res.status).toBe(200);
    return (await res.json()) as ApiKeyState;
  }

  async function storeKey(baseUrl: string, apiKey: string): Promise<void> {
    const res = await putKey(baseUrl, apiKey);
    expect(res.status).toBe(200);
  }

  it('persists the key when validation succeeds', async () => {
    const calls: string[] = [];
    const baseUrl = await startServer(async (apiKey) => {
      calls.push(apiKey);
    });

    const res = await putKey(baseUrl, 'sk-test-valid-123');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      schemaVersion: 1,
      status: 'validated',
      configured: true,
      source: 'stored',
      masked: maskSecret('sk-test-valid-123'),
    });
    expect(calls).toEqual(['sk-test-valid-123']);

    expect(await getKey(baseUrl)).toEqual({
      schemaVersion: 1,
      configured: true,
      source: 'stored',
      masked: maskSecret('sk-test-valid-123'),
    });
  });

  it('rejects with 401 and keeps the previously stored key when validation fails with an auth error', async () => {
    const okUrl = await startServer(async () => undefined);
    await storeKey(okUrl, OLD_KEY);

    const failUrl = await startServer(async () => {
      throw new OpenAIAuthenticationError({ status: 401 });
    });
    const res = await putKey(failUrl, NEW_KEY);
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({
      schemaVersion: 1,
      error: {
        code: 'openai_authentication',
        message: 'OpenAI authentication failed.',
        details: null,
      },
    } satisfies ErrorEnvelope);

    expect(await getKey(failUrl)).toEqual({
      schemaVersion: 1,
      configured: true,
      source: 'stored',
      masked: maskSecret(OLD_KEY),
    });
  });

  it('rejects with 503 and keeps the previously stored key when validation fails with a network error', async () => {
    const okUrl = await startServer(async () => undefined);
    await storeKey(okUrl, OLD_KEY);

    const failUrl = await startServer(async () => {
      throw new OpenAINetworkError({ status: null });
    });
    const res = await putKey(failUrl, NEW_KEY);
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({
      schemaVersion: 1,
      error: {
        code: 'openai_network_error',
        message: 'OpenAI network failure.',
        details: null,
      },
    } satisfies ErrorEnvelope);

    expect(await getKey(failUrl)).toEqual({
      schemaVersion: 1,
      configured: true,
      source: 'stored',
      masked: maskSecret(OLD_KEY),
    });
  });

  it('rejects with 503 and code unknown when the validator throws a non-typed error', async () => {
    const baseUrl = await startServer(async () => {
      throw new Error('validator exploded');
    });

    const res = await putKey(baseUrl, NEW_KEY);
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({
      schemaVersion: 1,
      error: { code: 'unknown', message: 'validator exploded', details: null },
    } satisfies ErrorEnvelope);

    expect(await getKey(baseUrl)).toEqual({
      schemaVersion: 1,
      configured: false,
      source: 'none',
      masked: '',
    });
  });

  it('clears the stored key without validating when the body is empty', async () => {
    const calls: string[] = [];
    const baseUrl = await startServer(async (apiKey) => {
      calls.push(apiKey);
    });
    await storeKey(baseUrl, OLD_KEY);
    calls.length = 0;

    const res = await putKey(baseUrl, '');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      schemaVersion: 1,
      status: 'validated',
      configured: false,
      source: 'none',
      masked: '',
    });
    expect(calls).toHaveLength(0);

    expect(await getKey(baseUrl)).toEqual({
      schemaVersion: 1,
      configured: false,
      source: 'none',
      masked: '',
    });
  });
});
