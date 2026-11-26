import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { buildServer } from '../src/server.js';
import { AiProviderAuthenticationError, AiProviderNetworkError } from '@jobhunter/core/profile';
import {
  DEFAULT_OPERATIONAL_CONFIG,
  FileSecretsStore,
  maskSecret,
  resolveSecretsPath,
  type OperationalConfig,
  type Secrets,
  type SecretsStore,
} from '@jobhunter/core/config';
import { resolvePlatformPaths, createDefaultPlatformAdapter } from '@jobhunter/core/platform';
import type { ResolvedSecretsBackend } from '../src/secrets-backend.js';

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

interface ConfigErrorDetails {
  readonly keys?: readonly string[];
  readonly issues?: readonly { readonly path: readonly string[]; readonly message: string }[];
}

describe('PATCH /api/config', () => {
  let configHome: string;
  let server: Awaited<ReturnType<typeof buildServer>>;
  let baseUrl: string;

  function configPath(): string {
    return resolvePlatformPaths(createDefaultPlatformAdapter()).config.file('config.json');
  }

  beforeEach(async () => {
    configHome = mkdtempSync(join(tmpdir(), 'jobhunter-config-patch-'));
    vi.stubEnv('XDG_CONFIG_HOME', configHome);
    vi.stubEnv('HOME', configHome);
    // The PATCH below writes config.json; refuse to aim it outside the throwaway HOME.
    expect(configPath().startsWith(configHome)).toBe(true);
    server = await buildServer({ env: { port: 0, host: '127.0.0.1' } });
    baseUrl = await server.listen();
  });

  afterEach(async () => {
    await server.close();
    vi.unstubAllEnvs();
    rmSync(configHome, { recursive: true, force: true });
  });

  it('persists an aiProvider patch the way the Settings form sends it', async () => {
    mkdirSync(dirname(configPath()), { recursive: true });
    writeFileSync(
      configPath(),
      JSON.stringify({ ...DEFAULT_OPERATIONAL_CONFIG, output: { runTopN: 5 } }, null, 2),
    );

    const res = await fetch(`${baseUrl}/api/config`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        patch: {
          aiProvider: {
            ...DEFAULT_OPERATIONAL_CONFIG.aiProvider,
            provider: 'groq',
            jobScoring: { ...DEFAULT_OPERATIONAL_CONFIG.aiProvider.jobScoring, concurrency: 7 },
          },
        },
      }),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { config: OperationalConfig };
    expect(body.config.aiProvider.provider).toBe('groq');
    expect(body.config.aiProvider.jobScoring.concurrency).toBe(7);

    const onDisk = JSON.parse(readFileSync(configPath(), 'utf8'));
    expect(onDisk.aiProvider.provider).toBe('groq');
    expect(onDisk.aiProvider.jobScoring.concurrency).toBe(7);
    expect(onDisk.output.runTopN).toBe(5);

    const refetched = (await (await fetch(`${baseUrl}/api/config`)).json()) as {
      config: OperationalConfig;
    };
    expect(refetched.config.aiProvider.provider).toBe('groq');
  });

  function seedConfig(config: OperationalConfig): string {
    const raw = JSON.stringify(config, null, 2);
    mkdirSync(dirname(configPath()), { recursive: true });
    writeFileSync(configPath(), raw);
    return raw;
  }

  function patchConfig(body: unknown): Promise<Response> {
    return fetch(`${baseUrl}/api/config`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  async function errorOf(res: Response): Promise<{ code: string; details: ConfigErrorDetails }> {
    const body = (await res.json()) as ErrorEnvelope;
    return { code: body.error.code, details: body.error.details as ConfigErrorDetails };
  }

  it('rejects a patch whose only key is unknown and leaves config.json untouched (#370)', async () => {
    const seeded = seedConfig({ ...DEFAULT_OPERATIONAL_CONFIG, output: { runTopN: 7 } });

    const res = await patchConfig({ patch: { outpt: { runTopN: 5 } } });

    expect(res.status).toBe(400);
    const { code, details } = await errorOf(res);
    expect(code).toBe('unknown_keys');
    expect(details.keys).toEqual(['outpt']);
    expect(details.issues).toEqual([{ path: ['outpt'], message: expect.any(String) }]);
    expect(readFileSync(configPath(), 'utf8')).toBe(seeded);
  });

  it('rejects an unknown key next to a valid section, so the valid section is not saved either (#370)', async () => {
    const logging = { level: 'warn', prettyTerminal: true } as const;
    seedConfig({ ...DEFAULT_OPERATIONAL_CONFIG, logging });

    const res = await patchConfig({
      patch: { logging: { level: 'debug', prettyTerminal: false }, nope: {} },
    });

    expect(res.status).toBe(400);
    const { code, details } = await errorOf(res);
    expect(code).toBe('unknown_keys');
    expect(details.keys).toEqual(['nope']);
    expect(details.issues).toEqual([{ path: ['nope'], message: expect.any(String) }]);
    expect(JSON.parse(readFileSync(configPath(), 'utf8')).logging).toEqual(logging);
  });

  it('rejects the pre-rename openai key as unknown instead of answering 200 (#370)', async () => {
    const res = await patchConfig({ patch: { openai: {} } });

    expect(res.status).toBe(400);
    const { code, details } = await errorOf(res);
    expect(code).toBe('unknown_keys');
    expect(details.keys).toEqual(['openai']);
  });

  it('rejects a body without the patch wrapper with 400 instead of 500 (#370)', async () => {
    const res = await patchConfig({ output: { runTopN: 5 } });

    expect(res.status).toBe(400);
    const { code, details } = await errorOf(res);
    expect(code).toBe('zod_failed');
    expect(details.issues).toEqual([{ path: ['patch'], message: expect.any(String) }]);
    expect(existsSync(configPath())).toBe(false);
  });

  it.each<[string, unknown]>([
    ['an array body', []],
    ['a null patch', { patch: null }],
  ])('rejects %s with the issue path patch (#370)', async (_case, body) => {
    const res = await patchConfig(body);

    expect(res.status).toBe(400);
    const { code, details } = await errorOf(res);
    expect(code).toBe('zod_failed');
    expect(details.issues).toEqual([{ path: ['patch'], message: expect.any(String) }]);
  });

  it('rejects a patch whose version is not 1 with the issue path version (#370)', async () => {
    const res = await patchConfig({ patch: { version: 2 } });

    expect(res.status).toBe(400);
    const { code, details } = await errorOf(res);
    expect(code).toBe('zod_failed');
    expect(details.issues).toEqual([{ path: ['version'], message: expect.any(String) }]);
  });

  it('still saves the whole config the Settings form submits, version included', async () => {
    seedConfig({ ...DEFAULT_OPERATIONAL_CONFIG, output: { runTopN: 7 } });

    const res = await patchConfig({
      patch: { ...DEFAULT_OPERATIONAL_CONFIG, output: { runTopN: 5 } },
    });

    expect(res.status).toBe(200);
    expect(JSON.parse(readFileSync(configPath(), 'utf8')).output.runTopN).toBe(5);
  });
});

interface ApiKeyState {
  readonly schemaVersion: number;
  readonly configured: boolean;
  readonly source: 'stored' | 'environment' | 'none';
  readonly masked: string;
  readonly backend: string;
  readonly backendReason?: string;
  readonly legacyFilePresent: boolean;
}

interface ErrorEnvelope {
  readonly schemaVersion: number;
  readonly error: { readonly code: string; readonly message: string; readonly details: unknown };
}

function secretsPath(): string {
  return resolveSecretsPath(resolvePlatformPaths(createDefaultPlatformAdapter()));
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

  const FILE_BACKEND_FIELDS = {
    backend: 'file',
    backendReason: 'bridge_not_configured',
  } as const;

  /**
   * Route-seam default: the standalone file backend, resolving the store
   * lazily per request so each test's stubbed XDG config dir is honored
   * exactly like the pre-backend code path.
   */
  function standaloneFileBackend(): Promise<ResolvedSecretsBackend> {
    return Promise.resolve({
      store: new FileSecretsStore({ paths: resolvePlatformPaths(createDefaultPlatformAdapter()) }),
      backend: 'file',
      reason: 'bridge_not_configured',
    });
  }

  async function startServer(
    validateApiKey: (apiKey: string, provider?: string, baseUrl?: string) => Promise<void>,
    secretsBackend: () => Promise<ResolvedSecretsBackend> = standaloneFileBackend,
  ): Promise<string> {
    const server = await buildServer({
      env: { port: 0, host: '127.0.0.1' },
      validateApiKey,
      secretsBackend,
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

  async function getKey(baseUrl: string, provider?: string): Promise<ApiKeyState> {
    const res = await fetch(
      provider === undefined
        ? `${baseUrl}/api/secrets/api-key`
        : `${baseUrl}/api/secrets/api-key?provider=${provider}`,
    );
    expect(res.status).toBe(200);
    return (await res.json()) as ApiKeyState;
  }

  async function storeKey(baseUrl: string, apiKey: string): Promise<void> {
    const res = await putKey(baseUrl, apiKey);
    expect(res.status).toBe(200);
  }

  async function storeKeyFor(baseUrl: string, provider: string, apiKey: string): Promise<void> {
    const res = await fetch(`${baseUrl}/api/secrets/api-key`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ apiKey, provider }),
    });
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
      provider: 'openrouter',
      masked: maskSecret('sk-test-valid-123'),
      ...FILE_BACKEND_FIELDS,
    });
    expect(calls).toEqual(['sk-test-valid-123']);

    expect(await getKey(baseUrl)).toEqual({
      schemaVersion: 1,
      configured: true,
      source: 'stored',
      provider: 'openrouter',
      masked: maskSecret('sk-test-valid-123'),
      ...FILE_BACKEND_FIELDS,
      legacyFilePresent: true,
    });
  });

  it('rejects with 401 and keeps the previously stored key when validation fails with an auth error', async () => {
    const okUrl = await startServer(async () => undefined);
    await storeKey(okUrl, OLD_KEY);

    const failUrl = await startServer(async () => {
      throw new AiProviderAuthenticationError({ status: 401 });
    });
    const res = await putKey(failUrl, NEW_KEY);
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({
      schemaVersion: 1,
      error: {
        code: 'ai_provider_authentication',
        message: 'AiProvider authentication failed.',
        details: null,
      },
    } satisfies ErrorEnvelope);

    expect(await getKey(failUrl)).toEqual({
      schemaVersion: 1,
      configured: true,
      source: 'stored',
      provider: 'openrouter',
      masked: maskSecret(OLD_KEY),
      ...FILE_BACKEND_FIELDS,
      legacyFilePresent: true,
    });
  });

  it('rejects with 503 and keeps the previously stored key when validation fails with a network error', async () => {
    const okUrl = await startServer(async () => undefined);
    await storeKey(okUrl, OLD_KEY);

    const failUrl = await startServer(async () => {
      throw new AiProviderNetworkError({ status: null });
    });
    const res = await putKey(failUrl, NEW_KEY);
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({
      schemaVersion: 1,
      error: {
        code: 'ai_provider_network_error',
        message: 'AiProvider network failure.',
        details: null,
      },
    } satisfies ErrorEnvelope);

    expect(await getKey(failUrl)).toEqual({
      schemaVersion: 1,
      configured: true,
      source: 'stored',
      provider: 'openrouter',
      masked: maskSecret(OLD_KEY),
      ...FILE_BACKEND_FIELDS,
      legacyFilePresent: true,
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
      provider: 'openrouter',
      masked: '',
      ...FILE_BACKEND_FIELDS,
      legacyFilePresent: false,
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
      provider: 'openrouter',
      masked: '',
      ...FILE_BACKEND_FIELDS,
    });
    expect(calls).toHaveLength(0);

    expect(await getKey(baseUrl)).toEqual({
      schemaVersion: 1,
      configured: false,
      source: 'none',
      provider: 'openrouter',
      masked: '',
      ...FILE_BACKEND_FIELDS,
      legacyFilePresent: false,
    });
  });

  it('stores and reports keys per provider (#359)', async () => {
    const seen: Array<{ readonly apiKey: string; readonly provider?: string }> = [];
    const baseUrl = await startServer(async (apiKey, provider) => {
      seen.push({ apiKey, provider });
    });

    const openaiRes = await fetch(`${baseUrl}/api/secrets/api-key`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ apiKey: 'sk-openai-key-11', provider: 'openai' }),
    });
    expect(openaiRes.status).toBe(200);
    const groqRes = await fetch(`${baseUrl}/api/secrets/api-key`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ apiKey: 'sk-groq-key-22', provider: 'groq' }),
    });
    expect(groqRes.status).toBe(200);
    expect(seen).toEqual([
      { apiKey: 'sk-openai-key-11', provider: 'openai' },
      { apiKey: 'sk-groq-key-22', provider: 'groq' },
    ]);

    expect(await getKey(baseUrl, 'openai')).toMatchObject({
      configured: true,
      source: 'stored',
      provider: 'openai',
      masked: maskSecret('sk-openai-key-11'),
    });
    expect(await getKey(baseUrl, 'groq')).toMatchObject({
      configured: true,
      source: 'stored',
      provider: 'groq',
      masked: maskSecret('sk-groq-key-22'),
    });
    expect(await getKey(baseUrl, 'xai')).toMatchObject({
      configured: false,
      source: 'none',
      provider: 'xai',
      masked: '',
    });
  });

  it('removes only the requested provider slot on DELETE (#359)', async () => {
    const baseUrl = await startServer(async () => undefined);
    await storeKeyFor(baseUrl, 'openai', 'sk-openai-key-11');
    await storeKeyFor(baseUrl, 'groq', 'sk-groq-key-22');

    const res = await fetch(`${baseUrl}/api/secrets/api-key?provider=openai`, { method: 'DELETE' });
    expect(res.status).toBe(200);

    expect(await getKey(baseUrl, 'openai')).toMatchObject({ configured: false });
    expect(await getKey(baseUrl, 'groq')).toMatchObject({
      configured: true,
      masked: maskSecret('sk-groq-key-22'),
    });
  });

  it('rejects an unknown provider id with 400', async () => {
    const baseUrl = await startServer(async () => undefined);
    const res = await fetch(`${baseUrl}/api/secrets/api-key?provider=anthropic`, {
      method: 'GET',
    });
    expect(res.status).toBe(400);
  });

  it('validates a custom provider key against the supplied base URL', async () => {
    const seen: Array<{
      readonly apiKey: string;
      readonly provider?: string;
      readonly baseUrl?: string;
    }> = [];
    const baseUrl = await startServer(async (apiKey, provider, customBaseUrl) => {
      seen.push({ apiKey, provider, baseUrl: customBaseUrl });
    });

    const res = await fetch(`${baseUrl}/api/secrets/api-key`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        apiKey: 'sk-proxy-key-33',
        provider: 'custom',
        baseUrl: 'https://compat-proxy.example/v1',
      }),
    });
    expect(res.status).toBe(200);
    expect(seen).toEqual([
      {
        apiKey: 'sk-proxy-key-33',
        provider: 'custom',
        baseUrl: 'https://compat-proxy.example/v1',
      },
    ]);
    expect(await getKey(baseUrl, 'custom')).toMatchObject({
      configured: true,
      masked: maskSecret('sk-proxy-key-33'),
    });
  });
});

describe('GET /api/secrets/api-key with a legacy single-slot key (#359)', () => {
  const LEGACY_KEY = 'sk-legacy-single-1';

  let configHome: string;
  const servers: Awaited<ReturnType<typeof buildServer>>[] = [];

  beforeEach(() => {
    configHome = mkdtempSync(join(tmpdir(), 'jobhunter-legacy-status-'));
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

  it('reports the key as stored and masked on the very first status read', async () => {
    const store = new FileSecretsStore({
      paths: resolvePlatformPaths(createDefaultPlatformAdapter()),
    });
    await store.write({ aiProviderApiKey: LEGACY_KEY });
    const server = await buildServer({
      env: { port: 0, host: '127.0.0.1' },
      validateApiKey: async () => undefined,
      // Resolved per request so this test's stubbed config dir is used,
      // not the process-wide memoized backend of an earlier test.
      secretsBackend: () =>
        Promise.resolve({
          store: new FileSecretsStore({
            paths: resolvePlatformPaths(createDefaultPlatformAdapter()),
          }),
          backend: 'file',
          reason: 'bridge_not_configured',
        }),
    });
    servers.push(server);
    const baseUrl = await server.listen();

    const res = await fetch(`${baseUrl}/api/secrets/api-key`);

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      configured: true,
      source: 'stored',
      provider: 'openrouter',
      masked: maskSecret(LEGACY_KEY),
    });
    expect(await store.read()).toEqual({
      aiProviderApiKeys: { openrouter: LEGACY_KEY },
    });
  });
});

/** In-memory keychain stand-in recording the call sequence per op. */
class FakeKeychainStore implements SecretsStore {
  readonly calls: string[] = [];
  readonly fileExistsAt: Record<string, boolean> = {};
  private secrets: Secrets = {};

  constructor(
    private readonly hooks?: {
      readonly onWrite?: () => string | undefined;
      readonly onRead?: () => string | undefined;
    },
  ) {}

  async read(): Promise<Secrets> {
    this.calls.push('read');
    const override = this.hooks?.onRead?.();
    if (override !== undefined) return { aiProviderApiKey: override };
    return this.secrets;
  }

  async write(secrets: Secrets): Promise<void> {
    this.calls.push('write');
    const override = this.hooks?.onWrite?.();
    this.secrets =
      override !== undefined
        ? { aiProviderApiKey: override }
        : {
            ...(secrets.aiProviderApiKey !== undefined
              ? { aiProviderApiKey: secrets.aiProviderApiKey }
              : {}),
            ...(secrets.aiProviderApiKeys !== undefined
              ? { aiProviderApiKeys: secrets.aiProviderApiKeys }
              : {}),
          };
  }

  async clear(): Promise<void> {
    this.calls.push('delete');
    this.secrets = {};
  }

  get storedValue(): string | undefined {
    return this.secrets.aiProviderApiKey;
  }

  get storedProviderKey(): string | undefined {
    return this.secrets.aiProviderApiKeys?.['openrouter'];
  }
}

describe('secrets backend reporting and fallback gate', () => {
  const KEY = 'sk-keychain-key-42';

  let configHome: string;
  const servers: Awaited<ReturnType<typeof buildServer>>[] = [];

  beforeEach(() => {
    configHome = mkdtempSync(join(tmpdir(), 'jobhunter-secrets-keychain-'));
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

  function keychainBackend(store: SecretsStore): () => Promise<ResolvedSecretsBackend> {
    return () => Promise.resolve({ store, backend: 'keychain' });
  }

  function fileBackend(
    reason: 'bridge_not_configured' | 'keychain_unavailable',
  ): () => Promise<ResolvedSecretsBackend> {
    return () =>
      Promise.resolve({
        store: new FileSecretsStore({
          paths: resolvePlatformPaths(createDefaultPlatformAdapter()),
        }),
        backend: 'file',
        reason,
      });
  }

  async function startServer(
    secretsBackend: () => Promise<ResolvedSecretsBackend>,
  ): Promise<string> {
    const server = await buildServer({
      env: { port: 0, host: '127.0.0.1' },
      validateApiKey: async () => undefined,
      secretsBackend,
    });
    servers.push(server);
    return server.listen();
  }

  async function put(baseUrl: string, body: Record<string, unknown>): Promise<Response> {
    return fetch(`${baseUrl}/api/secrets/api-key`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  it('GET/PUT/DELETE report backend keychain and write through the store', async () => {
    const store = new FakeKeychainStore();
    const baseUrl = await startServer(keychainBackend(store));

    const putRes = await put(baseUrl, { apiKey: KEY });
    expect(putRes.status).toBe(200);
    expect(await putRes.json()).toEqual({
      schemaVersion: 1,
      status: 'validated',
      configured: true,
      source: 'stored',
      provider: 'openrouter',
      masked: maskSecret(KEY),
      backend: 'keychain',
    });
    expect(store.storedProviderKey).toBe(KEY);

    const getRes = await fetch(`${baseUrl}/api/secrets/api-key`);
    expect(await getRes.json()).toEqual({
      schemaVersion: 1,
      configured: true,
      source: 'stored',
      provider: 'openrouter',
      masked: maskSecret(KEY),
      backend: 'keychain',
      legacyFilePresent: false,
    });

    const deleteRes = await fetch(`${baseUrl}/api/secrets/api-key`, { method: 'DELETE' });
    expect(deleteRes.status).toBe(200);
    expect(await deleteRes.json()).toEqual({
      schemaVersion: 1,
      configured: false,
      source: 'none',
      provider: 'openrouter',
      masked: '',
      backend: 'keychain',
    });
    // PUT reads the current map before writing (per-provider merge);
    // GET resolves source + masked value; DELETE clears once the map is empty.
    expect(store.calls).toEqual(['read', 'write', 'read', 'read', 'read', 'delete']);
  });

  it('PUT without the consent flag is a 503 and writes nothing when the keychain is unavailable', async () => {
    const baseUrl = await startServer(fileBackend('keychain_unavailable'));

    const res = await put(baseUrl, { apiKey: KEY });

    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({
      schemaVersion: 1,
      error: {
        code: 'secrets_backend_unavailable',
        message: expect.any(String) as unknown as string,
        details: { reason: 'keychain_unavailable' },
      },
    });
    expect(existsSync(secretsPath())).toBe(false);
  });

  it('PUT with allowPlaintextFallback writes the file and reports the fallback', async () => {
    const baseUrl = await startServer(fileBackend('keychain_unavailable'));

    const res = await put(baseUrl, { apiKey: KEY, allowPlaintextFallback: true });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      schemaVersion: 1,
      status: 'validated',
      configured: true,
      source: 'stored',
      provider: 'openrouter',
      masked: maskSecret(KEY),
      backend: 'file',
      backendReason: 'keychain_unavailable',
    });
    const onDisk = JSON.parse(readFileSync(secretsPath(), 'utf8')) as {
      aiProviderApiKeys?: Record<string, string>;
    };
    expect(onDisk.aiProviderApiKeys?.['openrouter']).toBe(KEY);
  });
});

describe('POST /api/secrets/api-key/migrate', () => {
  const LEGACY_KEY = 'sk-legacy-file-key-1';

  let configHome: string;
  const servers: Awaited<ReturnType<typeof buildServer>>[] = [];

  beforeEach(() => {
    configHome = mkdtempSync(join(tmpdir(), 'jobhunter-migrate-'));
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

  function legacyStore(): FileSecretsStore {
    return new FileSecretsStore({ paths: resolvePlatformPaths(createDefaultPlatformAdapter()) });
  }

  async function startServer(
    secretsBackend: () => Promise<ResolvedSecretsBackend>,
  ): Promise<string> {
    const server = await buildServer({
      env: { port: 0, host: '127.0.0.1' },
      validateApiKey: async () => undefined,
      secretsBackend,
    });
    servers.push(server);
    return server.listen();
  }

  function migrate(baseUrl: string): Promise<Response> {
    return fetch(`${baseUrl}/api/secrets/api-key/migrate`, { method: 'POST' });
  }

  it('moves the legacy file key into the keychain and deletes the file only after verification', async () => {
    await legacyStore().write({ aiProviderApiKey: LEGACY_KEY });
    const store = new FakeKeychainStore({
      onWrite: () => {
        store.fileExistsAt['write'] = existsSync(secretsPath());
        return undefined;
      },
      onRead: () => {
        store.fileExistsAt['read'] = existsSync(secretsPath());
        return undefined;
      },
    });
    const baseUrl = await startServer(() => Promise.resolve({ store, backend: 'keychain' }));

    const res = await migrate(baseUrl);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      schemaVersion: 1,
      migrated: true,
      source: 'stored',
      backend: 'keychain',
      masked: maskSecret(LEGACY_KEY),
    });
    expect(store.storedProviderKey).toBe(LEGACY_KEY);
    expect(store.calls).toEqual(['read', 'write', 'read']);
    // The legacy file still existed while the keychain was written and
    // verified; it is gone only after the verified migration completed.
    expect(store.fileExistsAt['write']).toBe(true);
    expect(store.fileExistsAt['read']).toBe(true);
    expect(existsSync(secretsPath())).toBe(false);
  });

  it('returns 503 with the file untouched when the keychain is unavailable', async () => {
    await legacyStore().write({ aiProviderApiKey: LEGACY_KEY });
    const baseUrl = await startServer(() =>
      Promise.resolve({
        store: legacyStore(),
        backend: 'file',
        reason: 'keychain_unavailable',
      }),
    );

    const res = await migrate(baseUrl);

    expect(res.status).toBe(503);
    const body = (await res.json()) as ErrorEnvelope;
    expect(body.error.code).toBe('secrets_backend_unavailable');
    expect((await legacyStore().read()).aiProviderApiKey).toBe(LEGACY_KEY);
  });

  it('returns 409 legacy_shadowed and leaves both stores unchanged when the keychain already has a key', async () => {
    await legacyStore().write({ aiProviderApiKey: LEGACY_KEY });
    const store = new FakeKeychainStore({ onRead: () => 'sk-existing-keychain' });
    const baseUrl = await startServer(() => Promise.resolve({ store, backend: 'keychain' }));

    const res = await migrate(baseUrl);

    expect(res.status).toBe(409);
    const body = (await res.json()) as ErrorEnvelope;
    expect(body.error.code).toBe('legacy_shadowed');
    expect(store.calls).toEqual(['read']);
    expect((await legacyStore().read()).aiProviderApiKey).toBe(LEGACY_KEY);
  });

  it('fails verification with 500 and keeps the file when the read-back does not match', async () => {
    await legacyStore().write({ aiProviderApiKey: LEGACY_KEY });
    let reads = 0;
    const store = new FakeKeychainStore({
      onRead: () => (reads++ === 0 ? undefined : 'sk-different-value'),
    });
    const baseUrl = await startServer(() => Promise.resolve({ store, backend: 'keychain' }));

    const res = await migrate(baseUrl);

    expect(res.status).toBe(500);
    const body = (await res.json()) as ErrorEnvelope;
    expect(body.error.code).toBe('secrets_migration_verification_failed');
    expect((await legacyStore().read()).aiProviderApiKey).toBe(LEGACY_KEY);
  });

  it('reports nothing_to_migrate when no legacy file exists', async () => {
    const store = new FakeKeychainStore();
    const baseUrl = await startServer(() => Promise.resolve({ store, backend: 'keychain' }));

    const res = await migrate(baseUrl);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      schemaVersion: 1,
      migrated: false,
      reason: 'nothing_to_migrate',
    });
    expect(store.calls).toEqual([]);
  });

  it('reports no_keychain_backend on a standalone sidecar without the gate', async () => {
    await legacyStore().write({ aiProviderApiKey: LEGACY_KEY });
    const baseUrl = await startServer(() =>
      Promise.resolve({
        store: legacyStore(),
        backend: 'file',
        reason: 'bridge_not_configured',
      }),
    );

    const res = await migrate(baseUrl);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      schemaVersion: 1,
      migrated: false,
      reason: 'no_keychain_backend',
    });
    expect((await legacyStore().read()).aiProviderApiKey).toBe(LEGACY_KEY);
  });
});
