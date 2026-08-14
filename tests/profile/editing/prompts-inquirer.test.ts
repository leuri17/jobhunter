import { describe, expect, it } from 'vitest';

import {
  InquirerProfileEditorPrompts,
  clearSentinel,
  defaultInquirerEditorPrompts,
  derivedFields,
  languageLevels,
  sectionKind,
  sectionLabels,
  seniorityLevels,
  skillCategories,
} from '../../../src/profile/editing/prompts-inquirer.js';
import type { ProfileEditorPrompts } from '../../../src/profile/editing/prompts.js';

describe('InquirerProfileEditorPrompts construction', () => {
  it('constructs without throwing', () => {
    const prompts = new InquirerProfileEditorPrompts();
    expect(prompts).toBeInstanceOf(InquirerProfileEditorPrompts);
  });

  it('exposes every interface method', () => {
    const prompts = new InquirerProfileEditorPrompts();
    const required: (keyof ProfileEditorPrompts)[] = [
      'selectSection',
      'editScalar',
      'editCollection',
      'resolveConflict',
      'manageOverrides',
      'showReview',
      'confirmSave',
      'confirmDiscard',
    ];
    for (const method of required) {
      expect(typeof prompts[method]).toBe('function');
    }
  });

  it('defaultInquirerEditorPrompts is a pre-constructed instance', () => {
    expect(defaultInquirerEditorPrompts).toBeInstanceOf(InquirerProfileEditorPrompts);
  });
});

describe('InquirerProfileEditorPrompts helpers', () => {
  it('sectionLabels returns one label per SectionKey', () => {
    const labels = sectionLabels();
    expect(Object.keys(labels)).toEqual(
      expect.arrayContaining([
        'basics',
        'experience',
        'skills',
        'languages',
        'education',
        'certifications',
        'projects',
        'derived',
        'warnings',
        'review',
        'save',
        'discard',
        'exit',
      ]),
    );
  });

  it('sectionKind classifies sections correctly', () => {
    expect(sectionKind('basics')).toBe('scalar');
    expect(sectionKind('derived')).toBe('scalar');
    expect(sectionKind('experience')).toBe('collection');
    expect(sectionKind('skills')).toBe('collection');
    expect(sectionKind('review')).toBe('meta');
    expect(sectionKind('save')).toBe('meta');
    expect(sectionKind('exit')).toBe('meta');
  });

  it('derivedFields lists all four derived keys', () => {
    const fields = derivedFields();
    expect(fields.map((f) => f.key)).toEqual([
      'likelySeniority',
      'primaryRoles',
      'primaryDomains',
      'strongestSkills',
    ]);
  });

  it('clearSentinel returns a non-empty string', () => {
    const sentinel = clearSentinel();
    expect(typeof sentinel).toBe('string');
    expect(sentinel.length).toBeGreaterThan(0);
  });

  it('level/category enumerators return the schema enums', () => {
    expect(seniorityLevels()).toContain('senior');
    expect(seniorityLevels()).toContain('staff');
    expect(languageLevels()).toContain('fluent');
    expect(skillCategories()).toContain('programming_language');
  });
});
