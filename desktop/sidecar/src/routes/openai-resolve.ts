import {
  createDefaultOpenAIClient,
  type DefaultOpenAIClientRefusalOptions,
  type OpenAIClient,
} from '@jobhunter/core/profile';
import { resolveOpenAiApiKey, type SecretsStore } from '@jobhunter/core/config';
import { getSecretsBackend } from '../secrets-backend.js';

export async function resolveOpenAiClientOrNull(
  refusal?: DefaultOpenAIClientRefusalOptions,
  store?: SecretsStore,
): Promise<OpenAIClient | null> {
  const resolved = store ?? (await getSecretsBackend()).store;
  const key = await resolveOpenAiApiKey({ store: resolved, env: process.env });
  if (key === null) return null;
  return createDefaultOpenAIClient({
    apiKey: key,
    ...(refusal !== undefined ? { refusal } : {}),
  });
}
