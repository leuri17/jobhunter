import { describe, expect, it } from 'vitest';

import {
  validateRequiredFields,
  type RequiredFieldsValidation,
} from '../../src/linkedin/extraction/required-fields.js';
import type { ExtractionFieldSet } from '../../src/linkedin/extraction/state.js';

/**
 * Tests for `src/linkedin/extraction/required-fields.ts`
 * (TASK-013 Plan Task 4). Asserts every combination of the four
 * required fields being present/absent (16 cases total — `2^4`)
 * plus a few edge cases.
 */

const FULL: ExtractionFieldSet = {
  title: 'Senior Engineer',
  company: 'Acme',
  location: 'Remote',
  description: 'Build cool stuff.',
};

const EMPTY: ExtractionFieldSet = {
  title: null,
  company: null,
  location: null,
  description: null,
};

/**
 * Enumerate the 16 possible combinations of present/absent for
 * the four required fields. `present[i] === true` means field `i`
 * is populated with a non-empty string; otherwise it's `null`.
 * Returns the list as `{ fields, missing }` tuples ready to
 * assert against.
 */
function enumerateCombinations(): ReadonlyArray<{
  readonly fields: ExtractionFieldSet;
  readonly missing: ReadonlyArray<'title' | 'company' | 'location' | 'description'>;
  readonly expectedValid: boolean;
}> {
  const labels = ['title', 'company', 'location', 'description'] as const;
  const out: Array<{
    fields: ExtractionFieldSet;
    missing: ReadonlyArray<(typeof labels)[number]>;
    expectedValid: boolean;
  }> = [];
  for (let mask = 0; mask < 16; mask++) {
    // Build a mutable local copy and freeze before returning it as
    // a readonly `ExtractionFieldSet`.
    const mutableFields: { -readonly [K in keyof ExtractionFieldSet]: ExtractionFieldSet[K] } = {
      title: null,
      company: null,
      location: null,
      description: null,
    };
    const missing: Array<(typeof labels)[number]> = [];
    let valid = true;
    for (let i = 0; i < 4; i++) {
      const bit = (mask >> i) & 1;
      const label = labels[i] as (typeof labels)[number];
      if (bit === 1) {
        mutableFields[label] = `${label}-value`;
      } else {
        mutableFields[label] = null;
        missing.push(label);
        valid = false;
      }
    }
    out.push({ fields: mutableFields, missing, expectedValid: valid });
  }
  return out;
}

describe('src/linkedin/extraction/required-fields — Wave A', () => {
  it('returns valid: true + missing: [] when every field is present', () => {
    const result = validateRequiredFields(FULL);
    expect(result.valid).toBe(true);
    expect(result.missing).toEqual([]);
  });

  it('returns valid: false + missing: all four when every field is null', () => {
    const result = validateRequiredFields(EMPTY);
    expect(result.valid).toBe(false);
    expect(result.missing).toEqual(['title', 'company', 'location', 'description']);
  });

  it('treats whitespace-only strings as missing (after normalizeText)', () => {
    const result = validateRequiredFields({
      title: '   ',
      company: '',
      location: 'Remote',
      description: '<p>   </p>',
    });
    expect(result.valid).toBe(false);
    expect(result.missing).toContain('title');
    expect(result.missing).toContain('company');
    expect(result.missing).toContain('description');
    expect(result.missing).not.toContain('location');
  });

  it('treats "Show more"-only HTML as missing (CTA literal is stripped)', () => {
    const result = validateRequiredFields({
      title: 'Senior Engineer',
      company: 'Acme',
      location: 'Remote',
      description: '<button>Show more</button>',
    });
    expect(result.valid).toBe(false);
    expect(result.missing).toEqual(['description']);
  });

  it('every present bit-flag matches the corresponding non-null field', () => {
    const cases = enumerateCombinations();
    expect(cases).toHaveLength(16);
    for (const { fields, missing, expectedValid } of cases) {
      const result: RequiredFieldsValidation = validateRequiredFields(fields);
      expect(result.valid).toBe(expectedValid);
      // Order is stable: title, company, location, description.
      expect(result.missing).toEqual(missing);
    }
  });

  it('valid is true exactly when missing is empty', () => {
    const cases = enumerateCombinations();
    for (const { fields } of cases) {
      const result = validateRequiredFields(fields);
      if (result.valid) {
        expect(result.missing).toHaveLength(0);
      } else {
        expect(result.missing.length).toBeGreaterThan(0);
      }
    }
  });

  it('returned missing array is a fresh array per call (no shared mutation)', () => {
    const fields: ExtractionFieldSet = {
      title: null,
      company: 'Acme',
      location: null,
      description: 'd',
    };
    const a = validateRequiredFields(fields);
    const b = validateRequiredFields(fields);
    expect(a.missing).not.toBe(b.missing);
    expect(a.missing).toEqual(b.missing);
  });
});
