import {
  createDefaultAiProviderClient,
  type DefaultAiProviderClientRefusalOptions,
  type AiProviderClient,
} from '@jobhunter/core/profile';
import {
  loadConfig,
  resolveAiProviderApiKey,
  resolveAiProviderBaseUrl as resolveConfiguredProviderBaseUrl,
  resolveProviderEndpoint,
  type AiProviderId,
  type LoadedConfig,
  type SecretsStore,
} from '@jobhunter/core/config';
import type { PlatformPaths } from '@jobhunter/core/platform';
import { resolvePlatformPaths, createDefaultPlatformAdapter } from '@jobhunter/core/platform';
import { getSecretsBackend } from '../secrets-backend.js';
import { sidecarFileSystem } from './fs-adapter.js';

function loadOperationalConfig(paths?: PlatformPaths): Promise<LoadedConfig> {
  return loadConfig(
    paths ?? resolvePlatformPaths(createDefaultPlatformAdapter()),
    sidecarFileSystem,
  );
}

/**
 * Resolve the configured provider endpoint. Reads the operational
 * config and maps the `aiProvider.provider` enum onto its catalog
 * entry (or the explicit `baseUrl` for `custom` providers); a
 * missing file falls back to the default (OpenRouter for fresh
 * installs, `openai` for legacy `openai`-section files via the
 * load-time transform).
 */
export async function resolveAiProviderBaseUrl(paths?: PlatformPaths): Promise<string> {
  const loaded = await loadOperationalConfig(paths);
  return resolveConfiguredProviderBaseUrl(loaded.config.aiProvider);
}

/** The provider the saved operational config selects. */
export async function resolveConfiguredProvider(): Promise<AiProviderId> {
  const loaded = await loadOperationalConfig();
  return loaded.config.aiProvider.provider;
}

/** The provider-scoped key for the saved config's provider (#359). */
export async function resolveAiProviderApiKeyForConfig(): Promise<string | null> {
  const loaded = await loadOperationalConfig();
  return resolveAiProviderApiKey({
    store: (await getSecretsBackend()).store,
    env: process.env,
    provider: loaded.config.aiProvider.provider,
  });
}

export async function resolveAiProviderClientOrNull(
  refusal?: DefaultAiProviderClientRefusalOptions,
  store?: SecretsStore,
  timeoutMs?: number,
  maxRetries?: number,
): Promise<AiProviderClient | null> {
  const loaded = await loadOperationalConfig();
  const resolved = store ?? (await getSecretsBackend()).store;
  const key = await resolveAiProviderApiKey({
    store: resolved,
    env: process.env,
    provider: loaded.config.aiProvider.provider,
  });
  if (key === null) return null;
  return createDefaultAiProviderClient({
    apiKey: key,
    baseUrl: resolveConfiguredProviderBaseUrl(loaded.config.aiProvider),
    ...(refusal !== undefined ? { refusal } : {}),
    ...(timeoutMs !== undefined ? { timeoutMs } : {}),
    ...(maxRetries !== undefined ? { maxRetries } : {}),
  });
}

/**
 * Client used by the api-key route to probe a CANDIDATE key for one
 * provider — the selected one, even before Settings are saved. Must
 * hit that provider's endpoint — validating an OpenRouter key
 * against the OpenAI endpoint would false-fail with a 401.
 */
export async function createApiKeyValidationClient(
  apiKey: string,
  provider?: AiProviderId,
  baseUrl?: string,
): Promise<AiProviderClient> {
  const resolvedProvider = provider ?? (await resolveConfiguredProvider());
  return createDefaultAiProviderClient({
    apiKey,
    timeoutMs: 10_000,
    baseUrl: resolveProviderEndpoint(resolvedProvider, baseUrl),
  });
}
