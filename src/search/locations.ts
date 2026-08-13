const WHITESPACE_PATTERN = /\s+/g;

export interface RawLocationInput {
  readonly name: string;
  readonly geoId: string;
}

export function normalizeLocationName(value: string): string {
  return value.trim().replace(WHITESPACE_PATTERN, ' ');
}

export function isValidLocation(value: RawLocationInput): boolean {
  return (
    typeof value.geoId === 'string' &&
    value.geoId.trim().length > 0 &&
    typeof value.name === 'string' &&
    normalizeLocationName(value.name).length > 0
  );
}

export function dedupeLocationsByGeoId(values: readonly RawLocationInput[]): readonly RawLocationInput[] {
  const seen = new Set<string>();
  const out: RawLocationInput[] = [];
  for (const raw of values) {
    if (!isValidLocation(raw)) continue;
    const name = normalizeLocationName(raw.name);
    const geoId = raw.geoId.trim();
    if (seen.has(geoId)) continue;
    seen.add(geoId);
    out.push({ name, geoId });
  }
  return out;
}

export function normalizeLocations(values: readonly RawLocationInput[]): readonly RawLocationInput[] {
  return dedupeLocationsByGeoId(values);
}
