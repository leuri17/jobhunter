/**
 * Helper to resolve the OpenAI client from the environment (TASK-011).
 *
 * Reads `OPENAI_API_KEY` from `process.env`. Returns `null` when the
 * key is absent (Decision 4 — init treats absence as a skip-not-fail
 * for the `extract` step). When present, returns a freshly
 * constructed `OpenAIClient` via `createDefaultOpenAIClient`.
 *
 * This helper is imported ONLY by `src/cli.ts` (and tests). The
 * orchestrator receives the constructed client (or `null`) via its
 * constructor — it does not invoke this helper itself.
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
