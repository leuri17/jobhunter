/**
 * Unit test for `resolveRefusalDetection` — audit B2-M8 follow-up
 * (#52). Mirrors `tests/config/loader.test.ts`'s style: the helper
 * lives at `src/config/refusal.ts` and is re-exported via
 * `@jobhunter/core/config` so the sidecar (`desktop/sidecar/src/server.ts`)
 * can call it at boot.
 *
 * Asserts:
 *  1. A loaded config returns its `openai.refusalDetection` block.
 *  2. `null` (no `config.json` on disk OR the file fails to parse —
 *     both go through `loadConfig().catch(() => null)` in the caller)
 *     falls back to `DEFAULT_OPERATIONAL_CONFIG.openai.refusalDetection`,
 *     not to the deeper `DEFAULT_REFUSAL_MARKERS` set. The fallback
 *     still produces a non-empty marker list so the operator's intent
 *     survives a broken `config.json`.
 */
import { describe, expect, it } from 'vitest';

import { DEFAULT_OPERATIONAL_CONFIG, OperationalConfigSchema } from '../../src/config/schema.js';
import type { LoadedConfig } from '../../src/config/loader.js';
import { resolveRefusalDetection } from '../../src/config/refusal.js';

const STATIC_DEFAULT_MARKERS = DEFAULT_OPERATIONAL_CONFIG.openai.refusalDetection.refusalMarkers;
const STATIC_DEFAULT_FLAG_EMPTY =
  DEFAULT_OPERATIONAL_CONFIG.openai.refusalDetection.flagEmptyBodies;

function makeLoaded(refusalMarkers: readonly string[], flagEmptyBodies: boolean): LoadedConfig {
  // We round-trip through the schema so the test asserts the helper
  // works against the same shape the loader hands back at runtime —
  // not against an `as unknown` cast of an arbitrary literal.
  const parsed = OperationalConfigSchema.parse({
    ...DEFAULT_OPERATIONAL_CONFIG,
    openai: {
      ...DEFAULT_OPERATIONAL_CONFIG.openai,
      refusalDetection: { refusalMarkers, flagEmptyBodies },
    },
  });
  return {
    config: parsed,
    schemaVersion: 1,
    hash: 'test-hash',
    path: '/tmp/test/config.json',
  };
}

describe('resolveRefusalDetection', () => {
  it('returns the configured marker list + flagEmptyBodies when a config is loaded', () => {
    const loaded = makeLoaded(['CUSTOM_PHRASE_A', 'CUSTOM_PHRASE_B'], false);
    const resolved = resolveRefusalDetection(loaded);
    expect(resolved).toEqual({
      refusalMarkers: ['CUSTOM_PHRASE_A', 'CUSTOM_PHRASE_B'],
      flagEmptyBodies: false,
    });
    // Sanity: the operator's marker list must NOT be silently
    // replaced with the static default.
    expect(resolved.refusalMarkers).not.toEqual(STATIC_DEFAULT_MARKERS);
  });

  it('falls back to DEFAULT_OPERATIONAL_CONFIG.openai.refusalDetection when loaded is null', () => {
    const resolved = resolveRefusalDetection(null);
    expect(resolved.refusalMarkers).toEqual(STATIC_DEFAULT_MARKERS);
    expect(resolved.flagEmptyBodies).toBe(STATIC_DEFAULT_FLAG_EMPTY);
    // The static default is a non-empty marker list — never an
    // empty array — so the detector still scans for at least one
    // marker even with a missing or broken `config.json`.
    expect(resolved.refusalMarkers.length).toBeGreaterThan(0);
  });

  it('falls back to DEFAULT_OPERATIONAL_CONFIG.openai.refusalDetection when loaded is undefined', () => {
    // `undefined` is an accepted input shape — `loaded?.config…`
    // in the helper handles both. Callers shouldn't normally pass
    // `undefined`, but the helper must not throw.
    const resolved = resolveRefusalDetection(undefined);
    expect(resolved.refusalMarkers).toEqual(STATIC_DEFAULT_MARKERS);
    expect(resolved.flagEmptyBodies).toBe(STATIC_DEFAULT_FLAG_EMPTY);
  });

  it('does not mutate the loaded config', () => {
    const markers = ['CUSTOM_X'];
    const loaded = makeLoaded(markers, false);
    const before = loaded.config.openai.refusalDetection.refusalMarkers;
    resolveRefusalDetection(loaded);
    resolveRefusalDetection(loaded);
    expect(loaded.config.openai.refusalDetection.refusalMarkers).toBe(before);
    expect(loaded.config.openai.refusalDetection.refusalMarkers).toEqual(markers);
  });
});
