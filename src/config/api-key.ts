import type { SecretsStore } from './secrets.js';

/**
 * Resolve the effective AiProvider API key.
 *
 * Precedence: a stored secret wins over the environment, because the
 * stored value is the deliberate per-user choice made in Settings. The
 * environment variables remain the fallback so CI, headless runs, and
 * existing developer setups keep working untouched:
 * `AI_PROVIDER_API_KEY` (preferred) or the legacy `OPENAI_API_KEY`.
 *
 * This is the single seam every consumer must use. Nothing else should
 * read the environment directly, because that would reintroduce the
 * silent divergence this replaces.
 */
export interface ResolveApiKeyOptions {
  readonly store: SecretsStore;
  readonly env: Readonly<Record<string, string | undefined>>;
}

function keyFromEnv(env: Readonly<Record<string, string | undefined>>): string | undefined {
  const preferred = env['AI_PROVIDER_API_KEY'];
  if (typeof preferred === 'string' && preferred.length > 0) return preferred;
  const legacy = env['OPENAI_API_KEY'];
  if (typeof legacy === 'string' && legacy.length > 0) return legacy;
  return undefined;
}

export async function resolveAiProviderApiKey(
  options: ResolveApiKeyOptions,
): Promise<string | null> {
  try {
    const stored = await options.store.read();
    if (stored.aiProviderApiKey !== undefined && stored.aiProviderApiKey.length > 0) {
      return stored.aiProviderApiKey;
    }
  } catch {
    // A missing or unreadable store must not make the app unusable; fall
    // through to the environment so an existing setup keeps working.
  }

  return keyFromEnv(options.env) ?? null;
}

/**
 * Where the effective key came from. Surfaced in logs so an operator can
 * tell which of the two sources won without inspecting config files.
 */
export type ApiKeySource = 'stored' | 'environment' | 'none';

export async function resolveApiKeySource(options: ResolveApiKeyOptions): Promise<ApiKeySource> {
  try {
    const stored = await options.store.read();
    if (stored.aiProviderApiKey !== undefined && stored.aiProviderApiKey.length > 0)
      return 'stored';
  } catch {
    // Treated as "not stored"; see resolveAiProviderApiKey.
  }
  return keyFromEnv(options.env) !== undefined ? 'environment' : 'none';
}
