import type { FastifyInstance } from 'fastify';
import { resolveOpenAiClientOrNull } from './openai-resolve.js';
import { classifyKeyValidationFailure } from './config.js';

export interface OpenAiRouteDeps {
  /**
   * Test/alternative seam for the model listing. `null` means "no key
   * configured"; rejects with a typed `ProfileExtractionError` family
   * error on probe failure. Defaults to listing through the resolved
   * effective key (secrets store → env).
   */
  readonly listModels?: () => Promise<readonly string[] | null>;
}

const defaultListModels = async (): Promise<readonly string[] | null> => {
  const client = await resolveOpenAiClientOrNull(undefined, undefined, 10_000);
  return client === null ? null : client.listModels();
};

export async function registerOpenAiRoutes(
  app: FastifyInstance,
  deps: OpenAiRouteDeps = {},
): Promise<void> {
  app.get('/api/openai/models', async (_req, reply) => {
    const listModels = deps.listModels ?? defaultListModels;
    let models: readonly string[] | null;
    try {
      models = await listModels();
    } catch (error) {
      const { httpStatus, code, message } = classifyKeyValidationFailure(error);
      return reply.code(httpStatus).send({
        schemaVersion: 1,
        error: { code, message, details: null },
      });
    }
    return { schemaVersion: 1, configured: models !== null, models: models ?? [] };
  });
}
