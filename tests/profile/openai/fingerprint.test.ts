import { describe, expect, it } from 'vitest';

import {
  EXTRACTOR_IMPLEMENTATION_VERSION,
  PROFILE_EXTRACTION_PROMPT_VERSION,
  calculateExtractionFingerprint,
  type ExtractionFingerprintInputs,
} from '../../../src/profile/openai/fingerprint.js';

function baseInputs(): ExtractionFingerprintInputs {
  return {
    sourceHashes: ['hash-a', 'hash-b', 'hash-c'],
    schemaVersion: 1,
    promptVersion: PROFILE_EXTRACTION_PROMPT_VERSION,
    model: 'gpt-5.6-sol',
    reasoningEffort: 'medium',
    structuredOutputSchemaVersion: 1,
  };
}

describe('extract version constants', () => {
  it('exports EXTRACTOR_IMPLEMENTATION_VERSION = 1.0.0', () => {
    expect(EXTRACTOR_IMPLEMENTATION_VERSION).toBe('1.0.0');
  });

  it('exports PROFILE_EXTRACTION_PROMPT_VERSION = profile-extraction-prompt@v1', () => {
    expect(PROFILE_EXTRACTION_PROMPT_VERSION).toBe('profile-extraction-prompt@v1');
  });
});

describe('calculateExtractionFingerprint', () => {
  it('returns a 64-character lowercase hex digest for identical inputs', () => {
    const hash = calculateExtractionFingerprint(baseInputs());
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(calculateExtractionFingerprint(baseInputs())).toBe(hash);
  });

  it('produces the same hash regardless of source-hash order', () => {
    const forward: ExtractionFingerprintInputs = {
      ...baseInputs(),
      sourceHashes: ['hash-a', 'hash-b', 'hash-c'],
    };
    const reversed: ExtractionFingerprintInputs = {
      ...baseInputs(),
      sourceHashes: ['hash-c', 'hash-b', 'hash-a'],
    };
    const mixed: ExtractionFingerprintInputs = {
      ...baseInputs(),
      sourceHashes: ['hash-b', 'hash-c', 'hash-a'],
    };

    expect(calculateExtractionFingerprint(forward)).toBe(calculateExtractionFingerprint(reversed));
    expect(calculateExtractionFingerprint(forward)).toBe(calculateExtractionFingerprint(mixed));
  });

  it('produces a different hash when the model identifier changes', () => {
    const baseline = calculateExtractionFingerprint(baseInputs());
    const other = calculateExtractionFingerprint({ ...baseInputs(), model: 'gpt-5.6-pro' });
    expect(other).not.toBe(baseline);
  });

  it('produces a different hash when the reasoning effort changes', () => {
    const baseline = calculateExtractionFingerprint(baseInputs());
    const high = calculateExtractionFingerprint({ ...baseInputs(), reasoningEffort: 'high' });
    const low = calculateExtractionFingerprint({ ...baseInputs(), reasoningEffort: 'low' });
    expect(high).not.toBe(baseline);
    expect(low).not.toBe(baseline);
    expect(high).not.toBe(low);
  });

  it('produces a different hash when the schema version changes', () => {
    const baseline = calculateExtractionFingerprint(baseInputs());
    const next = calculateExtractionFingerprint({ ...baseInputs(), schemaVersion: 2 });
    expect(next).not.toBe(baseline);
  });

  it('produces a different hash when the prompt version changes', () => {
    const baseline = calculateExtractionFingerprint(baseInputs());
    const next = calculateExtractionFingerprint({
      ...baseInputs(),
      promptVersion: 'profile-extraction-prompt@v2',
    });
    expect(next).not.toBe(baseline);
  });
});
