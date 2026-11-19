import {
  createDefaultAiProviderClient,
  type DefaultAiProviderClientRefusalOptions,
  type AiProviderClient,
} from '@jobhunter/core/profile';
import { loadConfig, resolveAiProviderApiKey, type SecretsStore } from '@jobhunter/core/config';
import type { PlatformPaths } from '@jobhunter/core/platform';
import { resolvePlatformPaths, createDefaultPlatformAdapter } from '@jobhunter/core/platform';
import { getSecretsBackend } from '../secrets-backend.js';
import { sidecarFileSystem } from './fs-adapter.js';

/**
 * Resolve the configured provider endpoint (`aiProvider.baseUrl`).
 * Reads the operational config; a missing file falls back to the
 * default (OpenRouter for fresh installs, the OpenAI endpoint for
 * legacy `openai`-section files via the load-time transform).
 */
export async function resolveAiProviderBaseUrl(paths?: PlatformPaths): Promise<string> {
  const loaded = await loadConfig(
    paths ?? resolvePlatformPaths(createDefaultPlatformAdapter()),
    sidecarFileSystem,
  );
  return loaded.config.aiProvider.baseUrl;
}

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
    baseUrl: await resolveAiProviderBaseUrl(),
    ...(refusal !== undefined ? { refusal } : {}),
    ...(timeoutMs !== undefined ? { timeoutMs } : {}),
    ...(maxRetries !== undefined ? { maxRetries } : {}),
  });
}

/**
 * Client used by the api-key route to probe a CANDIDATE key. Must hit
 * the configured provider endpoint — validating an OpenRouter key
 * against the OpenAI endpoint would false-fail with a 401.
 */
export async function createApiKeyValidationClient(apiKey: string): Promise<AiProviderClient> {
  return createDefaultAiProviderClient({
    apiKey,
    timeoutMs: 10_000,
    baseUrl: await resolveAiProviderBaseUrl(),
  });
}
