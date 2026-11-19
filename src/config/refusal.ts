/**
 * Derive `DefaultAiProviderClientRefusalOptions` from a possibly-null
 * loaded `OperationalConfig`.
 *
 * Audit B2-M8 follow-up (#52): when a fresh model variant emits a
 * refusal phrase the static `DEFAULT_REFUSAL_MARKERS` miss, operators
 * can extend the list via `config.aiProvider.refusalDetection.refusalMarkers`
 * in `config.json`. This helper is the single read-side of that config
 * path; the sidecar (`desktop/sidecar/src/server.ts`) calls it once at
 * boot and threads the result into the route handlers.
 *
 * Behaviour:
 *  - Loaded config present → use `loaded.config.aiProvider.refusalDetection`.
 *  - Loaded config absent (no `config.json` on disk or a malformed
 *    one — `loadConfig` rejected) → fall back to the static
 *    `DEFAULT_OPERATIONAL_CONFIG.aiProvider.refusalDetection` so the
 *    operator's marker list survives even when their config file
 *    fails to parse. Same fallback shape as `resolveLogConfig`.
 */
import { DEFAULT_OPERATIONAL_CONFIG } from './schema.js';
import type { LoadedConfig } from './loader.js';
import type { DefaultAiProviderClientRefusalOptions } from '../profile/ai-provider/client.js';

export function resolveRefusalDetection(
  loaded: LoadedConfig | null,
): DefaultAiProviderClientRefusalOptions {
  const cfg =
    loaded?.config.aiProvider.refusalDetection ??
    DEFAULT_OPERATIONAL_CONFIG.aiProvider.refusalDetection;
  return {
    refusalMarkers: cfg.refusalMarkers,
    flagEmptyBodies: cfg.flagEmptyBodies,
  };
}
