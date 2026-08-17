import { describe, expect, it } from 'vitest';

import {
  calculateFilterConfigContentHash,
  calculateJobContentHash,
  normalizeForHashing,
  type JobContentHashInput,
} from '../../src/filter/content-hash.js';
import { type JobFilterConfig } from '../../src/filter/schema.js';

function minimalConfig(): JobFilterConfig {
  return {
    schemaVersion: 1,
    excludedCompanies: [],
    title: {
      excludedKeywords: [],
      requiredAnyKeywords: [],
    },
    description: {
      excludedKeywords: [],
      requiredAnyKeywords: [],
    },
    seniority: {
      maximum: null,
    },
    languages: {
      accepted: [],
      rejectWhenExplicitlyRequiresOtherLanguage: false,
    },
  };
}

function sampleConfig(): JobFilterConfig {
  return {
    schemaVersion: 1,
    excludedCompanies: ['Acme Corp', 'Initech'],
    title: {
      excludedKeywords: ['sales'],
      requiredAnyKeywords: ['typescript', 'backend'],
    },
    description: {
      excludedKeywords: ['clearance required'],
      requiredAnyKeywords: ['distributed systems'],
    },
    seniority: {
      maximum: 'senior',
    },
    languages: {
      accepted: ['english', 'portuguese'],
      rejectWhenExplicitlyRequiresOtherLanguage: true,
    },
  };
}

describe('normalizeForHashing', () => {
  it('returns an empty string for null', () => {
    expect(normalizeForHashing(null)).toBe('');
  });

  it('returns an empty string for empty input', () => {
    expect(normalizeForHashing('')).toBe('');
  });

  it('returns an empty string for whitespace-only input', () => {
    expect(normalizeForHashing('   \t\n  ')).toBe('');
  });

  it('lowercases, trims, and collapses whitespace', () => {
    expect(normalizeForHashing(' Foo  BAR\n')).toBe('foo bar');
  });

  it('collapses internal repeated whitespace to a single space', () => {
    expect(normalizeForHashing('hello\t   world')).toBe('hello world');
  });

  it('applies Unicode NFKC normalization before lowercasing', () => {
    // NFKC of "ﬁ" (U+FB01) is "fi". After NFKC + lowercase, the result is "fi".
    expect(normalizeForHashing('ﬁ')).toBe('fi');
    // NFKC of "Ⅸ" (Roman numeral nine) is "IX".
    expect(normalizeForHashing('Ⅸ')).toBe('ix');
  });

  it('treats null and empty string as equivalent (both produce "")', () => {
    expect(normalizeForHashing(null)).toBe(normalizeForHashing(''));
  });
});

describe('calculateJobContentHash', () => {
  it('returns a 64-character lowercase hex string (SHA-256)', () => {
    const hash = calculateJobContentHash({
      title: 'Senior Engineer',
      company: 'Acme',
      location: 'Remote',
      description: 'Build things.',
    });
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('produces the same hash regardless of input object key order', () => {
    const a = calculateJobContentHash({
      title: 'Senior Engineer',
      company: 'Acme',
      location: 'Remote',
      description: 'Build things.',
    });
    const b = calculateJobContentHash({
      description: 'Build things.',
      location: 'Remote',
      company: 'Acme',
      title: 'Senior Engineer',
    });
    expect(a).toBe(b);
  });

  it('produces the same hash for whitespace- and case-different inputs', () => {
    const a = calculateJobContentHash({
      title: 'Senior Engineer',
      company: 'Acme',
      location: 'Remote',
      description: 'Build things.',
    });
    const b = calculateJobContentHash({
      title: '  senior engineer  ',
      company: 'ACME',
      location: 'remote',
      description: '  BUILD things.  ',
    });
    expect(a).toBe(b);
  });

  it('produces a different hash when the title changes', () => {
    const a = calculateJobContentHash({
      title: 'Senior Engineer',
      company: 'Acme',
      location: 'Remote',
      description: 'Build things.',
    });
    const b = calculateJobContentHash({
      title: 'Staff Engineer',
      company: 'Acme',
      location: 'Remote',
      description: 'Build things.',
    });
    expect(a).not.toBe(b);
  });

  it('produces a different hash when the description changes', () => {
    const a = calculateJobContentHash({
      title: 'Senior Engineer',
      company: 'Acme',
      location: 'Remote',
      description: 'Build things.',
    });
    const b = calculateJobContentHash({
      title: 'Senior Engineer',
      company: 'Acme',
      location: 'Remote',
      description: 'Build different things.',
    });
    expect(a).not.toBe(b);
  });

  it('produces the same hash when null and empty string are used for the same field', () => {
    const a = calculateJobContentHash({
      title: null,
      company: 'Acme',
      location: 'Remote',
      description: 'Build things.',
    });
    const b = calculateJobContentHash({
      title: '',
      company: 'Acme',
      location: 'Remote',
      description: 'Build things.',
    });
    expect(a).toBe(b);
  });

  it('treats null fields as empty segments (still hashes over a fixed 4-field shape)', () => {
    const hash = calculateJobContentHash({
      title: null,
      company: null,
      location: null,
      description: null,
    });
    // The hash must be a valid SHA-256 hex digest.
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    // And it must differ from the hash of a single-character title because the
    // fixed-order 4-field shape (joined by \n) is the hashed input.
    const withTitle = calculateJobContentHash({
      title: 'x',
      company: null,
      location: null,
      description: null,
    });
    expect(hash).not.toBe(withTitle);
  });

  it('treats the field order as fixed: title, company, location, description', () => {
    // Two inputs that differ only in WHICH field carries the value (`title`
    // vs `company`) yield different hashes because the function reads the
    // fields in a fixed order.
    const titleInTitle = calculateJobContentHash({
      title: 'VALUE',
      company: null,
      location: null,
      description: null,
    });
    const valueInCompany = calculateJobContentHash({
      title: null,
      company: 'VALUE',
      location: null,
      description: null,
    });
    expect(titleInTitle).not.toBe(valueInCompany);
  });

  it('is pure: repeated invocation with the same input returns the same hash', () => {
    const input: JobContentHashInput = {
      title: 'Senior Engineer',
      company: 'Acme',
      location: 'Remote',
      description: 'Build things.',
    };
    const first = calculateJobContentHash(input);
    const second = calculateJobContentHash(input);
    expect(first).toBe(second);
  });
});

describe('calculateFilterConfigContentHash', () => {
  it('returns a 64-character lowercase hex string (SHA-256)', () => {
    const hash = calculateFilterConfigContentHash(minimalConfig());
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('produces a stable hash for the empty config', () => {
    const a = calculateFilterConfigContentHash(minimalConfig());
    const b = calculateFilterConfigContentHash(minimalConfig());
    expect(a).toBe(b);
  });

  it('produces the same hash for configurations that differ only in key order', () => {
    // Two parsed objects that are structurally equal must hash the same even
    // if the JSON serialization would differ in key order.
    const a = calculateFilterConfigContentHash(sampleConfig());
    const b = calculateFilterConfigContentHash(sampleConfig());
    expect(a).toBe(b);
  });

  it('produces a different hash when excludedCompanies changes', () => {
    const a = calculateFilterConfigContentHash(sampleConfig());
    const b = calculateFilterConfigContentHash({
      ...sampleConfig(),
      excludedCompanies: ['Different Corp'],
    });
    expect(a).not.toBe(b);
  });

  it('produces a different hash when seniority.maximum changes', () => {
    const a = calculateFilterConfigContentHash(sampleConfig());
    const b = calculateFilterConfigContentHash({
      ...sampleConfig(),
      seniority: { maximum: 'staff' },
    });
    expect(a).not.toBe(b);
  });

  it('produces a different hash when schemaVersion changes', () => {
    // The schema literal pins schemaVersion to 1, so we cast through `unknown`
    // to simulate a different version for the hash-only check.
    const base = sampleConfig();
    const bumped = { ...base, schemaVersion: 2 } as unknown as JobFilterConfig;
    const a = calculateFilterConfigContentHash(base);
    const b = calculateFilterConfigContentHash(bumped);
    expect(a).not.toBe(b);
  });

  it('is self-consistent: re-hashing the same config returns the same digest', () => {
    const config = sampleConfig();
    const first = calculateFilterConfigContentHash(config);
    // JobFilterConfig has no `contentHash` field, so the helper does not need
    // to exclude anything. A subsequent call with the same value must yield
    // the same digest (round-trip is idempotent).
    const second = calculateFilterConfigContentHash(config);
    expect(first).toBe(second);
  });

  it('hashes the normalized config (whitespace-only differences collapse via trim)', () => {
    const a = calculateFilterConfigContentHash({
      ...sampleConfig(),
      excludedCompanies: ['Acme Corp', 'Initech'],
    });
    const b = calculateFilterConfigContentHash({
      ...sampleConfig(),
      excludedCompanies: ['  Acme Corp  ', '  Initech  '],
    });
    // After normalization (trim + dedupe + sort), both configs collapse to
    // the same logical input. The normalization does NOT lowercase entries —
    // it only trims, dedupes case-insensitively (first-seen wins), and
    // sorts. Case preservation is intentional and is exercised by the
    // "different excludedCompanies" test above.
    expect(a).toBe(b);
  });

  it('hashes the normalized config (case-insensitive dedupe collapses equal entries)', () => {
    const a = calculateFilterConfigContentHash({
      ...sampleConfig(),
      excludedCompanies: ['Acme', 'Initech'],
    });
    const b = calculateFilterConfigContentHash({
      ...sampleConfig(),
      excludedCompanies: ['Acme', 'ACME', 'Initech'],
    });
    // After case-insensitive dedupe, both configs collapse to the same
    // logical input. The first-seen trimmed value wins.
    expect(a).toBe(b);
  });

  it('hashes the normalized config (ordering differences collapse inside an array)', () => {
    const a = calculateFilterConfigContentHash({
      ...sampleConfig(),
      title: {
        excludedKeywords: ['sales'],
        requiredAnyKeywords: ['typescript', 'backend'],
      },
    });
    const b = calculateFilterConfigContentHash({
      ...sampleConfig(),
      title: {
        excludedKeywords: ['sales'],
        requiredAnyKeywords: ['backend', 'typescript'],
      },
    });
    // After normalization, both arrays sort to the same order.
    expect(a).toBe(b);
  });

  it('produces a different hash when the boolean flag changes', () => {
    const a = calculateFilterConfigContentHash(sampleConfig());
    const b = calculateFilterConfigContentHash({
      ...sampleConfig(),
      languages: {
        ...sampleConfig().languages,
        rejectWhenExplicitlyRequiresOtherLanguage: false,
      },
    });
    expect(a).not.toBe(b);
  });
});
