import {
  createDefaultOpenAIClient,
  type DefaultOpenAIClientRefusalOptions,
  type OpenAIClient,
} from '@jobhunter/core/profile';
import { FileSecretsStore, resolveOpenAiApiKey, type SecretsStore } from '@jobhunter/core/config';
import { resolvePlatformPaths, createDefaultPlatformAdapter } from '@jobhunter/core/platform';

function defaultStore(): SecretsStore {
  return new FileSecretsStore({ paths: resolvePlatformPaths(createDefaultPlatformAdapter()) });
}

export async function resolveOpenAiClientOrNull(
  refusal?: DefaultOpenAIClientRefusalOptions,
  store: SecretsStore = defaultStore(),
): Promise<OpenAIClient | null> {
  const key = await resolveOpenAiApiKey({ store, env: process.env });
  if (key === null) return null;
  return createDefaultOpenAIClient({
    apiKey: key,
    ...(refusal !== undefined ? { refusal } : {}),
  });
}
