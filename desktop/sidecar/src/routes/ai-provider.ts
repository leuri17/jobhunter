import type { FastifyInstance } from 'fastify';
import { createDefaultAiProviderClient, type AiProviderClient } from '@jobhunter/core/profile';
import {
  AiProviderIdSchema,
  resolveAiProviderApiKey,
  resolveProviderEndpoint,
  type AiProviderId,
} from '@jobhunter/core/config';
import { getSecretsBackend } from '../secrets-backend.js';
import { resolveConfiguredProvider } from './ai-provider-resolve.js';
import { classifyKeyValidationFailure } from './config.js';

export interface AiProviderRouteDeps {
  /**
   * Test/alternative seam for the model listing, scoped to one
   * provider (+ its custom base URL). `null` means "no key
   * configured and the provider's list is not public"; rejects with
   * a typed `ProfileExtractionError` family error on probe failure.
   */
  readonly listModels?: (
    provider?: AiProviderId,
    baseUrl?: string,
  ) => Promise<readonly string[] | null>;
}

/**
 * OpenRouter's model catalog is public — an Authorization header is
 * ignored on `/models` — so a placeholder token lets the list load
 * before any key is saved (#359). Every other provider requires its
 * stored key.
 */
const OPENROUTER_KEYLESS_TOKEN = 'sk-test-0000';

const defaultListModels = async (
  provider?: AiProviderId,
  baseUrl?: string,
): Promise<readonly string[] | null> => {
  const resolvedProvider = provider ?? (await resolveConfiguredProvider());
  const endpoint = resolveProviderEndpoint(resolvedProvider, baseUrl);
  const key = await resolveAiProviderApiKey({
    store: (await getSecretsBackend()).store,
    env: process.env,
    provider: resolvedProvider,
  });
  const apiKey = key ?? (resolvedProvider === 'openrouter' ? OPENROUTER_KEYLESS_TOKEN : null);
  if (apiKey === null) return null;
  const client: AiProviderClient = await createDefaultAiProviderClient({
    apiKey,
    timeoutMs: 10_000,
    baseUrl: endpoint,
  });
  return client.listModels();
};

export async function registerAiProviderRoutes(
  app: FastifyInstance,
  deps: AiProviderRouteDeps = {},
): Promise<void> {
  app.get<{ Querystring: { provider?: string; baseUrl?: string } }>(
    '/api/ai-provider/models',
    async (req, reply) => {
      let provider: AiProviderId | undefined;
      if (req.query.provider !== undefined && req.query.provider.length > 0) {
        const parsed = AiProviderIdSchema.safeParse(req.query.provider);
        if (!parsed.success) {
          return reply.code(400).send({
            schemaVersion: 1,
            error: {
              code: 'invalid_provider',
              message: `Unknown provider id: ${req.query.provider}`,
              details: null,
            },
          });
        }
        provider = parsed.data;
      }
      if (
        provider === 'custom' &&
        (req.query.baseUrl === undefined || req.query.baseUrl.length === 0)
      ) {
        return reply.code(400).send({
          schemaVersion: 1,
          error: {
            code: 'custom_base_url_required',
            message: 'The custom provider requires its base URL to list models.',
            details: null,
          },
        });
      }
      const listModels = deps.listModels ?? defaultListModels;
      let models: readonly string[] | null;
      try {
        models = await listModels(provider, req.query.baseUrl);
      } catch (error) {
        const { httpStatus, code, message } = classifyKeyValidationFailure(error);
        return reply.code(httpStatus).send({
          schemaVersion: 1,
          error: { code, message, details: null },
        });
      }
      return { schemaVersion: 1, configured: models !== null, models: models ?? [] };
    },
  );
}
