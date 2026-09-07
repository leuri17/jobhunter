/**
 * Unit test for `resolveOpenAiClientOrNull` — audit B2-M8 follow-up
 * (#52). Asserts the resolver threads operator-set
 * `config.openai.refusalDetection` into the `createDefaultOpenAIClient`
 * factory so the detector inside the returned client is bound to the
 * configured marker list (and `flagEmptyBodies`), not to the
 * module-level `DEFAULT_REFUSAL_MARKERS`.
 *
 * The factory delegates the actual binding to `createRefusalDetector`
 * via the private `toRefusalDetectorOptions` adapter — we assert on
 * the public `createRefusalDetector` boundary, which is the same
 * observable: the detector returned by `createRefusalDetector(options)`
 * iterates `options.markers ?? DEFAULT_REFUSAL_MARKERS` on every
 * `detectRefusal` call.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/profile/openai/refusal-detector.js', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../../src/profile/openai/refusal-detector.js')>();
  return {
    ...actual,
    createRefusalDetector: vi.fn(actual.createRefusalDetector),
  };
});

import {
  createRefusalDetector,
  DEFAULT_REFUSAL_MARKERS,
} from '../../src/profile/openai/refusal-detector.js';
import { resolveOpenAiClientOrNull } from '../../src/init/openai-resolve.js';

const mockCreateRefusalDetector = vi.mocked(createRefusalDetector);

beforeEach(() => {
  mockCreateRefusalDetector.mockClear();
  vi.stubEnv('OPENAI_API_KEY', 'sk-test-key');
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('resolveOpenAiClientOrNull — refusal-detection wiring (audit B2-M8 follow-up)', () => {
  it('returns null when OPENAI_API_KEY is unset, regardless of `refusal`', () => {
    vi.unstubAllEnvs();
    expect(resolveOpenAiClientOrNull()).toBeNull();
    expect(resolveOpenAiClientOrNull({ refusalMarkers: ['X'], flagEmptyBodies: false })).toBeNull();
    expect(mockCreateRefusalDetector).not.toHaveBeenCalled();
  });

  it('binds DEFAULT_REFUSAL_MARKERS + flagEmpty=true when called with no options', () => {
    resolveOpenAiClientOrNull();
    expect(mockCreateRefusalDetector).toHaveBeenCalledTimes(1);
    // No `refusal` passed → the factory's `toRefusalDetectorOptions`
    // returns `undefined` and `createRefusalDetector(undefined)` falls
    // through to the module-level defaults.
    expect(mockCreateRefusalDetector).toHaveBeenCalledWith(undefined);
  });

  it('binds a passed `refusal` option to the detector (custom markers, flagEmpty=false)', () => {
    const refusal = {
      refusalMarkers: ['CUSTOM_REFUSAL_PHRASE'],
      flagEmptyBodies: false,
    };
    resolveOpenAiClientOrNull(refusal);
    expect(mockCreateRefusalDetector).toHaveBeenCalledTimes(1);
    // `toRefusalDetectorOptions` translates `refusalMarkers` → `markers`
    // and `flagEmptyBodies` → `flagEmpty` before binding.
    expect(mockCreateRefusalDetector).toHaveBeenCalledWith({
      markers: ['CUSTOM_REFUSAL_PHRASE'],
      flagEmpty: false,
    });
  });

  it('passes through partial refusal overrides (markers only; flagEmpty resolved at scan time)', () => {
    resolveOpenAiClientOrNull({ refusalMarkers: ['ONLY_MARKERS'] });
    // The factory's `toRefusalDetectorOptions` only writes `flagEmpty`
    // when the caller passed `flagEmptyBodies`. The detector defaults
    // `flagEmpty` to `true` at scan time (see refusal-detector.ts),
    // which is the same observable behaviour either way.
    expect(mockCreateRefusalDetector).toHaveBeenCalledWith({
      markers: ['ONLY_MARKERS'],
    });
  });

  it('keeps DEFAULT_REFUSAL_MARKERS distinct from the operator-supplied list', () => {
    // Sanity check that the marker list we're testing against isn't
    // accidentally the same as the static default — guards against
    // a future copy-paste regression in the test data.
    expect(DEFAULT_REFUSAL_MARKERS).not.toContain('CUSTOM_REFUSAL_PHRASE');
  });
});
