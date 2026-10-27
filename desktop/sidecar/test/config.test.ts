import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildServer } from '../src/server.js';
import { OpenAIAuthenticationError, OpenAINetworkError } from '@jobhunter/core/profile';
import {
  FileSecretsStore,
  maskSecret,
  resolveSecretsPath,
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
    validateApiKey: (apiKey: string) => Promise<void>,
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
      ...FILE_BACKEND_FIELDS,
    });
    expect(calls).toEqual(['sk-test-valid-123']);

    expect(await getKey(baseUrl)).toEqual({
      schemaVersion: 1,
      configured: true,
      source: 'stored',
      masked: maskSecret('sk-test-valid-123'),
      ...FILE_BACKEND_FIELDS,
      legacyFilePresent: true,
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
      ...FILE_BACKEND_FIELDS,
      legacyFilePresent: true,
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
      masked: '',
      ...FILE_BACKEND_FIELDS,
    });
    expect(calls).toHaveLength(0);

    expect(await getKey(baseUrl)).toEqual({
      schemaVersion: 1,
      configured: false,
      source: 'none',
      masked: '',
      ...FILE_BACKEND_FIELDS,
      legacyFilePresent: false,
    });
  });
});

/** In-memory keychain stand-in recording the call sequence per op. */
class FakeKeychainStore implements SecretsStore {
  readonly calls: string[] = [];
  readonly fileExistsAt: Record<string, boolean> = {};
  private value: string | undefined;

  constructor(
    private readonly hooks?: {
      readonly onWrite?: () => string | undefined;
      readonly onRead?: () => string | undefined;
    },
  ) {}

  async read(): Promise<Secrets> {
    this.calls.push('read');
    const override = this.hooks?.onRead?.();
    if (override !== undefined) return { openaiApiKey: override };
    return this.value === undefined ? {} : { openaiApiKey: this.value };
  }

  async write(secrets: Secrets): Promise<void> {
    this.calls.push('write');
    this.value = this.hooks?.onWrite?.() ?? secrets.openaiApiKey;
  }

  async clear(): Promise<void> {
    this.calls.push('delete');
    this.value = undefined;
  }

  get storedValue(): string | undefined {
    return this.value;
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
      masked: maskSecret(KEY),
      backend: 'keychain',
    });
    expect(store.storedValue).toBe(KEY);

    const getRes = await fetch(`${baseUrl}/api/secrets/api-key`);
    expect(await getRes.json()).toEqual({
      schemaVersion: 1,
      configured: true,
      source: 'stored',
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
      masked: '',
      backend: 'keychain',
    });
    expect(store.calls).toEqual(['write', 'read', 'read', 'delete']);
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
      masked: maskSecret(KEY),
      backend: 'file',
      backendReason: 'keychain_unavailable',
    });
    const onDisk = JSON.parse(readFileSync(secretsPath(), 'utf8')) as {
      openaiApiKey?: string;
    };
    expect(onDisk.openaiApiKey).toBe(KEY);
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
    await legacyStore().write({ openaiApiKey: LEGACY_KEY });
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
    expect(store.storedValue).toBe(LEGACY_KEY);
    expect(store.calls).toEqual(['read', 'write', 'read']);
    // The legacy file still existed while the keychain was written and
    // verified; it is gone only after the verified migration completed.
    expect(store.fileExistsAt['write']).toBe(true);
    expect(store.fileExistsAt['read']).toBe(true);
    expect(existsSync(secretsPath())).toBe(false);
  });

  it('returns 503 with the file untouched when the keychain is unavailable', async () => {
    await legacyStore().write({ openaiApiKey: LEGACY_KEY });
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
    expect((await legacyStore().read()).openaiApiKey).toBe(LEGACY_KEY);
  });

  it('returns 409 legacy_shadowed and leaves both stores unchanged when the keychain already has a key', async () => {
    await legacyStore().write({ openaiApiKey: LEGACY_KEY });
    const store = new FakeKeychainStore({ onRead: () => 'sk-existing-keychain' });
    const baseUrl = await startServer(() => Promise.resolve({ store, backend: 'keychain' }));

    const res = await migrate(baseUrl);

    expect(res.status).toBe(409);
    const body = (await res.json()) as ErrorEnvelope;
    expect(body.error.code).toBe('legacy_shadowed');
    expect(store.calls).toEqual(['read']);
    expect((await legacyStore().read()).openaiApiKey).toBe(LEGACY_KEY);
  });

  it('fails verification with 500 and keeps the file when the read-back does not match', async () => {
    await legacyStore().write({ openaiApiKey: LEGACY_KEY });
    let reads = 0;
    const store = new FakeKeychainStore({
      onRead: () => (reads++ === 0 ? undefined : 'sk-different-value'),
    });
    const baseUrl = await startServer(() => Promise.resolve({ store, backend: 'keychain' }));

    const res = await migrate(baseUrl);

    expect(res.status).toBe(500);
    const body = (await res.json()) as ErrorEnvelope;
    expect(body.error.code).toBe('secrets_migration_verification_failed');
    expect((await legacyStore().read()).openaiApiKey).toBe(LEGACY_KEY);
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
    await legacyStore().write({ openaiApiKey: LEGACY_KEY });
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
    expect((await legacyStore().read()).openaiApiKey).toBe(LEGACY_KEY);
  });
});
