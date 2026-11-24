import type { AiProviderId } from './schema.js';
import type { SecretsStore } from './secrets.js';

/**
 * Resolve the effective AiProvider API key for one provider (#359).
 *
 * Precedence: the provider's stored slot in the per-provider key map
 * wins, because it is the deliberate per-user choice made in Settings.
 * A legacy single-slot key (pre-#359) applies to the requested
 * provider — the key was saved against the endpoint the config
 * resolved to — and is migrated into the map on first resolution.
 * The environment variables remain the fallback so CI, headless runs,
 * and existing developer setups keep working untouched:
 * `AI_PROVIDER_API_KEY` (preferred) or the legacy `OPENAI_API_KEY`.
 *
 * This is the single seam every consumer must use. Nothing else should
 * read the environment directly, because that would reintroduce the
 * silent divergence this replaces.
 */
export interface ResolveApiKeyOptions {
  readonly store: SecretsStore;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly provider: AiProviderId;
}

function keyFromEnv(env: Readonly<Record<string, string | undefined>>): string | undefined {
  const preferred = env['AI_PROVIDER_API_KEY'];
  if (typeof preferred === 'string' && preferred.length > 0) return preferred;
  const legacy = env['OPENAI_API_KEY'];
  if (typeof legacy === 'string' && legacy.length > 0) return legacy;
  return undefined;
}

interface StoredKey {
  readonly key: string | undefined;
  /** True when the key came from the legacy single slot and should move into the map. */
  readonly fromLegacySlot: boolean;
}

async function readStoredKey(
  store: SecretsStore,
  provider: AiProviderId,
): Promise<StoredKey | null> {
  let secrets;
  try {
    secrets = await store.read();
  } catch {
    // A missing or unreadable store must not make the app unusable;
    // callers fall through to the environment.
    return null;
  }
  const mapped = secrets.aiProviderApiKeys?.[provider];
  if (mapped !== undefined && mapped.length > 0) {
    return { key: mapped, fromLegacySlot: false };
  }
  const legacy = secrets.aiProviderApiKey;
  if (legacy !== undefined && legacy.length > 0) {
    return { key: legacy, fromLegacySlot: true };
  }
  return { key: undefined, fromLegacySlot: false };
}

async function migrateLegacySlot(
  store: SecretsStore,
  provider: AiProviderId,
  legacy: string,
): Promise<void> {
  try {
    const secrets = await store.read();
    const map = { ...(secrets.aiProviderApiKeys ?? {}), [provider]: legacy };
    await store.write({ aiProviderApiKeys: map });
  } catch {
    // Best effort: resolution still returns the key for this launch;
    // the next successful write re-attempts the move.
  }
}

export async function resolveAiProviderApiKey(
  options: ResolveApiKeyOptions,
): Promise<string | null> {
  const stored = await readStoredKey(options.store, options.provider);
  if (stored !== null && stored.key !== undefined) {
    if (stored.fromLegacySlot) {
      await migrateLegacySlot(options.store, options.provider, stored.key);
    }
    return stored.key;
  }
  return keyFromEnv(options.env) ?? null;
}

/**
 * Where the effective key came from. Surfaced in logs so an operator can
 * tell which of the two sources won without inspecting config files.
 */
export type ApiKeySource = 'stored' | 'environment' | 'none';

export async function resolveApiKeySource(options: ResolveApiKeyOptions): Promise<ApiKeySource> {
  const stored = await readStoredKey(options.store, options.provider);
  if (stored !== null && stored.key !== undefined) {
    if (stored.fromLegacySlot) {
      await migrateLegacySlot(options.store, options.provider, stored.key);
    }
    return 'stored';
  }
  return keyFromEnv(options.env) !== undefined ? 'environment' : 'none';
}
