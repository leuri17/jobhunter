import { describe, expect, it } from 'vitest';

import {
  FILTER_SCHEMA_VERSION,
  JobFilterConfigSchema,
  normalizeJobFilterConfig,
  type JobFilterConfig,
} from '../../src/filter/schema.js';

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

describe('FILTER_SCHEMA_VERSION', () => {
  it('is pinned to 1', () => {
    expect(FILTER_SCHEMA_VERSION).toBe(1);
  });
});

describe('JobFilterConfigSchema', () => {
  it('parses a representative valid configuration', () => {
    const config: JobFilterConfig = {
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
    const result = JobFilterConfigSchema.safeParse(config);
    expect(result.success).toBe(true);
  });

  it('parses a minimal valid configuration', () => {
    const result = JobFilterConfigSchema.safeParse(minimalConfig());
    expect(result.success).toBe(true);
  });

  it('rejects schemaVersion values other than 1', () => {
    const result = JobFilterConfigSchema.safeParse({ ...minimalConfig(), schemaVersion: 2 });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(['schemaVersion']);
  });

  it('rejects unknown top-level fields', () => {
    const result = JobFilterConfigSchema.safeParse({
      ...minimalConfig(),
      preferences: { remoteOnly: true },
    });
    expect(result.success).toBe(false);
    expect(JSON.stringify(result.error?.issues)).toContain('preferences');
  });

  it('rejects unknown nested fields', () => {
    const result = JobFilterConfigSchema.safeParse({
      ...minimalConfig(),
      title: {
        excludedKeywords: [],
        requiredAnyKeywords: [],
        extraNested: true,
      },
    });
    expect(result.success).toBe(false);
  });

  it('rejects seniority.maximum values outside the seniority enum', () => {
    const result = JobFilterConfigSchema.safeParse({
      ...minimalConfig(),
      seniority: { maximum: 'overlord' },
    });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(['seniority', 'maximum']);
  });

  it('accepts every documented seniority value for seniority.maximum', () => {
    for (const level of [
      'intern',
      'junior',
      'mid',
      'senior',
      'staff',
      'principal',
      'lead',
      'manager',
      'director',
      'executive',
    ]) {
      const result = JobFilterConfigSchema.safeParse({
        ...minimalConfig(),
        seniority: { maximum: level as JobFilterConfig['seniority']['maximum'] },
      });
      expect(result.success, level).toBe(true);
    }
  });

  it('accepts seniority.maximum === null', () => {
    const result = JobFilterConfigSchema.safeParse({
      ...minimalConfig(),
      seniority: { maximum: null },
    });
    expect(result.success).toBe(true);
  });

  it('rejects non-string entries in excludedCompanies', () => {
    const result = JobFilterConfigSchema.safeParse({
      ...minimalConfig(),
      excludedCompanies: ['Acme', 42],
    });
    expect(result.success).toBe(false);
  });

  it('rejects non-string entries inside title.requiredAnyKeywords', () => {
    const result = JobFilterConfigSchema.safeParse({
      ...minimalConfig(),
      title: {
        excludedKeywords: [],
        requiredAnyKeywords: ['typescript', null],
      },
    });
    expect(result.success).toBe(false);
  });

  it('rejects non-boolean values for rejectWhenExplicitlyRequiresOtherLanguage', () => {
    const result = JobFilterConfigSchema.safeParse({
      ...minimalConfig(),
      languages: {
        accepted: [],
        rejectWhenExplicitlyRequiresOtherLanguage: 'yes',
      },
    });
    expect(result.success).toBe(false);
  });

  it('rejects an entirely missing top-level field', () => {
    const { languages: _languages, ...withoutLanguages } = minimalConfig();
    const result = JobFilterConfigSchema.safeParse(withoutLanguages);
    expect(result.success).toBe(false);
    expect(JSON.stringify(result.error?.issues)).toContain('languages');
  });
});

describe('normalizeJobFilterConfig', () => {
  it('trims whitespace from every string in the known string arrays', () => {
    const config: JobFilterConfig = {
      ...minimalConfig(),
      excludedCompanies: ['  Acme  ', 'Initech '],
      title: {
        excludedKeywords: ['  sales '],
        requiredAnyKeywords: ['typescript'],
      },
      description: {
        excludedKeywords: ['clearance required'],
        requiredAnyKeywords: ['  distributed systems  '],
      },
      languages: {
        ...minimalConfig().languages,
        accepted: [' english '],
      },
    };
    const normalized = normalizeJobFilterConfig(config);
    expect(normalized.excludedCompanies).toEqual(['Acme', 'Initech']);
    expect(normalized.title.excludedKeywords).toEqual(['sales']);
    expect(normalized.title.requiredAnyKeywords).toEqual(['typescript']);
    expect(normalized.description.excludedKeywords).toEqual(['clearance required']);
    expect(normalized.description.requiredAnyKeywords).toEqual(['distributed systems']);
    expect(normalized.languages.accepted).toEqual(['english']);
  });

  it('dedupes entries that differ only in case (case-insensitive comparison)', () => {
    const config: JobFilterConfig = {
      ...minimalConfig(),
      excludedCompanies: ['Acme', 'ACME', 'acme', 'Initech'],
    };
    const normalized = normalizeJobFilterConfig(config);
    // The first-seen trimmed value (after case-fold) is kept; only one Acme survives.
    expect(normalized.excludedCompanies).toContain('Acme');
    expect(normalized.excludedCompanies).not.toContain('ACME');
    expect(normalized.excludedCompanies).not.toContain('acme');
    expect(normalized.excludedCompanies.length).toBe(2);
  });

  it('sorts each normalized array deterministically by case-folded value', () => {
    const config: JobFilterConfig = {
      ...minimalConfig(),
      excludedCompanies: ['banana', 'Apple', 'cherry'],
      title: {
        excludedKeywords: ['zebra', 'apple'],
        requiredAnyKeywords: ['typescript', 'JavaScript'],
      },
      description: {
        excludedKeywords: ['xenon'],
        requiredAnyKeywords: ['apple', 'Banana'],
      },
      languages: {
        ...minimalConfig().languages,
        accepted: ['spanish', 'English', 'french'],
      },
    };
    const normalized = normalizeJobFilterConfig(config);
    expect(normalized.excludedCompanies).toEqual(['Apple', 'banana', 'cherry']);
    expect(normalized.title.excludedKeywords).toEqual(['apple', 'zebra']);
    expect(normalized.title.requiredAnyKeywords).toEqual(['JavaScript', 'typescript']);
    expect(normalized.description.requiredAnyKeywords).toEqual(['apple', 'Banana']);
    expect(normalized.languages.accepted).toEqual(['English', 'french', 'spanish']);
  });

  it('passes seniority.maximum and the boolean flag through untouched', () => {
    const config: JobFilterConfig = {
      ...minimalConfig(),
      seniority: { maximum: 'lead' },
      languages: {
        ...minimalConfig().languages,
        rejectWhenExplicitlyRequiresOtherLanguage: true,
      },
    };
    const normalized = normalizeJobFilterConfig(config);
    expect(normalized.seniority.maximum).toBe('lead');
    expect(normalized.languages.rejectWhenExplicitlyRequiresOtherLanguage).toBe(true);
  });

  it('preserves the schemaVersion literal', () => {
    const normalized = normalizeJobFilterConfig(minimalConfig());
    expect(normalized.schemaVersion).toBe(1);
  });

  it('produces identical output across repeated invocations (deterministic)', () => {
    const config: JobFilterConfig = {
      ...minimalConfig(),
      excludedCompanies: ['Foo', 'bar', 'BAZ', 'foo ', 'Bar'],
      languages: {
        ...minimalConfig().languages,
        accepted: ['english', 'Portuguese', 'ENGLISH'],
      },
    };
    const first = normalizeJobFilterConfig(config);
    const second = normalizeJobFilterConfig(config);
    expect(second).toEqual(first);
  });

  it('does not mutate the input object', () => {
    const config: JobFilterConfig = {
      ...minimalConfig(),
      excludedCompanies: ['  Acme  ', 'Initech'],
    };
    const snapshot = JSON.stringify(config);
    normalizeJobFilterConfig(config);
    expect(JSON.stringify(config)).toBe(snapshot);
  });
});
