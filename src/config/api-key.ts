import type { SecretsStore } from './secrets.js';

/**
 * Resolve the effective OpenAI API key.
 *
 * Precedence: a stored secret wins over `OPENAI_API_KEY`, because the
 * stored value is the deliberate per-user choice made in Settings. The
 * environment variable remains the fallback so CI, headless runs, and
 * existing developer setups keep working untouched.
 *
 * This is the single seam every consumer must use. Nothing else should
 * read `process.env.OPENAI_API_KEY` directly, because that would
 * reintroduce the silent divergence this replaces.
 */
export interface ResolveApiKeyOptions {
  readonly store: SecretsStore;
  readonly env: Readonly<Record<string, string | undefined>>;
}

export async function resolveOpenAiApiKey(options: ResolveApiKeyOptions): Promise<string | null> {
  try {
    const stored = await options.store.read();
    if (stored.openaiApiKey !== undefined && stored.openaiApiKey.length > 0) {
      return stored.openaiApiKey;
    }
  } catch {
    // A missing or unreadable store must not make the app unusable; fall
    // through to the environment so an existing setup keeps working.
  }

  const fromEnv = options.env['OPENAI_API_KEY'];
  if (typeof fromEnv === 'string' && fromEnv.length > 0) return fromEnv;
  return null;
}

/**
 * Where the effective key came from. Surfaced in logs so an operator can
 * tell which of the two sources won without inspecting config files.
 */
export type ApiKeySource = 'stored' | 'environment' | 'none';

export async function resolveApiKeySource(options: ResolveApiKeyOptions): Promise<ApiKeySource> {
  try {
    const stored = await options.store.read();
    if (stored.openaiApiKey !== undefined && stored.openaiApiKey.length > 0) return 'stored';
  } catch {
    // Treated as "not stored"; see resolveOpenAiApiKey.
  }
  const fromEnv = options.env['OPENAI_API_KEY'];
  if (typeof fromEnv === 'string' && fromEnv.length > 0) return 'environment';
  return 'none';
}
