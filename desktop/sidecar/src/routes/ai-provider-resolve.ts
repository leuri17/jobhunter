import {
  createDefaultAiProviderClient,
  type DefaultAiProviderClientRefusalOptions,
  type AiProviderClient,
} from '@jobhunter/core/profile';
import { resolveAiProviderApiKey, type SecretsStore } from '@jobhunter/core/config';
import { getSecretsBackend } from '../secrets-backend.js';

export async function resolveAiProviderClientOrNull(
  refusal?: DefaultAiProviderClientRefusalOptions,
  store?: SecretsStore,
  timeoutMs?: number,
  maxRetries?: number,
): Promise<AiProviderClient | null> {
  const resolved = store ?? (await getSecretsBackend()).store;
  const key = await resolveAiProviderApiKey({ store: resolved, env: process.env });
  if (key === null) return null;
  return createDefaultAiProviderClient({
    apiKey: key,
    ...(refusal !== undefined ? { refusal } : {}),
    ...(timeoutMs !== undefined ? { timeoutMs } : {}),
    ...(maxRetries !== undefined ? { maxRetries } : {}),
  });
}
