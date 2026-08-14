import { describe, expect, it } from 'vitest';

import { normalizeLanguageName, normalizeSkillName } from '../../src/profile/name-normalize.js';

describe('normalizeSkillName', () => {
  it('maps "Node.js" to normalizedName "nodejs" (SPEC §12.2)', () => {
    expect(normalizeSkillName('Node.js')).toEqual({ name: 'Node.js', normalizedName: 'nodejs' });
  });

  it('maps "NodeJS" to normalizedName "nodejs" (SPEC §12.2, case-insensitive)', () => {
    expect(normalizeSkillName('NodeJS')).toEqual({ name: 'NodeJS', normalizedName: 'nodejs' });
  });

  it('maps "React.js" to normalizedName "react" (alias map applies after normalization)', () => {
    expect(normalizeSkillName('React.js')).toEqual({ name: 'React.js', normalizedName: 'react' });
  });

  it('maps "Type Script" to normalizedName "typescript" (alias map applies to whitespace-collapsed key)', () => {
    expect(normalizeSkillName('Type Script')).toEqual({
      name: 'Type Script',
      normalizedName: 'typescript',
    });
  });

  it('maps "PostgreSQL" to normalizedName "postgresql" (SPEC §12.2)', () => {
    expect(normalizeSkillName('PostgreSQL')).toEqual({
      name: 'PostgreSQL',
      normalizedName: 'postgresql',
    });
  });

  it('returns empty trimmed name and empty normalized for whitespace-only input', () => {
    expect(normalizeSkillName('   \t  ')).toEqual({ name: '', normalizedName: '' });
  });

  it('preserves the original display value in `name` (no lowercasing of the human-readable form)', () => {
    const result = normalizeSkillName('Node.js');
    expect(result.name).toBe('Node.js');
    expect(result.name).not.toBe(result.normalizedName);
  });
});

describe('normalizeLanguageName', () => {
  it('maps "English" to normalizedName "english" (SPEC §12.2)', () => {
    expect(normalizeLanguageName('English')).toEqual({
      name: 'English',
      normalizedName: 'english',
    });
  });
});
