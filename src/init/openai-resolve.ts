/**
 * Helper to resolve the OpenAI client from the environment.
 *
 * Reads `OPENAI_API_KEY` from `process.env`. Returns `null` when the
 * key is absent ( — init treats absence as a skip-not-fail
 * for the `extract` step). When present, returns a freshly
 * constructed `OpenAIClient` via `createDefaultOpenAIClient`.
 *
 * This helper is imported by the desktop sidecar's bootstrap and by
 * tests. The orchestrator receives the constructed client (or `null`)
 * via its constructor — it does not invoke this helper itself.
 */
import { createDefaultOpenAIClient } from '../profile/openai/client.js';
import type { OpenAIClient } from '../profile/openai/types.js';

export function resolveOpenAiClientOrNull(): OpenAIClient | null {
  const apiKey = process.env['OPENAI_API_KEY'];
  if (typeof apiKey !== 'string' || apiKey.length === 0) {
    return null;
  }
  return createDefaultOpenAIClient({ apiKey });
}
