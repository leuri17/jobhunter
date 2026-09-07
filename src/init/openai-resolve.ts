/**
 * Helper to resolve the OpenAI client from the environment.
 *
 * Reads `OPENAI_API_KEY` from `process.env`. Returns `null` when the
 * key is absent ( — init treats absence as a skip-not-fail
 * for the `extract` step). When present, returns a freshly
 * constructed `OpenAIClient` via `createDefaultOpenAIClient`.
 *
 * The optional `refusal` argument threads operator-configured
 * `config.openai.refusalDetection` (the
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
  createDefaultOpenAIClient,
  type DefaultOpenAIClientRefusalOptions,
} from '../profile/openai/client.js';
import type { OpenAIClient } from '../profile/openai/types.js';

export function resolveOpenAiClientOrNull(
  refusal?: DefaultOpenAIClientRefusalOptions,
): OpenAIClient | null {
  const apiKey = process.env['OPENAI_API_KEY'];
  if (typeof apiKey !== 'string' || apiKey.length === 0) {
    return null;
  }
  return createDefaultOpenAIClient({
    apiKey,
    ...(refusal !== undefined ? { refusal } : {}),
  });
}
