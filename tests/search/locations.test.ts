import { describe, expect, it } from 'vitest';
import {
  dedupeLocationsByGeoId,
  isValidLocation,
  normalizeLocationName,
  normalizeLocations,
  type RawLocationInput,
} from '../../src/search/locations.js';

const rotterdam: RawLocationInput = { name: 'Rotterdam', geoId: '100467493' };
const amsterdam: RawLocationInput = { name: 'Amsterdam', geoId: '101889610' };

describe('normalizeLocationName', () => {
  it('trims and collapses internal whitespace', () => {
    expect(normalizeLocationName('   San  Francisco   ')).toBe('San Francisco');
  });
});

describe('dedupeLocationsByGeoId / normalizeLocations', () => {
  it('drops later occurrences with the same geoId', () => {
    expect(
      normalizeLocations([rotterdam, amsterdam, { name: 'Rotterdam Area', geoId: '100467493' }]),
    ).toEqual([rotterdam, amsterdam]);
  });

  it('preserves the first-occurrence name for every geoId', () => {
    expect(
      normalizeLocations([
        { name: 'Rotterdam', geoId: '100467493' },
        { name: 'Rotterdam, South Holland', geoId: '100467493' },
      ]),
    ).toEqual([{ name: 'Rotterdam', geoId: '100467493' }]);
  });

  it('preserves deterministic insertion order', () => {
    expect(normalizeLocations([amsterdam, rotterdam])).toEqual([amsterdam, rotterdam]);
  });

  it('skips entries with empty or whitespace-only names', () => {
    expect(
      normalizeLocations([
        { name: '   ', geoId: '100467493' },
        { name: 'Amsterdam', geoId: '101889610' },
        { name: '', geoId: '101889611' },
      ]),
    ).toEqual([amsterdam]);
  });

  it('skips entries with empty geoId', () => {
    expect(normalizeLocations([{ name: 'Rotterdam', geoId: '' }, amsterdam])).toEqual([amsterdam]);
  });

  it('returns an empty array when nothing valid is provided', () => {
    expect(dedupeLocationsByGeoId([])).toEqual([]);
    expect(dedupeLocationsByGeoId([{ name: '  ', geoId: '' }])).toEqual([]);
  });
});

describe('isValidLocation', () => {
  it('accepts trimmed non-empty name and geoId', () => {
    expect(isValidLocation({ name: 'Rotterdam', geoId: '100467493' })).toBe(true);
    expect(isValidLocation({ name: '  Rotterdam  ', geoId: '  100467493  ' })).toBe(true);
  });
  it('rejects empty name or empty geoId', () => {
    expect(isValidLocation({ name: '', geoId: '100467493' })).toBe(false);
    expect(isValidLocation({ name: 'Rotterdam', geoId: '' })).toBe(false);
    expect(isValidLocation({ name: '   ', geoId: '   ' })).toBe(false);
  });
});
