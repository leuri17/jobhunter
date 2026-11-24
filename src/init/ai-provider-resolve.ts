/**
 * Helper to resolve the AiProvider client from the environment.
 *
 * Reads the provider-scoped key (#359) for `provider` from the
 * secrets store / `process.env`. Returns `null` when the key is
 * absent ( — init treats absence as a skip-not-fail for the
 * `extract` step). When present, returns a freshly constructed
 * `AiProviderClient` via `createDefaultAiProviderClient`.
 *
 * The optional `refusal` argument threads operator-configured
 * `config.aiProvider.refusalDetection` (the
 * `{ refusalMarkers, flagEmptyBodies }` pair) into the underlying
 * factory so a model-version bump can be matched by editing
 * `config.json` rather than code. When omitted, the detector's
 * built-in defaults apply — same observable behaviour as before
 * this wiring existed.
 *
 * This helper is imported by the desktop sidecar's bootstrap and by
 * tests. The orchestrator receives the constructed client (or `null`)
 * via its constructor — it does not invoke this helper itself.
 */
import {
  createDefaultAiProviderClient,
  type DefaultAiProviderClientRefusalOptions,
} from '../profile/ai-provider/client.js';
import type { AiProviderClient } from '../profile/ai-provider/types.js';
import { resolveAiProviderApiKey } from '../config/api-key.js';
import type { SecretsStore } from '../config/secrets.js';
import type { AiProviderId } from '../config/schema.js';

export async function resolveAiProviderClientOrNull(
  refusal?: DefaultAiProviderClientRefusalOptions,
  store?: SecretsStore,
  baseUrl?: string,
  provider?: AiProviderId,
): Promise<AiProviderClient | null> {
  const apiKey = await resolveAiProviderApiKey({
    store: store ?? emptySecretsStore(),
    env: process.env,
    provider: provider ?? 'openrouter',
  });
  if (apiKey === null) {
    return null;
  }
  return createDefaultAiProviderClient({
    apiKey,
    ...(baseUrl !== undefined ? { baseUrl } : {}),
    ...(refusal !== undefined ? { refusal } : {}),
  });
}

/** A SecretsStore that behaves as "nothing stored"; used when no store is wired. */
export function emptySecretsStore(): SecretsStore {
  return {
    read: async () => ({}),
    write: async () => undefined,
    clear: async () => undefined,
  };
}
