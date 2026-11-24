import type { FastifyInstance, FastifyReply } from 'fastify';
import {
  loadConfig,
  updateConfig,
  OperationalConfigSchema,
  type ConfigPatch,
  type UpdateOptions,
} from '@jobhunter/core/config';
import { resolvePlatformPaths, createDefaultPlatformAdapter } from '@jobhunter/core/platform';
import { ApplicationError, ValidationError } from '@jobhunter/core/errors';
import {
  AiProviderAuthenticationError,
  AiProviderBillingError,
  AiProviderPermissionError,
} from '@jobhunter/core/profile';
import {
  FileSecretsStore,
  maskSecret,
  resolveApiKeySource,
  resolveSecretsPath,
  AiProviderIdSchema,
  type AiProviderId,
  type Secrets,
} from '@jobhunter/core/config';
import { getSecretsBackend, type ResolvedSecretsBackend } from '../secrets-backend.js';
import { sidecarFileSystem } from './fs-adapter.js';
import { createApiKeyValidationClient, resolveConfiguredProvider } from './ai-provider-resolve.js';

export interface ConfigRouteDeps {
  /** Receives the candidate provider (+ its custom URL) so validation hits the right endpoint. */
  readonly validateApiKey?: (
    apiKey: string,
    provider?: AiProviderId,
    baseUrl?: string,
  ) => Promise<void>;
  /**
   * Test/alternative seam for the resolved secrets backend. Defaults to
   * the process-wide memoized resolver.
   */
  readonly secretsBackend?: () => Promise<ResolvedSecretsBackend>;
}

const defaultValidateApiKey = async (
  apiKey: string,
  provider?: AiProviderId,
  baseUrl?: string,
): Promise<void> => {
  // Probes the candidate provider's endpoint — an OpenRouter key must
  // not be validated against the OpenAI endpoint (false 401s).
  await (await createApiKeyValidationClient(apiKey, provider, baseUrl)).validate();
};

/** Parse a provider id param: the id, `'invalid'`, or undefined when absent. */
function parseProviderParam(raw: string | undefined): AiProviderId | 'invalid' | undefined {
  if (raw === undefined || raw.length === 0) return undefined;
  const parsed = AiProviderIdSchema.safeParse(raw);
  return parsed.success ? parsed.data : 'invalid';
}

function invalidProviderReply(reply: FastifyReply, raw: string): unknown {
  return reply.code(400).send({
    schemaVersion: 1,
    error: { code: 'invalid_provider', message: `Unknown provider id: ${raw}`, details: null },
  });
}

const resolveBackend = (deps: ConfigRouteDeps): (() => Promise<ResolvedSecretsBackend>) =>
  deps.secretsBackend ?? getSecretsBackend;

const backendFields = (
  backend: ResolvedSecretsBackend,
): { backend: string; backendReason?: string } => ({
  backend: backend.backend,
  ...(backend.reason !== undefined ? { backendReason: backend.reason } : {}),
});

/**
 * Reply with the route's 503 envelope for a `secrets_backend_unavailable`
 * store failure; anything else is rethrown for the global error handler.
 */
function backendUnavailable(reply: FastifyReply, error: unknown): unknown {
  if (error instanceof ApplicationError && error.code === 'secrets_backend_unavailable') {
    return reply.code(503).send({
      schemaVersion: 1,
      error: {
        code: 'secrets_backend_unavailable',
        message: error.message,
        details: { reason: error.message },
      },
    });
  }
  throw error;
}

/**
 * Map a key-probe failure (`validate()` / `listModels()`) to this route
 * family's HTTP semantics: rejected-key errors (authentication, permission,
 * billing) answer 401; everything else means "cannot tell right now" and
 * answers 503.
 */
export function classifyKeyValidationFailure(error: unknown): {
  readonly httpStatus: number;
  readonly code: string;
  readonly message: string;
} {
  const rejected =
    error instanceof AiProviderAuthenticationError ||
    error instanceof AiProviderPermissionError ||
    error instanceof AiProviderBillingError;
  return {
    httpStatus: rejected ? 401 : 503,
    code: error instanceof ApplicationError ? error.code : 'unknown',
    message: error instanceof Error ? error.message : 'AiProvider key validation failed.',
  };
}

export async function registerConfigRoutes(
  app: FastifyInstance,
  deps: ConfigRouteDeps = {},
): Promise<void> {
  app.get('/api/config', async () => {
    const paths = resolvePlatformPaths(createDefaultPlatformAdapter());
    const loaded = await loadConfig(paths, sidecarFileSystem);
    return { schemaVersion: 1, config: loaded.config };
  });

  app.patch<{ Body: { patch: ConfigPatch } }>('/api/config', async (req) => {
    const paths = resolvePlatformPaths(createDefaultPlatformAdapter());
    const options: UpdateOptions = { confirm: async () => true };
    const result = await updateConfig(paths, req.body.patch, options, sidecarFileSystem);
    return { schemaVersion: 1, config: result.config };
  });

  app.post('/api/config/validate', async () => {
    const paths = resolvePlatformPaths(createDefaultPlatformAdapter());
    const loaded = await loadConfig(paths, sidecarFileSystem);
    const parsed = OperationalConfigSchema.safeParse(loaded.config);
    if (!parsed.success) {
      throw new ValidationError('zod_failed', 'Loaded configuration failed revalidation.', {
        issues: parsed.error.issues.map((i) => ({ path: i.path, message: i.message })),
      });
    }
    return { schemaVersion: 1, valid: true };
  });

  app.get<{ Querystring: { provider?: string } }>('/api/secrets/api-key', async (req, reply) => {
    const paths = resolvePlatformPaths(createDefaultPlatformAdapter());
    const parsedProvider = parseProviderParam(req.query.provider);
    if (parsedProvider === 'invalid') {
      return invalidProviderReply(reply, req.query.provider ?? '');
    }
    const provider = parsedProvider ?? (await resolveConfiguredProvider());
    const resolved = await resolveBackend(deps)();
    // Resolve the source first: on a legacy install that is what moves the
    // single-slot key into this provider's slot, so the read below sees it.
    const source = await resolveApiKeySource({
      store: resolved.store,
      env: process.env,
      provider,
    });
    const secrets = await resolved.store.read();
    return {
      schemaVersion: 1,
      configured: source !== 'none',
      source,
      provider,
      // Masked only — the plaintext key is never returned over the wire.
      masked: maskSecret(source === 'stored' ? secrets.aiProviderApiKeys?.[provider] : undefined),
      ...backendFields(resolved),
      legacyFilePresent: await sidecarFileSystem.pathExists(resolveSecretsPath(paths)),
    };
  });

  app.put<{
    Body: {
      apiKey?: string;
      allowPlaintextFallback?: boolean;
      provider?: string;
      baseUrl?: string;
    };
    Querystring: { provider?: string };
  }>('/api/secrets/api-key', async (req, reply) => {
    const rawProvider = req.body.provider ?? req.query.provider;
    const parsedProvider = parseProviderParam(rawProvider);
    if (parsedProvider === 'invalid') {
      return invalidProviderReply(reply, rawProvider ?? '');
    }
    const provider = parsedProvider ?? (await resolveConfiguredProvider());
    const resolved = await resolveBackend(deps)();
    const validateApiKey = deps.validateApiKey ?? defaultValidateApiKey;
    const apiKey = req.body.apiKey?.trim() ?? '';
    if (apiKey.length === 0) {
      try {
        await removeProviderSlot(resolved.store, provider);
      } catch (error) {
        return backendUnavailable(reply, error);
      }
      return {
        schemaVersion: 1,
        status: 'validated',
        configured: false,
        source: 'none',
        provider,
        masked: '',
        ...backendFields(resolved),
      };
    }
    try {
      await validateApiKey(apiKey, provider, req.body.baseUrl);
    } catch (error) {
      // 401/503 are this route's own semantics; `statusFor` would map the
      // typed error's CLI exit code instead.
      const { httpStatus, code, message } = classifyKeyValidationFailure(error);
      return reply.code(httpStatus).send({
        schemaVersion: 1,
        error: { code, message, details: null },
      });
    }

    // Persist into the per-provider map, preserving other providers'
    // keys. A `file` backend caused by an unreachable keychain only
    // writes with the caller's explicit plaintext consent; the
    // standalone (`bridge_not_configured`) file backend writes directly.
    const persist = async (): Promise<void> => {
      const current = await resolved.store.read();
      const map = { ...(current.aiProviderApiKeys ?? {}), [provider]: apiKey };
      await resolved.store.write({ aiProviderApiKeys: map });
    };
    try {
      if (resolved.backend === 'keychain') {
        await persist();
      } else {
        if (
          resolved.reason === 'keychain_unavailable' &&
          req.body.allowPlaintextFallback !== true
        ) {
          return reply.code(503).send({
            schemaVersion: 1,
            error: {
              code: 'secrets_backend_unavailable',
              message:
                'The OS keychain is unavailable. Pass allowPlaintextFallback to store the key in a plaintext secrets file instead.',
              details: { reason: 'keychain_unavailable' },
            },
          });
        }
        await persist();
      }
    } catch (error) {
      return backendUnavailable(reply, error);
    }
    return {
      schemaVersion: 1,
      status: 'validated',
      configured: true,
      source: 'stored',
      provider,
      masked: maskSecret(apiKey),
      ...backendFields(resolved),
    };
  });

  app.delete<{ Querystring: { provider?: string } }>('/api/secrets/api-key', async (req, reply) => {
    const parsedProvider = parseProviderParam(req.query.provider);
    if (parsedProvider === 'invalid') {
      return invalidProviderReply(reply, req.query.provider ?? '');
    }
    const provider = parsedProvider ?? (await resolveConfiguredProvider());
    const resolved = await resolveBackend(deps)();
    try {
      await removeProviderSlot(resolved.store, provider);
    } catch (error) {
      return backendUnavailable(reply, error);
    }
    return {
      schemaVersion: 1,
      configured: false,
      source: 'none',
      provider,
      masked: '',
      ...backendFields(resolved),
    };
  });

  /** Remove one provider's key slot; other providers' keys survive (#359). */
  async function removeProviderSlot(
    store: {
      read(): Promise<Secrets>;
      write(secrets: Secrets): Promise<void>;
      clear(): Promise<void>;
    },
    provider: AiProviderId,
  ): Promise<void> {
    const current = await store.read();
    const map = { ...(current.aiProviderApiKeys ?? {}) };
    delete map[provider];
    if (Object.keys(map).length === 0 && current.aiProviderApiKey === undefined) {
      await store.clear();
      return;
    }
    await store.write({
      ...(current.aiProviderApiKey !== undefined
        ? { aiProviderApiKey: current.aiProviderApiKey }
        : {}),
      ...(Object.keys(map).length > 0 ? { aiProviderApiKeys: map } : {}),
    });
  }

  /**
   * Move the legacy `secrets.json` key into the OS keychain. The file is
   * deleted only after the key was written to the keychain and read back
   * matching; every earlier exit leaves it untouched.
   */
  app.post('/api/secrets/api-key/migrate', async (_req, reply) => {
    const legacy = new FileSecretsStore({
      paths: resolvePlatformPaths(createDefaultPlatformAdapter()),
    });
    const legacySecrets = await legacy.read();
    const configProvider = await resolveConfiguredProvider();
    const legacyMap: Record<string, string> = { ...(legacySecrets.aiProviderApiKeys ?? {}) };
    if (legacySecrets.aiProviderApiKey !== undefined) {
      legacyMap[configProvider] ??= legacySecrets.aiProviderApiKey;
    }
    if (Object.keys(legacyMap).length === 0) {
      return { schemaVersion: 1, migrated: false, reason: 'nothing_to_migrate' };
    }

    const resolved = await resolveBackend(deps)();
    if (resolved.backend !== 'keychain') {
      if (resolved.reason === 'keychain_unavailable') {
        return reply.code(503).send({
          schemaVersion: 1,
          error: {
            code: 'secrets_backend_unavailable',
            message: 'The OS keychain is unavailable; the secrets file was left untouched.',
            details: { reason: 'keychain_unavailable' },
          },
        });
      }
      return { schemaVersion: 1, migrated: false, reason: 'no_keychain_backend' };
    }

    try {
      const existing = await resolved.store.read();
      // A legacy single-slot keychain key resolves for the config's
      // provider too, so either shape counts as "already occupied".
      const occupied =
        existing.aiProviderApiKeys?.[configProvider] !== undefined ||
        existing.aiProviderApiKey !== undefined;
      if (occupied) {
        return reply.code(409).send({
          schemaVersion: 1,
          error: {
            code: 'legacy_shadowed',
            message:
              'The keychain already holds an API key, so it stays the active source; the secrets file was not changed.',
            details: null,
          },
        });
      }
      const merged = { ...(existing.aiProviderApiKeys ?? {}), ...legacyMap };
      await resolved.store.write({ aiProviderApiKeys: merged });
      const verified = await resolved.store.read();
      if (verified.aiProviderApiKeys?.[configProvider] !== legacyMap[configProvider]) {
        return reply.code(500).send({
          schemaVersion: 1,
          error: {
            code: 'secrets_migration_verification_failed',
            message:
              'Reading the key back from the keychain did not match; the secrets file was left untouched.',
            details: null,
          },
        });
      }
    } catch (error) {
      return backendUnavailable(reply, error);
    }

    await legacy.clear();
    return {
      schemaVersion: 1,
      migrated: true,
      source: 'stored',
      backend: 'keychain',
      masked: maskSecret(legacyMap[configProvider]),
    };
  });
}
