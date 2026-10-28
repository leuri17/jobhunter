import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildServer } from '../src/server.js';
import { OpenAIAuthenticationError, OpenAINetworkError } from '@jobhunter/core/profile';
import { FileSecretsStore } from '@jobhunter/core/config';
import { resolvePlatformPaths, createDefaultPlatformAdapter } from '@jobhunter/core/platform';
import type { ResolvedSecretsBackend } from '../src/secrets-backend.js';

describe('GET /api/openai/models', () => {
  let configHome: string;
  const servers: Awaited<ReturnType<typeof buildServer>>[] = [];

  beforeEach(() => {
    configHome = mkdtempSync(join(tmpdir(), 'jobhunter-openai-models-test-'));
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

  function standaloneFileBackend(): Promise<ResolvedSecretsBackend> {
    return Promise.resolve({
      store: new FileSecretsStore({ paths: resolvePlatformPaths(createDefaultPlatformAdapter()) }),
      backend: 'file',
      reason: 'bridge_not_configured',
    });
  }

  async function startServer(listModels: () => Promise<readonly string[] | null>): Promise<string> {
    const server = await buildServer({
      env: { port: 0, host: '127.0.0.1' },
      listModels,
      secretsBackend: standaloneFileBackend,
    });
    servers.push(server);
    return server.listen();
  }

  it('returns configured false with an empty model list when no key is configured', async () => {
    const baseUrl = await startServer(async () => null);

    const res = await fetch(`${baseUrl}/api/openai/models`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ schemaVersion: 1, configured: false, models: [] });
  });

  it('passes the resolved model list through unsorted', async () => {
    const baseUrl = await startServer(async () => ['b-model', 'a-model']);

    const res = await fetch(`${baseUrl}/api/openai/models`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      schemaVersion: 1,
      configured: true,
      models: ['b-model', 'a-model'],
    });
  });

  it('maps an authentication failure to 401 with the typed error envelope', async () => {
    const baseUrl = await startServer(async () => {
      throw new OpenAIAuthenticationError({ status: 401 });
    });

    const res = await fetch(`${baseUrl}/api/openai/models`);
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({
      schemaVersion: 1,
      error: {
        code: 'openai_authentication',
        message: 'OpenAI authentication failed.',
        details: null,
      },
    });
  });

  it('maps a network failure to 503 with the typed error envelope', async () => {
    const baseUrl = await startServer(async () => {
      throw new OpenAINetworkError({ status: null });
    });

    const res = await fetch(`${baseUrl}/api/openai/models`);
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({
      schemaVersion: 1,
      error: {
        code: 'openai_network_error',
        message: 'OpenAI network failure.',
        details: null,
      },
    });
  });
});
