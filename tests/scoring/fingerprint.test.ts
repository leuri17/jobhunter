import { describe, expect, it } from 'vitest';

import {
  SCORER_IMPLEMENTATION_VERSION,
  computeScoreFingerprint,
} from '../../src/scoring/fingerprint.js';

const BASE_INPUT = {
  jobContentHash: 'a'.repeat(64),
  profileVersionId: 1,
  profileFingerprint: 'b'.repeat(64),
  effectiveDerivedValuesHash: 'c'.repeat(64),
  promptVersion: 1,
  rubricVersion: 1,
  model: 'gpt-5.6-sol',
  reasoningEffort: 'medium',
  modelConfig: { temperature: 1 } as const,
  scorerImplementationVersion: SCORER_IMPLEMENTATION_VERSION,
} as const;

describe('SCORER_IMPLEMENTATION_VERSION', () => {
  it('is exactly 1', () => {
    expect(SCORER_IMPLEMENTATION_VERSION).toBe(1);
  });
});

describe('computeScoreFingerprint', () => {
  it('returns a 64-char lowercase hex string', () => {
    const fp = computeScoreFingerprint(BASE_INPUT);
    expect(fp).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is deterministic — same input → same fingerprint', () => {
    const fp1 = computeScoreFingerprint(BASE_INPUT);
    const fp2 = computeScoreFingerprint(BASE_INPUT);
    expect(fp1).toBe(fp2);
  });

  it('changes when jobContentHash changes', () => {
    const fp1 = computeScoreFingerprint(BASE_INPUT);
    const fp2 = computeScoreFingerprint({ ...BASE_INPUT, jobContentHash: 'd'.repeat(64) });
    expect(fp1).not.toBe(fp2);
  });

  it('changes when model changes', () => {
    const fp1 = computeScoreFingerprint(BASE_INPUT);
    const fp2 = computeScoreFingerprint({ ...BASE_INPUT, model: 'gpt-5.6-pro' });
    expect(fp1).not.toBe(fp2);
  });

  it('changes when scorerImplementationVersion changes', () => {
    const fp1 = computeScoreFingerprint(BASE_INPUT);
    const fp2 = computeScoreFingerprint({ ...BASE_INPUT, scorerImplementationVersion: 2 });
    expect(fp1).not.toBe(fp2);
  });

  it('changes when promptVersion changes', () => {
    const fp1 = computeScoreFingerprint(BASE_INPUT);
    const fp2 = computeScoreFingerprint({ ...BASE_INPUT, promptVersion: 2 });
    expect(fp1).not.toBe(fp2);
  });

  it('changes when rubricVersion changes', () => {
    const fp1 = computeScoreFingerprint(BASE_INPUT);
    const fp2 = computeScoreFingerprint({ ...BASE_INPUT, rubricVersion: 2 });
    expect(fp1).not.toBe(fp2);
  });

  it('changes when reasoningEffort changes', () => {
    const fp1 = computeScoreFingerprint(BASE_INPUT);
    const fp2 = computeScoreFingerprint({ ...BASE_INPUT, reasoningEffort: 'high' });
    expect(fp1).not.toBe(fp2);
  });

  it('changes when profileFingerprint changes', () => {
    const fp1 = computeScoreFingerprint(BASE_INPUT);
    const fp2 = computeScoreFingerprint({ ...BASE_INPUT, profileFingerprint: 'e'.repeat(64) });
    expect(fp1).not.toBe(fp2);
  });

  it('is invariant to modelConfig key order (canonicalization)', () => {
    const a = computeScoreFingerprint({
      ...BASE_INPUT,
      modelConfig: { temperature: 1, topP: 0.9, seed: 42 },
    });
    const b = computeScoreFingerprint({
      ...BASE_INPUT,
      modelConfig: { seed: 42, topP: 0.9, temperature: 1 },
    });
    expect(a).toBe(b);
  });

  it('is invariant to the order of the top-level key insertion (top-level canonicalization)', () => {
    // The replacer array locks the top-level key order to alphabetical.
    // Two structurally identical inputs must produce the same fingerprint
    // even if the object-literal key order differs.
    const fp1 = computeScoreFingerprint(BASE_INPUT);
    const reordered = {
      scorerImplementationVersion: SCORER_IMPLEMENTATION_VERSION,
      rubricVersion: 1,
      reasoningEffort: 'medium',
      promptVersion: 1,
      modelConfig: { temperature: 1 },
      model: 'gpt-5.6-sol',
      effectiveDerivedValuesHash: 'c'.repeat(64),
      profileFingerprint: 'b'.repeat(64),
      profileVersionId: 1,
      jobContentHash: 'a'.repeat(64),
    };
    const fp2 = computeScoreFingerprint(reordered);
    expect(fp1).toBe(fp2);
  });
});
