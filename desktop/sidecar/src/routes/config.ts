import type { FastifyInstance } from 'fastify';
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
import { FileSecretsStore, maskSecret, resolveApiKeySource } from '@jobhunter/core/config';
import { sidecarFileSystem } from './fs-adapter.js';

export interface ConfigRouteDeps {
  readonly validateApiKey?: (apiKey: string) => Promise<void>;
}

const defaultValidateApiKey = (apiKey: string): Promise<void> =>
  createDefaultOpenAIClient({ apiKey, timeoutMs: 10_000 }).validate();

function classifyKeyValidationFailure(error: unknown): {
  status: 'rejected' | 'unreachable';
  reason: string;
} {
  const code = error instanceof ApplicationError ? error.code : 'unknown';
  const rejected =
    error instanceof OpenAIAuthenticationError ||
    error instanceof OpenAIPermissionError ||
    error instanceof OpenAIBillingError;
  return rejected ? { status: 'rejected', reason: code } : { status: 'unreachable', reason: code };
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
    const store = new FileSecretsStore({ paths });
    const [secrets, source] = await Promise.all([
      store.read(),
      resolveApiKeySource({
        store,
        env: process.env,
      }),
    ]);
    return {
      schemaVersion: 1,
      configured: source !== 'none',
      source,
      // Masked only — the plaintext key is never returned over the wire.
      masked: maskSecret(source === 'stored' ? secrets.openaiApiKey : undefined),
    };
  });

  app.put<{ Body: { apiKey?: string } }>('/api/secrets/api-key', async (req) => {
    const paths = resolvePlatformPaths(createDefaultPlatformAdapter());
    const store = new FileSecretsStore({ paths });
    const validateApiKey = deps.validateApiKey ?? defaultValidateApiKey;
    const apiKey = req.body.apiKey?.trim() ?? '';
    if (apiKey.length === 0) {
      await store.clear();
      return {
        schemaVersion: 1,
        status: 'validated',
        configured: false,
        source: 'none',
        masked: '',
      };
    }
    try {
      await validateApiKey(apiKey);
    } catch (error) {
      const { status, reason } = classifyKeyValidationFailure(error);
      const [secrets, source] = await Promise.all([
        store.read(),
        resolveApiKeySource({ store, env: process.env }),
      ]);
      return {
        schemaVersion: 1,
        status,
        reason,
        configured: source !== 'none',
        source,
        masked: maskSecret(source === 'stored' ? secrets.openaiApiKey : undefined),
      };
    }
    await store.write({ openaiApiKey: apiKey });
    return {
      schemaVersion: 1,
      status: 'validated',
      configured: true,
      source: 'stored',
      masked: maskSecret(apiKey),
    };
  });

  app.delete('/api/secrets/api-key', async () => {
    const paths = resolvePlatformPaths(createDefaultPlatformAdapter());
    await new FileSecretsStore({ paths }).clear();
    return { schemaVersion: 1, configured: false, source: 'none', masked: '' };
  });
}
