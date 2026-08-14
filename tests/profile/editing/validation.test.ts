import { describe, expect, it } from 'vitest';

import { validateScalar } from '../../../src/profile/editing/validation.js';

describe('validateScalar: basics', () => {
  it('accepts a non-empty headline', () => {
    const result = validateScalar('basics', 'headline', 'Staff Engineer');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toBe('Staff Engineer');
  });

  it('rejects empty headline (required string)', () => {
    const result = validateScalar('basics', 'headline', '');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues.length).toBeGreaterThan(0);
  });

  it('accepts null for nullable headline', () => {
    const result = validateScalar('basics', 'headline', null);
    expect(result.ok).toBe(true);
  });

  it('rejects unknown basics field', () => {
    const result = validateScalar('basics', 'nonsense', 'x');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues[0]).toMatch(/Unknown field basics\.nonsense/);
  });
});

describe('validateScalar: experience', () => {
  it('accepts a valid year-month startDate', () => {
    const result = validateScalar('experience', 'startDate', '2024-01');
    expect(result.ok).toBe(true);
  });

  it('rejects a malformed startDate', () => {
    const result = validateScalar('experience', 'startDate', '2024/01');
    expect(result.ok).toBe(false);
  });

  it('accepts null for nullable endDate', () => {
    const result = validateScalar('experience', 'endDate', null);
    expect(result.ok).toBe(true);
  });

  it('rejects empty company (required)', () => {
    const result = validateScalar('experience', 'company', '');
    expect(result.ok).toBe(false);
  });
});

describe('validateScalar: skills', () => {
  it('accepts a valid skill category enum', () => {
    const result = validateScalar('skills', 'category', 'programming_language');
    expect(result.ok).toBe(true);
  });

  it('rejects an unknown skill category', () => {
    const result = validateScalar('skills', 'category', 'not_a_category');
    expect(result.ok).toBe(false);
  });

  it('accepts null proficiency', () => {
    const result = validateScalar('skills', 'proficiency', null);
    expect(result.ok).toBe(true);
  });
});

describe('validateScalar: certifications', () => {
  it('accepts a valid http URL for credentialUrl', () => {
    const result = validateScalar('certifications', 'credentialUrl', 'https://example.com/cert');
    expect(result.ok).toBe(true);
  });

  it('rejects an invalid URL', () => {
    const result = validateScalar('certifications', 'credentialUrl', 'not-a-url');
    expect(result.ok).toBe(false);
  });

  it('accepts null for credentialUrl (nullable)', () => {
    const result = validateScalar('certifications', 'credentialUrl', null);
    expect(result.ok).toBe(true);
  });
});

describe('validateScalar: derived', () => {
  it('accepts a valid seniority enum', () => {
    const result = validateScalar('derived', 'likelySeniority', 'senior');
    expect(result.ok).toBe(true);
  });

  it('accepts a string array for primaryRoles', () => {
    const result = validateScalar('derived', 'primaryRoles', ['backend engineer']);
    expect(result.ok).toBe(true);
  });

  it('rejects empty string in array field', () => {
    const result = validateScalar('derived', 'primaryRoles', ['']);
    expect(result.ok).toBe(false);
  });
});

describe('validateScalar: education / languages / projects', () => {
  it('accepts required institution string', () => {
    const result = validateScalar('education', 'institution', 'MIT');
    expect(result.ok).toBe(true);
  });

  it('rejects empty institution', () => {
    const result = validateScalar('education', 'institution', '');
    expect(result.ok).toBe(false);
  });

  it('accepts valid language level enum', () => {
    const result = validateScalar('languages', 'level', 'fluent');
    expect(result.ok).toBe(true);
  });

  it('accepts null for language level', () => {
    const result = validateScalar('languages', 'level', null);
    expect(result.ok).toBe(true);
  });

  it('accepts a project URL', () => {
    const result = validateScalar('projects', 'url', 'http://example.com/p');
    expect(result.ok).toBe(true);
  });

  it('rejects unknown field path', () => {
    const result = validateScalar('projects', 'unknown', 'x');
    expect(result.ok).toBe(false);
  });
});
