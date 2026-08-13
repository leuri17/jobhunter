import { describe, expect, it } from 'vitest';
import {
  DATE_POSTED_CHOICES,
  DATE_POSTED_F_TPR,
  DATE_POSTED_VALUES,
  DEFAULT_DATE_POSTED,
  DEFAULT_WORKPLACE_TYPES,
  DatePostedSecondsSchema,
  WORKPLACE_TYPE_CHOICES,
  WORKPLACE_TYPE_LABELS,
  WORKPLACE_TYPE_VALUES,
  WorkplaceTypeSchema,
} from '../../src/search/labels.js';

describe('labels — date posted', () => {
  it('exposes the three documented values in the documented order', () => {
    expect(DATE_POSTED_VALUES).toEqual([86400, 604800, 2592000]);
    expect(DEFAULT_DATE_POSTED).toBe(86400);
  });

  it('maps each value to the matching human label', () => {
    expect(DATE_POSTED_CHOICES).toEqual([
      { label: 'Past 24 hours', value: 86400 },
      { label: 'Past week', value: 604800 },
      { label: 'Past month', value: 2592000 },
    ]);
  });

  it('builds the f_TPR parameter with the documented prefix', () => {
    expect(DATE_POSTED_F_TPR(86400)).toBe('r86400');
    expect(DATE_POSTED_F_TPR(604800)).toBe('r604800');
    expect(DATE_POSTED_F_TPR(2592000)).toBe('r2592000');
  });

  it('accepts the three values via Zod and rejects any other number', () => {
    expect(DatePostedSecondsSchema.parse(86400)).toBe(86400);
    expect(DatePostedSecondsSchema.parse(2592000)).toBe(2592000);
    expect(() => DatePostedSecondsSchema.parse(1)).toThrow();
    expect(() => DatePostedSecondsSchema.parse(86401)).toThrow();
    expect(() => DatePostedSecondsSchema.parse('86400')).toThrow();
  });
});

describe('labels — workplace types', () => {
  it('exposes the three documented values in the documented order', () => {
    expect(WORKPLACE_TYPE_VALUES).toEqual(['1', '2', '3']);
    expect(DEFAULT_WORKPLACE_TYPES).toEqual(['1', '2', '3']);
  });

  it('maps each value to the matching human label', () => {
    expect(WORKPLACE_TYPE_CHOICES).toEqual([
      { label: 'On-site', value: '1' },
      { label: 'Remote', value: '2' },
      { label: 'Hybrid', value: '3' },
    ]);
    expect(WORKPLACE_TYPE_LABELS).toEqual({
      '1': 'On-site',
      '2': 'Remote',
      '3': 'Hybrid',
    });
  });

  it('accepts the three values via Zod and rejects any other string', () => {
    expect(WorkplaceTypeSchema.parse('1')).toBe('1');
    expect(WorkplaceTypeSchema.parse('3')).toBe('3');
    expect(() => WorkplaceTypeSchema.parse('4')).toThrow();
    expect(() => WorkplaceTypeSchema.parse('on-site')).toThrow();
    expect(() => WorkplaceTypeSchema.parse(1)).toThrow();
  });
});
