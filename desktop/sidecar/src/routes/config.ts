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
  createDefaultOpenAIClient,
  OpenAIAuthenticationError,
  OpenAIBillingError,
  OpenAIPermissionError,
} from '@jobhunter/core/profile';
import {
  FileSecretsStore,
  maskSecret,
  resolveApiKeySource,
  resolveSecretsPath,
} from '@jobhunter/core/config';
import { getSecretsBackend, type ResolvedSecretsBackend } from '../secrets-backend.js';
import { sidecarFileSystem } from './fs-adapter.js';

export interface ConfigRouteDeps {
  readonly validateApiKey?: (apiKey: string) => Promise<void>;
  /**
   * Test/alternative seam for the resolved secrets backend. Defaults to
   * the process-wide memoized resolver.
   */
  readonly secretsBackend?: () => Promise<ResolvedSecretsBackend>;
}

const defaultValidateApiKey = (apiKey: string): Promise<void> =>
  createDefaultOpenAIClient({ apiKey, timeoutMs: 10_000 }).validate();

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

function classifyKeyValidationFailure(error: unknown): {
  readonly httpStatus: number;
  readonly code: string;
  readonly message: string;
} {
  const rejected =
    error instanceof OpenAIAuthenticationError ||
    error instanceof OpenAIPermissionError ||
    error instanceof OpenAIBillingError;
  return {
    httpStatus: rejected ? 401 : 503,
    code: error instanceof ApplicationError ? error.code : 'unknown',
    message: error instanceof Error ? error.message : 'OpenAI key validation failed.',
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

  app.get('/api/secrets/api-key', async () => {
    const paths = resolvePlatformPaths(createDefaultPlatformAdapter());
    const resolved = await resolveBackend(deps)();
    const [secrets, source] = await Promise.all([
      resolved.store.read(),
      resolveApiKeySource({
        store: resolved.store,
        env: process.env,
      }),
    ]);
    return {
      schemaVersion: 1,
      configured: source !== 'none',
      source,
      // Masked only — the plaintext key is never returned over the wire.
      masked: maskSecret(source === 'stored' ? secrets.openaiApiKey : undefined),
      ...backendFields(resolved),
      legacyFilePresent: await sidecarFileSystem.pathExists(resolveSecretsPath(paths)),
    };
  });

  app.put<{ Body: { apiKey?: string; allowPlaintextFallback?: boolean } }>(
    '/api/secrets/api-key',
    async (req, reply) => {
      const resolved = await resolveBackend(deps)();
      const validateApiKey = deps.validateApiKey ?? defaultValidateApiKey;
      const apiKey = req.body.apiKey?.trim() ?? '';
      if (apiKey.length === 0) {
        try {
          await resolved.store.clear();
        } catch (error) {
          return backendUnavailable(reply, error);
        }
        return {
          schemaVersion: 1,
          status: 'validated',
          configured: false,
          source: 'none',
          masked: '',
          ...backendFields(resolved),
        };
      }
      try {
        await validateApiKey(apiKey);
      } catch (error) {
        // 401/503 are this route's own semantics; `statusFor` would map the
        // typed error's CLI exit code instead.
        const { httpStatus, code, message } = classifyKeyValidationFailure(error);
        return reply.code(httpStatus).send({
          schemaVersion: 1,
          error: { code, message, details: null },
        });
      }

      if (resolved.backend === 'keychain') {
        try {
          await resolved.store.write({ openaiApiKey: apiKey });
        } catch (error) {
          return backendUnavailable(reply, error);
        }
      } else {
        // A `file` backend caused by an unreachable keychain only writes
        // with the caller's explicit plaintext consent; the standalone
        // (`bridge_not_configured`) file backend writes directly.
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
        await resolved.store.write({ openaiApiKey: apiKey });
      }
      return {
        schemaVersion: 1,
        status: 'validated',
        configured: true,
        source: 'stored',
        masked: maskSecret(apiKey),
        ...backendFields(resolved),
      };
    },
  );

  app.delete('/api/secrets/api-key', async (_req, reply) => {
    const resolved = await resolveBackend(deps)();
    try {
      await resolved.store.clear();
    } catch (error) {
      return backendUnavailable(reply, error);
    }
    return {
      schemaVersion: 1,
      configured: false,
      source: 'none',
      masked: '',
      ...backendFields(resolved),
    };
  });

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
    if (legacySecrets.openaiApiKey === undefined) {
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
      if (existing.openaiApiKey !== undefined) {
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
      await resolved.store.write({ openaiApiKey: legacySecrets.openaiApiKey });
      const verified = await resolved.store.read();
      if (verified.openaiApiKey !== legacySecrets.openaiApiKey) {
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
      masked: maskSecret(legacySecrets.openaiApiKey),
    };
  });
}
