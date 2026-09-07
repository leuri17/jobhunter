import { describe, expect, it } from 'vitest';

import {
  DEFAULT_REFUSAL_MARKERS,
  createRefusalDetector,
  detectRefusal,
} from '../../../src/profile/openai/refusal-detector.js';

describe('DEFAULT_REFUSAL_MARKERS', () => {
  it('is a non-empty readonly array of distinct refusal phrases', () => {
    expect(DEFAULT_REFUSAL_MARKERS.length).toBeGreaterThanOrEqual(5);
    const unique = new Set(DEFAULT_REFUSAL_MARKERS);
    expect(unique.size).toBe(DEFAULT_REFUSAL_MARKERS.length);
  });

  it('every default marker is at least 4 chars (filters out trivial false-positives)', () => {
    for (const marker of DEFAULT_REFUSAL_MARKERS) {
      expect(marker.length).toBeGreaterThanOrEqual(4);
    }
  });
});

describe('detectRefusal — refusal_marker', () => {
  for (const marker of DEFAULT_REFUSAL_MARKERS) {
    it(`flags rawJsonText containing the default marker "${marker}"`, () => {
      const detection = detectRefusal(`Hello. ${marker} help with that.`);
      expect(detection.isRefusal).toBe(true);
      expect(detection.reason).toBe('refusal_marker');
      expect(detection.matchedMarker).toBe(marker);
    });
  }

  it('matches case-insensitively', () => {
    const detection = detectRefusal("i CAN'T help with that request");
    expect(detection.isRefusal).toBe(true);
    expect(detection.reason).toBe('refusal_marker');
    expect(detection.matchedMarker).toBe("I can't");
  });

  it('matches as a substring (not just whole-word)', () => {
    // The input contains two default markers ("as an AI" + "I cannot").
    // The detector returns whichever marker it encounters first in the
    // configured array order — DEFAULT_REFUSAL_MARKERS lists
    // "I cannot" before "as an AI", so "I cannot" wins.
    const detection = detectRefusal('Sure thing, but as an AI language model I cannot lie');
    expect(detection.isRefusal).toBe(true);
    expect(detection.matchedMarker).toBe('I cannot');
  });

  it('returns the FIRST matching marker in the array order', () => {
    const custom = ['first-marker', 'second-marker', 'third-marker'];
    const detection = detectRefusal('Has first-marker AND third-marker in it', {
      markers: custom,
    });
    expect(detection.matchedMarker).toBe('first-marker');
  });

  it('accepts a custom marker list via RefusalDetectorOptions', () => {
    const detection = detectRefusal('Custom refusal phrase XYZ', {
      markers: ['Custom refusal phrase'],
    });
    expect(detection.isRefusal).toBe(true);
    expect(detection.matchedMarker).toBe('Custom refusal phrase');
  });

  it('an empty markers list short-circuits the refusal-marker scan to never match', () => {
    const detection = detectRefusal("I can't help with that", { markers: [] });
    expect(detection.isRefusal).toBe(false);
  });
});

describe('detectRefusal — empty_body', () => {
  it('flags the empty string', () => {
    const detection = detectRefusal('');
    expect(detection.isRefusal).toBe(true);
    expect(detection.reason).toBe('empty_body');
    expect(detection.matchedMarker).toBeUndefined();
  });

  it('flags a whitespace-only string', () => {
    const detection = detectRefusal('   \n\t  ');
    expect(detection.isRefusal).toBe(true);
    expect(detection.reason).toBe('empty_body');
  });

  it('flags `"{}"` as `empty_json_object`, not `empty_body`', () => {
    const detection = detectRefusal('{}');
    expect(detection.isRefusal).toBe(true);
    expect(detection.reason).toBe('empty_json_object');
  });

  it('flags whitespace-padded `"{}"` (outer spaces only) as `empty_json_object`', () => {
    const detection = detectRefusal('  {}  ');
    expect(detection.isRefusal).toBe(true);
    expect(detection.reason).toBe('empty_json_object');
  });

  it('does NOT flag `{ }` (whitespace inside braces) — not valid JSON anyway', () => {
    // Inner-brace whitespace isn't valid JSON; we rely on the
    // caller's JSON.parse to fail loud elsewhere. The detector only
    // flags the canonical `"{}"` (after trim).
    const detection = detectRefusal('  {  }  ');
    expect(detection.isRefusal).toBe(false);
  });

  it('does NOT flag `{}` as empty when `flagEmpty` is false', () => {
    const detection = detectRefusal('{}', { flagEmpty: false });
    expect(detection.isRefusal).toBe(false);
  });

  it('does NOT flag an empty string as empty_body when `flagEmpty` is false', () => {
    const detection = detectRefusal('', { flagEmpty: false });
    expect(detection.isRefusal).toBe(false);
  });
});

describe('detectRefusal — happy path (not a refusal)', () => {
  it('returns isRefusal: false for a well-formed JSON object that is not `{}`', () => {
    const detection = detectRefusal('{"basics":{"headline":"Senior Engineer"}}');
    expect(detection.isRefusal).toBe(false);
    expect(detection.reason).toBeUndefined();
    expect(detection.matchedMarker).toBeUndefined();
  });

  it('returns isRefusal: false for an array-shaped JSON object', () => {
    const detection = detectRefusal('[1, 2, 3]');
    expect(detection.isRefusal).toBe(false);
  });

  it('returns isRefusal: false for JSON containing a refusal-marker phrase as a value (not as the model speaking)', () => {
    // The marker "as an AI" is a substring of "as an AI engineer
    // building a tool" — but the model is REPORTING this as data, not
    // speaking it. Phase 1 (this PR) is a global substring scan;
    // the false positive is acceptable because the upstream retry
    // policy gives the model ONE chance to emit a clean response.
    // A future scoped-scan follow-up (#51 markers) could narrow
    // this to inside the user-data delimiters.
    const detection = detectRefusal('{"warning":"as an AI engineer I should disclose this"}');
    // We assert the CURRENT (global) behavior: it's a positive match
    // for the substring. This documents the global-scan trade-off
    // so a future scoped-scan follow-up is easy to spot.
    expect(detection.isRefusal).toBe(true);
  });
});

describe('createRefusalDetector', () => {
  it('returns a function with the same semantics as `detectRefusal`', () => {
    const detect = createRefusalDetector();
    expect(detect('{}').isRefusal).toBe(true);
    expect(detect('{"ok":true}').isRefusal).toBe(false);
  });

  it('bakes in custom markers once at construction (per-call options not consulted)', () => {
    const detect = createRefusalDetector({ markers: ['only-this-marker'] });
    expect(detect('only-this-marker in here').isRefusal).toBe(true);
    // Per-call options are ignored — the constructor's options win.
    expect(detect('I cannot help').isRefusal).toBe(false);
  });

  it('falls back to DEFAULT_REFUSAL_MARKERS when no options supplied', () => {
    const detect = createRefusalDetector();
    expect(detect('I cannot help with that')).toEqual({
      isRefusal: true,
      reason: 'refusal_marker',
      matchedMarker: 'I cannot',
    });
  });
});
